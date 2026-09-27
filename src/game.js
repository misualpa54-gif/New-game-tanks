/* ============================================================================
 * game.js — renderer, world, combat rules, waves, camera, game states
 * ==========================================================================*/
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { BOSS_EVERY, BOSS_ROTATION, CAMERA, ENEMIES, MODELS, PICKUPS, QUALITY, SCORE, SPAWN, TANK, TEXTURES, WORLD } from './config.js';
import { clamp, clamp01, damp, lerp, rand, storage, weightedPick } from './core/util.js';
import { AudioSystem } from './core/audio.js';
import { Input } from './core/input.js';
import { TextureLibrary } from './world/textures.js';
import { TerrainMaterial, WaterSystem, biomeAt, terrainHeight } from './world/terrain.js';
import { PropMaterials } from './world/props.js';
import { ChunkManager } from './world/chunks.js';
import { SkySystem } from './world/sky.js';
import { CreatureMaterials, ModelLibrary, buildPlayerTank } from './world/models.js';
import { ParticleSystem } from './entities/particles.js';
import { ProjectileSystem } from './entities/projectiles.js';
import { EnemyManager } from './entities/enemies.js';
import { PickupManager } from './entities/pickups.js';
import { Player } from './entities/player.js';
import { HUD } from './ui/hud.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _look = new THREE.Vector3();
const _props = [];

const DUST = { plains: 0xa08d6c, forest: 0x7d6e52, desert: 0xd8c092, stone: 0x9a948a, snow: 0xe8f0f6, volcanic: 0x5a4a44 };

export class Game {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;
    this.qualityName = settings.quality;
    this.q = QUALITY[this.qualityName] || QUALITY.medium;
    this.state = 'loading';
    this.time = 0;
    this.timeScale = 1;
    this.shake = 0;
    this.listeners = {};
    this.best = storage.get('ironverge.best', { score: 0, wave: 0 });
  }

  on(ev, fn) { this.listeners[ev] = fn; }
  emit(ev, data) { if (this.listeners[ev]) this.listeners[ev](data); }

  /* ======================================================================= */
  async init(progress = () => {}) {
    const q = this.q;
    progress(0.04, 'Starting WebGL renderer');

    const r = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: !q.bloom && this.qualityName !== 'low',
      powerPreference: 'high-performance', alpha: false, stencil: false
    });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 0.92;
    r.shadowMap.enabled = q.shadowMap > 0;
    r.shadowMap.type = THREE.PCFShadowMap;
    this.maxPR = Math.min(window.devicePixelRatio || 1, q.pixelRatio);
    this.pixelRatio = this.maxPR;
    r.setPixelRatio(this.pixelRatio);
    r.setSize(window.innerWidth, window.innerHeight, false);
    r.debug.onShaderError = (gl, program, vs, fs) => {
      console.error('[shader]', gl.getShaderInfoLog(fs) || gl.getShaderInfoLog(vs) || gl.getProgramInfoLog(program));
      if (this.terrainMat && !this.terrainMat.broken) {
        this.terrainMat.markBroken();
        if (this.chunks) this.chunks.applyTerrainMaterial();
      }
    };
    this.renderer = r;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xa8b6b0);
    this.scene = scene;
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far);
    this.camera.position.set(0, 30, -20);

    this.setupComposer();

    progress(0.1, 'Painting procedural PBR materials');
    await frame();
    this.lib = new TextureLibrary(q);
    this.lib.applyAnisotropy(Math.min(8, r.capabilities.getMaxAnisotropy()));

    progress(0.2, 'Streaming free textures (grass, water, smoke)');
    await withTimeout(this.lib.loadCore(), 9000);

    progress(0.3, 'Building sky & lighting');
    this.sky = new SkySystem(scene, r, this.lib, this.qualityName);
    this.sky.buildProceduralSky();
    if (q.envHdr) {
      progress(0.34, 'Downloading HDRI environment (quarry_01, CC0)');
      await withTimeout(this.sky.loadHDRI(TEXTURES.env.url), 10000);
    }

    progress(0.42, 'Growing the infinite world');
    this.terrainMat = new TerrainMaterial(this.lib);
    this.propMats = new PropMaterials(this.lib);
    this.chunks = new ChunkManager(scene, this.lib, this.propMats, this.qualityName);
    this.chunks.setTerrainMaterial(this.terrainMat);
    this.water = new WaterSystem(this.lib);
    scene.add(this.water.mesh);

    progress(0.5, 'Assembling your tank');
    this.cmats = new CreatureMaterials(this.lib);
    this.tank = buildPlayerTank(this.lib, this.cmats);
    scene.add(this.tank.group);
    this.player = new Player(this.tank);
    const spawn = findDrySpawn();
    this.player.reset(spawn.x, spawn.z);

    progress(0.55, 'Downloading creature models (glTF)');
    this.models = new ModelLibrary(this.lib, this.cmats, this.qualityName);
    const glbKeys = [...new Set(Object.values(ENEMIES).map((e) => e.visual).filter((v) => v.startsWith('glb:')).map((v) => v.slice(4)))];
    await withTimeout(this.models.preload(glbKeys, (d, t, k) => progress(0.55 + (d / t) * 0.2, `Model ${d}/${t}: ${k}`)), 25000);
    for (const k of Object.keys(ENEMIES)) this.models.template(k);

    progress(0.76, 'Generating terrain chunks');
    await this.chunks.buildInitial(this.player.pos, (d, t) => progress(0.76 + (d / t) * 0.16, `Terrain ${d}/${t}`));

    this.particles = new ParticleSystem(scene, this.lib, q);
    this.projectiles = new ProjectileSystem(scene, this.lib, this.particles, this.cmats);
    this.enemies = new EnemyManager(scene, this.models, this.particles, this.projectiles);
    this.pickups = new PickupManager(scene, this.lib);
    this.hud = new HUD();
    this.audio = new AudioSystem();
    this.audio.setEnabled(this.settings.sound !== 'off');
    this.input = new Input();
    this.input.onAnyGesture = () => this.audio.unlock();
    this.input.onPause = () => { if (this.state === 'playing') this.pause(); else if (this.state === 'paused') this.resume(); };
    this.wireCallbacks();

    progress(0.94, 'Compiling shaders');
    await this.precompile();

    // extra photo-scans stream in the background
    this.lib.loadExtra();
    this.lib.loadLava();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    this.resize();

    this.last = performance.now();
    this.frameTimes = [];
    this.state = 'menu';
    progress(1, 'Ready');
    requestAnimationFrame((t) => this.loop(t));
    return this;
  }

  setupComposer() {
    const q = this.q;
    this.composer = null;
    if (!q.bloom) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: this.renderer.capabilities.isWebGL2 === false ? 0 : 4 });
    const c = new EffectComposer(this.renderer, rt);
    c.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.3, 0.45, 1.05);
    c.addPass(this.bloom);
    c.addPass(new OutputPass());
    this.composer = c;
  }

  async precompile() {
    // put one of every creature in front of the camera so their shaders compile now, not mid-fight
    const tmp = new THREE.Group();
    for (const k of Object.keys(ENEMIES)) {
      const inst = this.models.instance(k, 1);
      if (!inst) continue;
      inst.group.position.set(this.player.pos.x + rand(-5, 5), this.player.pos.y, this.player.pos.z + 12);
      tmp.add(inst.group);
    }
    this.scene.add(tmp);
    this.pickups.spawn(this.player.pos, 'repair');
    this.updateCamera(1, true);
    try {
      if (this.renderer.compileAsync) await withTimeout(this.renderer.compileAsync(this.scene, this.camera), 8000);
      else this.renderer.compile(this.scene, this.camera);
    } catch (e) { /* not fatal */ }
    this.render();
    this.scene.remove(tmp);
    this.pickups.clear();
  }

  /* ======================================================================= */
  wireCallbacks() {
    const E = this.enemies;
    E.callbacks.onKill = (e) => this.onKill(e);
    E.callbacks.onPlayerDamage = (amount, src, pos, knock) => this.damagePlayer(amount, src ? src.name : 'hit', pos, knock);
    E.callbacks.onAttackSound = (kind, pos) => this.audio.play(kind, pos);
    E.callbacks.onShake = (p) => this.addShake(p);
    E.callbacks.onContact = (e) => {
      const p = this.player;
      if (e.ramCd > 0) return;
      e.ramCd = 0.55;
      const heavy = e.maxHp > 120;
      const ram = p.speed * (heavy ? 0.9 : 2.2) * (p.overdrive > 0 ? 2 : 1);
      if (p.speed > 6) {
        this.hitEnemy(e, ram, p.pos, false);
        this.particles.impact(_v.set(e.pos.x, e.pos.y + 1, e.pos.z), _v2.set(0, 1, 0), { power: 1, dirt: true });
        this.audio.play('bump', e.pos);
        this.addShake(heavy ? 0.5 : 0.25);
      }
      if (heavy) p.speed *= 0.45;
    };
    this.hooks = {
      chunks: this.chunks, enemies: this.enemies.list, player: this.player, playerPos: this.player.pos,
      onGroundHit: (p, pos) => {
        if (pos.y < WORLD.waterLevel + 0.4 && terrainHeight(pos.x, pos.z) < WORLD.waterLevel) {
          _v.set(pos.x, WORLD.waterLevel, pos.z);
          this.particles.splash(_v, p.kind === 'shell' ? 1.4 : 0.8);
          if (p.splash > 0) this.splashDamage(p, _v, 0.7);
          return;
        }
        if (p.splash > 0) this.explodeProjectile(p, pos, 1);
        else { this.particles.impact(pos, _v2.set(0, 1, 0), { power: 0.6, dirt: true }); this.audio.play('impact', pos); }
      },
      onPropHit: (p, c, n) => {
        if (p.byPlayer && p.kind === 'shell') {
          const breakable = c.explosive || ['pine', 'oak', 'palm', 'dead', 'column', 'bush', 'crate', 'barrel', 'crystal', 'shroom'].includes(c.kind) && c.r < 1.1;
          if (breakable) this.destroyProp(c, true);
        }
        if (p.splash > 0) this.explodeProjectile(p, p.pos, 0.9);
        else { this.particles.impact(p.pos, n, { power: 0.7 }); this.audio.play('impact', p.pos); }
      },
      onLavaHit: (p, pos) => { this.particles.lavaSplash(pos, 1); },
      onHitEnemy: (p, e, n) => {
        this.hitEnemy(e, p.damage, p.pos, true);
        if (p.splash > 0) this.explodeProjectile(p, p.pos, 1, e);
        else this.particles.impact(p.pos, n, { power: 0.7 });
      },
      onHitPlayer: (p, pl) => {
        this.damagePlayer(p.damage, p.owner ? p.owner.name : 'fire', p.pos, 1.5);
        if (p.splash > 0) this.explodeProjectile(p, p.pos, 0.7, null, true);
        else this.particles.impact(p.pos, _v2.set(0, 1, 0), { power: 0.8, color: 0xffb080 });
      },
      onExplode: (p, pos, s) => this.explodeProjectile(p, pos, s)
    };
  }

  /* ---- combat helpers ---- */
  hitEnemy(e, dmg, from, fromShell) {
    if (!e.alive || e.dying) return;
    const crit = fromShell && Math.random() < 0.12;
    const amount = Math.round(dmg * (crit ? 2 : 1) * (this.player.overdrive > 0 ? 1.25 : 1));
    const killed = this.enemies.damage(e, amount, from);
    this.hud.floatText(_v.set(e.pos.x, e.pos.y + e.height + 1.2, e.pos.z), (crit ? 'CRIT ' : '') + amount, crit ? '#ffd36a' : killed ? '#ff8a5a' : '#ffffff', crit ? 26 : 20);
    if (!killed) {
      const organic = !/mech|sentry|idol|golem|titan/.test(e.type);
      if (organic) this.particles.ichor(e.center, e.type === 'wraith' ? 0x6affd8 : 0x8a1f2a, 0.6);
    }
  }

  explodeProjectile(p, pos, scale = 1, direct = null, onPlayer = false) {
    const power = (p.kind === 'shell' ? 1.1 : p.kind === 'boulder' ? 1.0 : p.kind === 'bomb' ? 1.3 : 0.55) * scale;
    if (p.kind === 'boulder') {
      this.particles.explosion(pos, { power, color: 0xd8b070, smokeColor: 0x6b5d4a, debrisColor: 0x7b736a });
    } else if (p.kind === 'bolt' || p.kind === 'spell' || p.kind === 'plasma') {
      this.particles.magicBurst(pos, p.color, power * 1.4);
    } else if (p.kind === 'flame') {
      this.particles.lavaSplash(pos, 0.5);
    } else {
      this.particles.explosion(pos, { power, color: p.byPlayer ? 0xffa53a : 0xff6a2a, debrisColor: DUST[this.biomeName] || 0x5c5347 });
    }
    if (p.kind !== 'flame') {
      this.sky.flash(pos, p.kind === 'shell' || p.kind === 'bomb' ? 0xffa050 : p.color, 30 * power, 30 * power, 0.25);
      this.audio.play(p.kind === 'shell' || p.kind === 'bomb' || p.kind === 'boulder' ? 'explode' : 'impact', pos, power);
    }
    const d = pos.distanceTo(this.player.pos);
    this.addShake(clamp(power * 0.5 * (1 - d / 60), 0, 0.8));
    this.splashDamage(p, pos, scale, direct, onPlayer);
  }

  splashDamage(p, pos, scale = 1, direct = null, skipPlayer = false) {
    const R = p.splash * scale;
    if (R <= 0) return;
    if (p.byPlayer) {
      for (const e of this.enemies.list) {
        if (e === direct || !e.alive || e.dying) continue;
        const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z) - e.radius;
        if (d < R && Math.abs(e.pos.y + e.height * 0.5 - pos.y) < R + e.height) {
          this.hitEnemy(e, p.splashDamage * (1 - clamp01(d / R) * 0.7), pos, false);
        }
      }
      // chain-react barrels & crates
      for (const rec of this.chunks.queryProps(pos.x, pos.z, R + 1, _props).slice()) {
        if (rec.explosive) setTimeout(() => this.destroyProp({ rec, x: rec.x, z: rec.z, kind: rec.key, explosive: true }, true), 90 + Math.random() * 140);
      }
    } else if (!skipPlayer) {
      const d = Math.hypot(this.player.pos.x - pos.x, this.player.pos.z - pos.z) - this.player.radius;
      if (d < R) this.damagePlayer(p.splashDamage * (1 - clamp01(d / R) * 0.7), p.owner ? p.owner.name : 'blast', pos, 1);
    }
  }

  destroyProp(c, byShell = false) {
    const rec = c.rec;
    if (!rec || rec.gone) return;
    rec.gone = true;
    this.chunks.destroyProp(rec);
    _v.set(rec.x, rec.y + 0.8, rec.z);
    const woody = ['pine', 'oak', 'palm', 'dead', 'crate', 'bush', 'fern', 'tuft'].includes(rec.key);
    if (rec.explosive && rec.key === 'barrel') {
      this.particles.explosion(_v, { power: 1.6, color: 0xff8a2a, debrisColor: 0x7a6a52 });
      this.sky.flash(_v, 0xff8a3a, 45, 36, 0.3);
      this.audio.play('explode', _v, 1.4);
      this.addShake(0.5 * (1 - clamp01(_v.distanceTo(this.player.pos) / 50)));
      this.splashDamage({ splash: 7, splashDamage: 45, byPlayer: true }, _v, 1);
      const d = Math.hypot(this.player.pos.x - rec.x, this.player.pos.z - rec.z);
      if (d < 6) this.damagePlayer(6, 'fuel barrel', _v, 1);
    } else {
      for (let i = 0; i < (woody ? 10 : 7); i++) {
        this.particles.debris.emit(_v.x, _v.y + rand(0, rec.height * 0.5), _v.z, {
          color: woody ? (rec.key === 'bush' || rec.key === 'fern' || rec.key === 'tuft' ? 0x4d7a34 : 0x6b4f34) : rec.key === 'crystal' ? 0x9fe8ff : 0x8a847a,
          size: rand(0.2, 0.55), vy: rand(3, 9)
        });
      }
      this.particles.dust(_v, 1.2, woody ? 0x6b5a3a : 0x9a948a);
      if (rec.key === 'crystal') this.particles.magicBurst(_v, 0x9fe8ff, 1);
      if (rec.key === 'crate' && Math.random() < 0.3) this.pickups.spawn(_v);
      this.score += 5;
    }
  }

  damagePlayer(amount, source, pos, knock = 0) {
    const p = this.player;
    if (!p.alive || this.state !== 'playing') return;
    const dealt = p.hurt(amount);
    this.audio.play('hitPlayer');
    this.hud.flash(p.shield > 0 ? 'rgba(160,120,255,0.3)' : 'rgba(255,50,30,0.32)');
    this.addShake(clamp(dealt / 25, 0.15, 0.9));
    this.hud.floatText(_v.set(p.pos.x, p.pos.y + 3.5, p.pos.z), '-' + Math.round(dealt), p.shield > 0 ? '#c9a8ff' : '#ff5a4a', 20);
    if (knock && pos) {
      p.speed = Math.max(TANK.minSpeed * 0.5, p.speed - knock * 1.2);
    }
    if (navigator.vibrate) { try { navigator.vibrate(Math.min(80, 20 + dealt * 2)); } catch (_) { /* */ } }
    if (!p.alive) this.gameOver(source);
  }

  onKill(e) {
    const spec = e.spec;
    this.kills++;
    this.combo = this.comboT > 0 ? Math.min(SCORE.comboMax, this.combo + 1) : 1;
    this.comboT = SCORE.comboWindow;
    const pts = Math.round(spec.score * this.combo * (1 + this.wave * 0.05));
    this.score += pts;
    this.hud.floatText(_v.set(e.pos.x, e.pos.y + e.height + 2, e.pos.z), '+' + pts, '#ffd36a', spec.boss ? 34 : 22, 1.2);
    this.hud.feed(`${spec.name} destroyed${this.combo > 1 ? ' ×' + this.combo : ''}`, spec.boss ? 'boss' : '');
    this.audio.play(spec.boss ? 'explode' : 'kill', e.pos, spec.boss ? 3 : 1 + this.combo * 0.1);
    this.sky.flash(e.center, spec.accent, spec.boss ? 90 : 25, spec.boss ? 80 : 26, spec.boss ? 0.8 : 0.25);
    if (spec.boss) {
      this.addShake(1.2);
      this.timeScale = 0.35; this.slowT = 1.2;
      this.hud.showBanner(spec.name.toUpperCase() + ' SLAIN', '+' + pts + ' points', '#ffd36a', 3);
      for (let i = 0; i < 3; i++) this.pickups.spawn(_v.set(e.pos.x + rand(-6, 6), 0, e.pos.z + rand(-6, 6)), i === 0 ? 'relic' : null);
    } else if (Math.random() < (spec.drops || 0.2) * 0.9) {
      this.pickups.spawn(e.pos);
    }
  }

  collect(pk) {
    const p = this.player, d = pk.def;
    switch (pk.kind) {
      case 'repair': p.heal(d.value); break;
      case 'coolant': p.heat = 0; p.overheated = 0; break;
      case 'overdrive': p.overdrive = TANK.overdriveTime; break;
      case 'shield': p.shield = TANK.shieldTime; break;
      case 'relic': this.score += d.value * (1 + this.wave * 0.1) | 0; break;
    }
    this.particles.pickupBurst(_v.set(pk.pos.x, pk.pos.y + 1.6, pk.pos.z), d.color);
    this.audio.play('pickup');
    this.hud.feed(d.name + (pk.kind === 'repair' ? ' +' + d.value : ''), 'pickup');
    this.hud.flash('rgba(' + ((d.color >> 16) & 255) + ',' + ((d.color >> 8) & 255) + ',' + (d.color & 255) + ',0.18)', 120);
  }

  addShake(p) { if (this.settings.shake !== 'off') this.shake = Math.min(1.2, this.shake + p); }

  /* ======================================================================= */
  /* waves */
  startRun() {
    this.enemies.clear();
    this.projectiles.clear();
    this.pickups.clear();
    this.particles.clear();
    const s = findDrySpawn(Math.floor(rand(-40, 40)) * 97);
    this.player.reset(s.x, s.z);
    this.player.yaw = rand(0, Math.PI * 2);
    this.tank.group.visible = true;
    this.tank.hullMesh.material.color.setHex(0xffffff);
    this.score = 0; this.kills = 0; this.combo = 1; this.comboT = 0;
    this.wave = 0; this.waveState = 'intermission'; this.waveT = 1.6;
    this.toSpawn = 0; this.spawnT = 0; this.pickupT = SPAWN.pickupEvery;
    this.lastDist = 0; this.timeScale = 1; this.slowT = 0;
    this.runTime = 0;
    this.chunks.update(this.player.pos.x, this.player.pos.z, 99);
    this.updateCamera(1, true);
    this.state = 'playing';
    this.input.enabled = true;
    this.hud.show(true);
    this.audio.unlock();
    this.audio.play('wave');
  }

  nextWave() {
    this.wave++;
    const boss = this.wave % BOSS_EVERY === 0;
    this.toSpawn = Math.round(SPAWN.baseCount + this.wave * SPAWN.perWave) - (boss ? 3 : 0);
    this.waveState = 'spawning';
    this.spawnT = 0.4;
    if (boss) {
      const type = BOSS_ROTATION[(this.wave / BOSS_EVERY - 1) % BOSS_ROTATION.length];
      const spec = ENEMIES[type];
      this.spawnEnemy(type, 95);
      this.hud.showBanner('WAVE ' + this.wave + ' — ' + spec.name.toUpperCase(), 'A boss approaches', '#ff5a6a', 3.2);
      this.audio.play('boss');
      this.audio.play('roar');
    } else {
      this.hud.showBanner('WAVE ' + this.wave, this.toSpawn + ' hostiles inbound', '#ffd36a', 2.2);
      this.audio.play('wave');
    }
  }

  pickType() {
    const list = [];
    for (const [key, s] of Object.entries(ENEMIES)) {
      if (s.boss || !s.weight || s.minWave > this.wave) continue;
      // newest arrivals get a bonus so each wave feels fresh
      list.push({ key, weight: s.weight * (s.minWave === this.wave ? 1.8 : 1) });
    }
    return list.length ? weightedPick(list).key : 'wolf';
  }

  spawnEnemy(type, dist = null) {
    const spec = ENEMIES[type];
    const p = this.player;
    for (let attempt = 0; attempt < 10; attempt++) {
      const yaw = p.yaw + rand(-1.25, 1.25) * (attempt > 5 ? 2 : 1);
      const r = dist != null ? dist : rand(SPAWN.spawnRingMin, SPAWN.spawnRingMax);
      const x = p.pos.x + Math.sin(yaw) * r, z = p.pos.z + Math.cos(yaw) * r;
      const h = terrainHeight(x, z);
      if (!spec.flying && h < WORLD.waterLevel + 0.4) continue;
      return this.enemies.spawn(type, _v.set(x, h, z));
    }
    return null;
  }

  updateWaves(dt) {
    const maxAlive = Math.min(this.q.maxEnemies, SPAWN.maxAliveBase + this.wave);
    if (this.waveState === 'intermission') {
      this.waveT -= dt;
      if (this.waveT <= 0) this.nextWave();
    } else if (this.waveState === 'spawning') {
      this.spawnT -= dt;
      if (this.spawnT <= 0 && this.toSpawn > 0 && this.enemies.aliveCount < maxAlive) {
        this.spawnT = SPAWN.spawnInterval * rand(0.6, 1.3);
        // pack spawns: animals arrive in small groups
        const type = this.pickType();
        const pack = ['wolf', 'spider', 'harpy', 'stork'].includes(type) ? Math.min(this.toSpawn, 1 + (Math.random() * 3 | 0)) : 1;
        for (let i = 0; i < pack; i++) { if (this.spawnEnemy(type)) this.toSpawn--; else break; }
      }
      if (this.toSpawn <= 0) this.waveState = 'fighting';
    } else if (this.waveState === 'fighting') {
      if (this.enemies.aliveCount === 0) {
        this.waveState = 'intermission';
        this.waveT = SPAWN.waveDelay;
        const bonus = 100 * this.wave;
        this.score += bonus;
        this.hud.showBanner('WAVE CLEARED', '+' + bonus + ' bonus', '#7dff9a', 2);
        // reward drop in front of the tank
        const p = this.player;
        this.pickups.spawn(_v.set(p.pos.x + p.forward.x * 40, 0, p.pos.z + p.forward.z * 40));
      }
    }
    // guaranteed supply drop every N seconds
    this.pickupT -= dt;
    if (this.pickupT <= 0) {
      this.pickupT = SPAWN.pickupEvery;
      const p = this.player;
      const yaw = p.yaw + rand(-0.5, 0.5);
      this.pickups.spawn(_v.set(p.pos.x + Math.sin(yaw) * 55, 0, p.pos.z + Math.cos(yaw) * 55));
    }
  }

  /* ======================================================================= */
  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.releaseAll();
    this.audio.updateEngine(0, false);
    this.emit('pause', this.runStats());
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.last = performance.now();
    this.emit('resume');
  }
  quitToMenu() {
    this.state = 'menu';
    this.hud.show(false);
    this.input.enabled = false;
    this.enemies.clear(); this.projectiles.clear(); this.pickups.clear();
    this.audio.updateEngine(0, false);
  }

  runStats() {
    return { score: Math.floor(this.score || 0), wave: this.wave || 0, kills: this.kills || 0, distance: this.player.distance, time: this.runTime || 0 };
  }

  gameOver(source) {
    if (this.state !== 'playing') return;
    this.state = 'dying';
    this.dyingT = 0;
    this.timeScale = 0.3;
    const p = this.player;
    _v.set(p.pos.x, p.pos.y + 1.5, p.pos.z);
    this.particles.explosion(_v, { power: 3.5, color: 0xff7a2a });
    this.sky.flash(_v, 0xff7a2a, 120, 80, 1.0);
    this.audio.play('explode', null, 3);
    this.audio.play('gameover');
    this.addShake(1.2);
    this.tank.hullMesh.material.color.setHex(0x2a2522);
    this.deathSource = source;
    const stats = this.runStats();
    const newBest = stats.score > this.best.score;
    if (newBest) this.best = { score: stats.score, wave: stats.wave };
    else this.best.wave = Math.max(this.best.wave, stats.wave);
    storage.set('ironverge.best', this.best);
    this.finalStats = { ...stats, source, newBest };
  }

  /* ======================================================================= */
  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    // portrait phones: widen FOV so the road ahead stays visible
    this.camera.fov = w < h ? CAMERA.fov + 12 : CAMERA.fov;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, false);
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
    }
    const db = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.particles.resize(db.y);
    this.hud.resize();
  }

  /** adaptive resolution keeps mobile at a steady frame rate */
  adaptResolution(frameMs) {
    this.frameTimes.push(frameMs);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes.length = 0;
    let pr = this.pixelRatio;
    if (avg > 24 && pr > 0.6) pr = Math.max(0.6, pr - 0.15);
    else if (avg < 14 && pr < this.maxPR) pr = Math.min(this.maxPR, pr + 0.1);
    if (pr !== this.pixelRatio) { this.pixelRatio = pr; this.resize(); }
  }

  updateCamera(dt, snap = false) {
    const p = this.player;
    const portrait = window.innerWidth < window.innerHeight;
    const hgt = (this.settings.camHeight || CAMERA.height) * (portrait ? 1.15 : 1);
    const back = CAMERA.back * (hgt / CAMERA.height) * (portrait ? 0.85 : 1);
    const f = p.forward;
    const tx = p.pos.x - f.x * back, tz = p.pos.z - f.z * back;
    const ty = Math.max(p.pos.y, WORLD.waterLevel) + hgt;
    const ahead = CAMERA.lookAhead + p.speed * 0.35;
    _look.set(p.pos.x + f.x * ahead, p.pos.y + 1, p.pos.z + f.z * ahead);
    if (snap) {
      this.camera.position.set(tx, ty, tz);
      this.camLook = _look.clone();
    } else {
      const c = this.camera.position;
      c.x = damp(c.x, tx, CAMERA.dampPos, dt);
      c.y = damp(c.y, ty, CAMERA.dampPos * 0.7, dt);
      c.z = damp(c.z, tz, CAMERA.dampPos, dt);
      this.camLook.x = damp(this.camLook.x, _look.x, CAMERA.dampLook, dt);
      this.camLook.y = damp(this.camLook.y, _look.y, CAMERA.dampLook, dt);
      this.camLook.z = damp(this.camLook.z, _look.z, CAMERA.dampLook, dt);
    }
    // never clip into a hill
    const gh = terrainHeight(this.camera.position.x, this.camera.position.z) + 4;
    if (this.camera.position.y < gh) this.camera.position.y = gh;
    this.camera.lookAt(this.camLook);
    if (this.shake > 0.001) {
      const s = this.shake * this.shake;
      this.camera.position.x += rand(-1, 1) * s * 1.1;
      this.camera.position.y += rand(-1, 1) * s * 0.8;
      this.camera.rotation.z += rand(-1, 1) * s * 0.03;
    }
  }

  menuCamera(dt) {
    const p = this.player;
    this.menuAngle = (this.menuAngle || 0) + dt * 0.12;
    const r = 16;
    this.camera.position.set(p.pos.x + Math.sin(this.menuAngle) * r, p.pos.y + 7.5, p.pos.z + Math.cos(this.menuAngle) * r);
    this.camera.lookAt(p.pos.x, p.pos.y + 1.6, p.pos.z);
  }

  /* ======================================================================= */
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const rawMs = now - this.last;
    this.last = now;
    if (document.hidden) return;
    let dt = Math.min(0.05, Math.max(0, rawMs / 1000));
    this.adaptResolution(rawMs);

    if (this.state === 'paused' || this.state === 'loading') { this.render(); return; }
    this.step(dt);
    this.render();
  }

  /** advance the simulation by dt seconds (no rendering) */
  step(dt) {
    if (this.slowT > 0) { this.slowT -= dt; if (this.slowT <= 0) this.timeScale = 1; }
    const sdt = dt * this.timeScale;
    this.time += sdt;

    const p = this.player;
    const playing = this.state === 'playing';

    if (playing || this.state === 'dying') {
      this.runTime += playing ? dt : 0;
      const b = biomeAt(p.pos.x, p.pos.z);
      this.biomeName = b.name;
      const inputState = playing ? this.input.state : { left: false, right: false, fire: false };
      p.update(sdt, inputState, {
        chunks: this.chunks, enemies: this.enemies.list, particles: this.particles,
        aimMode: this.settings.aim, dustColor: DUST[b.name],
        onCrush: (c) => { this.destroyProp(c); this.audio.play('crush', c); p.speed *= 0.93; this.addShake(0.08); },
        onBump: (c, impact) => {
          this.audio.play('bump');
          this.addShake(clamp(impact / 30, 0.1, 0.6));
          this.particles.impact(_v.set(c.x, p.pos.y + 1, c.z), _v2.set(p.pos.x - c.x, 0.5, p.pos.z - c.z).normalize(), { power: 0.8, dirt: true });
          if (impact > 11) this.damagePlayer((impact - 11) * 0.5, 'collision', null, 0);
        },
        onLava: () => { this.damagePlayer(4, 'lava', null, 0); this.particles.lavaSplash(p.pos, 0.6); },
        onLand: (v) => { this.addShake(clamp(v / 30, 0.1, 0.5)); this.particles.dust(p.pos, 2, DUST[b.name]); this.audio.play('bump'); }
      });

      // firing
      if (playing && this.input.state.fire) {
        if (p.canFire) {
          const shot = p.tryFire();
          if (shot) {
            const pr = this.projectiles.spawn('shell', shot.pos, shot.dir, {
              byPlayer: true, owner: p, speed: TANK.shellSpeed, damage: TANK.shellDamage * (p.overdrive > 0 ? 1.1 : 1),
              splash: TANK.shellSplash, splashDamage: TANK.shellSplashDamage, gravity: TANK.shellGravity
            });
            void pr;
            this.particles.muzzleFlash(shot.pos, shot.dir, 1);
            this.sky.flash(shot.pos, 0xffc070, TANK.muzzleLight * 8, 24, 0.09);
            this.audio.play('cannon');
            this.addShake(CAMERA.kickFire * 0.4);
            if (p.overheated > 0) { this.audio.play('overheat'); this.hud.feed('BARREL OVERHEATED', 'warn'); }
          }
        } else if (p.overheated > 0) this.audio.play('dry');
      }

      if (p.hp < p.maxHp * 0.35 && p.alive) this.particles.burningTrail(_v.set(p.pos.x, p.pos.y + 1.6, p.pos.z), 1 - p.hp / p.maxHp);

      this.enemies.update(sdt, p, this.chunks, this.time);
      this.projectiles.update(sdt, this.hooks);
      this.pickups.update(sdt, p, (pk) => this.collect(pk));
      if (playing) {
        this.updateWaves(sdt);
        this.comboT -= sdt;
        if (this.comboT <= 0) this.combo = 1;
        const dd = p.distance - this.lastDist;
        this.lastDist = p.distance;
        this.score += dd * SCORE.distanceWeight;
      }
      this.updateCamera(dt);
      this.audio.setListener(p.pos.x, p.pos.z, p.yaw);
      this.audio.updateEngine(p.speed, p.alive);

      if (this.state === 'dying') {
        this.dyingT += dt;
        this.particles.burningTrail(_v.set(p.pos.x, p.pos.y + 1.4, p.pos.z), 1);
        if (this.dyingT > 2.2) {
          this.state = 'over';
          this.timeScale = 1;
          this.hud.show(false);
          this.input.enabled = false;
          this.audio.updateEngine(0, false);
          this.emit('gameover', this.finalStats);
        }
      }
      this.hud.update(dt, this);
    } else {
      // menu / game-over attract mode
      this.tank.update(dt, { speed: 0 });
      this.menuCamera(dt);
      this.enemies.update(sdt, p, this.chunks, this.time);
      this.projectiles.update(sdt, this.hooks);
    }

    this.shake = Math.max(0, this.shake - dt * 1.8);
    const focus = _v.set(p.pos.x + p.forward.x * 12, p.pos.y, p.pos.z + p.forward.z * 12);
    this.chunks.update(focus.x, focus.z);
    this.sky.update(dt, focus);
    this.water.update(dt, p.pos);
    this.propMats.update(dt, this.time);
    this.particles.update(sdt);
  }

  render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  debugStats() {
    const i = this.renderer.info;
    return {
      fps: Math.round(1000 / (this.frameTimes.length ? this.frameTimes[this.frameTimes.length - 1] : 16)),
      calls: i.render.calls, tris: i.render.triangles, pr: this.pixelRatio,
      world: this.chunks.stats(), particles: this.particles.stats(),
      models: this.models.stats, textures: this.lib.real, sky: this.sky.mode
    };
  }
}

/* ---------------------------------------------------------------------------
 * helpers
 * -------------------------------------------------------------------------*/
function frame() { return new Promise((r) => requestAnimationFrame(() => r())); }

function withTimeout(promise, ms) {
  return Promise.race([
    Promise.resolve(promise).catch((e) => { console.warn(e); return null; }),
    new Promise((r) => setTimeout(() => r(null), ms))
  ]);
}

/** find a dry, gentle spot to start on */
function findDrySpawn(seed = 0) {
  for (let i = 0; i < 400; i++) {
    const a = i * 2.399 + seed, r = i * 9;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = terrainHeight(x, z);
    if (h < WORLD.waterLevel + 1.5) continue;
    const bn = biomeAt(x, z).name;
    if (i < 300 && (bn === 'snow' || bn === 'volcanic')) continue;
    const s = Math.abs(terrainHeight(x + 3, z) - terrainHeight(x - 3, z)) + Math.abs(terrainHeight(x, z + 3) - terrainHeight(x, z - 3));
    if (s < 1.6) return { x, z };
  }
  return { x: 0, z: 0 };
}

export { MODELS, PICKUPS, lerp };
