/* ============================================================================
 * entities/particles.js — pooled VFX
 * ---------------------------------------------------------------------------
 * sparks/embers : one THREE.Points cloud with a custom shader  (up to ~2200)
 * smoke / flash : pooled additive + alpha sprites               (bounded)
 * debris        : pooled InstancedMesh shards with real bounces
 * shockwaves    : pooled expanding ground rings
 * scorch decals : pooled ground quads aligned to the terrain normal
 * Everything is allocated once at boot — zero garbage during combat.
 * ==========================================================================*/
import * as THREE from 'three';
import { clamp, clamp01, lerp, rand, TAU } from '../core/util.js';
import { terrainHeight, terrainNormal } from '../world/terrain.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m4 = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

/* ---------------------------------------------------------------------------
 * Points cloud (sparks / embers / rain of dust)
 * -------------------------------------------------------------------------*/
class SparkField {
  constructor(scene, texture, capacity, { additive = true, sizeScale = 1 } = {}) {
    this.cap = capacity;
    this.sizeScale = sizeScale;
    this.cursor = 0;
    this.alive = 0;

    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(capacity * 3);
    this.col = new Float32Array(capacity * 3);
    this.siz = new Float32Array(capacity);
    this.alp = new Float32Array(capacity);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.siz, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alp, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, capacity);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uScale: { value: 400 }
      },
      vertexShader: /* glsl */`
        attribute vec3 aColor;
        attribute float aSize;
        attribute float aAlpha;
        uniform float uScale;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vColor = aColor;
          vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4( position, 1.0 );
          gl_PointSize = clamp( aSize * uScale / max( 0.001, -mv.z ), 1.0, 190.0 );
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          vec4 t = texture2D( uMap, gl_PointCoord );
          float a = t.a * vAlpha;
          if ( a < 0.004 ) discard;
          gl_FragColor = vec4( vColor * t.rgb, a );
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending
    });

    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 6 : 4;
    this.geometry = g;
    scene.add(this.points);

    // CPU side particle state
    this.vel = new Float32Array(capacity * 3);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
    this.grav = new Float32Array(capacity);
    this.drag = new Float32Array(capacity);
    this.baseSize = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.bounce = new Float32Array(capacity);
    this.fadeMode = new Uint8Array(capacity);   // 0 linear, 1 late, 2 flicker
    this.baseColor = new Float32Array(capacity * 3);
    this.endColor = new Float32Array(capacity * 3);
    for (let i = 0; i < capacity; i++) this.alp[i] = 0;
  }

  setViewportScale(drawingBufferHeight) {
    this.material.uniforms.uScale.value = Math.max(60, drawingBufferHeight * 0.5);
  }

  spawn(x, y, z, vx, vy, vz, o = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.cap;
    const i3 = i * 3;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    const life = o.life != null ? o.life : rand(0.35, 0.8);
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = o.gravity != null ? o.gravity : -14;
    this.drag[i] = o.drag != null ? o.drag : 1.4;
    this.baseSize[i] = (o.size != null ? o.size : 0.35) * this.sizeScale;
    this.grow[i] = o.grow != null ? o.grow : -0.35;
    this.bounce[i] = o.bounce != null ? o.bounce : 0;
    this.fadeMode[i] = o.fadeMode || 0;
    _c.setHex(o.color != null ? o.color : 0xffcc66);
    this.baseColor[i3] = _c.r; this.baseColor[i3 + 1] = _c.g; this.baseColor[i3 + 2] = _c.b;
    const end = o.endColor != null ? o.endColor : o.color != null ? o.color : 0xff5522;
    _c.setHex(end);
    this.endColor[i3] = _c.r; this.endColor[i3 + 1] = _c.g; this.endColor[i3 + 2] = _c.b;
    this.alp[i] = o.alpha != null ? o.alpha : 1;
  }

  update(dt, groundCheck = true) {
    const { pos, vel, life, maxLife, alp, siz, col, cap } = this;
    let alive = 0;
    for (let i = 0; i < cap; i++) {
      if (life[i] <= 0) { if (alp[i] !== 0) alp[i] = 0; continue; }
      alive++;
      life[i] -= dt;
      const i3 = i * 3;
      if (life[i] <= 0) { alp[i] = 0; continue; }
      const dragK = Math.max(0, 1 - this.drag[i] * dt);
      vel[i3] *= dragK;
      vel[i3 + 1] = vel[i3 + 1] * dragK + this.grav[i] * dt;
      vel[i3 + 2] *= dragK;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;

      if (groundCheck && this.bounce[i] > 0) {
        const gh = terrainHeight(pos[i3], pos[i3 + 2]) + 0.06;
        if (pos[i3 + 1] < gh) {
          pos[i3 + 1] = gh;
          vel[i3 + 1] = -vel[i3 + 1] * this.bounce[i];
          vel[i3] *= 0.72; vel[i3 + 2] *= 0.72;
          if (Math.abs(vel[i3 + 1]) < 0.6) { vel[i3 + 1] = 0; this.bounce[i] = 0; }
        }
      }

      const t = 1 - clamp01(life[i] / maxLife[i]);
      let a = 1 - t;
      if (this.fadeMode[i] === 1) a = a * a;
      else if (this.fadeMode[i] === 2) a *= 0.65 + Math.sin(life[i] * 46) * 0.35;
      alp[i] = a;
      siz[i] = Math.max(0.02, this.baseSize[i] * (1 + this.grow[i] * t));
      col[i3] = lerp(this.baseColor[i3], this.endColor[i3], t);
      col[i3 + 1] = lerp(this.baseColor[i3 + 1], this.endColor[i3 + 1], t);
      col[i3 + 2] = lerp(this.baseColor[i3 + 2], this.endColor[i3 + 2], t);
    }
    this.alive = alive;
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aColor.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.points.visible = alive > 0;
  }

  clear() {
    for (let i = 0; i < this.cap; i++) { this.life[i] = 0; this.alp[i] = 0; }
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

/* ---------------------------------------------------------------------------
 * Sprite pools (smoke, flashes) and ring/decal pools
 * -------------------------------------------------------------------------*/
class SpritePool {
  constructor(scene, texture, capacity, { additive = false, color = 0xffffff, renderOrder = 5, depthWrite = false } = {}) {
    this.items = [];
    this.scene = scene;
    for (let i = 0; i < capacity; i++) {
      const mat = new THREE.SpriteMaterial({
        map: texture, color, transparent: true, opacity: 0,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite, depthTest: true, toneMapped: !additive, fog: true
      });
      const sp = new THREE.Sprite(mat);
      sp.visible = false;
      sp.renderOrder = renderOrder;
      scene.add(sp);
      this.items.push({ sp, mat, life: 0, max: 1, vel: new THREE.Vector3(), size: 1, grow: 0, spin: 0, rot: 0, fade: 1, peak: 1, gravity: 0, drag: 0.6 });
    }
    this.cursor = 0;
  }

  get() {
    // prefer a dead slot, otherwise steal the oldest
    for (let i = 0; i < this.items.length; i++) {
      const idx = (this.cursor + i) % this.items.length;
      if (this.items[idx].life <= 0) { this.cursor = (idx + 1) % this.items.length; return this.items[idx]; }
    }
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    return it;
  }

  emit(x, y, z, o = {}) {
    const it = this.get();
    it.sp.position.set(x, y, z);
    it.life = it.max = o.life != null ? o.life : 1;
    it.vel.set(o.vx || 0, o.vy || 0, o.vz || 0);
    it.size = o.size != null ? o.size : 1;
    it.grow = o.grow != null ? o.grow : 0.6;
    it.spin = o.spin || 0;
    it.rot = o.rot != null ? o.rot : rand(0, TAU);
    it.peak = o.opacity != null ? o.opacity : 1;
    it.fade = o.fade != null ? o.fade : 1;
    it.gravity = o.gravity || 0;
    it.drag = o.drag != null ? o.drag : 0.9;
    it.mat.opacity = 0;
    if (o.color != null) it.mat.color.setHex(o.color);
    it.sp.scale.setScalar(Math.max(0.01, it.size));
    it.sp.material.rotation = it.rot;
    it.sp.visible = true;
    return it;
  }

  update(dt) {
    let visible = 0;
    for (const it of this.items) {
      if (it.life <= 0) { if (it.sp.visible) it.sp.visible = false; continue; }
      it.life -= dt;
      if (it.life <= 0) { it.sp.visible = false; it.mat.opacity = 0; continue; }
      visible++;
      const dragK = Math.max(0, 1 - it.drag * dt);
      it.vel.multiplyScalar(dragK);
      it.vel.y += it.gravity * dt;
      it.sp.position.addScaledVector(it.vel, dt);
      const t = 1 - clamp01(it.life / it.max);
      it.mat.opacity = it.peak * Math.pow(1 - t, it.fade);
      const s = Math.max(0.02, it.size * (1 + it.grow * t));
      it.sp.scale.set(s, s, s);
      if (it.spin) it.sp.material.rotation = it.rot + t * it.spin;
    }
    return visible;
  }

  clear() { for (const it of this.items) { it.life = 0; it.sp.visible = false; } }

  setVisible(v) { for (const it of this.items) it.sp.visible = v && it.life > 0; }

  dispose() { for (const it of this.items) { it.mat.dispose(); this.scene.remove(it.sp); } }
}

class RingPool {
  constructor(scene, texture, capacity) {
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.rotateX(-Math.PI / 2);
    this.items = [];
    for (let i = 0; i < capacity; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: texture, transparent: true, opacity: 0, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false
      });
      const m = new THREE.Mesh(this.geo, mat);
      m.visible = false;
      m.renderOrder = 7;
      scene.add(m);
      this.items.push({ m, mat, life: 0, max: 1, size: 1, grow: 8, peak: 1 });
    }
    this.cursor = 0;
  }
  emit(x, y, z, o = {}) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    it.m.position.set(x, y, z);
    it.life = it.max = o.life != null ? o.life : 0.5;
    it.size = o.size != null ? o.size : 2;
    it.grow = o.grow != null ? o.grow : 14;
    it.peak = o.opacity != null ? o.opacity : 1;
    it.mat.color.setHex(o.color != null ? o.color : 0xffbb66);
    it.mat.opacity = it.peak;
    it.m.scale.setScalar(it.size);
    it.m.visible = true;
    if (o.flat === false) it.m.rotation.x = 0; else it.m.rotation.x = 0;
    return it;
  }
  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) { if (it.m.visible) it.m.visible = false; continue; }
      it.life -= dt;
      const t = 1 - clamp01(it.life / it.max);
      if (it.life <= 0) { it.m.visible = false; continue; }
      const s = it.size + it.grow * t * it.max;
      it.m.scale.set(s, 1, s);
      it.mat.opacity = it.peak * (1 - t) * (1 - t);
    }
  }
  clear() { for (const it of this.items) { it.life = 0; it.m.visible = false; } }
  dispose() { for (const it of this.items) it.mat.dispose(); this.geo.dispose(); }
}

class DecalPool {
  constructor(scene, texture, capacity) {
    this.geo = new THREE.PlaneGeometry(1, 1);
    this.geo.rotateX(-Math.PI / 2);
    this.items = [];
    for (let i = 0; i < capacity; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: texture, transparent: true, opacity: 0, depthWrite: false,
        color: 0x1a1512, blending: THREE.NormalBlending, polygonOffset: true,
        polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: true
      });
      const m = new THREE.Mesh(this.geo, mat);
      m.visible = false;
      m.renderOrder = 3;
      scene.add(m);
      this.items.push({ m, mat, life: 0, max: 1, peak: 0.85 });
    }
    this.cursor = 0;
  }
  emit(x, z, size = 4, life = 14, opacity = 0.8) {
    const it = this.items[this.cursor];
    this.cursor = (this.cursor + 1) % this.items.length;
    const y = terrainHeight(x, z) + 0.06;
    it.m.position.set(x, y, z);
    terrainNormal(x, z, _v2);
    _q.setFromUnitVectors(_up, _v2);
    it.m.quaternion.copy(_q);
    it.m.rotateY(rand(0, TAU));
    it.m.scale.set(size, 1, size);
    it.life = it.max = life;
    it.peak = opacity;
    it.mat.opacity = opacity;
    it.m.visible = true;
  }
  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) { if (it.m.visible) it.m.visible = false; continue; }
      it.life -= dt;
      if (it.life <= 0) { it.m.visible = false; continue; }
      const t = clamp01(it.life / it.max);
      it.mat.opacity = it.peak * (t > 0.75 ? (1 - t) * 4 : t / 0.75);
    }
  }
  clear() { for (const it of this.items) { it.life = 0; it.m.visible = false; } }
  dispose() { for (const it of this.items) it.mat.dispose(); this.geo.dispose(); }
}

class DebrisField {
  constructor(scene, capacity) {
    this.cap = capacity;
    const geos = [
      new THREE.TetrahedronGeometry(0.22, 0),
      new THREE.BoxGeometry(0.24, 0.18, 0.3),
      new THREE.IcosahedronGeometry(0.2, 0)
    ];
    this.geo = geos[0];
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x6a5f52, roughness: 0.9, metalness: 0.25, flatShading: true, vertexColors: false
    });
    this.mesh = new THREE.InstancedMesh(this.geo, this.mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.count = 0;
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    scene.add(this.mesh);
    this.p = [];
    for (let i = 0; i < capacity; i++) {
      this.p.push({ life: 0, max: 1, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), size: 0.2, bounce: 0.35, color: 0x6a5f52 });
    }
    this.cursor = 0;
  }
  emit(x, y, z, o = {}) {
    const it = this.p[this.cursor];
    this.cursor = (this.cursor + 1) % this.cap;
    it.life = it.max = o.life != null ? o.life : rand(0.9, 2.0);
    it.pos.set(x, y, z);
    it.vel.set(o.vx || rand(-4, 4), o.vy != null ? o.vy : rand(3, 9), o.vz || rand(-4, 4));
    it.spin.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
    it.size = o.size != null ? o.size : rand(0.16, 0.4);
    it.bounce = o.bounce != null ? o.bounce : 0.34;
    it.color = o.color != null ? o.color : 0x6a5f52;
    it.rot.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
  }
  update(dt) {
    let n = 0;
    for (let i = 0; i < this.cap; i++) {
      const it = this.p[i];
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) continue;
      it.vel.y -= 21 * dt;
      it.vel.multiplyScalar(Math.max(0, 1 - 0.25 * dt));
      it.pos.addScaledVector(it.vel, dt);
      const gh = terrainHeight(it.pos.x, it.pos.z) + it.size * 0.4;
      if (it.pos.y < gh) {
        it.pos.y = gh;
        it.vel.y = -it.vel.y * it.bounce;
        it.vel.x *= 0.66; it.vel.z *= 0.66;
        it.spin.multiplyScalar(0.6);
        if (Math.abs(it.vel.y) < 0.7) it.vel.y = 0;
      }
      it.rot.x += it.spin.x * dt;
      it.rot.y += it.spin.y * dt;
      it.rot.z += it.spin.z * dt;
      _q.setFromEuler(it.rot);
      const fade = clamp01(it.life / it.max);
      const sc = it.size * (fade < 0.25 ? fade / 0.25 : 1);
      _s.setScalar(Math.max(0.001, sc));
      _m4.compose(it.pos, _q, _s);
      this.mesh.setMatrixAt(n, _m4);
      _c.setHex(it.color);
      this.mesh.setColorAt(n, _c);
      n++;
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
  }
  clear() { for (const it of this.p) it.life = 0; this.mesh.count = 0; this.mesh.visible = false; }
  dispose() { this.mesh.dispose(); this.geo.dispose(); this.mat.dispose(); }
}

/* ---------------------------------------------------------------------------
 * ParticleSystem — the public API used by gameplay
 * -------------------------------------------------------------------------*/
export class ParticleSystem {
  constructor(scene, texLib, quality) {
    this.scene = scene;
    this.lib = texLib;
    this.scale = (quality && quality.particles) || 1;
    this.enabled = true;

    this.sparks = new SparkField(scene, texLib.spark, Math.round(2200 * this.scale), { additive: true });
    this.embers = new SparkField(scene, texLib.soft, Math.round(900 * this.scale), { additive: true });
    this.smoke = new SpritePool(scene, texLib.smoke, Math.round(70 * this.scale), { additive: false, renderOrder: 5 });
    this.flash = new SpritePool(scene, texLib.soft, Math.round(26 * this.scale), { additive: true, renderOrder: 8 });
    this.rings = new RingPool(scene, texLib.ring, 14);
    this.decals = new DecalPool(scene, texLib.scorch, 26);
    this.debris = new DebrisField(scene, Math.round(220 * this.scale));
    this.gore = new SparkField(scene, texLib.soft, Math.round(500 * this.scale), { additive: false });
    this.counts = { sparks: 0 };
  }

  setQuality(quality) {
    this.scale = quality.particles || 1;
    this.smoke.setVisible(true);
  }

  resize(h) {
    this.sparks.setViewportScale(h);
    this.embers.setViewportScale(h);
    this.gore.setViewportScale(h);
  }

  /* ---- composite effects ---- */
  muzzleFlash(pos, dir, power = 1) {
    if (!this.enabled) return;
    this.flash.emit(pos.x, pos.y, pos.z, {
      size: 2.2 * power, grow: 2.6, life: 0.09, opacity: 1, color: 0xffd9a0
    });
    this.rings.emit(pos.x, pos.y, pos.z, { size: 0.8 * power, grow: 9, life: 0.16, color: 0xffcf8a, opacity: 0.85 });
    const n = Math.round(16 * this.scale * power);
    for (let i = 0; i < n; i++) {
      const spread = rand(0.12, 0.55);
      const a = rand(0, TAU);
      _v.set(dir.x + Math.cos(a) * spread, dir.y + rand(-0.2, 0.35), dir.z + Math.sin(a) * spread).normalize().multiplyScalar(rand(24, 62) * power);
      this.sparks.spawn(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, {
        life: rand(0.1, 0.34), size: rand(0.12, 0.3), color: 0xffe6b0, endColor: 0xff6a1a,
        gravity: -6, drag: 2.6, fadeMode: 2
      });
    }
    // forward smoke puff
    this.smoke.emit(pos.x + dir.x * 1.4, pos.y + dir.y * 1.4 + 0.2, pos.z + dir.z * 1.4, {
      size: 1.1, grow: 2.6, life: rand(0.7, 1.3), opacity: 0.4, vx: dir.x * 7, vy: 1.6, vz: dir.z * 7, drag: 1.4, color: 0x8d8578
    });
  }

  explosion(pos, { power = 1, color = 0xffa53a, smokeColor = 0x3a3530, scorch = true, debrisColor = 0x5c5347 } = {}) {
    if (!this.enabled) return;
    const p = clamp(power, 0.2, 6);
    this.flash.emit(pos.x, pos.y, pos.z, { size: 3.4 * p, grow: 3.4, life: 0.16, opacity: 1, color: 0xfff0c0 });
    this.flash.emit(pos.x, pos.y + 0.2, pos.z, { size: 2.0 * p, grow: -0.4, life: 0.3, opacity: 0.9, color });
    this.rings.emit(pos.x, pos.y + 0.1, pos.z, { size: 1.2 * p, grow: 16 * p, life: 0.4, color, opacity: 0.95 });

    const nSpark = Math.round(34 * this.scale * p);
    for (let i = 0; i < nSpark; i++) {
      const a = rand(0, TAU), el = rand(-0.35, 1);
      const sp = rand(9, 34) * p;
      this.sparks.spawn(pos.x, pos.y, pos.z,
        Math.cos(a) * sp * (1 - el * 0.5), el * sp * 1.1, Math.sin(a) * sp * (1 - el * 0.5), {
          life: rand(0.25, 0.9), size: rand(0.14, 0.42) * p, color: 0xfff0c8, endColor: color,
          gravity: -18, drag: 1.5, bounce: 0.3, fadeMode: 1
        });
    }
    const nSmoke = Math.round(12 * this.scale * p);
    for (let i = 0; i < nSmoke; i++) {
      const a = rand(0, TAU), sp = rand(1.5, 7) * p;
      this.smoke.emit(pos.x + Math.cos(a) * 0.4, pos.y + rand(0.2, 1.2), pos.z + Math.sin(a) * 0.4, {
        size: rand(1.2, 2.4) * p, grow: rand(1.6, 3.4), life: rand(1.1, 2.6), opacity: rand(0.35, 0.7),
        vx: Math.cos(a) * sp, vy: rand(1.5, 5.5), vz: Math.sin(a) * sp, drag: 1.1,
        color: i % 3 === 0 ? 0x6b6055 : smokeColor, spin: rand(-2, 2)
      });
    }
    const nEmber = Math.round(14 * this.scale * p);
    for (let i = 0; i < nEmber; i++) {
      const a = rand(0, TAU);
      this.embers.spawn(pos.x, pos.y + 0.3, pos.z, Math.cos(a) * rand(1, 6), rand(3, 11), Math.sin(a) * rand(1, 6), {
        life: rand(0.9, 2.4), size: rand(0.08, 0.2), color: 0xffb347, endColor: 0x551100,
        gravity: -2.4, drag: 0.6, fadeMode: 2
      });
    }
    const nDeb = Math.round(9 * this.scale * p);
    for (let i = 0; i < nDeb; i++) {
      const a = rand(0, TAU), sp = rand(4, 15) * p;
      this.debris.emit(pos.x, pos.y + 0.4, pos.z, {
        vx: Math.cos(a) * sp, vy: rand(4, 14), vz: Math.sin(a) * sp,
        size: rand(0.14, 0.4) * p, color: debrisColor, life: rand(1.2, 2.6)
      });
    }
    if (scorch) this.decals.emit(pos.x, pos.z, clamp(3.4 * p, 1.6, 12), 16, 0.75);
  }

  impact(pos, normal, { power = 1, color = 0xffd9a0, dirt = false } = {}) {
    if (!this.enabled) return;
    this.flash.emit(pos.x, pos.y, pos.z, { size: 0.9 * power, grow: 1.4, life: 0.09, opacity: 0.9, color });
    const n = Math.round(12 * this.scale * power);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(4, 18) * power;
      _v.set(normal.x + Math.cos(a) * 0.6, Math.abs(normal.y) + 0.55, normal.z + Math.sin(a) * 0.6).normalize().multiplyScalar(sp);
      this.sparks.spawn(pos.x, pos.y, pos.z, _v.x, _v.y, _v.z, {
        life: rand(0.14, 0.5), size: rand(0.08, 0.22), color, endColor: dirt ? 0x6b5a42 : 0xff6a1a,
        gravity: -22, drag: 1.6, bounce: 0.35
      });
    }
    if (dirt) {
      for (let i = 0; i < Math.round(4 * this.scale); i++) {
        this.smoke.emit(pos.x, pos.y + 0.2, pos.z, {
          size: rand(0.7, 1.5), grow: 1.6, life: rand(0.5, 1.2), opacity: 0.35,
          vx: rand(-2, 2), vy: rand(1, 3), vz: rand(-2, 2), color: 0x8a7a5e
        });
      }
      this.decals.emit(pos.x, pos.z, clamp(1.5 * power, 0.8, 4), 9, 0.5);
    }
  }

  ichor(pos, color = 0x8a1f2a, power = 1) {
    if (!this.enabled) return;
    const n = Math.round(14 * this.scale * power);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(3, 13) * power;
      this.gore.spawn(pos.x, pos.y, pos.z, Math.cos(a) * sp, rand(1.5, 8), Math.sin(a) * sp, {
        life: rand(0.3, 0.9), size: rand(0.12, 0.34) * power, color, endColor: 0x2a0a10,
        gravity: -20, drag: 0.8, bounce: 0.15, fadeMode: 1
      });
    }
  }

  magicBurst(pos, color = 0x6affd8, power = 1) {
    if (!this.enabled) return;
    this.rings.emit(pos.x, pos.y, pos.z, { size: 1.0 * power, grow: 10 * power, life: 0.5, color, opacity: 0.9 });
    const n = Math.round(22 * this.scale * power);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), el = rand(-0.4, 1);
      const sp = rand(5, 18) * power;
      this.embers.spawn(pos.x, pos.y, pos.z, Math.cos(a) * sp, el * sp, Math.sin(a) * sp, {
        life: rand(0.5, 1.4), size: rand(0.12, 0.34) * power, color, endColor: 0x113344,
        gravity: -1.2, drag: 1.1, fadeMode: 2
      });
    }
    this.flash.emit(pos.x, pos.y, pos.z, { size: 1.8 * power, grow: 1.6, life: 0.22, opacity: 0.85, color });
  }

  dust(pos, amount = 1, colorHex = 0xa08d6c) {
    if (!this.enabled) return;
    const n = Math.round(4 * this.scale * amount);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU);
      this.smoke.emit(pos.x + Math.cos(a) * rand(0.2, 1.4), pos.y + rand(0, 0.3), pos.z + Math.sin(a) * rand(0.2, 1.4), {
        size: rand(0.5, 1.3) * amount, grow: rand(1.0, 2.2), life: rand(0.6, 1.5), opacity: rand(0.16, 0.34),
        vx: Math.cos(a) * rand(0.4, 2.2), vy: rand(0.4, 1.8), vz: Math.sin(a) * rand(0.4, 2.2), color: colorHex, drag: 1.2
      });
    }
    const ns = Math.round(6 * this.scale * amount);
    for (let i = 0; i < ns; i++) {
      const a = rand(0, TAU), sp = rand(1, 5);
      this.sparks.spawn(pos.x, pos.y + 0.1, pos.z, Math.cos(a) * sp, rand(0.6, 3.2), Math.sin(a) * sp, {
        life: rand(0.3, 0.9), size: rand(0.08, 0.2), color: colorHex, endColor: colorHex,
        gravity: -7, drag: 1.6, fadeMode: 1, alpha: 0.5
      });
    }
  }

  splash(pos, power = 1) {
    if (!this.enabled) return;
    this.rings.emit(pos.x, pos.y, pos.z, { size: 1.4 * power, grow: 8 * power, life: 0.6, color: 0x9fd8ff, opacity: 0.6 });
    const n = Math.round(18 * this.scale * power);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(2, 9) * power;
      this.gore.spawn(pos.x, pos.y, pos.z, Math.cos(a) * sp, rand(3, 10) * power, Math.sin(a) * sp, {
        life: rand(0.4, 1.0), size: rand(0.1, 0.28), color: 0xbfeaff, endColor: 0x3a6a80,
        gravity: -18, drag: 0.5, bounce: 0.1, fadeMode: 1
      });
    }
  }

  lavaSplash(pos, power = 1) {
    if (!this.enabled) return;
    this.flash.emit(pos.x, pos.y, pos.z, { size: 2.0 * power, grow: 2.0, life: 0.3, opacity: 0.85, color: 0xff7a2a });
    const n = Math.round(18 * this.scale * power);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), sp = rand(2, 8) * power;
      this.embers.spawn(pos.x, pos.y, pos.z, Math.cos(a) * sp, rand(3, 11), Math.sin(a) * sp, {
        life: rand(0.6, 1.6), size: rand(0.12, 0.3), color: 0xffc14a, endColor: 0x551100,
        gravity: -12, drag: 0.7, fadeMode: 2, bounce: 0.2
      });
    }
  }

  /** persistent emitter for damaged tanks / burning wrecks */
  burningTrail(pos, intensity = 1) {
    if (!this.enabled) return;
    if (Math.random() > 0.55 * intensity) return;
    this.smoke.emit(pos.x + rand(-0.4, 0.4), pos.y + rand(0.3, 1.2), pos.z + rand(-0.4, 0.4), {
      size: rand(0.8, 1.8), grow: rand(1.4, 2.6), life: rand(1.0, 2.2), opacity: rand(0.22, 0.5),
      vx: rand(-1, 1), vy: rand(1.2, 3), vz: rand(-1, 1), color: Math.random() > 0.5 ? 0x2f2b26 : 0x544b41
    });
    if (Math.random() < 0.35) {
      this.embers.spawn(pos.x, pos.y + 0.6, pos.z, rand(-1, 1), rand(1, 4), rand(-1, 1), {
        life: rand(0.5, 1.4), size: rand(0.08, 0.18), color: 0xffa53a, endColor: 0x551100, gravity: -1.5, drag: 0.8, fadeMode: 2
      });
    }
  }

  pickupBurst(pos, color = 0x6affd8) {
    if (!this.enabled) return;
    this.rings.emit(pos.x, pos.y, pos.z, { size: 0.8, grow: 7, life: 0.45, color, opacity: 0.9 });
    for (let i = 0; i < Math.round(18 * this.scale); i++) {
      const a = rand(0, TAU);
      this.embers.spawn(pos.x, pos.y, pos.z, Math.cos(a) * rand(2, 7), rand(2, 8), Math.sin(a) * rand(2, 7), {
        life: rand(0.4, 1.0), size: rand(0.1, 0.24), color, endColor: 0x113322, gravity: -6, drag: 1.2, fadeMode: 2
      });
    }
  }

  update(dt) {
    this.sparks.update(dt);
    this.embers.update(dt);
    this.gore.update(dt);
    this.smoke.update(dt);
    this.flash.update(dt);
    this.rings.update(dt);
    this.decals.update(dt);
    this.debris.update(dt);
  }

  clear() {
    this.sparks.clear(); this.embers.clear(); this.gore.clear();
    this.smoke.clear(); this.flash.clear(); this.rings.clear();
    this.decals.clear(); this.debris.clear();
  }

  stats() {
    return {
      sparks: this.sparks.alive + this.embers.alive + this.gore.alive,
      smoke: this.smoke.items.filter((i) => i.life > 0).length,
      debris: this.debris.mesh.count
    };
  }

  dispose() {
    this.sparks.dispose(); this.embers.dispose(); this.gore.dispose();
    this.smoke.dispose(); this.flash.dispose(); this.rings.dispose();
    this.decals.dispose(); this.debris.dispose();
  }
}

export { SparkField, SpritePool, DebrisField };
