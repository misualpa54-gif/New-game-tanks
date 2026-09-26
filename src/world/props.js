/* ============================================================================
 * world/props.js — everything that grows / stands in the world
 * ---------------------------------------------------------------------------
 * Each prop is ONE merged BufferGeometry (with material groups when two
 * surfaces are needed) so whole forests are drawn with a handful of
 * InstancedMesh calls. Geometry sits on y = 0 and is authored around the
 * origin, so an instance matrix is just "move to ground, spin, scale".
 *
 * NOTE: mergeGeometries() refuses to mix indexed with non-indexed buffers, so
 * every part is normalised through mrg() first.
 * ==========================================================================*/
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp01, fbm, hash2i, lerp, mulberry32, TAU } from '../core/util.js';

/* ---------------------------------------------------------------------------
 * materials
 * -------------------------------------------------------------------------*/
export class PropMaterials {
  constructor(lib) {
    this.lib = lib;
    this.bark = new THREE.MeshStandardMaterial({
      map: lib.bark.map, normalMap: lib.bark.normalMap, roughnessMap: lib.bark.roughnessMap,
      roughness: 1, metalness: 0, vertexColors: true, envMapIntensity: 0.55
    });
    this.bark.normalScale.set(1.2, 1.2);

    this.foliage = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.88, metalness: 0.0, vertexColors: true,
      flatShading: true, envMapIntensity: 0.6
    });

    this.leafCard = new THREE.MeshStandardMaterial({
      map: lib.leaf, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.92,
      metalness: 0, vertexColors: true, envMapIntensity: 0.5
    });

    this.tuft = new THREE.MeshStandardMaterial({
      map: lib.tuft, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.95,
      metalness: 0, vertexColors: true, envMapIntensity: 0.4
    });

    this.rock = new THREE.MeshStandardMaterial({
      map: lib.rock.map, normalMap: lib.rock.normalMap, roughnessMap: lib.rock.roughnessMap,
      roughness: 1, metalness: 0, vertexColors: true, flatShading: true, envMapIntensity: 0.6
    });
    this.rock.normalScale.set(1.15, 1.15);

    this.stone = new THREE.MeshStandardMaterial({
      map: lib.stone.map, normalMap: lib.stone.normalMap, roughnessMap: lib.stone.roughnessMap,
      roughness: 0.95, metalness: 0, vertexColors: true, envMapIntensity: 0.7
    });

    this.metal = new THREE.MeshStandardMaterial({
      map: lib.metal.map, normalMap: lib.metal.normalMap, roughnessMap: lib.metal.roughnessMap,
      roughness: 0.6, metalness: 0.85, vertexColors: true, envMapIntensity: 1.0
    });

    this.rust = new THREE.MeshStandardMaterial({
      map: lib.rust.map, normalMap: lib.rust.normalMap, roughnessMap: lib.rust.roughnessMap,
      roughness: 0.85, metalness: 0.55, vertexColors: true, envMapIntensity: 0.8
    });

    this.crystal = new THREE.MeshStandardMaterial({
      color: 0xbfeeff, roughness: 0.16, metalness: 0.1, transparent: true, opacity: 0.85,
      emissive: new THREE.Color(0x2ea8d8), emissiveIntensity: 1.2, flatShading: true,
      envMapIntensity: 1.4
    });

    this.glow = new THREE.MeshStandardMaterial({
      color: 0x2a2018, roughness: 0.7, metalness: 0.05, vertexColors: true,
      emissive: new THREE.Color(0x54ffb0), emissiveIntensity: 1.5
    });

    this.scorched = new THREE.MeshStandardMaterial({
      color: 0x2b2724, roughness: 0.95, metalness: 0.3, vertexColors: true, envMapIntensity: 0.4
    });

    this.lava = new THREE.MeshStandardMaterial({
      map: lib.lava.map, emissiveMap: lib.lava.emissiveMap, emissive: new THREE.Color(0xff5a1e),
      emissiveIntensity: 2.2, normalMap: lib.lava.normalMap, roughness: 0.88, metalness: 0.0
    });
    this.lava.normalScale.set(0.5, 0.5);
  }

  setEnv(envMap) {
    for (const k of Object.keys(this)) {
      const m = this[k];
      if (m && m.isMaterial) { m.envMap = envMap; m.needsUpdate = true; }
    }
  }

  update(dt, time) {
    // pulsing lava + crystal shimmer keeps the world feeling alive
    this.lava.emissiveIntensity = 2.0 + Math.sin(time * 1.7) * 0.35;
    if (this.lava.map) { this.lava.map.offset.set(time * 0.006, time * 0.004); }
    this.crystal.emissiveIntensity = 1.0 + Math.sin(time * 2.3) * 0.35;
  }

  dispose() { for (const k of Object.keys(this)) if (this[k] && this[k].isMaterial) this[k].dispose(); }
}

/* ---------------------------------------------------------------------------
 * geometry helpers
 * -------------------------------------------------------------------------*/
function ensureUV(geo) {
  if (!geo.attributes.uv) {
    const pos = geo.attributes.position;
    const n = pos.count;
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      uv[i * 2] = (pos.getX(i) + pos.getZ(i)) * 0.4;
      uv[i * 2 + 1] = pos.getY(i) * 0.4;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  return geo;
}

/** merge-safe normalisation: same index state + same attribute set */
function nrm(g) {
  const o = g.index ? g.toNonIndexed() : g;
  ensureUV(o);
  if (o.attributes.tangent) o.deleteAttribute('tangent');
  return o;
}

function mrg(list, groups = false) {
  const parts = list.map(nrm);
  const out = mergeGeometries(parts, groups);
  if (!out) {
    console.warn('[props] merge failed, keeping first part');
    return parts[0];
  }
  for (const p of parts) if (p !== out) p.dispose();
  return out;
}

function tint(geo, hex, jitter = 0.06, seed = 1) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = 1 + (hash2i(i, seed, 7) - 0.5) * jitter * 2;
    arr[i * 3] = c.r * j; arr[i * 3 + 1] = c.g * j; arr[i * 3 + 2] = c.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function paintByHeight(geo, lowHex, highHex, spread = 1) {
  const lo = new THREE.Color(lowHex), hi = new THREE.Color(highHex);
  const pos = geo.attributes.position;
  const n = pos.count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const t = clamp01(pos.getY(i) / (spread || 1));
    c.copy(lo).lerp(hi, t);
    const j = 0.88 + hash2i(i, 5, 21) * 0.24;
    arr[i * 3] = c.r * j; arr[i * 3 + 1] = c.g * j; arr[i * 3 + 2] = c.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function displaceRock(geo, seed = 5, amount = 0.28) {
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  const squash = 0.72 + hash2i(seed, 3, 9) * 0.5;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = fbm(v.x * 0.9 + seed, v.z * 0.9 - seed * 0.4, 3, 2, 0.55, seed * 131 + 7);
    v.multiplyScalar(1 + n * amount);
    v.y *= squash;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* ---------------------------------------------------------------------------
 * TREES
 * -------------------------------------------------------------------------*/
function pineTree(rng, scale = 1) {
  const h = (5.2 + rng() * 2.6) * scale;
  const trunkR = 0.3 * scale;
  const trunk = new THREE.CylinderGeometry(trunkR * 0.68, trunkR * 1.3, h, 7, 3);
  trunk.translate(0, h / 2, 0);
  const trunkG = tint(trunk, 0x6b4f34, 0.14, 3);

  const layers = 4 + ((rng() * 2) | 0);
  const foliage = [];
  for (let i = 0; i < layers; i++) {
    const t = layers > 1 ? i / (layers - 1) : 0;
    const r = lerp(2.15, 0.55, t) * scale * (0.85 + rng() * 0.3);
    const ch = lerp(1.95, 1.3, t) * scale;
    const cone = new THREE.ConeGeometry(r, ch, 8, 1);
    cone.translate(0, h * (0.4 + t * 0.55) + ch * 0.3, 0);
    cone.rotateY(rng() * TAU);
    foliage.push(cone);
  }
  const canopy = paintByHeight(mrg(foliage), 0x20391c, 0x4d7c36, h * 1.15);
  return { geo: mrg([trunkG, canopy], true), groups: 2, radius: 2.1 * scale, height: h * 1.3, collider: 0.62 * scale };
}

function oakTree(rng, scale = 1) {
  const h = (3.4 + rng() * 2.0) * scale;
  const trunkR = 0.36 * scale;
  const parts = [];
  const trunk = new THREE.CylinderGeometry(trunkR * 0.75, trunkR * 1.45, h, 8, 2);
  trunk.translate(0, h / 2, 0);
  parts.push(trunk);
  const nb = 2 + ((rng() * 2) | 0);
  for (let i = 0; i < nb; i++) {
    const a = rng() * TAU;
    const len = (1.1 + rng() * 0.9) * scale;
    const b = new THREE.CylinderGeometry(trunkR * 0.28, trunkR * 0.48, len, 5, 1);
    b.translate(0, len / 2, 0);
    b.rotateZ((0.6 + rng() * 0.5) * (rng() > 0.5 ? 1 : -1));
    b.rotateY(a);
    b.translate(0, h * (0.6 + rng() * 0.3), 0);
    parts.push(b);
  }
  const trunkAll = tint(mrg(parts), 0x6d5136, 0.16, 11);

  const blobs = [];
  const canopyR = (1.9 + rng() * 1.1) * scale;
  const nblobs = 4 + ((rng() * 3) | 0);
  for (let i = 0; i < nblobs; i++) {
    const r = canopyR * (0.5 + rng() * 0.5);
    const g = new THREE.IcosahedronGeometry(r, 1);
    displaceRock(g, 3 + i * 5, 0.24);
    const a = rng() * TAU, d = rng() * canopyR * 0.7;
    g.translate(Math.cos(a) * d, h + canopyR * (0.35 + rng() * 0.5), Math.sin(a) * d);
    blobs.push(g);
  }
  const canopy = paintByHeight(mrg(blobs), 0x2c5423, 0x79a83d, h + canopyR * 2.2);
  return { geo: mrg([trunkAll, canopy], true), groups: 2, radius: canopyR * 1.2, height: h + canopyR * 2, collider: 0.6 * scale };
}

function deadTree(rng, scale = 1) {
  const h = (4.0 + rng() * 3.0) * scale;
  const parts = [];
  const trunk = new THREE.CylinderGeometry(0.16 * scale, 0.44 * scale, h, 7, 3);
  trunk.translate(0, h / 2, 0);
  trunk.rotateZ((rng() - 0.5) * 0.16);
  parts.push(trunk);
  const nb = 4 + ((rng() * 4) | 0);
  for (let i = 0; i < nb; i++) {
    const len = (1.0 + rng() * 2.0) * scale;
    const b = new THREE.CylinderGeometry(0.05 * scale, 0.17 * scale, len, 5, 1);
    b.translate(0, len / 2, 0);
    b.rotateZ(0.7 + rng() * 0.75);
    b.rotateY(rng() * TAU);
    b.translate(0, h * (0.45 + rng() * 0.5), 0);
    parts.push(b);
  }
  const geo = tint(mrg(parts), 0x59493a, 0.2, 29);
  return { geo, groups: 1, radius: 1.6 * scale, height: h, collider: 0.45 * scale };
}

function palmTree(rng, scale = 1) {
  const h = (4.4 + rng() * 2.2) * scale;
  const curve = (rng() - 0.5) * 0.6;
  const segs = 7;
  const parts = [];
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs;
    const r = lerp(0.34, 0.2, t0) * scale;
    const s = new THREE.CylinderGeometry(r * 0.92, r, (h / segs) * 1.08, 7, 1);
    s.translate(Math.sin(t0 * 2.2) * curve * h * 0.28, h * (t0 + 0.5 / segs), 0);
    parts.push(s);
  }
  const trunk = tint(mrg(parts), 0x8a7350, 0.14, 41);

  const fronds = [];
  const nf = 6 + ((rng() * 3) | 0);
  for (let i = 0; i < nf; i++) {
    const a = (i / nf) * TAU + rng() * 0.3;
    const len = (2.4 + rng() * 1.1) * scale;
    const f = new THREE.PlaneGeometry(len, 0.85 * scale, 4, 1);
    const p = f.attributes.position;
    for (let k = 0; k < p.count; k++) {
      const x = p.getX(k) + len / 2;
      const t = x / len;
      p.setY(k, p.getY(k) * (1 - t * 0.55) - t * t * len * 0.3);
    }
    p.needsUpdate = true;
    f.computeVertexNormals();
    f.translate(len / 2, 0, 0);
    f.rotateZ(0.2 + rng() * 0.22);
    f.rotateY(a);
    f.translate(Math.sin(2.2) * curve * h * 0.28, h, 0);
    fronds.push(f);
  }
  const canopy = paintByHeight(mrg(fronds), 0x3f6b2a, 0x93b452, h * 0.5);
  return { geo: mrg([trunk, canopy], true), groups: 2, radius: 2.4 * scale, height: h, collider: 0.5 * scale };
}

/* ---------------------------------------------------------------------------
 * ROCKS
 * -------------------------------------------------------------------------*/
function boulder(rng, scale = 1) {
  const detail = rng() > 0.55 ? 2 : 1;
  const g = new THREE.IcosahedronGeometry(1, detail);
  displaceRock(g, 1 + ((rng() * 90) | 0), 0.34);
  const sx = (0.9 + rng() * 0.9) * scale;
  const sy = (0.55 + rng() * 0.75) * scale;
  const sz = (0.9 + rng() * 0.9) * scale;
  g.scale(sx, sy, sz);
  g.translate(0, sy * 0.6, 0);
  g.rotateY(rng() * TAU);
  g.computeVertexNormals();
  const geo = paintByHeight(g, 0x69645d, 0xaba69c, sy * 2.2);
  return { geo, groups: 1, radius: Math.max(sx, sz), height: sy * 1.7, collider: Math.max(sx, sz) * 0.8 };
}

function spire(rng, scale = 1) {
  const h = (3.2 + rng() * 5.0) * scale;
  const g = new THREE.ConeGeometry((0.7 + rng() * 0.7) * scale, h, 6 + ((rng() * 3) | 0), 3);
  displaceRock(g, 7 + ((rng() * 40) | 0), 0.26);
  g.translate(0, h * 0.46, 0);
  g.rotateY(rng() * TAU);
  g.computeVertexNormals();
  const geo = paintByHeight(g, 0x484340, 0x918880, h);
  return { geo, groups: 1, radius: 1.2 * scale, height: h, collider: 0.95 * scale };
}

function rubble(rng, scale = 1) {
  const parts = [];
  const n = 3 + ((rng() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const g = new THREE.DodecahedronGeometry((0.28 + rng() * 0.5) * scale, 0);
    displaceRock(g, i * 7 + 3, 0.3);
    const a = rng() * TAU, d = rng() * 1.5 * scale;
    g.translate(Math.cos(a) * d, 0.18 * scale, Math.sin(a) * d);
    g.rotateY(rng() * TAU);
    parts.push(g);
  }
  const geo = paintByHeight(mrg(parts), 0x6f6961, 0xa39d93, 1.2 * scale);
  return { geo, groups: 1, radius: 1.9 * scale, height: 0.75 * scale, collider: 0.5 * scale };
}

function crystalCluster(rng, scale = 1) {
  const parts = [];
  const n = 3 + ((rng() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const h = (1.1 + rng() * 2.6) * scale;
    const g = new THREE.ConeGeometry((0.2 + rng() * 0.34) * scale, h, 5, 1);
    g.translate(0, h / 2, 0);
    g.rotateZ((rng() - 0.5) * 0.7);
    g.rotateX((rng() - 0.5) * 0.7);
    const a = rng() * TAU, d = rng() * 1.1 * scale;
    g.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
    parts.push(g);
  }
  return { geo: mrg(parts), groups: 1, radius: 1.4 * scale, height: 3 * scale, collider: 0.7 * scale };
}

function glowShroom(rng, scale = 1) {
  const parts = [];
  const n = 2 + ((rng() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const h = (0.5 + rng() * 1.2) * scale;
    const stem = new THREE.CylinderGeometry(0.09 * scale, 0.14 * scale, h, 6, 1);
    stem.translate(0, h / 2, 0);
    const cap = new THREE.SphereGeometry((0.28 + rng() * 0.24) * scale, 8, 5, 0, TAU, 0, Math.PI * 0.55);
    cap.translate(0, h, 0);
    const a = rng() * TAU, d = rng() * 0.75 * scale;
    stem.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
    cap.translate(Math.cos(a) * d, 0, Math.sin(a) * d);
    parts.push(stem, cap);
  }
  const geo = tint(mrg(parts), 0x9dffcb, 0.22, 61);
  return { geo, groups: 1, radius: 1.0 * scale, height: 1.8 * scale, collider: 0.25 * scale };
}

/* ---------------------------------------------------------------------------
 * BUSHES / GROUND COVER
 * -------------------------------------------------------------------------*/
function bush(rng, scale = 1) {
  const parts = [];
  const n = 3 + ((rng() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const r = (0.42 + rng() * 0.5) * scale;
    const g = new THREE.IcosahedronGeometry(r, 1);
    displaceRock(g, i * 5 + 2, 0.26);
    g.scale(1, 0.78, 1);
    const a = rng() * TAU, d = rng() * 0.75 * scale;
    g.translate(Math.cos(a) * d, r * 0.62, Math.sin(a) * d);
    parts.push(g);
  }
  const geo = paintByHeight(mrg(parts), 0x2a4a20, 0x6f9c3d, 1.5 * scale);
  return { geo, groups: 1, radius: 1.25 * scale, height: 1.2 * scale, collider: 0.55 * scale };
}

function tuftCards(rng, scale = 1, cards = 3, w = 1.6, h = 1.15) {
  const parts = [];
  for (let i = 0; i < cards; i++) {
    const cw = w * scale * (0.8 + rng() * 0.5);
    const ch = h * scale * (0.8 + rng() * 0.5);
    const g = new THREE.PlaneGeometry(cw, ch);
    g.translate(0, ch / 2, 0);
    g.rotateY((i / cards) * Math.PI + rng() * 0.4);
    parts.push(g);
  }
  const geo = tint(mrg(parts), 0xffffff, 0.18, 71);
  return { geo, groups: 1, radius: 0.9 * scale, height: h * scale, collider: 0 };
}

/* ---------------------------------------------------------------------------
 * RUINS / OBJECTS
 * -------------------------------------------------------------------------*/
function column(rng, scale = 1) {
  const h = (3.0 + rng() * 4.0) * scale;
  const parts = [];
  const base = new THREE.BoxGeometry(1.5 * scale, 0.4 * scale, 1.5 * scale);
  base.translate(0, 0.2 * scale, 0);
  const shaft = new THREE.CylinderGeometry(0.46 * scale, 0.56 * scale, h, 10, 4);
  const p = shaft.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y > h * 0.26) p.setY(i, y - hash2i(i, 3, 17) * 0.6 * scale);
  }
  p.needsUpdate = true;
  shaft.translate(0, h / 2 + 0.34 * scale, 0);
  const cap = new THREE.BoxGeometry(1.25 * scale, 0.3 * scale, 1.25 * scale);
  cap.translate(0, 0.52 * scale, 0);
  parts.push(base, shaft, cap);
  const geo = paintByHeight(mrg(parts), 0x8d8577, 0xd3cab6, h);
  return { geo, groups: 1, radius: 0.95 * scale, height: h, collider: 0.8 * scale };
}

function ruinedWall(rng, scale = 1) {
  const w = (4 + rng() * 4) * scale, h = (1.8 + rng() * 2.6) * scale, t = 0.7 * scale;
  const parts = [];
  const blocks = 3 + ((rng() * 3) | 0);
  for (let i = 0; i < blocks; i++) {
    const bw = (w / blocks) * (0.8 + rng() * 0.35);
    const bh = h * (0.45 + rng() * 0.6);
    const b = new THREE.BoxGeometry(bw, bh, t);
    b.translate(-w / 2 + bw / 2 + i * (w / blocks), bh / 2, (rng() - 0.5) * 0.3 * scale);
    b.rotateY((rng() - 0.5) * 0.09);
    parts.push(b);
  }
  const geo = paintByHeight(mrg(parts), 0x7c7466, 0xb9ae9a, h);
  return { geo, groups: 1, radius: w * 0.55, height: h, collider: Math.max(w * 0.5, t) * 0.7 };
}

function stoneArch(rng, scale = 1) {
  const h = (3.6 + rng() * 1.6) * scale;
  const parts = [];
  for (const s of [-1, 1]) {
    const c = new THREE.BoxGeometry(0.8 * scale, h, 0.8 * scale);
    c.translate(s * 1.9 * scale, h / 2, 0);
    parts.push(c);
  }
  const lintel = new THREE.BoxGeometry(5.2 * scale, 0.7 * scale, 0.9 * scale);
  lintel.translate(0, h + 0.3 * scale, 0);
  parts.push(lintel);
  const geo = paintByHeight(mrg(parts), 0x6f6a60, 0xada391, h + 0.8 * scale);
  return { geo, groups: 1, radius: 3 * scale, height: h + 0.7 * scale, collider: 0.9 * scale };
}

function crate(rng, scale = 1) {
  const s = (0.9 + rng() * 0.5) * scale;
  const parts = [];
  const box = new THREE.BoxGeometry(s, s, s);
  box.translate(0, s / 2, 0);
  parts.push(box);
  const plank = new THREE.BoxGeometry(s * 0.14, s * 1.04, s * 1.04);
  plank.translate(s * 0.5, s / 2, 0);
  const plank2 = plank.clone(); plank2.translate(-s, 0, 0);
  const plank3 = new THREE.BoxGeometry(s * 1.04, s * 1.04, s * 0.14);
  plank3.translate(0, s / 2, s * 0.5);
  const plank4 = plank3.clone(); plank4.translate(0, 0, -s);
  parts.push(plank, plank2, plank3, plank4);
  const geo = tint(mrg(parts), 0x8b6a42, 0.18, 83);
  return { geo, groups: 1, radius: s, height: s, collider: s * 0.66, explosive: true };
}

function barrel(rng, scale = 1) {
  const r = 0.45 * scale, h = 1.2 * scale;
  const parts = [];
  const body = new THREE.CylinderGeometry(r, r * 0.94, h, 12, 1);
  body.translate(0, h / 2, 0);
  parts.push(body);
  for (const y of [h * 0.28, h * 0.72]) {
    const ring = new THREE.TorusGeometry(r * 1.03, 0.045 * scale, 5, 14);
    ring.rotateX(Math.PI / 2);
    ring.translate(0, y, 0);
    parts.push(ring);
  }
  const geo = tint(mrg(parts), 0x7a6a52, 0.16, 97);
  return { geo, groups: 1, radius: r * 1.3, height: h, collider: r * 1.15, explosive: true };
}

/** burnt-out tank wreck — cover + storytelling */
function wreck(rng, scale = 1) {
  const parts = [];
  const hull = new THREE.BoxGeometry(2.6 * scale, 0.9 * scale, 4.6 * scale);
  hull.translate(0, 0.85 * scale, 0);
  parts.push(hull);
  const nose = new THREE.BoxGeometry(2.4 * scale, 0.6 * scale, 1.3 * scale);
  nose.rotateX(-0.34);
  nose.translate(0, 1.05 * scale, 2.7 * scale);
  parts.push(nose);
  const turret = new THREE.CylinderGeometry(0.95 * scale, 1.15 * scale, 0.72 * scale, 9, 1);
  turret.rotateZ((rng() - 0.5) * 0.3);
  turret.translate(0.2 * scale, 1.62 * scale, -0.3 * scale);
  parts.push(turret);
  const barrel = new THREE.CylinderGeometry(0.13 * scale, 0.16 * scale, 2.6 * scale, 7, 1);
  barrel.rotateX(Math.PI / 2);
  barrel.rotateY((rng() - 0.5) * 0.9);
  barrel.translate(0.2 * scale, 1.66 * scale, 1.4 * scale);
  parts.push(barrel);
  for (const s of [-1, 1]) {
    const track = new THREE.BoxGeometry(0.62 * scale, 0.74 * scale, 4.8 * scale);
    track.translate(s * 1.32 * scale, 0.4 * scale, 0);
    parts.push(track);
  }
  const geo = tint(mrg(parts), 0x3b3630, 0.24, 113);
  return { geo, groups: 1, radius: 2.8 * scale, height: 2.4 * scale, collider: 2.2 * scale, wreck: true };
}

/** lava pool disc (hazard) */
function lavaPool(rng, scale = 1) {
  const r = (2.6 + rng() * 3.4) * scale;
  const g = new THREE.CircleGeometry(r, 20, 0, TAU);
  g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, Math.sin(x * 1.7) * 0.05 + Math.cos(z * 1.3) * 0.05);
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.4, uv.getY(i) * 2.4);
  const geo = tint(g, 0xffffff, 0.03, 7);
  return { geo, groups: 1, radius: r, height: 0.12, collider: 0, lava: true };
}

/* ---------------------------------------------------------------------------
 * registry
 * -------------------------------------------------------------------------*/
export const PROP_DEFS = {
  pine:     { build: pineTree,    mats: ['bark', 'foliage'], shadow: true,  variants: 3, scale: [0.75, 1.5] },
  oak:      { build: oakTree,     mats: ['bark', 'foliage'], shadow: true,  variants: 3, scale: [0.8, 1.45] },
  palm:     { build: palmTree,    mats: ['bark', 'foliage'], shadow: true,  variants: 2, scale: [0.85, 1.3] },
  dead:     { build: deadTree,    mats: ['bark'],            shadow: true,  variants: 3, scale: [0.8, 1.4] },
  boulder:  { build: boulder,     mats: ['rock'],            shadow: true,  variants: 4, scale: [0.6, 2.4] },
  spire:    { build: spire,       mats: ['rock'],            shadow: true,  variants: 3, scale: [0.7, 1.8] },
  rubble:   { build: rubble,      mats: ['rock'],            shadow: false, variants: 3, scale: [0.7, 1.6] },
  crystal:  { build: crystalCluster, mats: ['crystal'],      shadow: false, variants: 2, scale: [0.6, 1.6] },
  shroom:   { build: glowShroom,  mats: ['glow'],            shadow: false, variants: 2, scale: [0.7, 1.7] },
  bush:     { build: bush,        mats: ['foliage'],         shadow: true,  variants: 3, scale: [0.6, 1.5] },
  tuft:     { build: (r, s) => tuftCards(r, s, 3, 1.6, 1.15), mats: ['tuft'], shadow: false, variants: 2, scale: [0.7, 1.7] },
  fern:     { build: (r, s) => tuftCards(r, s, 4, 2.1, 1.6),  mats: ['leafCard'], shadow: false, variants: 2, scale: [0.7, 1.4] },
  column:   { build: column,      mats: ['stone'],           shadow: true,  variants: 2, scale: [0.8, 1.5] },
  wall:     { build: ruinedWall,  mats: ['stone'],           shadow: true,  variants: 2, scale: [0.8, 1.4] },
  arch:     { build: stoneArch,   mats: ['stone'],           shadow: true,  variants: 1, scale: [0.8, 1.3] },
  crate:    { build: crate,       mats: ['bark'],            shadow: true,  variants: 2, scale: [0.8, 1.3] },
  barrel:   { build: barrel,      mats: ['rust'],            shadow: true,  variants: 2, scale: [0.85, 1.2] },
  wreck:    { build: wreck,       mats: ['scorched'],        shadow: true,  variants: 2, scale: [0.85, 1.25] },
  lavaPool: { build: lavaPool,    mats: ['lava'],            shadow: false, variants: 2, scale: [0.7, 1.5] }
};

/** per-biome spawn weights: [plains, forest, desert, stone, snow, volcanic] */
export const SCATTER_TABLE = {
  pine:     { base: 12.0, w: [0.25, 1.00, 0.00, 0.35, 0.85, 0.05], densityKey: 'treeDensity' },
  oak:      { base: 10.0, w: [0.55, 1.00, 0.05, 0.25, 0.10, 0.05], densityKey: 'treeDensity' },
  palm:     { base: 4.0,  w: [0.00, 0.00, 0.90, 0.05, 0.00, 0.00], densityKey: 'treeDensity' },
  dead:     { base: 3.4,  w: [0.25, 0.20, 0.80, 0.55, 0.35, 0.70], densityKey: 'deadTreeMix' },
  boulder:  { base: 7.0,  w: [0.30, 0.25, 0.45, 1.00, 0.50, 0.85], densityKey: 'rockDensity' },
  spire:    { base: 2.6,  w: [0.05, 0.02, 0.15, 0.55, 0.20, 1.00], densityKey: 'rockDensity' },
  rubble:   { base: 4.5,  w: [0.20, 0.15, 0.30, 0.70, 0.30, 0.60], densityKey: 'rockDensity' },
  crystal:  { base: 2.4,  w: [0.02, 0.02, 0.02, 0.20, 0.45, 1.00], densityKey: 'crystalDensity' },
  shroom:   { base: 3.2,  w: [0.10, 0.55, 0.00, 0.15, 0.10, 0.35], densityKey: 'crystalDensity' },
  bush:     { base: 8.0,  w: [0.65, 1.00, 0.20, 0.35, 0.25, 0.10], densityKey: 'bushDensity' },
  tuft:     { base: 46.0, w: [1.00, 0.85, 0.35, 0.35, 0.25, 0.10], densityKey: 'grassDensity' },
  fern:     { base: 16.0, w: [0.35, 1.00, 0.00, 0.20, 0.05, 0.05], densityKey: 'bushDensity' },
  column:   { base: 1.4,  w: [0.35, 0.20, 0.45, 0.80, 0.30, 0.40], densityKey: 'ruinDensity' },
  wall:     { base: 1.2,  w: [0.30, 0.18, 0.40, 0.70, 0.25, 0.40], densityKey: 'ruinDensity' },
  arch:     { base: 0.35, w: [0.30, 0.15, 0.35, 0.70, 0.25, 0.45], densityKey: 'ruinDensity' },
  crate:    { base: 0.8,  w: [0.45, 0.35, 0.45, 0.60, 0.35, 0.40], densityKey: 'ruinDensity' },
  barrel:   { base: 0.8,  w: [0.45, 0.35, 0.45, 0.60, 0.35, 0.45], densityKey: 'ruinDensity' },
  wreck:    { base: 0.26, w: [0.55, 0.45, 0.55, 0.65, 0.40, 0.50], densityKey: 'ruinDensity' },
  lavaPool: { base: 1.6,  w: [0.00, 0.00, 0.00, 0.05, 0.00, 1.00], densityKey: 'volcanic' }
};

export const SCATTER_KEYS = Object.keys(SCATTER_TABLE);

/** build the variant meshes for one prop key */
export function buildPropVariants(key, mats) {
  const def = PROP_DEFS[key];
  const out = [];
  for (let i = 0; i < def.variants; i++) {
    const rng = mulberry32(((i * 2654435761) ^ (key.charCodeAt(0) * 40503) ^ (key.length * 7717)) >>> 0);
    const built = def.build(rng, 1);
    const materials = built.groups > 1 ? def.mats.map((m) => mats[m]) : [mats[def.mats[0]]];
    out.push({
      key, index: i, geo: built.geo, materials, groups: built.groups,
      radius: built.radius, height: built.height, collider: built.collider,
      explosive: !!built.explosive, lava: !!built.lava, wreck: !!built.wreck,
      shadow: def.shadow, scale: def.scale
    });
  }
  return out;
}
