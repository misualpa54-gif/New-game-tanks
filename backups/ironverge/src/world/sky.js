/* ============================================================================
 * world/sky.js — sun, sky, image based lighting, fog
 * ---------------------------------------------------------------------------
 * Preferred: a free 1k HDRI from the three.js sample library (real image based
 * lighting + sky background). Fallback: the analytic Preetham `Sky` addon baked
 * into an env map with PMREMGenerator. Either way the shadow-casting sun and
 * biome-tinted fog follow the player forever.
 * ==========================================================================*/
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { QUALITY } from '../config.js';
import { clamp, lerp } from '../core/util.js';
import { biomeAt, terrainHeight } from './terrain.js';

const SUN_ELEVATION = 32;   // degrees
const SUN_AZIMUTH = 128;    // degrees

function sunDirection(elev = SUN_ELEVATION, azim = SUN_AZIMUTH, out = new THREE.Vector3()) {
  const phi = THREE.MathUtils.degToRad(90 - elev);
  const theta = THREE.MathUtils.degToRad(azim);
  return out.setFromSphericalCoords(1, phi, theta);
}

const FOG_TINTS = {
  plains: 0xa8b6b0, forest: 0x93a58f, desert: 0xd6c39a,
  stone: 0xa9a6a1, snow: 0xd6e2ea, volcanic: 0x8d7268
};

export class SkySystem {
  constructor(scene, renderer, texLib, qualityName = 'medium') {
    this.scene = scene;
    this.renderer = renderer;
    this.lib = texLib;
    this.qualityName = qualityName;
    this.q = QUALITY[qualityName] || QUALITY.medium;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
    this.sunDir = sunDirection();
    this.envRT = null;
    this.sky = null;
    this.hdr = null;
    this.mode = 'procedural';
    this._fogColor = new THREE.Color(0xa8b6b0);
    this._targetFog = new THREE.Color(0xa8b6b0);
    this._scratch = new THREE.Color();
    this._ground = new THREE.Color();
    this._biome = {};
    this._tmp = new THREE.Vector3();

    /* ---- sun ---- */
    this.sun = new THREE.DirectionalLight(0xffe6c4, 2.7);
    this.sun.position.copy(this.sunDir).multiplyScalar(120);
    this.sun.castShadow = this.q.shadowMap > 0;
    this.sun.shadow.mapSize.set(this.q.shadowMap || 512, this.q.shadowMap || 512);
    const d = qualityName === 'high' ? 58 : qualityName === 'low' ? 34 : 46;
    this.shadowSpan = d;
    const c = this.sun.shadow.camera;
    c.left = -d; c.right = d; c.top = d; c.bottom = -d; c.near = 1; c.far = 340;
    c.updateProjectionMatrix();
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.42;
    this.sun.shadow.radius = qualityName === 'low' ? 1 : 2.2;
    scene.add(this.sun);
    scene.add(this.sun.target);

    /* ---- fill lights ---- */
    this.hemi = new THREE.HemisphereLight(0xbcd9ff, 0x54483a, 0.42);
    scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.05);
    scene.add(this.ambient);

    /* ---- fog ---- */
    scene.fog = new THREE.Fog(this._fogColor.getHex(), this.q.fogFar * 0.22, this.q.fogFar);

    /* ---- explosion light pool ---- */
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffb066, 0, 60, 2);
      l.visible = false;
      scene.add(l);
      this.lights.push({ light: l, life: 0, max: 1, peak: 0 });
    }
  }

  /** procedural sky + PMREM environment (no network needed) */
  buildProceduralSky() {
    const sky = new Sky();
    sky.scale.setScalar(1000);   // stays inside camera.far (1400)
    const u = sky.material.uniforms;
    u.turbidity.value = 5.4;
    u.rayleigh.value = 1.45;
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.86;
    u.sunPosition.value.copy(this.sunDir);
    this.sky = sky;
    this.scene.add(sky);

    const envScene = new THREE.Scene();
    envScene.add(sky);
    this.envRT = this.pmrem.fromScene(envScene, 0, 0.1, 1000);
    this.scene.add(sky);
    this.applyEnv(this.envRT.texture);
    this.mode = 'procedural';
    return this.envRT.texture;
  }

  /** try the free HDRI (quarry_01_1k.hdr) for realistic IBL */
  async loadHDRI(rel) {
    try {
      const loader = new HDRLoader();
      const hdr = await this.lib.loadEnvironment(loader, this.pmrem, this.renderer, rel);
      if (!hdr) return false;
      this.hdr = hdr.background;
      this.scene.background = hdr.background;
      this.scene.backgroundIntensity = 1.0;
      this.scene.backgroundBlurriness = 0.0;
      this.mode = 'hdri';
      this.applyEnv(hdr.envMap);
      if (this.sky) { this.scene.remove(this.sky); this.sky.geometry.dispose(); this.sky.material.dispose(); this.sky = null; }
      this.mode = 'hdri';
      return true;
    } catch (e) {
      console.warn('[sky] HDRI unavailable, keeping procedural sky', e && e.message);
      return false;
    }
  }

  applyEnv(envMap) {
    this.scene.environment = envMap;
    // the procedural sky is much brighter than the HDRI: keep IBL as fill light
    this.scene.environmentIntensity = this.mode === 'hdri' ? 0.8 : 0.45;
    this.envMap = envMap;
    if (this.onEnv) this.onEnv(envMap);
  }

  setQuality(name) {
    this.qualityName = name;
    this.q = QUALITY[name] || QUALITY.medium;
    this.sun.castShadow = this.q.shadowMap > 0;
    if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    this.sun.shadow.mapSize.set(this.q.shadowMap || 512, this.q.shadowMap || 512);
    const d = name === 'high' ? 58 : name === 'low' ? 34 : 46;
    this.shadowSpan = d;
    const c = this.sun.shadow.camera;
    c.left = -d; c.right = d; c.top = d; c.bottom = -d;
    c.updateProjectionMatrix();
    this.scene.fog.far = this.q.fogFar;
    this.scene.fog.near = this.q.fogFar * 0.22;
  }

  /** brief point light for explosions / muzzle flashes */
  flash(position, color = 0xffb066, intensity = 40, distance = 46, life = 0.22) {
    let best = null;
    for (const f of this.lights) {
      if (f.life <= 0) { best = f; break; }
      if (!best || f.life < best.life) best = f;
    }
    if (!best) return;
    best.light.position.copy(position);
    best.light.color.setHex(color);
    best.light.distance = distance;
    best.light.intensity = intensity;
    best.light.visible = true;
    best.life = life; best.max = life; best.peak = intensity;
  }

  update(dt, playerPos) {
    // sun + shadow frustum ride along with the player
    this._tmp.copy(this.sunDir).multiplyScalar(140).add(playerPos);
    this.sun.position.copy(this._tmp);
    this.sun.target.position.copy(playerPos);
    this.sun.target.updateMatrixWorld();

    if (this.sky) {
      this.sky.position.copy(playerPos);
      this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    }

    // biome tinted fog + hemi light
    const b = biomeAt(playerPos.x, playerPos.z, this._biome);
    const tint = FOG_TINTS[b.name] || FOG_TINTS.plains;
    this._targetFog.setHex(tint);
    if (b.volcanic > 0.3) this._targetFog.lerp(this._scratch.setHex(0x6b4a3c), b.volcanic * 0.5);
    this._fogColor.lerp(this._targetFog, clamp(dt * 0.6, 0, 1));
    this.scene.fog.color.copy(this._fogColor);
    if (this.scene.background && this.scene.background.isColor) this.scene.background.copy(this._fogColor);
    this._ground.setHex(FOG_TINTS[b.name] || 0x8a8a7a).multiplyScalar(0.55);
    this.hemi.groundColor.copy(this._ground);
    this.hemi.intensity = lerp(0.4, 0.3, b.snow);

    // explosion lights
    for (const f of this.lights) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) { f.light.visible = false; f.light.intensity = 0; continue; }
      const k = f.life / f.max;
      f.light.intensity = f.peak * k * k;
    }
  }

  /** water/lava level relative to the player — used for splash decisions */
  groundBelow(x, z) { return terrainHeight(x, z); }

  dispose() {
    if (this.envRT) this.envRT.dispose();
    if (this.sky) { this.sky.geometry.dispose(); this.sky.material.dispose(); }
    if (this.hdr) this.hdr.dispose();
    this.pmrem.dispose();
  }
}

export { sunDirection, SUN_ELEVATION, SUN_AZIMUTH };
