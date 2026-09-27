/* ============================================================================
 * world/models.js — the player tank, every creature, and the GLB pipeline
 * ---------------------------------------------------------------------------
 * Free glTF-Binary models (three.js sample library, CC0/CC-BY) are streamed
 * from CDN and normalised to game scale. Every one of them has a hand-built
 * procedural stand-in, so a blocked CDN still gives you a full bestiary.
 *
 * Templates are built ONCE per enemy type and then cloned per instance
 * (Object3D.clone shares geometry + materials → cheap spawns, no extra shader
 * programs). Per-instance feedback uses a sprite flash instead of materials.
 * ==========================================================================*/
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ASSET_HOSTS, ENEMIES, MODELS } from '../config.js';
import { clamp, clamp01, lerp, mulberry32, TAU } from '../core/util.js';

/* ---------------------------------------------------------------------------
 * small geometry helpers
 * -------------------------------------------------------------------------*/
function nrm(g) { const o = g.index ? g.toNonIndexed() : g; if (!o.attributes.uv) {
  const p = o.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = (p.getX(i) + p.getZ(i)) * 0.5; uv[i * 2 + 1] = p.getY(i) * 0.5; }
  o.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
} return o; }

function mrg(list, groups = false) {
  const out = mergeGeometries(list.map(nrm), groups);
  if (!out) return nrm(list[0]);
  for (const p of list.map(nrm)) if (p !== out) p.dispose();
  return out;
}

function box(w, h, d) { return new THREE.BoxGeometry(w, h, d); }
function cyl(rt, rb, h, seg = 10) { return new THREE.CylinderGeometry(rt, rb, h, seg, 1); }
function cone(r, h, seg = 8) { return new THREE.ConeGeometry(r, h, seg, 1); }
function sph(r, w = 10, h = 8) { return new THREE.SphereGeometry(r, w, h); }
function ico(r, d = 1) { return new THREE.IcosahedronGeometry(r, d); }

function place(geo, x, y, z, rx = 0, ry = 0, rz = 0) {
  if (rx) geo.rotateX(rx);
  if (ry) geo.rotateY(ry);
  if (rz) geo.rotateZ(rz);
  geo.translate(x, y, z);
  return geo;
}

function rockify(geo, seed = 3, amount = 0.2) {
  const p = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = Math.sin(v.x * 3.1 + seed) * Math.cos(v.z * 2.7 - seed) * Math.sin(v.y * 2.3 + seed * 0.7);
    v.multiplyScalar(1 + n * amount);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/* ---------------------------------------------------------------------------
 * Creature material kit
 * -------------------------------------------------------------------------*/
export class CreatureMaterials {
  constructor(lib) {
    this.lib = lib;
    this.cache = new Map();
  }

  /** tinted hide / fur / skin (procedural neutral map keeps colours honest) */
  skin(hex, { rough = 0.94, metal = 0.0, normal = 0.9, flat = false } = {}) {
    const key = 'skin' + hex + rough + metal + normal + flat;
    if (this.cache.has(key)) return this.cache.get(key);
    const m = new THREE.MeshStandardMaterial({
      color: hex, map: this.lib.hide.map, normalMap: this.lib.hide.normalMap,
      roughnessMap: this.lib.hide.roughnessMap, roughness: rough, metalness: metal,
      flatShading: flat, envMapIntensity: 0.65
    });
    m.normalScale.set(normal, normal);
    this.cache.set(key, m);
    return m;
  }

  stone(hex, { rough = 0.9, emissive = 0x000000, emissiveIntensity = 0 } = {}) {
    const key = 'stone' + hex + rough + emissive + emissiveIntensity;
    if (this.cache.has(key)) return this.cache.get(key);
    const m = new THREE.MeshStandardMaterial({
      color: hex, map: this.lib.rock.map, normalMap: this.lib.rock.normalMap,
      roughnessMap: this.lib.rock.roughnessMap, roughness: rough, metalness: 0.04,
      flatShading: true, emissive: new THREE.Color(emissive), emissiveIntensity, envMapIntensity: 0.6
    });
    this.cache.set(key, m);
    return m;
  }

  metal(hex, { rough = 0.45, metal = 0.9 } = {}) {
    const key = 'metal' + hex + rough + metal;
    if (this.cache.has(key)) return this.cache.get(key);
    const m = new THREE.MeshStandardMaterial({
      color: hex, map: this.lib.metal.map, normalMap: this.lib.metal.normalMap,
      roughness: rough, metalness: metal, envMapIntensity: 1.0
    });
    this.cache.set(key, m);
    return m;
  }

  rust(hex = 0x8a5a3a) {
    const key = 'rust' + hex;
    if (this.cache.has(key)) return this.cache.get(key);
    const m = new THREE.MeshStandardMaterial({
      color: hex, map: this.lib.rust.map, normalMap: this.lib.rust.normalMap,
      roughnessMap: this.lib.rust.roughnessMap, roughness: 0.9, metalness: 0.5, envMapIntensity: 0.8
    });
    this.cache.set(key, m);
    return m;
  }

  cloth(hex, { rough = 0.98 } = {}) {
    const key = 'cloth' + hex + rough;
    if (this.cache.has(key)) return this.cache.get(key);
    const m = new THREE.MeshStandardMaterial({
      color: hex, roughness: rough, metalness: 0, side: THREE.DoubleSide,
      normalMap: this.lib.hide.normalMap, envMapIntensity: 0.4, flatShading: true
    });
    m.normalScale.set(0.5, 0.5);
    this.cache.set(key, m);
    return m;
  }

  glow(hex, intensity = 2.6) {
    const key = 'glow' + hex + intensity;
    if (this.cache.has(key)) return this.cache.get(key);
    const m = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a, emissive: new THREE.Color(hex), emissiveIntensity: intensity,
      roughness: 0.4, metalness: 0, toneMapped: true
    });
    this.cache.set(key, m);
    return m;
  }

  setEnv(envMap) { for (const m of this.cache.values()) { m.envMap = envMap; m.needsUpdate = true; } }
  dispose() { for (const m of this.cache.values()) m.dispose(); this.cache.clear(); }
}

/* ---------------------------------------------------------------------------
 * PLAYER TANK
 * -------------------------------------------------------------------------*/
export function buildPlayerTank(lib, cmats, { palette = ['#4b5a35', '#3a4529', '#6b6a4a', '#2b3220'], seed = 7 } = {}) {
  const camo = lib.camo(palette, seed);
  const paint = new THREE.MeshStandardMaterial({
    map: camo.map, normalMap: camo.normalMap, roughnessMap: camo.roughnessMap,
    color: 0xffffff, roughness: 1, metalness: 0.32, envMapIntensity: 0.9
  });
  paint.normalScale.set(0.75, 0.75);
  const dark = cmats.metal(0x2f3236, { rough: 0.55, metal: 0.85 });
  const rubber = new THREE.MeshStandardMaterial({
    map: lib.tread.map, normalMap: lib.tread.normalMap, roughnessMap: lib.tread.roughnessMap,
    color: 0xb9b9b9, roughness: 1, metalness: 0.05, envMapIntensity: 0.5
  });
  rubber.normalScale.set(1.4, 1.4);
  const rust = cmats.rust(0x7d6a52);
  const glass = cmats.glow(0xfff0c0, 1.6);
  const red = cmats.glow(0xff3b2a, 1.4);

  const root = new THREE.Group();
  root.name = 'playerTank';

  /* ---- hull (merged, one draw call) ---- */
  const hull = [];
  hull.push(place(box(2.62, 0.78, 4.35), 0, 0.98, 0));                       // main body
  hull.push(place(box(2.5, 0.62, 1.5), 0, 1.32, 1.62, -0.46));               // sloped glacis
  hull.push(place(box(2.44, 0.3, 1.35), 0, 1.42, -1.55, 0.18));              // engine deck
  hull.push(place(box(2.72, 0.34, 4.5), 0, 1.4, 0));                         // upper sponson
  hull.push(place(box(0.16, 0.72, 4.3), 1.36, 0.95, 0));                     // side skirt R
  hull.push(place(box(0.16, 0.72, 4.3), -1.36, 0.95, 0));                    // side skirt L
  hull.push(place(box(0.5, 0.12, 4.6), 1.28, 1.34, 0));                      // mudguard R
  hull.push(place(box(0.5, 0.12, 4.6), -1.28, 1.34, 0));                     // mudguard L
  hull.push(place(box(2.2, 0.22, 0.5), 0, 0.66, 2.28, -0.5));                // front plate
  hull.push(place(box(0.9, 0.5, 0.9), 0, 1.5, -1.9));                        // stowage box
  hull.push(place(cyl(0.19, 0.19, 0.62, 10), 0.72, 1.52, -1.85, 0, 0, Math.PI / 2)); // jerrycan
  hull.push(place(box(0.34, 0.34, 0.5), -0.8, 1.55, -1.7));                  // toolbox
  for (const s of [-1, 1]) {                                                 // exhausts
    hull.push(place(cyl(0.13, 0.15, 0.5, 8), s * 0.62, 1.5, -2.24, Math.PI / 2));
  }
  for (let i = 0; i < 4; i++) {                                              // tow hooks / cleats
    hull.push(place(box(0.16, 0.16, 0.3), (i % 2 ? 1 : -1) * 0.9, 0.72, i < 2 ? 2.3 : -2.3));
  }
  const hullMesh = new THREE.Mesh(mrg(hull), paint);
  hullMesh.castShadow = true; hullMesh.receiveShadow = true;
  root.add(hullMesh);

  /* ---- tracks ---- */
  const trackGeo = (() => {
    const parts = [];
    const L = 4.75, H = 0.86, W = 0.66;
    parts.push(place(box(W, H, L), 0, 0, 0));
    parts.push(place(cyl(H * 0.5, H * 0.5, W, 10), 0, 0.02, L / 2 - H * 0.4, 0, 0, Math.PI / 2));
    parts.push(place(cyl(H * 0.5, H * 0.5, W, 10), 0, 0.02, -L / 2 + H * 0.4, 0, 0, Math.PI / 2));
    return mrg(parts);
  })();
  // give the track box long UVs so the tread pattern scrolls believably
  {
    const p = trackGeo.attributes.position, uv = trackGeo.attributes.uv;
    for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) * 1.6 + p.getZ(i) * 0.05, p.getZ(i) * 0.55);
    uv.needsUpdate = true;
  }
  const tracks = [];
  for (const s of [-1, 1]) {
    const m = new THREE.Mesh(trackGeo, rubber);
    m.position.set(s * 1.33, 0.48, 0);
    m.castShadow = true; m.receiveShadow = true;
    root.add(m);
    tracks.push(m);
  }

  /* ---- road wheels (one instanced draw call) ---- */
  const wheelGeo = nrm(cyl(0.4, 0.4, 0.26, 12));
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x3c3f42, map: lib.metal.map, roughnessMap: lib.metal.roughnessMap,
    roughness: 0.72, metalness: 0.7, envMapIntensity: 0.8
  });
  const WHEELS = [];
  for (const s of [-1, 1]) {
    for (let i = 0; i < 5; i++) WHEELS.push({ x: s * 1.33, y: 0.44, z: -1.7 + i * 0.85, r: 0.4 });
    WHEELS.push({ x: s * 1.33, y: 0.62, z: 2.15, r: 0.3 });   // idler
    WHEELS.push({ x: s * 1.33, y: 0.62, z: -2.15, r: 0.3 });  // sprocket
  }
  const wheels = new THREE.InstancedMesh(wheelGeo, wheelMat, WHEELS.length);
  wheels.castShadow = true; wheels.receiveShadow = true;
  wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  root.add(wheels);

  /* ---- turret ---- */
  const turret = new THREE.Group();
  turret.position.set(0, 1.62, -0.15);
  root.add(turret);

  const turretParts = [];
  const ring = cyl(1.22, 1.3, 0.16, 16); place(ring, 0, 0.02, 0);
  turretParts.push(ring);
  const body = (() => {
    const g = cyl(1.02, 1.2, 0.62, 14);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {          // faceted, sloped turret
      const z = p.getZ(i), y = p.getY(i);
      p.setX(i, p.getX(i) * (1 - Math.max(0, z) * 0.12));
      p.setZ(i, z * (y > 0 ? 0.86 : 1.06));
    }
    p.needsUpdate = true; g.computeVertexNormals();
    return g;
  })();
  place(body, 0, 0.4, -0.05);
  turretParts.push(body);
  turretParts.push(place(box(1.5, 0.34, 0.9), 0, 0.42, -1.05));               // bustle
  turretParts.push(place(box(0.9, 0.42, 0.5), 0, 0.42, 1.02, -0.22));         // mantlet base
  turretParts.push(place(cyl(0.5, 0.5, 0.2, 12), 0, 0.76, -0.1));             // hatch ring
  turretParts.push(place(box(0.34, 0.18, 0.34), 0.34, 0.74, -0.62));          // sight box
  for (const s of [-1, 1]) {
    turretParts.push(place(cyl(0.07, 0.07, 0.3, 6), s * 0.95, 0.55, 0.35, 0.4)); // smoke launchers
    turretParts.push(place(cyl(0.07, 0.07, 0.3, 6), s * 0.78, 0.55, 0.55, 0.4));
  }
  turretParts.push(place(box(0.2, 0.2, 0.7), -0.9, 0.62, -0.9));              // stowage bin
  const turretMesh = new THREE.Mesh(mrg(turretParts), paint);
  turretMesh.castShadow = true; turretMesh.receiveShadow = true;
  turret.add(turretMesh);

  /* ---- main gun (recoils) ---- */
  const gun = new THREE.Group();
  gun.position.set(0, 0.44, 0.95);
  turret.add(gun);
  const gunParts = [];
  gunParts.push(place(cyl(0.115, 0.15, 3.5, 10), 0, 0, 1.75, Math.PI / 2));   // barrel
  gunParts.push(place(cyl(0.2, 0.2, 0.55, 10), 0, 0, 1.35, Math.PI / 2));     // evacuator
  gunParts.push(place(cyl(0.19, 0.19, 0.4, 10), 0, 0, 3.45, Math.PI / 2));    // muzzle brake
  gunParts.push(place(box(0.42, 0.4, 0.55), 0, 0, 0.28));                     // mantlet
  gunParts.push(place(cyl(0.05, 0.05, 0.5, 6), 0.16, 0.16, 3.3, Math.PI / 2));// pitot
  const gunMesh = new THREE.Mesh(mrg(gunParts), dark);
  gunMesh.castShadow = true;
  gun.add(gunMesh);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 3.75);
  gun.add(muzzle);

  /* ---- coax MG + antenna + lights ---- */
  const mg = new THREE.Mesh(mrg([
    place(box(0.14, 0.16, 0.7), 0, 0, 0.3), place(cyl(0.045, 0.045, 0.6, 6), 0, 0.02, 0.75, Math.PI / 2)
  ]), dark);
  mg.position.set(0.42, 0.44, 1.0);
  turret.add(mg);

  const antenna = new THREE.Mesh(cyl(0.02, 0.035, 2.3, 5), dark);
  antenna.position.set(-1.0, 1.55, -0.8);
  antenna.geometry.translate(0, 1.15, 0);
  antenna.castShadow = false;
  turret.add(antenna);

  const headL = new THREE.Mesh(sph(0.12, 8, 6), glass);
  headL.position.set(0.86, 1.28, 2.24); root.add(headL);
  const headR = new THREE.Mesh(sph(0.12, 8, 6), glass);
  headR.position.set(-0.86, 1.28, 2.24); root.add(headR);
  const tail = new THREE.Mesh(sph(0.09, 8, 6), red);
  tail.position.set(0.9, 1.2, -2.28); root.add(tail);

  /* ---- runtime animation ---- */
  const state = { wheelSpin: 0, trackScroll: 0, recoil: 0, antennaSway: 0, bounce: 0 };
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();

  const api = {
    group: root,
    turret, gun, muzzle, wheels, tracks, hullMesh, materials: [paint, dark, rubber, wheelMat, rust, glass, red],
    state,
    fireKick(amount = 1) { state.recoil = Math.max(state.recoil, amount); },
    update(dt, ctx = {}) {
      const speed = ctx.speed || 0;
      state.wheelSpin += (speed / 0.4) * dt;
      state.trackScroll += speed * 0.055 * dt;
      rubber.map.offset.y = -state.trackScroll;
      if (rubber.normalMap) rubber.normalMap.offset.y = -state.trackScroll;
      if (rubber.roughnessMap) rubber.roughnessMap.offset.y = -state.trackScroll;

      for (let i = 0; i < WHEELS.length; i++) {
        const w = WHEELS[i];
        const sc = w.r / 0.4;
        _q.setFromAxisAngle(AXIS_X, state.wheelSpin * (w.r > 0.35 ? 1 : 1.25));
        _v.set(w.x, w.y + Math.sin(state.wheelSpin * 2 + i) * 0.012, w.z);
        _s.set(sc, sc, sc);
        _m4.compose(_v, _q, _s);
        wheels.setMatrixAt(i, _m4);
      }
      wheels.instanceMatrix.needsUpdate = true;

      // recoil recovery
      state.recoil = Math.max(0, state.recoil - dt * 4.2);
      const r = state.recoil * state.recoil * 0.55;
      gun.position.z = 0.95 - r;
      gun.rotation.x = -(ctx.gunPitch || 0) - state.recoil * 0.035;
      turret.position.y = 1.62 - r * 0.05;

      // antenna whip + hull vibration
      state.antennaSway += dt;
      antenna.rotation.z = Math.sin(state.antennaSway * 7.3) * 0.06 + Math.sin(state.antennaSway * 3.1) * 0.04;
      antenna.rotation.x = Math.cos(state.antennaSway * 5.7) * 0.05;
      const vib = clamp01(speed / 16) * 0.012;
      hullMesh.position.y = Math.sin(state.antennaSway * 41) * vib;
      hullMesh.position.x = Math.cos(state.antennaSway * 33) * vib * 0.6;
    },
    dispose() {
      for (const m of api.materials) m.dispose();
      trackGeo.dispose(); wheelGeo.dispose();
      hullMesh.geometry.dispose(); turretMesh.geometry.dispose(); gunMesh.geometry.dispose();
      mg.geometry.dispose(); antenna.geometry.dispose();
    }
  };
  return api;
}
const AXIS_X = new THREE.Vector3(1, 0, 0);

/* ---------------------------------------------------------------------------
 * Procedural creatures
 * -------------------------------------------------------------------------*/
function makeLeg(mat, { thigh = 0.9, shin = 0.8, rTop = 0.18, rBot = 0.1, foot = 0.22, spread = 0 } = {}) {
  const hip = new THREE.Group();
  const upper = new THREE.Mesh(cyl(rTop * 0.8, rTop, thigh, 7), mat);
  upper.position.y = -thigh / 2;
  upper.castShadow = true;
  hip.add(upper);
  const knee = new THREE.Group();
  knee.position.y = -thigh;
  hip.add(knee);
  const lower = new THREE.Mesh(cyl(rBot, rTop * 0.75, shin, 6), mat);
  lower.position.y = -shin / 2;
  lower.castShadow = true;
  knee.add(lower);
  const paw = new THREE.Mesh(ico(foot, 0), mat);
  paw.position.y = -shin - foot * 0.4;
  paw.scale.set(1, 0.6, 1.25);
  knee.add(paw);
  hip.rotation.z = spread;
  return { hip, knee };
}

function makeArm(mat, { upper = 0.95, fore = 0.9, r = 0.17 } = {}) {
  const shoulder = new THREE.Group();
  const a = new THREE.Mesh(cyl(r * 0.85, r, upper, 7), mat);
  a.position.y = -upper / 2; a.castShadow = true;
  shoulder.add(a);
  const elbow = new THREE.Group();
  elbow.position.y = -upper;
  shoulder.add(elbow);
  const b = new THREE.Mesh(cyl(r * 0.7, r * 0.9, fore, 6), mat);
  b.position.y = -fore / 2; b.castShadow = true;
  elbow.add(b);
  const hand = new THREE.Mesh(ico(r * 1.25, 0), mat);
  hand.position.y = -fore - r * 0.6;
  elbow.add(hand);
  return { shoulder, elbow, hand };
}

function addEyes(parent, mat, positions) {
  const eyes = [];
  for (const [x, y, z, r] of positions) {
    const e = new THREE.Mesh(sph(r, 8, 6), mat);
    e.position.set(x, y, z);
    parent.add(e);
    eyes.push(e);
  }
  return eyes;
}

/** generic biped: cyclops / golem / minotaur / titan */
function makeHumanoid(cmats, o) {
  const skin = cmats.skin(o.tint, { rough: o.rough ?? 0.95, flat: !!o.flat });
  const accent = cmats.glow(o.accent, o.glowIntensity ?? 2.4);
  const hard = o.stone ? cmats.stone(o.tint, { rough: 0.9, emissive: o.accent, emissiveIntensity: o.crackGlow ?? 0.55 }) : skin;

  const g = new THREE.Group();
  const H = o.height;
  const legLen = H * (o.legRatio ?? 0.44);
  const torsoH = H * (o.torsoRatio ?? 0.34);
  const headH = H * (o.headRatio ?? 0.18);
  const hipY = legLen;

  const body = new THREE.Group();
  body.position.y = hipY;
  g.add(body);

  // torso
  const torso = new THREE.Mesh(rockify(ico(torsoH * 0.62, 1), 5, 0.16), hard);
  torso.scale.set(o.wide ?? 1.15, torsoH / (torsoH * 1.24), o.depth ?? 0.8);
  torso.position.y = torsoH * 0.55;
  torso.castShadow = true;
  body.add(torso);

  if (o.belly) {
    const belly = new THREE.Mesh(rockify(sph(torsoH * 0.42, 10, 8), 9, 0.12), skin);
    belly.position.set(0, torsoH * 0.32, torsoH * 0.16);
    belly.scale.set(1.1, 0.85, 0.9);
    belly.castShadow = true;
    body.add(belly);
  }

  // shoulders / pauldrons
  for (const s of [-1, 1]) {
    const sh = new THREE.Mesh(rockify(ico(torsoH * (o.pauldron ?? 0.3), 1), 3 + s, 0.22), hard);
    sh.position.set(s * torsoH * 0.62, torsoH * 0.92, 0);
    sh.castShadow = true;
    body.add(sh);
    if (o.spikes) {
      for (let i = 0; i < 3; i++) {
        const sp = new THREE.Mesh(cone(torsoH * 0.07, torsoH * 0.3, 5), hard);
        sp.position.set(s * torsoH * (0.6 + i * 0.05), torsoH * (1.0 + i * 0.03), -0.06 * i);
        sp.rotation.z = s * (0.5 + i * 0.18);
        body.add(sp);
      }
    }
  }

  // head
  const head = new THREE.Group();
  head.position.y = torsoH * 1.12;
  body.add(head);
  const skull = new THREE.Mesh(rockify(o.headShape === 'block' ? box(headH * 0.8, headH * 0.9, headH * 0.85) : sph(headH * 0.5, 10, 8), 11, 0.1), hard);
  skull.castShadow = true;
  head.add(skull);
  if (o.horns) {
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(cyl(0.045 * headH * 0.5, 0.12 * headH * 0.5, headH * 0.85, 7), cmats.skin(o.hornColor ?? 0xd8cbb2, { rough: 0.7 }));
      horn.position.set(s * headH * 0.42, headH * 0.3, -headH * 0.05);
      horn.rotation.z = s * 1.05;
      horn.rotation.x = -0.25;
      head.add(horn);
    }
    const snout = new THREE.Mesh(box(headH * 0.42, headH * 0.36, headH * 0.5), hard);
    snout.position.set(0, -headH * 0.12, headH * 0.4);
    head.add(snout);
  }
  if (o.singleEye) {
    const eye = new THREE.Mesh(sph(headH * 0.24, 10, 8), accent);
    eye.position.set(0, headH * 0.06, headH * 0.42);
    head.add(eye);
    const brow = new THREE.Mesh(box(headH * 0.62, headH * 0.12, headH * 0.2), hard);
    brow.position.set(0, headH * 0.26, headH * 0.36);
    brow.rotation.x = -0.2;
    head.add(brow);
  } else {
    addEyes(head, accent, [[-headH * 0.2, headH * 0.06, headH * 0.4, headH * 0.09], [headH * 0.2, headH * 0.06, headH * 0.4, headH * 0.09]]);
  }
  if (o.jaw) {
    const jaw = new THREE.Mesh(box(headH * 0.44, headH * 0.18, headH * 0.42), hard);
    jaw.position.set(0, -headH * 0.3, headH * 0.24);
    head.add(jaw);
    head.userData.jaw = jaw;
  }

  // arms
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = makeArm(skin, { upper: torsoH * (o.armUpper ?? 0.95), fore: torsoH * (o.armFore ?? 0.9), r: torsoH * (o.armR ?? 0.22) });
    arm.shoulder.position.set(s * torsoH * 0.62, torsoH * 0.86, 0);
    arm.shoulder.rotation.z = s * (o.armSpread ?? 0.16);
    body.add(arm.shoulder);
    arms.push(arm);
  }

  // weapon
  let weapon = null;
  if (o.weapon === 'club') {
    weapon = new THREE.Group();
    const shaft = new THREE.Mesh(cyl(torsoH * 0.09, torsoH * 0.12, torsoH * 1.5, 8), cmats.skin(0x6b4f34, { rough: 0.9 }));
    shaft.position.y = -torsoH * 0.75;
    weapon.add(shaft);
    const head2 = new THREE.Mesh(rockify(ico(torsoH * 0.34, 1), 4, 0.24), hard);
    head2.position.y = -torsoH * 1.5;
    head2.castShadow = true;
    weapon.add(head2);
    for (let i = 0; i < 5; i++) {
      const sp = new THREE.Mesh(cone(torsoH * 0.07, torsoH * 0.22, 5), hard);
      const a = (i / 5) * TAU;
      sp.position.set(Math.cos(a) * torsoH * 0.3, -torsoH * 1.5, Math.sin(a) * torsoH * 0.3);
      sp.rotation.z = Math.cos(a) * 1.3; sp.rotation.x = -Math.sin(a) * 1.3;
      weapon.add(sp);
    }
    arms[1].hand.add(weapon);
    weapon.rotation.x = Math.PI * 0.9;
  } else if (o.weapon === 'axe') {
    weapon = new THREE.Group();
    const shaft = new THREE.Mesh(cyl(torsoH * 0.07, torsoH * 0.07, torsoH * 1.35, 7), cmats.skin(0x5d442e, { rough: 0.9 }));
    shaft.position.y = -torsoH * 0.6;
    weapon.add(shaft);
    const blade = new THREE.Mesh(mrg([place(box(torsoH * 0.06, torsoH * 0.6, torsoH * 0.5), 0, -torsoH * 1.1, torsoH * 0.24)]), cmats.metal(0x9aa3ab, { rough: 0.35 }));
    weapon.add(blade);
    arms[1].hand.add(weapon);
    weapon.rotation.x = Math.PI * 0.85;
  } else if (o.weapon === 'staff') {
    weapon = new THREE.Group();
    const shaft = new THREE.Mesh(cyl(torsoH * 0.05, torsoH * 0.06, torsoH * 1.6, 6), cmats.skin(0x4a3a2a));
    shaft.position.y = -torsoH * 0.8;
    weapon.add(shaft);
    const orb = new THREE.Mesh(ico(torsoH * 0.2, 1), accent);
    orb.position.y = -torsoH * 1.6;
    weapon.add(orb);
    arms[1].hand.add(weapon);
    weapon.rotation.x = 0.15;
    head.userData.orb = orb;
  }

  // legs
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = makeLeg(skin, {
      thigh: legLen * 0.55, shin: legLen * 0.5,
      rTop: torsoH * (o.legR ?? 0.26), rBot: torsoH * 0.18, foot: torsoH * 0.2, spread: s * 0.08
    });
    leg.hip.position.set(s * torsoH * 0.34, 0, 0);
    body.add(leg.hip);
    legs.push(leg);
  }

  // rune belt / glowing core
  let core = null;
  if (o.core) {
    core = new THREE.Mesh(ico(torsoH * 0.24, 1), accent);
    core.position.set(0, torsoH * 0.62, torsoH * 0.42);
    body.add(core);
  }

  const rig = {
    group: g, body, head, arms, legs, weapon, core,
    height: H, hipY, torsoH,
    animate(t, dt, ctx) {
      const speed = ctx.speed || 0;
      const moving = clamp01(speed / 3);
      const freq = 2.2 + speed * 0.42;
      const amp = 0.42 + moving * 0.42;
      const ph = t * freq;
      for (let i = 0; i < legs.length; i++) {
        legs[i].hip.rotation.x = Math.sin(ph + i * Math.PI) * amp;
        legs[i].knee.rotation.x = Math.max(0, Math.sin(ph + i * Math.PI + 1.1)) * amp * 0.9 + 0.08;
      }
      for (let i = 0; i < arms.length; i++) {
        const swing = i === 0 ? Math.sin(ph + Math.PI) : Math.sin(ph);
        arms[i].shoulder.rotation.x = swing * amp * 0.55 - 0.1;
        arms[i].shoulder.rotation.z = (i === 0 ? -1 : 1) * (o.armSpread ?? 0.16) + Math.sin(ph * 0.5 + i) * 0.05;
        arms[i].elbow.rotation.x = -0.35 - Math.max(0, swing) * 0.3;
      }
      body.position.y = hipY + Math.abs(Math.sin(ph)) * 0.06 * H * 0.1 + moving * Math.sin(ph * 2) * 0.02;
      body.rotation.z = Math.sin(ph) * 0.045 * moving;
      body.rotation.x = clamp01(speed / 10) * 0.12;
      head.rotation.y = Math.sin(t * 0.9) * 0.22 + (ctx.lookYaw || 0);
      head.rotation.x = (ctx.lookPitch || 0) - Math.sin(ph * 2) * 0.03;
      if (ctx.attack > 0) {
        const a = ctx.attack;
        if (weapon) {
          arms[1].shoulder.rotation.x = -2.1 * Math.sin(a * Math.PI) - 0.2;
          arms[1].elbow.rotation.x = -0.8 + Math.sin(a * Math.PI) * 1.2;
        }
        body.rotation.x += Math.sin(a * Math.PI) * 0.18;
      }
      if (core) core.rotation.y += dt * 1.6;
    }
  };
  return rig;
}
/** quadruped: wolf / dire beast */
function makeQuadruped(cmats, o) {
  const skin = cmats.skin(o.tint, { rough: o.rough ?? 0.96 });
  const dark = cmats.skin(o.dark ?? 0x2b2622, { rough: 0.9 });
  const accent = cmats.glow(o.accent, 2.6);
  const g = new THREE.Group();
  const L = o.length ?? 2.2, H = o.height ?? 1.4;
  const bodyY = H * 0.62;

  const body = new THREE.Group();
  body.position.y = bodyY;
  g.add(body);

  const torso = new THREE.Mesh(rockify(sph(L * 0.36, 12, 9), 3, 0.14), skin);
  torso.scale.set(0.72, 0.78, 1.5);
  torso.castShadow = true;
  body.add(torso);

  // haunches + chest
  const chest = new THREE.Mesh(rockify(sph(L * 0.3, 10, 8), 7, 0.12), skin);
  chest.position.set(0, 0.02, L * 0.4);
  chest.scale.set(0.85, 0.95, 1);
  body.add(chest);
  const haunch = new THREE.Mesh(rockify(sph(L * 0.28, 10, 8), 13, 0.12), skin);
  haunch.position.set(0, -0.02, -L * 0.42);
  haunch.scale.set(0.8, 1.05, 1.1);
  body.add(haunch);

  // dorsal ridge / fur
  if (o.ridge) {
    const ridge = [];
    for (let i = 0; i < 7; i++) {
      ridge.push(place(cone(L * 0.055, L * (0.16 + Math.sin(i / 6 * Math.PI) * 0.16), 5), 0, L * 0.26, L * (0.45 - i * 0.15)));
    }
    const r = new THREE.Mesh(mrg(ridge), dark);
    body.add(r);
  }

  // neck + head
  const neck = new THREE.Group();
  neck.position.set(0, L * 0.1, L * 0.5);
  body.add(neck);
  const neckMesh = new THREE.Mesh(cyl(L * 0.14, L * 0.2, L * 0.42, 8), skin);
  neckMesh.rotation.x = -0.9;
  neckMesh.position.set(0, L * 0.12, L * 0.14);
  neck.add(neckMesh);
  const head = new THREE.Group();
  head.position.set(0, L * 0.24, L * 0.32);
  neck.add(head);
  const skull = new THREE.Mesh(rockify(sph(L * 0.19, 10, 8), 17, 0.1), skin);
  skull.scale.set(0.9, 0.92, 1.15);
  skull.castShadow = true;
  head.add(skull);
  const snout = new THREE.Mesh(box(L * 0.14, L * 0.12, L * 0.3), skin);
  snout.position.set(0, -L * 0.04, L * 0.24);
  head.add(snout);
  const jaw = new THREE.Mesh(box(L * 0.12, L * 0.06, L * 0.26), dark);
  jaw.position.set(0, -L * 0.11, L * 0.23);
  head.add(jaw);
  // teeth
  const teeth = [];
  for (let i = 0; i < 6; i++) {
    teeth.push(place(cone(L * 0.018, L * 0.07, 4), (i % 2 ? 1 : -1) * L * 0.045, -L * 0.07, L * (0.14 + i * 0.035), Math.PI));
  }
  head.add(new THREE.Mesh(mrg(teeth), cmats.skin(0xe8e2d0, { rough: 0.5 })));
  // ears
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(cone(L * 0.07, L * (o.earLen ?? 0.2), 5), dark);
    ear.position.set(s * L * 0.11, L * 0.16, -L * 0.02);
    ear.rotation.z = s * 0.25;
    ear.rotation.x = -0.15;
    head.add(ear);
  }
  addEyes(head, accent, [[-L * 0.08, L * 0.03, L * 0.15, L * 0.032], [L * 0.08, L * 0.03, L * 0.15, L * 0.032]]);

  // tusks
  if (o.tusks) {
    for (const s of [-1, 1]) {
      const t = new THREE.Mesh(cone(L * 0.035, L * 0.34, 6), cmats.skin(0xe6dcc2, { rough: 0.45 }));
      t.position.set(s * L * 0.09, -L * 0.06, L * 0.3);
      t.rotation.x = -1.1; t.rotation.z = s * 0.3;
      head.add(t);
    }
  }

  // legs
  const legs = [];
  const legPos = [[-1, 1], [1, 1], [-1, -1], [1, -1]];
  for (const [s, fz] of legPos) {
    const leg = makeLeg(skin, { thigh: bodyY * 0.62, shin: bodyY * 0.6, rTop: L * 0.085, rBot: L * 0.055, foot: L * 0.075, spread: s * 0.06 });
    leg.hip.position.set(s * L * 0.2, -L * 0.04, fz * L * 0.42);
    body.add(leg.hip);
    legs.push(leg);
  }

  // tail
  const tail = new THREE.Group();
  tail.position.set(0, L * 0.06, -L * 0.55);
  body.add(tail);
  const tailParts = [];
  for (let i = 0; i < 4; i++) tailParts.push(place(cyl(L * 0.05 * (1 - i * 0.18), L * 0.06 * (1 - i * 0.15), L * 0.2, 6), 0, 0, -L * (0.1 + i * 0.19), 0.12 * i));
  tail.add(new THREE.Mesh(mrg(tailParts), skin));

  return {
    group: g, body, head, neck, jaw, legs, tail, height: H,
    animate(t, dt, ctx) {
      const speed = ctx.speed || 0;
      const run = clamp01(speed / 6);
      const freq = 5 + speed * 0.85;
      const ph = t * freq;
      const amp = 0.25 + run * 0.85;
      for (let i = 0; i < legs.length; i++) {
        const off = [0, Math.PI, Math.PI, 0][i];
        legs[i].hip.rotation.x = Math.sin(ph + off) * amp;
        legs[i].knee.rotation.x = Math.max(0, -Math.sin(ph + off - 0.9)) * amp * 1.1 + 0.1;
      }
      body.position.y = H * 0.62 + Math.sin(ph * 2) * 0.045 * run - run * 0.04;
      body.rotation.x = run * 0.09 + Math.sin(ph) * 0.03;
      body.rotation.z = Math.sin(ph * 0.5) * 0.05 * run;
      neck.rotation.x = -0.15 - run * 0.12 + Math.sin(ph * 2) * 0.03;
      head.rotation.y = Math.sin(t * 1.3) * 0.18 + (ctx.lookYaw || 0);
      head.rotation.x = (ctx.lookPitch || 0) + Math.sin(ph) * 0.04;
      tail.rotation.y = Math.sin(t * 4.5) * 0.35;
      tail.rotation.x = -0.25 + Math.sin(t * 3.1) * 0.12;
      const bite = ctx.attack > 0 ? Math.sin(ctx.attack * Math.PI) : 0;
      jaw.rotation.x = bite * 0.85 + clamp01(run * 0.3) * 0.16;
    }
  };
}

/** 8-legged skitterer */
function makeSpider(cmats, o) {
  const skin = cmats.skin(o.tint, { rough: 0.8, metal: 0.15, flat: true });
  const accent = cmats.glow(o.accent, 2.8);
  const g = new THREE.Group();
  const H = o.height ?? 1.2, R = o.radius ?? 1.1;
  const body = new THREE.Group();
  body.position.y = H * 0.72;
  g.add(body);
  const abdomen = new THREE.Mesh(rockify(sph(R * 0.62, 12, 9), 21, 0.2), skin);
  abdomen.position.z = -R * 0.55;
  abdomen.scale.set(1, 0.85, 1.25);
  abdomen.castShadow = true;
  body.add(abdomen);
  const thorax = new THREE.Mesh(rockify(sph(R * 0.42, 10, 8), 31, 0.16), skin);
  thorax.position.z = R * 0.15;
  thorax.castShadow = true;
  body.add(thorax);
  const head = new THREE.Mesh(rockify(sph(R * 0.3, 10, 8), 41, 0.14), skin);
  head.position.set(0, -R * 0.04, R * 0.55);
  body.add(head);
  addEyes(head, accent, [[-R * 0.12, R * 0.06, R * 0.2, R * 0.06], [R * 0.12, R * 0.06, R * 0.2, R * 0.06], [-R * 0.06, -R * 0.02, R * 0.24, R * 0.035], [R * 0.06, -R * 0.02, R * 0.24, R * 0.035]]);
  // fangs
  for (const s of [-1, 1]) {
    const f = new THREE.Mesh(cone(R * 0.05, R * 0.24, 5), cmats.skin(0xe8e0cc, { rough: 0.4 }));
    f.position.set(s * R * 0.09, -R * 0.16, R * 0.72);
    f.rotation.x = Math.PI * 0.86;
    body.add(f);
  }
  const legs = [];
  for (let i = 0; i < 8; i++) {
    const s = i < 4 ? -1 : 1;
    const idx = i % 4;
    const leg = makeLeg(skin, { thigh: R * 1.05, shin: R * 1.05, rTop: R * 0.075, rBot: R * 0.045, foot: R * 0.06, spread: s * (0.9 + idx * 0.12) });
    leg.hip.position.set(s * R * 0.28, 0, R * (0.42 - idx * 0.3));
    leg.hip.rotation.y = s * (0.5 - idx * 0.34);
    leg.hip.rotation.x = -0.5 + idx * 0.16;
    body.add(leg.hip);
    legs.push({ ...leg, s, idx, baseRotX: leg.hip.rotation.x });
  }
  return {
    group: g, body, head, legs, height: H,
    animate(t, dt, ctx) {
      const speed = ctx.speed || 0;
      const ph = t * (7 + speed * 1.2);
      const amp = 0.22 + clamp01(speed / 6) * 0.5;
      for (let i = 0; i < legs.length; i++) {
        const l = legs[i];
        const off = (i % 2) * Math.PI + (i < 4 ? 0 : Math.PI * 0.5);
        l.hip.rotation.x = l.baseRotX + Math.sin(ph + off) * amp;
        l.knee.rotation.x = 0.5 + Math.max(0, Math.sin(ph + off + 1.2)) * amp * 1.4;
      }
      body.position.y = H * 0.72 + Math.sin(ph * 1.5) * 0.05;
      body.rotation.z = Math.sin(ph * 0.7) * 0.06;
      head.rotation.y = Math.sin(t * 3.1) * 0.25 + (ctx.lookYaw || 0);
      if (ctx.attack > 0) {
        body.rotation.x = -Math.sin(ctx.attack * Math.PI) * 0.45;
        body.position.y += Math.sin(ctx.attack * Math.PI) * H * 0.25;
      } else body.rotation.x = lerp(body.rotation.x, clamp01(speed / 12) * 0.12, 0.2);
    }
  };
}

/** floating spectre */
function makeWraith(cmats, o) {
  const cloth = cmats.cloth(o.tint, { rough: 1 });
  const accent = cmats.glow(o.accent, 3.0);
  const g = new THREE.Group();
  const H = o.height ?? 2.6;

  // robe: lathe profile, tattered at the hem
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(Math.max(0.02, (0.18 + Math.sin(t * Math.PI) * 0.42) * (1 - t * 0.35)), t * H * 0.78));
  }
  const robe = new THREE.Mesh(new THREE.LatheGeometry(pts, 14), cloth);
  robe.castShadow = true;
  g.add(robe);

  const hood = new THREE.Group();
  hood.position.y = H * 0.76;
  g.add(hood);
  const hoodMesh = new THREE.Mesh(rockify(sph(H * 0.16, 12, 9), 51, 0.1), cloth);
  hoodMesh.scale.set(1, 1.15, 1.05);
  hoodMesh.castShadow = true;
  hood.add(hoodMesh);
  const face = new THREE.Mesh(sph(H * 0.11, 10, 8), cmats.skin(0x0a0d12, { rough: 1 }));
  face.position.z = H * 0.05;
  hood.add(face);
  const eyes = addEyes(hood, accent, [[-H * 0.045, H * 0.015, H * 0.13, H * 0.026], [H * 0.045, H * 0.015, H * 0.13, H * 0.026]]);

  // skeletal hands
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = makeArm(cloth, { upper: H * 0.2, fore: H * 0.22, r: H * 0.045 });
    arm.shoulder.position.set(s * H * 0.2, H * 0.6, 0);
    arm.shoulder.rotation.z = s * 0.5;
    arm.shoulder.rotation.x = -0.7;
    g.add(arm.shoulder);
    arms.push(arm);
    const claw = new THREE.Mesh(mrg([
      place(cone(H * 0.02, H * 0.14, 4), 0, -H * 0.1, 0),
      place(cone(H * 0.02, H * 0.13, 4), H * 0.03, -H * 0.09, 0.01),
      place(cone(H * 0.02, H * 0.13, 4), -H * 0.03, -H * 0.09, 0.01)
    ]), cmats.skin(0xd8d2c0, { rough: 0.6 }));
    arm.hand.add(claw);
  }

  // tattered hem strips
  const strips = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    const s = new THREE.Mesh(new THREE.PlaneGeometry(H * 0.14, H * 0.34, 1, 3), cloth);
    s.geometry.translate(0, -H * 0.17, 0);
    s.position.set(Math.cos(a) * H * 0.3, H * 0.14, Math.sin(a) * H * 0.3);
    s.rotation.y = -a;
    g.add(s);
    strips.push(s);
  }

  // orbiting rune
  const rune = new THREE.Mesh(new THREE.PlaneGeometry(H * 0.9, H * 0.9), new THREE.MeshBasicMaterial({
    map: cmats.lib.rune, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    color: new THREE.Color(o.accent), side: THREE.DoubleSide, opacity: 0.55, toneMapped: false
  }));
  rune.rotation.x = -Math.PI / 2;
  rune.position.y = 0.06;
  g.add(rune);

  return {
    group: g, body: g, head: hood, arms, eyes, rune, strips, height: H, flying: true,
    animate(t, dt, ctx) {
      const speed = ctx.speed || 0;
      g.position.y = Math.sin(t * 1.6) * H * 0.05 + H * 0.08;
      g.rotation.y = Math.sin(t * 0.7) * 0.08;
      hood.rotation.y = Math.sin(t * 1.1) * 0.28 + (ctx.lookYaw || 0);
      hood.rotation.x = (ctx.lookPitch || 0) * 0.6;
      for (let i = 0; i < arms.length; i++) {
        const s = i === 0 ? -1 : 1;
        arms[i].shoulder.rotation.x = -0.7 - Math.sin(t * 1.8 + i) * 0.18 - (ctx.attack > 0 ? Math.sin(ctx.attack * Math.PI) * 1.1 : 0);
        arms[i].shoulder.rotation.z = s * (0.5 + Math.sin(t * 1.3 + i) * 0.1);
        arms[i].elbow.rotation.x = -0.5 - Math.sin(t * 2.1 + i) * 0.2;
      }
      for (let i = 0; i < strips.length; i++) {
        strips[i].rotation.x = Math.sin(t * 2.4 + i * 0.7) * 0.22 - clamp01(speed / 8) * 0.25;
        strips[i].rotation.z = Math.cos(t * 1.9 + i) * 0.16;
      }
      rune.rotation.z += dt * (0.6 + clamp01(speed / 8));
      rune.material.opacity = 0.32 + Math.sin(t * 3) * 0.14 + (ctx.attack > 0 ? 0.4 : 0);
      const pulse = 2.2 + Math.sin(t * 4.2) * 0.7 + (ctx.attack > 0 ? 2 : 0);
      for (const e of eyes) e.material.emissiveIntensity = pulse;
    }
  };
}

/** dragon (procedural stand-in for the streamed GLB) */
function makeDragon(cmats, o) {
  const skin = cmats.skin(o.tint, { rough: 0.72, metal: 0.12, flat: true });
  const belly = cmats.skin(o.belly ?? 0xc9a06a, { rough: 0.8 });
  const accent = cmats.glow(o.accent, 3.0);
  const wingMat = new THREE.MeshStandardMaterial({
    color: o.tint, map: cmats.lib.hide.map, roughness: 0.85, metalness: 0,
    side: THREE.DoubleSide, transparent: true, opacity: 0.96, envMapIntensity: 0.6
  });
  const g = new THREE.Group();
  const H = o.height ?? 6;
  const L = H * 1.9;
  const body = new THREE.Group();
  body.position.y = H * 0.55;
  g.add(body);

  const torso = new THREE.Mesh(rockify(sph(L * 0.22, 14, 10), 3, 0.12), skin);
  torso.scale.set(0.85, 0.9, 1.7);
  torso.castShadow = true;
  body.add(torso);
  const bellyMesh = new THREE.Mesh(sph(L * 0.19, 12, 9), belly);
  bellyMesh.scale.set(0.7, 0.72, 1.5);
  bellyMesh.position.y = -L * 0.05;
  body.add(bellyMesh);

  // neck + head
  const neck = new THREE.Group();
  neck.position.set(0, L * 0.06, L * 0.3);
  body.add(neck);
  const neckParts = [];
  for (let i = 0; i < 6; i++) {
    const t = i / 5;
    neckParts.push(place(sph(L * (0.11 - t * 0.045), 9, 7), 0, L * 0.16 * t + Math.sin(t * 1.4) * L * 0.06, L * 0.16 * t, 0));
  }
  neck.add(new THREE.Mesh(mrg(neckParts), skin));
  const head = new THREE.Group();
  head.position.set(0, L * 0.2, L * 0.32);
  neck.add(head);
  const skull = new THREE.Mesh(rockify(sph(L * 0.1, 12, 9), 9, 0.1), skin);
  skull.scale.set(0.85, 0.8, 1.5);
  skull.castShadow = true;
  head.add(skull);
  const snout = new THREE.Mesh(box(L * 0.09, L * 0.07, L * 0.2), skin);
  snout.position.set(0, -L * 0.02, L * 0.16);
  head.add(snout);
  const jaw = new THREE.Mesh(box(L * 0.08, L * 0.045, L * 0.19), belly);
  jaw.position.set(0, -L * 0.07, L * 0.15);
  head.add(jaw);
  const teeth = [];
  for (let i = 0; i < 8; i++) {
    teeth.push(place(cone(L * 0.012, L * 0.05, 4), (i % 2 ? 1 : -1) * L * 0.032, -L * 0.045, L * (0.08 + i * 0.022), Math.PI));
  }
  head.add(new THREE.Mesh(mrg(teeth), cmats.skin(0xf0e8d4, { rough: 0.4 })));
  for (const s of [-1, 1]) {
    const horn = new THREE.Mesh(cone(L * 0.028, L * 0.24, 6), cmats.skin(0xe0d6bd, { rough: 0.5 }));
    horn.position.set(s * L * 0.06, L * 0.08, -L * 0.06);
    horn.rotation.x = -0.7; horn.rotation.z = s * 0.35;
    head.add(horn);
  }
  addEyes(head, accent, [[-L * 0.045, L * 0.03, L * 0.09, L * 0.018], [L * 0.045, L * 0.03, L * 0.09, L * 0.018]]);
  const throat = new THREE.Mesh(sph(L * 0.045, 8, 6), accent);
  throat.position.set(0, -L * 0.05, L * 0.1);
  head.add(throat);
  head.userData.throat = throat;

  // wings
  const wings = [];
  for (const s of [-1, 1]) {
    const wing = new THREE.Group();
    wing.position.set(s * L * 0.14, L * 0.1, -L * 0.02);
    body.add(wing);
    const span = L * 0.85;
    const membrane = new THREE.PlaneGeometry(span, L * 0.5, 6, 3);
    const p = membrane.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + span / 2, t = x / span;
      const y = p.getY(i);
      p.setY(i, y * (1 - t * 0.55) + Math.sin(t * Math.PI) * L * 0.06);
      p.setZ(i, -t * t * L * 0.16 + Math.sin(y * 3 + t * 4) * L * 0.02);
    }
    p.needsUpdate = true;
    membrane.computeVertexNormals();
    membrane.translate(span / 2, 0, 0);
    const mem = new THREE.Mesh(membrane, wingMat);
    mem.castShadow = true;
    wing.add(mem);
    const bones = [];
    for (let i = 0; i < 4; i++) {
      const a = -0.5 + i * 0.34;
      const b = cyl(L * 0.018, L * 0.03, span * (0.95 - i * 0.08), 5);
      b.rotateZ(-Math.PI / 2);
      b.rotateY(a);
      b.translate(Math.cos(a) * span * 0.45, 0, -Math.sin(a) * span * 0.45);
      bones.push(b);
    }
    wing.add(new THREE.Mesh(mrg(bones), skin));
    wing.rotation.z = s * 0.2;
    wings.push({ group: wing, s });
  }

  // tail
  const tail = new THREE.Group();
  tail.position.set(0, 0, -L * 0.3);
  body.add(tail);
  const tailSegs = [];
  const segNodes = [];
  let parent = tail;
  for (let i = 0; i < 5; i++) {
    const seg = new THREE.Group();
    seg.position.z = -L * (i === 0 ? 0.06 : 0.16);
    parent.add(seg);
    const r = L * (0.085 - i * 0.013);
    const m = new THREE.Mesh(cyl(r * 0.7, r, L * 0.17, 7), skin);
    m.rotation.x = Math.PI / 2;
    seg.add(m);
    segNodes.push(seg);
    parent = seg;
  }
  const fin = new THREE.Mesh(cone(L * 0.05, L * 0.2, 5), skin);
  fin.rotation.x = -Math.PI / 2;
  fin.position.z = -L * 0.2;
  parent.add(fin);

  // legs
  const legs = [];
  for (const [s, fz] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
    const leg = makeLeg(skin, { thigh: L * 0.14, shin: L * 0.13, rTop: L * 0.045, rBot: L * 0.03, foot: L * 0.04, spread: s * 0.25 });
    leg.hip.position.set(s * L * 0.13, -L * 0.06, fz * L * 0.2);
    body.add(leg.hip);
    legs.push(leg);
  }

  return {
    group: g, body, head, neck, jaw, wings, legs, tail: segNodes, height: H, flying: true, materials: [wingMat],
    animate(t, dt, ctx) {
      const speed = ctx.speed || 0;
      const flap = Math.sin(t * (2.6 + speed * 0.12));
      for (const w of wings) {
        w.group.rotation.z = w.s * (0.22 + flap * 0.42);
        w.group.rotation.x = Math.sin(t * 2.6 + 0.6) * 0.14;
      }
      body.position.y = H * 0.55 + flap * H * 0.05;
      body.rotation.x = clamp01(speed / 14) * 0.16 + Math.sin(t * 1.3) * 0.03;
      body.rotation.z = Math.sin(t * 0.9) * 0.06;
      neck.rotation.x = -0.25 + Math.sin(t * 1.1) * 0.08 + (ctx.attack > 0 ? -Math.sin(ctx.attack * Math.PI) * 0.5 : 0);
      head.rotation.y = Math.sin(t * 0.8) * 0.2 + (ctx.lookYaw || 0);
      head.rotation.x = (ctx.lookPitch || 0);
      jaw.rotation.x = (ctx.attack > 0 ? Math.sin(ctx.attack * Math.PI) * 0.9 : 0) + 0.06;
      throat.material.emissiveIntensity = 2 + (ctx.attack > 0 ? 5 * Math.sin(ctx.attack * Math.PI) : Math.sin(t * 3) * 0.6);
      for (let i = 0; i < segNodes.length; i++) {
        segNodes[i].rotation.y = Math.sin(t * 2.2 - i * 0.6) * 0.16;
        segNodes[i].rotation.x = Math.sin(t * 1.7 - i * 0.5) * 0.07;
      }
      for (let i = 0; i < legs.length; i++) {
        legs[i].hip.rotation.x = Math.sin(t * 2.6 + i * 1.4) * 0.14 - 0.2;
        legs[i].knee.rotation.x = 0.5 + Math.sin(t * 2.6 + i) * 0.1;
      }
    }
  };
}

/* ---------------------------------------------------------------------------
 * registry of procedural creatures
 * -------------------------------------------------------------------------*/
export const CREATURE_BUILDERS = {
  quadruped: makeQuadruped,
  boar: (cm, o) => makeQuadruped(cm, { ...o, length: 2.3, ridge: true, tusks: true, earLen: 0.12, dark: 0x3a2c22 }),
  spider: makeSpider,
  wraith: makeWraith,
  dragon: makeDragon,
  cyclops: (cm, o) => makeHumanoid(cm, { ...o, weapon: 'club', singleEye: true, wide: 1.3, armR: 0.26, spikes: false, jaw: true }),
  golem: (cm, o) => makeHumanoid(cm, { ...o, stone: true, weapon: null, wide: 1.5, depth: 1.0, armR: 0.3, legR: 0.34, pauldron: 0.38, spikes: true, core: true, headShape: 'block', crackGlow: 0.9 }),
  minotaur: (cm, o) => makeHumanoid(cm, { ...o, weapon: 'axe', horns: true, wide: 1.35, armR: 0.26, belly: true, jaw: true, hornColor: 0xd9c9a6 }),
  titan: (cm, o) => makeHumanoid(cm, { ...o, stone: true, weapon: 'club', wide: 1.7, depth: 1.1, armR: 0.34, legR: 0.4, pauldron: 0.46, spikes: true, core: true, headShape: 'block', singleEye: true, crackGlow: 1.4 })
};

/* ---------------------------------------------------------------------------
 * ModelLibrary — GLB streaming + template cache
 * -------------------------------------------------------------------------*/
const GLB_ANIM_HINTS = {
  mech: { idle: ['Idle', 'idle'], run: ['Running', 'Run', 'Walking', 'Walk'], attack: ['Punch', 'Wave', 'Yes'], die: ['Death', 'death'] },
  soldier: { idle: ['Idle', 'idle'], run: ['Run', 'Walk'], attack: ['Run'], die: ['Death', 'Idle'] },
  xbot: { idle: ['idle', 'Idle'], run: ['run', 'walk'], attack: ['punch'], die: ['death'] },
  nightmare: { idle: [], run: ['horse.gallop', 'gallop', 'Animation'], attack: [], die: [] },
  idol: { idle: [], run: [], attack: [], die: [] },
  sentry: { idle: [], run: [], attack: [], die: [] },
  dragon: { idle: [], run: [], attack: [], die: [] }
};

export class ModelLibrary {
  constructor(texLib, cmats, qualityName = 'medium') {
    this.lib = texLib;
    this.cmats = cmats;
    this.quality = qualityName;
    this.glb = new Map();       // key -> {scene, animations, box, ok}
    this.failed = new Set();
    this.templates = new Map(); // enemy type -> template
    this.loader = new GLTFLoader();
    this.hostIndex = 0;
    this.stats = { loaded: 0, failed: 0, procedural: 0 };
  }

  wantsTier(tier) {
    if (this.quality === 'high') return true;
    if (this.quality === 'medium') return tier !== 'luxury';
    return tier === 'core';
  }

  async loadGLB(key) {
    if (this.glb.has(key)) return this.glb.get(key);
    const def = MODELS[key];
    if (!def) return null;
    if (!this.wantsTier(def.tier)) return null;
    let lastErr = null;
    for (let i = 0; i < ASSET_HOSTS.length; i++) {
      const idx = (this.hostIndex + i) % ASSET_HOSTS.length;
      const url = ASSET_HOSTS[idx] + def.url;
      try {
        const gltf = await this.loader.loadAsync(url);
        this.hostIndex = idx;
        const scene = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (!scene) throw new Error('empty scene');
        scene.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = true; o.receiveShadow = true;
            o.frustumCulled = true;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) { if (m) { m.envMapIntensity = 0.9; if (m.map) m.map.anisotropy = 4; } }
          }
        });
        const rec = { key, scene, animations: gltf.animations || [], ok: true };
        this.glb.set(key, rec);
        this.stats.loaded++;
        return rec;
      } catch (e) { lastErr = e; }
    }
    this.failed.add(key);
    this.stats.failed++;
    console.warn('[models] GLB unavailable:', key, lastErr && lastErr.message);
    return null;
  }

  /** preload a list of models with a small concurrency cap */
  async preload(keys, onProgress, concurrency = 3) {
    let done = 0;
    const queue = keys.filter((k) => MODELS[k] && this.wantsTier(MODELS[k].tier));
    const total = queue.length || 1;
    const worker = async () => {
      while (queue.length) {
        const k = queue.shift();
        await this.loadGLB(k);
        done++;
        if (onProgress) onProgress(done, total, k);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
  }

  /**
   * Normalise a GLB into a game-sized template:
   *   templateRoot (Group)
   *     └─ pivot (Group, holds scale + centring)
   *          └─ clone (the GLB scene — this is the AnimationMixer root)
   * The mixer must root at the GLB scene itself: morph-target tracks in the
   * sample birds use an empty node name and bind to the mixer root.
   */
  prepareGLB(rec, spec) {
    const clone = cloneSkinned(rec.scene);
    clone.name = 'glbRoot';
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.setScalar(1);
    clone.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const targetH = Math.max(0.3, spec.height * (spec.scale || 1));
    // flyers are normalised by wingspan, walkers by standing height
    const ref = spec.flying ? Math.max(size.x, size.y, size.z) : size.y;
    const s = targetH / Math.max(0.001, ref);
    clone.position.set(-center.x, -box.min.y, -center.z);

    const pivot = new THREE.Group();
    pivot.scale.setScalar(s);
    pivot.add(clone);

    const root = new THREE.Group();
    root.add(pivot);

    /* The AnimationMixer root matters:
       - skinned rigs name their tracks after bones, so the root must contain
         the whole skeleton  → the cloned glTF scene.
       - morph-target clips (the sample birds / horse) use an empty node name,
         which PropertyBinding resolves to the ROOT itself → must be the mesh. */
    let skinned = null, morphMesh = null;
    clone.traverse((o) => {
      if (!skinned && o.isSkinnedMesh) skinned = o;
      if (!morphMesh && o.isMesh && o.morphTargetInfluences && o.morphTargetInfluences.length) morphMesh = o;
    });
    const mixerRoot = skinned ? clone : (morphMesh || clone);
    mixerRoot.userData.mixerRoot = true;
    clone.userData.morphDriven = !skinned && !!morphMesh;

    const tint = new THREE.Color(spec.tint);
    clone.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const out = mats.map((m) => retint(m, tint, spec));
        o.material = Array.isArray(o.material) ? out : out[0];
      }
    });

    // hostile glow: eyes (and a core for machines)
    const eyeMat = this.cmats.glow(spec.accent, 3.0);
    const eyeR = Math.max(0.05, targetH * 0.032);
    const eyes = new THREE.Group();
    const headY = targetH * (spec.eyeHeight != null ? spec.eyeHeight : 0.8);
    const headZ = targetH * (spec.eyeForward != null ? spec.eyeForward : 0.13);
    if (!spec.flying) {
      for (const sx of [-1, 1]) {
        const e = new THREE.Mesh(sph(eyeR, 8, 6), eyeMat);
        e.position.set(sx * eyeR * 2.0, headY, headZ);
        eyes.add(e);
      }
      root.add(eyes);
    }
    if (spec.yawOffset) pivot.rotation.y = spec.yawOffset;

    return { group: root, clone, animations: rec.animations || [], eyes, eyeMat, targetH, morphDriven: !!clone.userData.morphDriven };
  }

  /** build (and cache) the template for an enemy type */
  template(typeKey) {
    if (this.templates.has(typeKey)) return this.templates.get(typeKey);
    const spec = ENEMIES[typeKey];
    if (!spec) return null;
    let t = null;
    const [kind, name] = String(spec.visual).split(':');

    if (kind === 'glb') {
      const rec = this.glb.get(name);
      if (rec && rec.ok) {
        try {
          const p = this.prepareGLB(rec, spec);
          t = {
            type: typeKey, kind: 'glb', group: p.group, animations: p.animations,
            animHints: GLB_ANIM_HINTS[name] || {}, radius: spec.radius,
            height: spec.height * (spec.scale || 1), source: name, morphDriven: p.morphDriven
          };
        } catch (e) {
          console.warn('[models] GLB prep failed for', typeKey, e);
        }
      }
    }

    if (!t) {
      const builderName = kind === 'proc' ? name : fallbackFor(typeKey);
      const builder = CREATURE_BUILDERS[builderName] || CREATURE_BUILDERS.quadruped;
      const rig = builder(this.cmats, {
        tint: spec.tint, accent: spec.accent,
        height: spec.height * (spec.scale || 1),
        length: 2.2, radius: spec.radius
      });
      t = { type: typeKey, kind: 'proc', group: rig.group, rig, radius: spec.radius, height: spec.height * (spec.scale || 1) };
      this.stats.procedural++;
    }

    this.templates.set(typeKey, t);
    return t;
  }

  /** spawn a fresh, independently animated instance of a template */
  instance(typeKey, seed = Math.random() * 1000) {
    const t = this.template(typeKey);
    if (!t) return null;
    const spec = ENEMIES[typeKey] || {};
    const group = t.group.clone(true);
    group.rotation.set(0, 0, 0);
    const rng = mulberry32(((seed * 2654435761) >>> 0) || 1);
    const inst = {
      type: typeKey, group, template: t, kind: t.kind,
      animTime: rng() * 12, mixer: null, actions: {}, current: null, height: t.height
    };

    if (t.kind === 'glb') {
      let mixerRoot = null;
      group.traverse((o) => { if (!mixerRoot && o.userData && o.userData.mixerRoot) mixerRoot = o; });
      inst.mixerRoot = mixerRoot;
      if (mixerRoot && t.animations && t.animations.length) {
        inst.mixer = new THREE.AnimationMixer(mixerRoot);
        const hints = t.animHints || {};
        for (const clip of t.animations) {
          const action = inst.mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          inst.actions[clip.name] = action;
          for (const role in hints) {
            if (hints[role] && hints[role].includes(clip.name) && !inst.actions['role:' + role]) {
              inst.actions['role:' + role] = action;
            }
          }
        }
        // morph-target birds only ship a single flying clip
        if (!inst.actions['role:run'] && t.animations[0]) inst.actions['role:run'] = inst.mixer.clipAction(t.animations[0]);
        if (!inst.actions['role:idle']) inst.actions['role:idle'] = inst.actions['role:run'];
        inst.playRole = (role, fade = 0.22) => {
          const next = inst.actions['role:' + role] || inst.actions['role:run'];
          if (!next || next === inst.current) return;
          next.reset();
          next.setEffectiveWeight(1);
          next.play();
          if (inst.current && inst.current !== next) inst.current.fadeOut(fade);
          next.fadeIn(fade);
          inst.current = next;
        };
        inst.playRole(/shooter|turret/.test(spec.behavior || '') ? 'idle' : 'run', 0);
        if (t.morphDriven) {
          // morph clips carry no useful duration: sync cycle length to travel speed
          inst.syncDuration = (speed) => {
            const h = inst.height || 2;
            const d = clamp((spec.gallopCycle || 4.2) * h / Math.max(2.5, speed || 8), 0.16, 1.4);
            if (inst.current && Math.abs((inst.current.getClip().duration || 1) - d) > 0.02) inst.current.setDuration(d);
          };
        }
        // phase variety so a flock never flaps in lockstep
        for (const role in inst.actions) {
          const a = inst.actions[role];
          if (a && a.getClip && a.getClip()) a.time = rng() * (a.getClip().duration || 1);
        }
      }
    }

    if (t.kind === 'proc' && t.rig) {
      inst.rigWalker = bindRigToClone(t.rig, group);
    }

    inst.update = (dt, ctx) => {
      inst.animTime += dt;
      const c = ctx || {};
      if (inst.rigWalker) {
        inst.rigWalker(inst.animTime, dt, c);
      } else if (inst.mixer) {
        if (inst.syncDuration) inst.syncDuration(c.speed || 0);
        inst.mixer.update(dt * (c.timeScale || 1));
        const role = c.dying ? 'die' : (c.attack > 0 ? 'attack' : ((c.speed || 0) > 0.6 ? 'run' : 'idle'));
        if (inst.playRole) inst.playRole(role, 0.2);
      } else {
        // static GLB (idol / sentry / dragon sculpture): give it life anyway
        const bob = Math.sin(inst.animTime * (spec.flying ? 2.2 : 1.3));
        group.children[0].rotation.y = Math.sin(inst.animTime * 0.6) * 0.12;
        group.children[0].position.y = bob * (spec.flying ? inst.height * 0.06 : inst.height * 0.015);
        group.children[0].rotation.z = spec.flying ? Math.sin(inst.animTime * 1.7) * 0.14 : 0;
      }
    };

    return inst;
  }

  dispose() {
    for (const rec of this.glb.values()) {
      if (rec && rec.scene) rec.scene.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    }
    this.glb.clear();
    this.templates.clear();
  }
}

function retint(material, tint, spec) {
  if (!material) return material;
  const m = material.clone();
  if (m.color) m.color.multiply(tint).lerp(tint, 0.35);
  m.roughness = m.roughness != null ? clamp(m.roughness, 0.35, 0.98) : 0.8;
  m.metalness = clamp(m.metalness || 0, 0, 0.35);
  m.envMapIntensity = 0.85;
  if (m.transparent && m.opacity < 0.2) m.opacity = 0.9;
  // transmission/glass materials are expensive: flatten them into PBR
  if (m.transmission > 0) {
    m.transmission = 0;
    m.thickness = 0;
    m.ior = 1.4;
    m.opacity = 1;
    m.transparent = false;
    m.color.multiply(tint);
    m.roughness = 0.55;
    m.metalness = 0.15;
    m.emissive = new THREE.Color(spec.accent);
    m.emissiveIntensity = 0.18;
  }
  return m;
}

/** procedural stand-in per enemy type when its GLB never arrives */
function fallbackFor(typeKey) {
  switch (typeKey) {
    case 'harpy': case 'phoenix': case 'stork': return 'birdFallback';
    case 'nightmare': return 'quadruped';
    case 'cultist': return 'humanoidFallback';
    case 'mech': return 'mechFallback';
    case 'idol': case 'sentry': return 'idolFallback';
    case 'dragon': return 'dragon';
    case 'titan': return 'titan';
    default: return 'quadruped';
  }
}

/* --- extra procedural fallbacks (registered after CREATURE_BUILDERS) --- */
CREATURE_BUILDERS.birdFallback = (cm, o) => {
  const skin = cm.skin(o.tint, { rough: 0.85, flat: true });
  const accent = cm.glow(o.accent, 2.6);
  const g = new THREE.Group();
  const H = o.height || 1.2;
  const body = new THREE.Group();
  body.position.y = H * 0.5;
  g.add(body);
  const torso = new THREE.Mesh(rockify(sph(H * 0.34, 12, 9), 3, 0.12), skin);
  torso.scale.set(0.8, 0.9, 1.5);
  torso.castShadow = true;
  body.add(torso);
  const head = new THREE.Group();
  head.position.set(0, H * 0.22, H * 0.4);
  body.add(head);
  head.add(new THREE.Mesh(rockify(sph(H * 0.18, 10, 8), 7, 0.1), skin));
  const beak = new THREE.Mesh(cone(H * 0.08, H * 0.34, 6), cm.skin(0xe8c46a, { rough: 0.6 }));
  beak.rotation.x = Math.PI / 2;
  beak.position.z = H * 0.26;
  head.add(beak);
  addEyes(head, accent, [[-H * 0.08, H * 0.05, H * 0.1, H * 0.035], [H * 0.08, H * 0.05, H * 0.1, H * 0.035]]);
  const wings = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group();
    w.position.set(s * H * 0.2, H * 0.1, 0);
    body.add(w);
    const span = H * 1.5;
    const mem = new THREE.PlaneGeometry(span, H * 0.6, 5, 2);
    const p = mem.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + span / 2, t = x / span;
      p.setY(i, p.getY(i) * (1 - t * 0.6));
      p.setZ(i, -t * t * H * 0.3);
    }
    p.needsUpdate = true;
    mem.computeVertexNormals();
    mem.translate(span / 2, 0, 0);
    const mesh = new THREE.Mesh(mem, cm.cloth(o.tint, { rough: 0.85 }));
    mesh.castShadow = true;
    w.add(mesh);
    wings.push({ group: w, s });
  }
  const tail = new THREE.Mesh(mrg([place(cone(H * 0.22, H * 0.7, 5), 0, 0, -H * 0.55, Math.PI / 2)]), skin);
  body.add(tail);
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = makeLeg(cm.skin(0xc9a06a, { rough: 0.7 }), { thigh: H * 0.16, shin: H * 0.18, rTop: H * 0.035, rBot: H * 0.025, foot: H * 0.04, spread: s * 0.1 });
    leg.hip.position.set(s * H * 0.12, -H * 0.16, -H * 0.05);
    body.add(leg.hip);
    legs.push(leg);
  }
  return {
    group: g, body, head, wings, legs, height: H, flying: true,
    animate(t, dt, ctx) {
      const speed = ctx.speed || 0;
      const flap = Math.sin(t * (6 + speed * 0.5));
      for (const w of wings) {
        w.group.rotation.z = w.s * (0.1 + flap * 0.75);
        w.group.rotation.x = Math.sin(t * 6 + 0.5) * 0.1;
      }
      body.position.y = H * 0.5 + flap * H * 0.06;
      body.rotation.x = clamp01(speed / 16) * 0.25;
      head.rotation.y = Math.sin(t * 2.1) * 0.2 + (ctx.lookYaw || 0);
      head.rotation.x = (ctx.lookPitch || 0);
      legs[0].hip.rotation.x = legs[1].hip.rotation.x = 0.4 + flap * 0.1;
      if (ctx.attack > 0) body.rotation.x += Math.sin(ctx.attack * Math.PI) * 0.5;
    }
  };
};

CREATURE_BUILDERS.humanoidFallback = (cm, o) => makeHumanoid(cm, {
  ...o, weapon: 'staff', wide: 0.95, depth: 0.7, armR: 0.16, legR: 0.2, pauldron: 0.2,
  headRatio: 0.16, legRatio: 0.46, torsoRatio: 0.34, horns: false, jaw: false
});

CREATURE_BUILDERS.mechFallback = (cm, o) => {
  const plate = cm.metal(0x8b939c, { rough: 0.42, metal: 0.92 });
  const rust = cm.rust(0x6f5a45);
  const accent = cm.glow(o.accent, 3.0);
  const g = new THREE.Group();
  const H = o.height || 2.2;
  const body = new THREE.Group();
  body.position.y = H * 0.52;
  g.add(body);
  const torso = new THREE.Mesh(mrg([
    place(box(H * 0.46, H * 0.4, H * 0.3), 0, H * 0.12, 0),
    place(box(H * 0.36, H * 0.2, H * 0.26), 0, H * 0.36, 0),
    place(cyl(H * 0.1, H * 0.12, H * 0.12, 8), 0, H * 0.46, 0)
  ]), plate);
  torso.castShadow = true;
  body.add(torso);
  const core = new THREE.Mesh(sph(H * 0.07, 10, 8), accent);
  core.position.set(0, H * 0.16, H * 0.17);
  body.add(core);
  const head = new THREE.Group();
  head.position.y = H * 0.52;
  body.add(head);
  head.add(new THREE.Mesh(mrg([place(box(H * 0.2, H * 0.16, H * 0.2), 0, 0, 0), place(cyl(H * 0.02, H * 0.02, H * 0.24, 5), H * 0.1, H * 0.16, 0)]), plate));
  const visor = new THREE.Mesh(box(H * 0.16, H * 0.05, H * 0.03), accent);
  visor.position.set(0, 0, H * 0.105);
  head.add(visor);
  const arms = [];
  for (const s of [-1, 1]) {
    const arm = makeArm(plate, { upper: H * 0.2, fore: H * 0.2, r: H * 0.05 });
    arm.shoulder.position.set(s * H * 0.3, H * 0.32, 0);
    body.add(arm.shoulder);
    arms.push(arm);
    // cannon on the right arm
    if (s > 0) {
      const cannon = new THREE.Mesh(mrg([
        place(cyl(H * 0.055, H * 0.07, H * 0.34, 8), 0, -H * 0.16, 0),
        place(cyl(H * 0.035, H * 0.035, H * 0.2, 6), 0, -H * 0.4, 0)
      ]), rust);
      arm.hand.add(cannon);
      arm.hand.userData.muzzle = cannon;
      const glowRing = new THREE.Mesh(new THREE.TorusGeometry(H * 0.045, H * 0.012, 6, 12), accent);
      glowRing.rotation.x = Math.PI / 2;
      glowRing.position.y = -H * 0.5;
      arm.hand.add(glowRing);
    }
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const leg = makeLeg(plate, { thigh: H * 0.24, shin: H * 0.24, rTop: H * 0.06, rBot: H * 0.045, foot: H * 0.06, spread: s * 0.05 });
    leg.hip.position.set(s * H * 0.16, 0, 0);
    body.add(leg.hip);
    legs.push(leg);
  }
  return {
    group: g, body, head, arms, legs, core, height: H,
    animate(t, dt, ctx) {
      const speed = ctx.speed || 0;
      const ph = t * (3 + speed * 0.6);
      const amp = 0.2 + clamp01(speed / 6) * 0.6;
      for (let i = 0; i < legs.length; i++) {
        legs[i].hip.rotation.x = Math.sin(ph + i * Math.PI) * amp;
        legs[i].knee.rotation.x = Math.max(0, -Math.sin(ph + i * Math.PI - 0.8)) * amp + 0.1;
      }
      for (let i = 0; i < arms.length; i++) {
        arms[i].shoulder.rotation.x = Math.sin(ph + (i ? 0 : Math.PI)) * amp * 0.4 - 0.15;
        arms[i].elbow.rotation.x = -0.4 - Math.max(0, Math.sin(ph + i)) * 0.2;
      }
      body.position.y = H * 0.52 + Math.abs(Math.sin(ph)) * 0.03;
      body.rotation.z = Math.sin(ph) * 0.03;
      head.rotation.y = Math.sin(t * 1.4) * 0.25 + (ctx.lookYaw || 0);
      head.rotation.x = (ctx.lookPitch || 0);
      core.material.emissiveIntensity = 2.4 + Math.sin(t * 5) * 0.8 + (ctx.attack > 0 ? 3 : 0);
      if (ctx.attack > 0) {
        arms[1].shoulder.rotation.x = -1.35 - Math.sin(ctx.attack * Math.PI) * 0.35;
        arms[1].elbow.rotation.x = -0.2;
      }
    }
  };
};

CREATURE_BUILDERS.idolFallback = (cm, o) => {
  const stone = cm.stone(o.tint ?? 0xc9b48d, { rough: 0.85, emissive: o.accent, emissiveIntensity: 0.35 });
  const accent = cm.glow(o.accent, 2.6);
  const g = new THREE.Group();
  const H = o.height || 3;
  const body = new THREE.Group();
  g.add(body);
  const plinth = new THREE.Mesh(mrg([
    place(box(H * 0.5, H * 0.12, H * 0.5), 0, H * 0.06, 0),
    place(box(H * 0.42, H * 0.08, H * 0.42), 0, H * 0.16, 0)
  ]), stone);
  plinth.castShadow = true; plinth.receiveShadow = true;
  body.add(plinth);
  const statue = new THREE.Mesh(rockify(cyl(H * 0.16, H * 0.22, H * 0.6, 10), 5, 0.08), stone);
  statue.position.y = H * 0.5;
  statue.castShadow = true;
  body.add(statue);
  const head = new THREE.Group();
  head.position.y = H * 0.86;
  body.add(head);
  head.add(new THREE.Mesh(rockify(sph(H * 0.13, 12, 10), 9, 0.07), stone));
  const headdress = new THREE.Mesh(mrg([
    place(box(H * 0.34, H * 0.1, H * 0.3), 0, H * 0.08, 0),
    place(box(H * 0.1, H * 0.24, H * 0.28), -H * 0.14, -H * 0.02, 0),
    place(box(H * 0.1, H * 0.24, H * 0.28), H * 0.14, -H * 0.02, 0)
  ]), stone);
  head.add(headdress);
  addEyes(head, accent, [[-H * 0.05, 0, H * 0.11, H * 0.022], [H * 0.05, 0, H * 0.11, H * 0.022]]);
  // orbiting glyphs
  const glyphs = new THREE.Group();
  glyphs.position.y = H * 0.6;
  body.add(glyphs);
  for (let i = 0; i < 3; i++) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(H * 0.22, H * 0.22), new THREE.MeshBasicMaterial({
      map: cm.lib.runeWarm, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      color: new THREE.Color(o.accent), side: THREE.DoubleSide, toneMapped: false, opacity: 0.9
    }));
    p.position.set(Math.cos((i / 3) * TAU) * H * 0.42, Math.sin(i * 2) * H * 0.1, Math.sin((i / 3) * TAU) * H * 0.42);
    glyphs.add(p);
  }
  return {
    group: g, body, head, glyphs, height: H,
    animate(t, dt, ctx) {
      glyphs.rotation.y += dt * 0.9;
      for (let i = 0; i < glyphs.children.length; i++) {
        const p = glyphs.children[i];
        p.rotation.y = -glyphs.rotation.y + Math.sin(t + i) * 0.3;
        p.position.y = Math.sin(t * 1.6 + i * 2) * H * 0.08;
        p.material.opacity = 0.55 + Math.sin(t * 3 + i) * 0.3 + (ctx.attack > 0 ? 0.4 : 0);
      }
      head.rotation.y = Math.sin(t * 0.7) * 0.3 + (ctx.lookYaw || 0) * 0.6;
      body.rotation.y = Math.sin(t * 0.3) * 0.05;
      if (ctx.attack > 0) body.position.y = Math.sin(ctx.attack * Math.PI) * H * 0.04;
    }
  };
};

/* ---------------------------------------------------------------------------
 * rig re-binding: procedural rigs animate template nodes, so for each clone we
 * walk the cloned hierarchy once and re-point the rig's node list at it.
 * -------------------------------------------------------------------------*/
function bindRigToClone(rig, clone) {
  const map = new Map();
  const templateRoot = rig.group;
  const src = [];
  templateRoot.traverse((o) => src.push(o));
  const dst = [];
  clone.traverse((o) => dst.push(o));
  // clones keep traversal order, so index mapping is exact
  for (let i = 0; i < Math.min(src.length, dst.length); i++) map.set(src[i], dst[i]);
  // procedural rigs animate the TEMPLATE nodes; afterwards we copy the
  // resulting local transforms onto this clone's mirrored hierarchy.
  return (t, dt, ctx) => {
    rig.animate(t, dt, ctx);
    copyTransforms(templateRoot, clone, map);
  };
}

function copyTransforms(srcRoot, dstRoot, map) {
  srcRoot.traverse((o) => {
    const d = map.get(o);
    if (!d || d === dstRoot) return;
    d.position.copy(o.position);
    d.rotation.copy(o.rotation);
    d.scale.copy(o.scale);
    d.visible = o.visible;
  });
}


