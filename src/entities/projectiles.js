/* ============================================================================
 * entities/projectiles.js — shells, bolts, boulders, bombs, flame
 * ---------------------------------------------------------------------------
 * Pooled meshes, sub-stepped collision against terrain, world props, enemies
 * and the player. Splash damage is resolved by the game through hooks so the
 * projectile system stays free of gameplay imports.
 * ==========================================================================*/
import * as THREE from 'three';
import { clamp01, lerp, rand, TAU } from '../core/util.js';
import { terrainHeight, terrainNormal } from '../world/terrain.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _fwd = new THREE.Vector3(0, 0, 1);

export const PROJECTILE_KINDS = {
  shell: {
    speed: 118, gravity: 9, life: 2.6, radius: 0.45, damage: 34,
    splash: 4.8, splashDamage: 18, visual: 'shell', byPlayer: true, trail: 0.55, light: 0xffb066
  },
  bullet: {
    speed: 74, gravity: 3.5, life: 2.4, radius: 0.3, damage: 8,
    splash: 0, splashDamage: 0, visual: 'bullet', trail: 0.25, light: 0xff8a4a
  },
  bolt: {
    speed: 44, gravity: 1.5, life: 4.0, radius: 0.55, damage: 11,
    splash: 1.6, splashDamage: 5, visual: 'bolt', trail: 0.5, light: 0x66ffe0
  },
  plasma: {
    speed: 58, gravity: 0, life: 3.0, radius: 0.6, damage: 13,
    splash: 2.4, splashDamage: 6, visual: 'plasma', trail: 0.5, light: 0x6ad4ff
  },
  boulder: {
    speed: 34, gravity: 24, life: 4.0, radius: 0.95, damage: 26,
    splash: 4.0, splashDamage: 14, visual: 'rock', trail: 0.1, light: 0x000000
  },
  bomb: {
    speed: 26, gravity: 18, life: 5.0, radius: 0.75, damage: 22,
    splash: 6.5, splashDamage: 16, visual: 'bomb', trail: 0.3, light: 0xff5a2a
  },
  flame: {
    speed: 30, gravity: -2.2, life: 1.15, radius: 1.0, damage: 5,
    splash: 2.2, splashDamage: 2, visual: 'flame', pierce: true, trail: 0, light: 0xff7a2a
  },
  spell: {
    speed: 38, gravity: -1.0, life: 3.4, radius: 0.7, damage: 16,
    splash: 3.0, splashDamage: 8, visual: 'spell', trail: 0.6, light: 0xb98aff
  }
};

const CAPACITY = { shell: 26, bullet: 40, bolt: 44, plasma: 30, boulder: 16, bomb: 18, flame: 40, spell: 24 };

/* ---------------------------------------------------------------------------
 * visuals
 * -------------------------------------------------------------------------*/
function makeVisual(kind, mats) {
  const g = new THREE.Group();
  switch (kind) {
    case 'shell': {
      const body = new THREE.Mesh(mats.shellGeo, mats.shellMat);
      g.add(body);
      const glow = new THREE.Sprite(mats.tracerMat(0xffd9a0));
      glow.scale.setScalar(1.5);
      g.add(glow);
      g.userData.spin = body;
      break;
    }
    case 'bullet': {
      const core = new THREE.Mesh(mats.bulletGeo, mats.bulletMat);
      g.add(core);
      const glow = new THREE.Sprite(mats.tracerMat(0xffb06a));
      glow.scale.setScalar(0.9);
      g.add(glow);
      break;
    }
    case 'bolt': case 'plasma': case 'spell': {
      const col = kind === 'bolt' ? 0x6affd8 : kind === 'plasma' ? 0x6ad4ff : 0xc79aff;
      const core = new THREE.Mesh(mats.orbGeo, mats.orbMat(col));
      g.add(core);
      const glow = new THREE.Sprite(mats.tracerMat(col));
      glow.scale.setScalar(2.4);
      g.add(glow);
      const ring = new THREE.Mesh(mats.ringGeo, mats.ringMat(col));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      g.userData.ring = ring;
      g.userData.core = core;
      break;
    }
    case 'rock': {
      const m = new THREE.Mesh(mats.rockGeo, mats.rockMat);
      g.add(m);
      g.userData.spin = m;
      break;
    }
    case 'bomb': {
      const m = new THREE.Mesh(mats.bombGeo, mats.bombMat);
      g.add(m);
      const glow = new THREE.Sprite(mats.tracerMat(0xff6a2a));
      glow.scale.setScalar(1.2);
      g.add(glow);
      g.userData.spin = m;
      break;
    }
    case 'flame': {
      const s = new THREE.Sprite(mats.flameMat());
      s.scale.setScalar(1.6);
      g.add(s);
      g.userData.sprite = s;
      break;
    }
  }
  return g;
}

/* ---------------------------------------------------------------------------
 * ProjectileSystem
 * -------------------------------------------------------------------------*/
export class ProjectileSystem {
  constructor(scene, texLib, particles, cmats) {
    this.scene = scene;
    this.lib = texLib;
    this.particles = particles;
    this.active = [];
    this.pools = new Map();

    /* shared geometry / material kit */
    const mats = {
      shellGeo: (() => {
        const parts = [];
        const body = new THREE.CylinderGeometry(0.1, 0.11, 0.5, 8);
        body.rotateX(Math.PI / 2);
        parts.push(body);
        const tip = new THREE.ConeGeometry(0.1, 0.22, 8);
        tip.rotateX(Math.PI / 2);
        tip.translate(0, 0, 0.34);
        parts.push(tip);
        const band = new THREE.CylinderGeometry(0.125, 0.125, 0.07, 8);
        band.rotateX(Math.PI / 2);
        band.translate(0, 0, -0.12);
        parts.push(band);
        const geo = mergeParts(parts);
        return geo;
      })(),
      shellMat: new THREE.MeshStandardMaterial({
        color: 0xd8b070, roughness: 0.35, metalness: 0.9,
        emissive: new THREE.Color(0xff7a2a), emissiveIntensity: 1.4
      }),
      bulletGeo: new THREE.CapsuleGeometry(0.07, 0.3, 3, 6),
      bulletMat: new THREE.MeshStandardMaterial({ color: 0xffd08a, emissive: new THREE.Color(0xff9a3a), emissiveIntensity: 2.4, roughness: 0.4 }),
      orbGeo: new THREE.IcosahedronGeometry(0.3, 1),
      orbMat: (hex) => new THREE.MeshStandardMaterial({
        color: 0x0b0b0f, emissive: new THREE.Color(hex), emissiveIntensity: 3.2, roughness: 0.25, metalness: 0
      }),
      ringGeo: new THREE.TorusGeometry(0.42, 0.035, 5, 14),
      ringMat: (hex) => new THREE.MeshBasicMaterial({ color: new THREE.Color(hex), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
      rockGeo: rockGeo(),
      rockMat: new THREE.MeshStandardMaterial({ color: 0x7b736a, map: texLib.rock.map, roughness: 0.95, metalness: 0, flatShading: true }),
      bombGeo: bombGeo(),
      bombMat: new THREE.MeshStandardMaterial({ color: 0x3b3f42, roughness: 0.5, metalness: 0.8, emissive: new THREE.Color(0xff3a10), emissiveIntensity: 0.5 }),
      tracerMat: (hex) => new THREE.SpriteMaterial({
        map: texLib.soft, color: new THREE.Color(hex), transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, opacity: 0.95, toneMapped: false
      }),
      flameMat: () => new THREE.SpriteMaterial({
        map: texLib.soft, color: new THREE.Color(0xffb055), transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, opacity: 0.9, toneMapped: false
      })
    };
    // capsule needs to point along Z
    mats.bulletGeo.rotateX(Math.PI / 2);
    this.mats = mats;

    for (const kind of Object.keys(PROJECTILE_KINDS)) {
      const cap = CAPACITY[kind] || 20;
      const items = [];
      for (let i = 0; i < cap; i++) {
        const visual = makeVisual(kind, mats);
        visual.visible = false;
        scene.add(visual);
        items.push(new Projectile(kind, visual, PROJECTILE_KINDS[kind]));
      }
      this.pools.set(kind, items);
    }
    this._colliders = [];
  }

  obtain(kind) {
    const pool = this.pools.get(kind);
    if (!pool) return null;
    for (const it of pool) if (!it.alive) return it;
    // steal the oldest
    let oldest = pool[0];
    for (const it of pool) if (it.life < oldest.life) oldest = it;
    oldest.alive = false;
    oldest.visual.visible = false;
    return oldest;
  }

  /**
   * @param {string} kind key of PROJECTILE_KINDS
   * @param {THREE.Vector3} pos muzzle position (world)
   * @param {THREE.Vector3} dir normalised direction
   * @param {object} opts {speed, damage, owner, byPlayer, color, scale, gravity, life, splash}
   */
  spawn(kind, pos, dir, opts = {}) {
    const it = this.obtain(kind);
    if (!it) return null;
    const cfg = it.cfg;
    it.alive = true;
    it.t = 0;
    it.hits.clear();
    it.pos.copy(pos);
    const speed = opts.speed != null ? opts.speed : cfg.speed;
    it.vel.copy(dir).normalize().multiplyScalar(speed);
    it.maxLife = it.life = opts.life != null ? opts.life : cfg.life;
    it.damage = opts.damage != null ? opts.damage : cfg.damage;
    it.splash = opts.splash != null ? opts.splash : cfg.splash;
    it.splashDamage = opts.splashDamage != null ? opts.splashDamage : cfg.splashDamage;
    it.byPlayer = opts.byPlayer != null ? opts.byPlayer : !!cfg.byPlayer;
    it.owner = opts.owner || null;
    it.color = opts.color != null ? opts.color : (cfg.light || 0xffffff);
    it.scale = opts.scale || 1;
    it.gravity = opts.gravity != null ? opts.gravity : cfg.gravity;
    it.trailAcc = 0;
    it.visual.visible = true;
    it.visual.position.copy(it.pos);
    it.visual.scale.setScalar(it.scale);
    it.orient();
    this.active.push(it);
    return it;
  }

  update(dt, hooks) {
    const list = this.active;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i];
      if (!p.alive) { list.splice(i, 1); continue; }
      p.t += dt;
      p.life -= dt;
      let dead = false;

      const steps = p.vel.length() * dt > 1.6 ? 2 : 1;
      const sdt = dt / steps;
      for (let s = 0; s < steps && !dead; s++) {
        p.vel.y -= p.gravity * sdt;
        p.pos.addScaledVector(p.vel, sdt);
        dead = this.collide(p, hooks);
      }

      if (p.life <= 0 && !dead) {
        // airburst at end of life (shells) or just vanish
        if (p.splash > 0 && p.kind !== 'flame') {
          if (hooks && hooks.onExplode) hooks.onExplode(p, p.pos, 0.5);
          dead = true;
        } else dead = true;
      }

      if (!dead) {
        p.orient();
        p.animate(dt);
        p.trail(dt, this.particles);
        // cull absurd distances
        if (hooks && hooks.playerPos && p.pos.distanceToSquared(hooks.playerPos) > 400 * 400) dead = true;
      }

      if (dead) {
        p.alive = false;
        p.visual.visible = false;
        list.splice(i, 1);
      }
    }
  }

  collide(p, hooks) {
    const r = p.cfg.radius * p.scale;
    const groundY = terrainHeight(p.pos.x, p.pos.z);

    // terrain
    if (p.pos.y - r * 0.5 <= groundY) {
      p.pos.y = groundY + r * 0.4;
      terrainNormal(p.pos.x, p.pos.z, _v3);
      if (hooks && hooks.onGroundHit) hooks.onGroundHit(p, p.pos, _v3);
      return true;
    }

    // world props (trees, rocks, ruins, barrels…)
    if (hooks && hooks.chunks) {
      const cols = hooks.chunks.queryColliders(p.pos.x, p.pos.z, r + 3.2, this._colliders);
      for (const c of cols) {
        const dx = p.pos.x - c.x, dz = p.pos.z - c.z;
        const rr = c.r + r;
        if (dx * dx + dz * dz > rr * rr) continue;
        if (p.pos.y > c.y + (c.h || 2) + r) continue;
        if (p.pos.y < c.y - 1.5) continue;
        if (hooks.onPropHit) hooks.onPropHit(p, c, _v2.set(dx, 0.4, dz).normalize());
        return true;
      }
      // lava pools swallow projectiles
      const lava = hooks.chunks.lavaNear(p.pos.x, p.pos.z, 0.4);
      if (lava && p.pos.y < groundY + 1.2) {
        if (hooks.onLavaHit) hooks.onLavaHit(p, p.pos);
        return true;
      }
    }

    if (p.byPlayer) {
      if (hooks && hooks.enemies) {
        const enemies = hooks.enemies;
        for (let i = 0; i < enemies.length; i++) {
          const e = enemies[i];
          if (!e.alive || e.dying) continue;
          if (p.hits.has(e)) continue;
          const rr = (e.radius || 1.4) + r;
          const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z;
          if (dx * dx + dz * dz > rr * rr) continue;
          const dy = p.pos.y - (e.pos.y + (e.height || 1.6) * 0.5);
          if (Math.abs(dy) > (e.height || 1.6) * 0.72 + r) continue;
          p.hits.add(e);
          if (hooks.onHitEnemy) hooks.onHitEnemy(p, e, _v2.set(dx, 0, dz).normalize());
          if (!p.cfg.pierce) return true;
        }
      }
    } else {
      const pl = hooks && hooks.player;
      if (pl && pl.alive) {
        const rr = (pl.radius || 2.2) + r;
        const dx = p.pos.x - pl.pos.x, dz = p.pos.z - pl.pos.z;
        if (dx * dx + dz * dz < rr * rr && p.pos.y < pl.pos.y + 2.8 && p.pos.y > pl.pos.y - 2.0) {
          if (hooks.onHitPlayer) hooks.onHitPlayer(p, pl);
          return true;
        }
      }
    }
    return false;
  }

  clear() {
    for (const p of this.active) { p.alive = false; p.visual.visible = false; }
    this.active.length = 0;
  }

  count() { return this.active.length; }

  dispose() {
    for (const [, items] of this.pools) for (const it of items) this.scene.remove(it.visual);
    for (const k in this.mats) {
      const m = this.mats[k];
      if (m && m.isMaterial) m.dispose();
      if (m && m.isBufferGeometry) m.dispose();
    }
  }
}

function mergeParts(list) {
  // tiny merge that keeps positions/normals/uvs only (projectiles are simple)
  let total = 0;
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o = 0, o2 = 0;
  for (const g of geos) {
    const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos[o + i * 3] = p.getX(i); pos[o + i * 3 + 1] = p.getY(i); pos[o + i * 3 + 2] = p.getZ(i);
      if (n) { nrm[o + i * 3] = n.getX(i); nrm[o + i * 3 + 1] = n.getY(i); nrm[o + i * 3 + 2] = n.getZ(i); }
      if (u) { uv[o2 + i * 2] = u.getX(i); uv[o2 + i * 2 + 1] = u.getY(i); }
    }
    o += p.count * 3; o2 += p.count * 2;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  for (const g of list) g.dispose();
  return out;
}

function rockGeo() {
  const g = new THREE.IcosahedronGeometry(0.62, 1);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 4.1) * Math.cos(v.z * 3.3) * Math.sin(v.y * 2.7);
    v.multiplyScalar(1 + n * 0.22);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

function bombGeo() {
  const parts = [];
  const body = new THREE.SphereGeometry(0.34, 10, 8);
  body.scale(1, 1, 1.5);
  parts.push(body);
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.BoxGeometry(0.04, 0.3, 0.24);
    fin.rotateZ((i / 4) * TAU);
    fin.translate(0, 0, -0.4);
    parts.push(fin);
  }
  const nose = new THREE.ConeGeometry(0.12, 0.24, 8);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, 0.56);
  parts.push(nose);
  return mergeParts(parts);
}

/* ---------------------------------------------------------------------------
 * Projectile instance
 * -------------------------------------------------------------------------*/
class Projectile {
  constructor(kind, visual, cfg) {
    this.kind = kind;
    this.visual = visual;
    this.cfg = cfg;
    this.alive = false;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.life = 0; this.maxLife = 1; this.t = 0;
    this.hits = new Set();
    this.damage = 0; this.splash = 0; this.splashDamage = 0;
    this.byPlayer = false; this.owner = null; this.color = 0xffffff;
    this.trailAcc = 0; this.scale = 1; this.gravity = cfg.gravity;
  }

  orient() {
    const dir = _v.copy(this.vel);
    if (dir.lengthSq() < 1e-6) return;
    dir.normalize();
    _q.setFromUnitVectors(_fwd, dir);
    this.visual.quaternion.copy(_q);
  }

  animate(dt) {
    const g = this.visual.userData;
    if (g.spin) g.spin.rotation.z += dt * (this.kind === 'rock' ? 7 : 12);
    if (g.ring) {
      g.ring.rotation.z += dt * 6;
      g.ring.scale.setScalar(1 + Math.sin(this.t * 22) * 0.12);
    }
    if (g.core) g.core.scale.setScalar(1 + Math.sin(this.t * 26) * 0.16);
    if (g.sprite) {
      const t = clamp01(this.t / this.maxLife);
      this.visual.scale.setScalar(this.scale * (1.2 + t * 3.4));
      g.sprite.material.opacity = (1 - t) * 0.85;
      g.sprite.material.color.setHex(t < 0.35 ? 0xffe9a0 : t < 0.7 ? 0xff9a3a : 0x8a3a1a);
    }
    if (this.kind === 'bolt' || this.kind === 'spell' || this.kind === 'plasma') {
      this.visual.scale.setScalar(this.scale * (1 + Math.sin(this.t * 18) * 0.06));
    }
  }

  trail(dt, particles) {
    const cfg = this.cfg;
    if (!cfg.trail || !particles) return;
    this.trailAcc += dt;
    const interval = 0.022 / Math.max(0.2, cfg.trail);
    if (this.trailAcc < interval) return;
    this.trailAcc = 0;
    const x = this.pos.x, y = this.pos.y, z = this.pos.z;
    if (this.kind === 'shell' || this.kind === 'bullet') {
      particles.sparks.spawn(x, y, z, rand(-0.6, 0.6), rand(-0.2, 0.8), rand(-0.6, 0.6), {
        life: rand(0.16, 0.4), size: rand(0.1, 0.22), color: 0xffd9a0, endColor: 0x553311,
        gravity: -1.5, drag: 3.2, fadeMode: 1, alpha: 0.8
      });
      if (this.kind === 'shell' && Math.random() < 0.5) {
        particles.smoke.emit(x, y, z, {
          size: 0.32, grow: 1.5, life: rand(0.4, 0.9), opacity: 0.16, vy: 0.5, color: 0x8d8578, drag: 2
        });
      }
    } else if (this.kind === 'flame') {
      particles.embers.spawn(x, y, z, rand(-1, 1), rand(0.4, 2.2), rand(-1, 1), {
        life: rand(0.25, 0.7), size: rand(0.2, 0.5), color: 0xffb347, endColor: 0x441100,
        gravity: -1.2, drag: 1.6, fadeMode: 2
      });
    } else if (this.kind === 'rock') {
      if (Math.random() < 0.4) {
        particles.sparks.spawn(x, y - 0.3, z, rand(-1, 1), rand(-1, 0.4), rand(-1, 1), {
          life: 0.3, size: 0.14, color: 0x9a8f7d, endColor: 0x4a4238, gravity: -6, drag: 2, alpha: 0.5
        });
      }
    } else {
      particles.embers.spawn(x, y, z, rand(-0.8, 0.8), rand(-0.4, 0.9), rand(-0.8, 0.8), {
        life: rand(0.2, 0.55), size: rand(0.12, 0.3), color: this.color, endColor: 0x112233,
        gravity: -0.6, drag: 2.4, fadeMode: 2
      });
    }
  }
}
