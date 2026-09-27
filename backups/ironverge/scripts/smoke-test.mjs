// Headless smoke test: runs the world generator, every creature builder, the
// tank, enemy AI, projectiles and the player controller in Node (no GPU).
import * as THREE from 'three';

// --- minimal browser shims ---------------------------------------------------
globalThis.window = globalThis;
globalThis.requestAnimationFrame = (f) => setTimeout(() => f(performance.now()), 0);
const fakeTex = () => { const t = new THREE.Texture(); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };
const set = () => ({ map: fakeTex(), normalMap: fakeTex(), roughnessMap: fakeTex(), emissiveMap: fakeTex() });
const lib = new Proxy({ camo: () => set() }, {
  get(o, k) { if (k in o) return o[k]; const v = /soft|spark|smoke|ring|scorch|rune|leaf|tuft|waterNormal/.test(k) ? fakeTex() : set(); o[k] = v; return v; }
});

const { terrainHeight, biomeAt, buildChunkGeometry } = await import('../src/world/terrain.js');
const { PropMaterials } = await import('../src/world/props.js');
const { ChunkManager } = await import('../src/world/chunks.js');
const { CreatureMaterials, ModelLibrary, buildPlayerTank } = await import('../src/world/models.js');
const { EnemyManager } = await import('../src/entities/enemies.js');
const { ProjectileSystem } = await import('../src/entities/projectiles.js');
const { Player } = await import('../src/entities/player.js');
const { ENEMIES } = await import('../src/config.js');

let ok = 0; const t0 = performance.now();
const check = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } ok++; };

// terrain determinism + finiteness
for (let i = 0; i < 2000; i++) {
  const x = (Math.random() - 0.5) * 1e5, z = (Math.random() - 0.5) * 1e5;
  const h = terrainHeight(x, z);
  check(Number.isFinite(h) && h === terrainHeight(x, z), 'height finite & deterministic');
}
const names = new Set();
for (let i = 0; i < 4000; i++) names.add(biomeAt(i * 173.3, i * -97.1).name);
console.log('biomes seen:', [...names].join(', '));
check(names.size >= 4, 'at least 4 biomes appear');
const g = buildChunkGeometry(0, 0, 48, 16);
check(g.attributes.aBlend && g.attributes.color, 'chunk attributes');

// world streaming
const scene = new THREE.Scene();
const pm = new PropMaterials(lib);
const cm = new ChunkManager(scene, lib, pm, 'medium');
await cm.buildInitial(new THREE.Vector3(), () => {});
for (let s = 0; s < 400; s++) cm.update(s * 6, s * 2.5, 2);
const st = cm.stats();
console.log('world:', st);
check(st.chunks > 20 && st.instances > 500, 'chunks and props streamed');

// creatures
const cmats = new CreatureMaterials(lib);
const models = new ModelLibrary(lib, cmats, 'medium');
for (const k of Object.keys(ENEMIES)) {
  const inst = models.instance(k, 3);
  check(inst && inst.group, 'template ' + k);
  inst.update(0.016, { speed: 5, attack: 0.5 });
}
console.log('creature templates:', models.stats);

// tank + player + enemies + projectiles
const tank = buildPlayerTank(lib, cmats);
scene.add(tank.group);
const player = new Player(tank);
player.reset(0, 0);
const pool = { spawn() {}, emit() {} };
const particles = new Proxy({ sparks: pool, embers: pool, smoke: pool, debris: pool }, { get: (o, k) => (k in o ? o[k] : () => {}) });
const projectiles = new ProjectileSystem(scene, lib, particles);
const enemies = new EnemyManager(scene, models, particles, projectiles);
let dmg = 0, kills = 0;
enemies.callbacks.onPlayerDamage = (a) => { dmg += a; };
enemies.callbacks.onKill = () => { kills++; };
for (const k of Object.keys(ENEMIES)) enemies.spawn(k, new THREE.Vector3(Math.random() * 60 - 30, 0, 30 + Math.random() * 40));
const input = { left: false, right: false, fire: false };
let shots = 0;
for (let f = 0; f < 1800; f++) {
  input.left = (f % 300) < 60; input.right = (f % 400) > 340;
  player.hp = player.maxHp; player.alive = true;   // invulnerable for the sim
  player.update(1 / 60, input, { chunks: cm, enemies: enemies.list, particles, onCrush: (c) => cm.destroyProp(c.rec) });
  if (f % 20 === 0) { const s = player.tryFire(); if (s) { shots++; projectiles.spawn('shell', s.pos, s.dir, { byPlayer: true }); } }
  enemies.update(1 / 60, player, cm, f / 60);
  projectiles.update(1 / 60, {
    chunks: cm, enemies: enemies.list, player, playerPos: player.pos,
    onHitEnemy: (p, e) => enemies.damage(e, 40, p.pos), onHitPlayer: (p) => { dmg += p.damage; }
  });
  cm.update(player.pos.x, player.pos.z, 1);
  check(Number.isFinite(player.pos.x + player.pos.y + player.pos.z), 'player position finite');
  if (process.env.DBG && f % 120 === 0) console.log(f, player.pos.x.toFixed(1), player.pos.z.toFixed(1), 'spd', player.speed.toFixed(1), 'water', player.inWater, 'yaw', player.yaw.toFixed(2), 'dist', player.distance.toFixed(0));
}
console.log(`sim: drove ${player.distance.toFixed(0)} m, ${shots} shots, ${kills} kills, ${dmg.toFixed(0)} dmg taken, ${enemies.list.length} enemies left`);
check(player.distance > 200, 'tank actually drives');
console.log(`\n✔ ${ok} checks passed in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
process.exit(0);
