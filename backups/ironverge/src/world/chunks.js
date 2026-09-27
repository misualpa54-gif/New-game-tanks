/* ============================================================================
 * world/chunks.js — infinite streaming world
 * ---------------------------------------------------------------------------
 * Chunks are generated on demand around the player and recycled forever.
 * Props live in a handful of GLOBAL InstancedMesh pools (one per prop variant)
 * so 100 000 trees cost ~30 draw calls. Collision data is kept per chunk and
 * queried through a 3×3 neighbourhood lookup.
 * ==========================================================================*/
import * as THREE from 'three';
import { WORLD, QUALITY } from '../config.js';
import { clamp01, mulberry32, seedFrom, TAU } from '../core/util.js';
import { biomeAt, buildChunkGeometry, terrainHeight } from './terrain.js';
import { buildPropVariants, PROP_DEFS, SCATTER_KEYS, SCATTER_TABLE } from './props.js';

const SIZE = WORLD.chunkSize;

const keyOf = (cx, cz) => cx + ',' + cz;

/* capacity of each instanced pool — generous but bounded */
const CAPACITY = {
  pine: 1100, oak: 1000, palm: 400, dead: 520,
  boulder: 1200, spire: 420, rubble: 820, crystal: 360, shroom: 420,
  bush: 1100, tuft: 4200, fern: 1500,
  column: 260, wall: 240, arch: 90, crate: 220, barrel: 220, wreck: 90,
  lavaPool: 180
};

class PropPool {
  constructor(mats, scatterScale) {
    this.mats = mats;
    this.scatterScale = scatterScale;
    this.pools = new Map();   // key -> {variants:[{mesh, records:[]}], }
    this.group = new THREE.Group();
    this.group.name = 'props';
    this.dirty = true;

    for (const key of SCATTER_KEYS) {
      const variants = buildPropVariants(key, mats);
      const entries = variants.map((v, i) => {
        const cap = Math.ceil((CAPACITY[key] || 400) / variants.length);
        const mesh = new THREE.InstancedMesh(v.geo, v.materials.length > 1 ? v.materials : v.materials[0], cap);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.castShadow = v.shadow;
        mesh.receiveShadow = true;
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.name = key + '#' + i;
        mesh.userData.variant = v;
        // per-instance tint keeps forests from looking cloned
        mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
        this.group.add(mesh);
        return { mesh, variant: v, cap, records: [] };
      });
      this.pools.set(key, entries);
    }
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  get entries() { return this.pools; }

  /** register every prop of a freshly generated chunk */
  addChunkRecords(props) {
    for (const p of props) {
      const list = this.pools.get(p.key);
      if (!list) continue;
      const entry = list[p.variant % list.length];
      entry.records.push(p);
    }
    this.dirty = true;
  }

  removeChunkRecords(chunkKey) {
    for (const list of this.pools.values()) {
      for (const entry of list) {
        if (entry.records.length === 0) continue;
        const kept = [];
        for (const r of entry.records) if (r.chunk !== chunkKey) kept.push(r);
        if (kept.length !== entry.records.length) { entry.records = kept; this.dirty = true; }
      }
    }
  }

  /** rewrite instance buffers (called at most once per frame, only when dirty) */
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    for (const list of this.pools.values()) {
      for (const entry of list) {
        const { mesh, records, cap, variant } = entry;
        const n = Math.min(records.length, cap);
        for (let i = 0; i < n; i++) {
          const r = records[i];
          this._e.set(r.tiltX || 0, r.rot, r.tiltZ || 0, 'YXZ');
          this._q.setFromEuler(this._e);
          this._p.set(r.x, r.y, r.z);
          this._s.set(r.scale, r.scaleY != null ? r.scaleY : r.scale, r.scale);
          this._m.compose(this._p, this._q, this._s);
          mesh.setMatrixAt(i, this._m);
          this._c.setHex(r.tint || 0xffffff);
          mesh.setColorAt(i, this._c);
        }
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.visible = n > 0;
      }
    }
  }

  /** live-update a single instance (e.g. exploding barrel removed later) */
  hideRecord(r) {
    r.hidden = true;
    const list = this.pools.get(r.key);
    if (!list) return;
    const entry = list[r.variant % list.length];
    entry.records = entry.records.filter((x) => x !== r);
    this.dirty = true;
  }

  dispose() {
    for (const list of this.pools.values()) {
      for (const entry of list) {
        entry.mesh.dispose();
        entry.variant.geo.dispose();
      }
    }
  }
}

/* ---------------------------------------------------------------------------
 * Chunk generation
 * -------------------------------------------------------------------------*/
const _b = {};
const _b2 = {};

function sampleBiomeField(cx, cz) {
  // average biome weights over the chunk so scatter is coherent
  const acc = { treeDensity: 0, rockDensity: 0, bushDensity: 0, grassDensity: 0, ruinDensity: 0, crystalDensity: 0, deadTreeMix: 0, pineMix: 0, volcanic: 0, snow: 0, desert: 0, forest: 0, stone: 0 };
  const pts = [[0, 0], [0.35, 0.35], [-0.35, 0.35], [0.35, -0.35], [-0.35, -0.35]];
  for (const [ox, oz] of pts) {
    const b = biomeAt((cx + ox) * SIZE, (cz + oz) * SIZE, _b);
    for (const k in acc) acc[k] += b[k] || 0;
  }
  for (const k in acc) acc[k] /= pts.length;
  // biome weight vector for the scatter table
  const forest = clamp01(acc.forest), desert = clamp01(acc.desert), snow = clamp01(acc.snow), stone = clamp01(acc.stone), vol = clamp01(acc.volcanic);
  const plains = clamp01(1 - forest - desert - snow - stone - vol);
  acc.biomeWeights = [plains, forest, desert, stone, snow, vol];
  return acc;
}

function populateChunk(cx, cz, scatterScale, rng) {
  const ox = cx * SIZE, oz = cz * SIZE;
  const field = sampleBiomeField(cx, cz);
  const props = [];
  const colliders = [];
  const margin = WORLD.scatterMargin;
  const big = [];   // large props, for spacing checks

  for (const key of SCATTER_KEYS) {
    const cfg = SCATTER_TABLE[key];
    const def = PROP_DEFS[key];
    const density = clamp01(field[cfg.densityKey] || 0);
    let bw = 0;
    for (let i = 0; i < cfg.w.length; i++) bw += cfg.w[i] * (field.biomeWeights[i] || 0);
    let count = cfg.base * density * bw * scatterScale;
    if (count <= 0) continue;
    count = Math.floor(count) + (rng() < (count % 1) ? 1 : 0);
    const variants = def.variants;

    for (let i = 0; i < count; i++) {
      const lx = (rng() - 0.5) * (SIZE - margin * 2);
      const lz = (rng() - 0.5) * (SIZE - margin * 2);
      const wx = ox + lx, wz = oz + lz;
      const h = terrainHeight(wx, wz);

      // nothing grows in the lake
      if (h < WORLD.waterLevel + 0.35) continue;

      // lava pools only settle in volcanic bowls
      if (key === 'lavaPool') {
        const bowl = (terrainHeight(wx + 4, wz) + terrainHeight(wx - 4, wz) +
                      terrainHeight(wx, wz + 4) + terrainHeight(wx, wz - 4)) * 0.25;
        if (h > bowl + 0.15) continue;
      }

      const slope = slopeQuick(wx, wz);
      if ((key === 'pine' || key === 'oak' || key === 'palm' || key === 'wall' || key === 'arch' || key === 'column' || key === 'crate' || key === 'barrel' || key === 'wreck') && slope > 0.42) continue;
      if (slope > 0.75 && key !== 'spire' && key !== 'rubble' && key !== 'boulder' && key !== 'tuft') continue;

      const sMin = def.scale[0], sMax = def.scale[1];
      const scale = lerpN(sMin, sMax, Math.pow(rng(), 1.6));
      const variant = (rng() * variants) | 0;

      // spacing: big things should not intersect
      if (scale > 0.9 && big.length) {
        let clash = false;
        for (const o of big) {
          const dx = o.x - wx, dz = o.z - wz;
          const rr = (o.r + scale) * 1.15;
          if (dx * dx + dz * dz < rr * rr) { clash = true; break; }
        }
        if (clash) continue;
      }

      const rec = {
        key, variant, chunk: keyOf(cx, cz),
        x: wx, y: h - 0.12 * scale, z: wz,
        rot: rng() * TAU, scale,
        scaleY: scale * (0.85 + rng() * 0.35),
        tiltX: (rng() - 0.5) * slope * 0.35,
        tiltZ: (rng() - 0.5) * slope * 0.35,
        tint: propTint(key, field, rng),
        radius: 1, height: 1, collider: 0, explosive: false, lava: false
      };
      // radius/height/collider depend on the built variant — resolve lazily at build time
      props.push(rec);
      if (scale > 0.9) big.push({ x: wx, z: wz, r: 1.4 });
    }
  }
  return { props, colliders, field };
}

function lerpN(a, b, t) { return a + (b - a) * t; }

function slopeQuick(x, z) {
  const e = 1.1;
  const hl = terrainHeight(x - e, z), hr = terrainHeight(x + e, z);
  const hd = terrainHeight(x, z - e), hu = terrainHeight(x, z + e);
  const nx = hl - hr, nz = hd - hu, ny = 2 * e;
  const len = Math.hypot(nx, ny, nz) || 1;
  return clamp01(1 - ny / len);
}

const _tint = new THREE.Color();
const _snowC = new THREE.Color(0xf2f8ff);

function propTint(key, field, rng) {
  const c = _tint;
  const v = 0.82 + rng() * 0.36;
  switch (key) {
    case 'pine': c.setHex(0x86bf8e); break;
    case 'oak': c.setHex(field.snow > 0.4 ? 0xc9d6de : field.desert > 0.4 ? 0xc2ad6e : 0x8fc866); break;
    case 'palm': c.setHex(0xbfe8a0); break;
    case 'dead': c.setHex(0xb0a294); break;
    case 'boulder': case 'rubble': case 'spire': c.setHex(field.volcanic > 0.4 ? 0x6a5a58 : 0xa8a49c); break;
    case 'bush': c.setHex(field.snow > 0.4 ? 0xd6e6ee : 0x9ede72); break;
    case 'tuft': c.setHex(field.desert > 0.4 ? 0xd9c98f : field.snow > 0.4 ? 0xe6f0f6 : 0x9ad46f); break;
    case 'fern': c.setHex(0x8fd86a); break;
    case 'crystal': c.setHex(rng() > 0.5 ? 0x9fe8ff : 0xd8a8ff); break;
    case 'shroom': c.setHex(rng() > 0.5 ? 0x8affc8 : 0x9fd8ff); break;
    default: c.setHex(0xffffff);
  }
  c.multiplyScalar(v);
  // snow dusting
  if (field.snow > 0.25 && key !== 'lavaPool' && key !== 'crystal') c.lerp(_snowC, field.snow * 0.22);
  return c.getHex();
}

/* ---------------------------------------------------------------------------
 * ChunkManager
 * -------------------------------------------------------------------------*/
export class ChunkManager {
  constructor(scene, texLib, mats, qualityName = 'medium') {
    this.scene = scene;
    this.texLib = texLib;
    this.mats = mats;
    this.setQuality(qualityName);

    this.terrainMat = null;          // assigned by game (TerrainMaterial)
    this.chunks = new Map();
    this.queue = [];
    this.pool = new PropPool(mats, this.scatterScale);
    scene.add(this.pool.group);

    this.group = new THREE.Group();
    this.group.name = 'terrain';
    scene.add(this.group);

    this.lastCX = null; this.lastCZ = null;
    this.built = 0;
    this.disposed = false;
  }

  setQuality(name) {
    this.qualityName = name;
    this.q = QUALITY[name] || QUALITY.medium;
    this.radius = this.q.chunkRadius;
    this.seg = this.q.chunkSeg;
    this.scatterScale = this.q.scatter;
    if (this.pool) this.pool.scatterScale = this.scatterScale;
  }

  setTerrainMaterial(tm) { this.terrainMat = tm; }

  /** synchronous initial build around a point (used by the loading screen) */
  async buildInitial(center, onProgress) {
    const keys = this.desiredKeys(center.x, center.z, Math.max(1, this.radius - 1));
    for (let i = 0; i < keys.length; i++) {
      const [cx, cz] = keys[i];
      this.buildChunk(cx, cz);
      if (onProgress) onProgress(i + 1, keys.length);
      await frame();
    }
    this.pool.flush();
  }

  desiredKeys(px, pz, radius = this.radius) {
    const cx = Math.round(px / SIZE), cz = Math.round(pz / SIZE);
    const out = [];
    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        out.push([cx + dx, cz + dz, dx * dx + dz * dz]);
      }
    }
    out.sort((a, b) => a[2] - b[2]);
    return out;
  }

  /** per-frame streaming */
  update(px, pz, budget = WORLD.buildBudgetPerFrame) {
    const cx = Math.round(px / SIZE), cz = Math.round(pz / SIZE);
    const moved = cx !== this.lastCX || cz !== this.lastCZ;
    if (moved || this.queue.length) {
      this.lastCX = cx; this.lastCZ = cz;
      const desired = this.desiredKeys(px, pz);
      const want = new Set();
      for (const [kx, kz] of desired) want.add(keyOf(kx, kz));

      // recycle far chunks
      for (const [key, chunk] of Array.from(this.chunks)) {
        if (!want.has(key)) this.removeChunk(key, chunk);
      }
      // queue new ones (nearest first)
      this.queue.length = 0;
      for (const [kx, kz, d] of desired) {
        const key = keyOf(kx, kz);
        if (!this.chunks.has(key)) this.queue.push({ cx: kx, cz: kz, key, d });
      }
    }

    let n = budget;
    while (n-- > 0 && this.queue.length) {
      const job = this.queue.shift();
      if (this.chunks.has(job.key)) continue;
      this.buildChunk(job.cx, job.cz);
    }
    this.pool.flush();
  }

  buildChunk(cx, cz) {
    const key = keyOf(cx, cz);
    if (this.chunks.has(key)) return this.chunks.get(key);
    const ox = cx * SIZE, oz = cz * SIZE;
    const rng = mulberry32(seedFrom(cx, cz, 0x51ed7));

    const geo = buildChunkGeometry(ox, oz, SIZE, this.seg);
    const mesh = new THREE.Mesh(geo, this.terrainMat ? this.terrainMat.material : this.mats.rock);
    mesh.position.set(ox, 0, oz);
    mesh.receiveShadow = true;
    mesh.castShadow = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group.add(mesh);

    const { props, field } = populateChunk(cx, cz, this.scatterScale, rng);

    // resolve collider + radius data from the built variant geometry
    const colliders = [];
    for (const r of props) {
      const list = this.pool.pools.get(r.key);
      const entry = list ? list[r.variant % list.length] : null;
      if (!entry) continue;
      const v = entry.variant;
      r.radius = v.radius * r.scale;
      r.height = v.height * r.scaleY;
      r.collider = v.collider * r.scale;
      r.explosive = v.explosive;
      r.lava = v.lava;
      r.propRef = r;
      if (r.collider > 0.28) {
        colliders.push({ x: r.x, z: r.z, r: r.collider, y: r.y, h: r.height, kind: r.key, rec: r, explosive: r.explosive });
      }
    }

    this.pool.addChunkRecords(props);

    const chunk = { key, cx, cz, ox, oz, mesh, geo, props, colliders, field, spawns: pickSpawns(cx, cz, rng) };
    this.chunks.set(key, chunk);
    this.built++;
    return chunk;
  }

  removeChunk(key, chunk) {
    this.group.remove(chunk.mesh);
    chunk.geo.dispose();
    this.pool.removeChunkRecords(key);
    this.chunks.delete(key);
  }

  chunkAt(x, z) {
    return this.chunks.get(keyOf(Math.round(x / SIZE), Math.round(z / SIZE)));
  }

  /** colliders within `radius` of a world point (3×3 chunk neighbourhood) */
  queryColliders(x, z, radius, out = []) {
    out.length = 0;
    const span = Math.max(1, Math.ceil(radius / SIZE));
    const cx = Math.round(x / SIZE), cz = Math.round(z / SIZE);
    const r2 = radius * radius;
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const chunk = this.chunks.get(keyOf(cx + dx, cz + dz));
        if (!chunk) continue;
        for (const c of chunk.colliders) {
          const ddx = c.x - x, ddz = c.z - z;
          if (ddx * ddx + ddz * ddz <= r2) out.push(c);
        }
      }
    }
    return out;
  }

  /** all prop records near a point (used by explosions to blow up barrels etc.) */
  queryProps(x, z, radius, out = []) {
    out.length = 0;
    const span = Math.max(1, Math.ceil(radius / SIZE));
    const cx = Math.round(x / SIZE), cz = Math.round(z / SIZE);
    const r2 = radius * radius;
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const chunk = this.chunks.get(keyOf(cx + dx, cz + dz));
        if (!chunk) continue;
        for (const p of chunk.props) {
          const ddx = p.x - x, ddz = p.z - z;
          if (ddx * ddx + ddz * ddz <= r2) out.push(p);
        }
      }
    }
    return out;
  }

  /** destroy a prop (explosive chain reactions, chopping cover) */
  destroyProp(rec) {
    const chunk = this.chunks.get(rec.chunk);
    if (chunk) {
      chunk.props = chunk.props.filter((p) => p !== rec);
      chunk.colliders = chunk.colliders.filter((c) => c.rec !== rec);
    }
    this.pool.hideRecord(rec);
  }

  /** lava pool locations near a point (hazard damage) */
  lavaNear(x, z, radius = 6) {
    const span = Math.max(1, Math.ceil(radius / SIZE));
    const cx = Math.round(x / SIZE), cz = Math.round(z / SIZE);
    for (let dz = -span; dz <= span; dz++) {
      for (let dx = -span; dx <= span; dx++) {
        const chunk = this.chunks.get(keyOf(cx + dx, cz + dz));
        if (!chunk) continue;
        for (const p of chunk.props) {
          if (!p.lava) continue;
          const ddx = p.x - x, ddz = p.z - z;
          const rr = p.radius + radius;
          if (ddx * ddx + ddz * ddz < rr * rr) return p;
        }
      }
    }
    return null;
  }

  /** re-point every terrain tile at the (possibly fallback) material */
  applyTerrainMaterial() {
    const m = this.terrainMat ? this.terrainMat.material : null;
    if (!m) return;
    for (const chunk of this.chunks.values()) chunk.mesh.material = m;
  }

  stats() {
    let props = 0, tris = 0, instances = 0;
    for (const chunk of this.chunks.values()) {
      props += chunk.props.length;
      const g = chunk.geo;
      tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    }
    for (const list of this.pool.pools.values()) for (const e of list) instances += e.mesh.count;
    return { chunks: this.chunks.size, props, instances, tris: Math.round(tris) };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const [key, chunk] of Array.from(this.chunks)) this.removeChunk(key, chunk);
    this.pool.dispose();
  }
}

/** a few flat, prop-free anchor points per chunk (used for boss arenas etc.) */
function pickSpawns(cx, cz, rng) {
  const out = [];
  for (let i = 0; i < 3; i++) {
    const x = cx * SIZE + (rng() - 0.5) * SIZE * 0.8;
    const z = cz * SIZE + (rng() - 0.5) * SIZE * 0.8;
    out.push({ x, z, y: terrainHeight(x, z), slope: slopeQuick(x, z) });
  }
  return out;
}

function frame() {
  return new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(r) : setTimeout(r, 16)));
}

export { SIZE as CHUNK_SIZE, keyOf, slopeQuick };
