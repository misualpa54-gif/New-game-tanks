/* ============================================================================
 * world/terrain.js — the infinite heightfield
 * ---------------------------------------------------------------------------
 * terrainHeight(x, z) is a pure, seeded function: the world is unbounded and
 * deterministic, so chunks can be created/destroyed forever without seams or
 * memory growth. Biomes (plains / forest / desert / stone / snow / volcanic)
 * come from very low frequency noise and drive ground blending + scatter.
 * ==========================================================================*/
import * as THREE from 'three';
import { WORLD } from '../config.js';
import { clamp, clamp01, fbm, hash2i, lerp, ridged, smoothstep, valueNoise } from '../core/util.js';

export const SEED = 20260926;

/* ---------------------------------------------------------------------------
 * Height field
 * -------------------------------------------------------------------------*/
const H_AMP = WORLD.heightAmp;

/** rolling continent shapes */
function baseField(x, z) {
  return fbm(x * WORLD.hillFreq, z * WORLD.hillFreq, 5, 2.03, 0.5, SEED);
}
/** eroded ridges / mesas */
function ridgeField(x, z) {
  return ridged(x * WORLD.hillFreq * 2.1 + 31.7, z * WORLD.hillFreq * 2.1 - 12.9, 3, SEED + 17);
}
/** basin mask — carves lakes */
function basinField(x, z) {
  return fbm(x * 0.0029 + 101.3, z * 0.0029 - 55.1, 3, 2.0, 0.5, SEED + 991);
}
/** volcanic activity (lava pools, obsidian spires) */
export function volcanicAt(x, z) {
  const v = ridged(x * 0.0042 - 71.1, z * 0.0042 + 43.7, 2, SEED + 555) * 0.65
          + fbm(x * 0.011, z * 0.011, 2, 2, 0.5, SEED + 556) * 0.35;
  return smoothstep(0.5, 0.82, v);
}

export function terrainHeight(x, z) {
  const base = baseField(x, z);
  const ridge = ridgeField(x, z);
  const detail = fbm(x * WORLD.detailFreq, z * WORLD.detailFreq, 3, 2.05, 0.5, SEED + 7);
  const micro = valueNoise(x * WORLD.microFreq, z * WORLD.microFreq, SEED + 13);

  let h = base * H_AMP * 0.62
        + (ridge - 0.55) * H_AMP * 0.85
        + detail * 1.55
        + micro * 0.16;

  // lakes: push the land down inside basins
  const basin = basinField(x, z);
  h += 1.4;
  if (basin > 0.3) {
    const k = smoothstep(0.3, 0.66, basin);
    h = lerp(h, WORLD.waterLevel - 1.2 - k * 3.4, k * 0.92);
  }
  // volcanic craters: slight rim + depressed centre
  const vol = volcanicAt(x, z);
  if (vol > 0.01) {
    h += vol * 2.6 * Math.sin((base + ridge) * 3.1);
  }
  return h;
}

const _n = new THREE.Vector3();
/** analytic surface normal (central differences) */
export function terrainNormal(x, z, out = _n, e = 0.75) {
  const hl = terrainHeight(x - e, z), hr = terrainHeight(x + e, z);
  const hd = terrainHeight(x, z - e), hu = terrainHeight(x, z + e);
  out.set(hl - hr, 2 * e, hd - hu).normalize();
  return out;
}

export function slopeAt(x, z) {
  terrainNormal(x, z, _n);
  return clamp01(1 - _n.y);
}

export function isUnderwater(x, z, pad = 0) {
  return terrainHeight(x, z) < WORLD.waterLevel + pad;
}

/* ---------------------------------------------------------------------------
 * Biomes
 * -------------------------------------------------------------------------*/
const BF = WORLD.biomeFreq;

export const BIOME_NAMES = ['plains', 'forest', 'desert', 'stone', 'snow', 'volcanic'];

/**
 * Fills `out` with ground blend weights + scatter density + tint.
 * Weights: grass / sand(incl. snow) / rock for the shader, plus tint color.
 */
export function biomeAt(x, z, out = biomeAt.scratch || (biomeAt.scratch = {})) {
  const temp = fbm(x * BF, z * BF, 2, 2.0, 0.5, SEED + 101);
  const moist = fbm(x * BF + 131.7, z * BF - 77.3, 2, 2.0, 0.5, SEED + 202);
  const rocky = fbm(x * BF * 2.9 + 9.1, z * BF * 2.9 + 41.3, 2, 2.0, 0.5, SEED + 303);
  const vol = volcanicAt(x, z);

  const snow = smoothstep(-0.16, -0.4, temp) * (1 - vol);
  const desert = smoothstep(0.06, 0.32, temp) * smoothstep(0.12, -0.22, moist) * (1 - vol);
  const forest = smoothstep(-0.18, 0.32, moist) * (1 - snow) * (1 - desert) * (1 - vol * 0.8);
  const stone = smoothstep(0.16, 0.46, rocky) * (1 - snow * 0.75) * (1 - desert * 0.5);

  const wSand = clamp01(desert + snow);
  const wRock = clamp01(stone * 0.85 + vol * 0.55);
  const wGrass = clamp01(1 - wSand - wRock);

  out.temp = temp; out.moist = moist; out.rocky = rocky;
  out.snow = snow; out.desert = desert; out.forest = forest; out.stone = stone; out.volcanic = vol;
  out.wGrass = wGrass; out.wSand = wSand; out.wRock = wRock;

  out.treeDensity = clamp01(forest * 1.35 + wGrass * 0.32 - desert * 0.5 - snow * 0.35 + vol * 0.1);
  out.rockDensity = clamp01(stone * 1.5 + vol * 1.2 + 0.18 + desert * 0.25);
  out.bushDensity = clamp01(forest * 1.1 + wGrass * 0.7 - desert * 0.55 - snow * 0.5);
  out.grassDensity = clamp01(wGrass * 1.25 + forest * 0.9 - snow * 0.75 - vol * 0.7);
  out.ruinDensity = clamp01(0.1 + stone * 0.35 + (1 - Math.abs(moist)) * 0.1);
  out.crystalDensity = clamp01(vol * 1.4 + snow * 0.5);
  out.deadTreeMix = clamp01(desert * 0.9 + vol * 0.8 + snow * 0.35);
  out.pineMix = clamp01(snow * 0.9 + (1 - temp) * 0.35);

  // tint (sRGB hex → THREE.Color converts to linear on setHex)
  const tint = out.tint || (out.tint = new THREE.Color());
  tint.setHex(0x6f8f4a);                                  // plains
  if (forest > 0.01) tint.lerp(TMP_C1.setHex(0x4c7137), forest * 0.85);
  if (desert > 0.01) tint.lerp(TMP_C1.setHex(0xcbb27e), desert);
  if (snow > 0.01) tint.lerp(TMP_C1.setHex(0xe8f1f7), snow);
  if (stone > 0.01) tint.lerp(TMP_C1.setHex(0x8b8781), stone * 0.9);
  if (vol > 0.01) tint.lerp(TMP_C1.setHex(0x4a3a36), vol);
  out.tintHex = tint.getHex();
  out.name = vol > 0.45 ? 'volcanic' : snow > 0.4 ? 'snow' : desert > 0.4 ? 'desert'
    : forest > 0.4 ? 'forest' : stone > 0.45 ? 'stone' : 'plains';
  return out;
}
const TMP_C1 = new THREE.Color();

/* ---------------------------------------------------------------------------
 * Terrain material — 3 blended PBR layers sampled in WORLD space (no seams)
 * -------------------------------------------------------------------------*/
export class TerrainMaterial {
  constructor(texLib) {
    this.lib = texLib;
    this.broken = false;
    this.uniforms = {
      uGrass: { value: texLib.grass.map },
      uGrassN: { value: texLib.grass.normalMap },
      uSand: { value: texLib.sand.map },
      uSandN: { value: texLib.sand.normalMap },
      uRock: { value: texLib.rock.map },
      uRockN: { value: texLib.rock.normalMap },
      uTexScale: { value: 0.062 },
      uNormalScale: { value: 0.85 }
    };

    this.main = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 1.0,
      metalness: 0.0,
      dithering: true,
      envMapIntensity: 0.85
    });
    this.main.customProgramCacheKey = () => 'ironverge-terrain';
    this.main.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, this.uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec3 aBlend;
          varying vec3 vBlend;
          varying vec3 vWPos;
          varying float vSlope;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 wPosT = modelMatrix * vec4( transformed, 1.0 );
          vWPos = wPosT.xyz;
          vBlend = aBlend;
          vSlope = 1.0 - clamp( objectNormal.y, 0.0, 1.0 );`);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D uGrass; uniform sampler2D uGrassN;
          uniform sampler2D uSand;  uniform sampler2D uSandN;
          uniform sampler2D uRock;  uniform sampler2D uRockN;
          uniform float uTexScale; uniform float uNormalScale;
          uniform mat3 normalMatrix;
          varying vec3 vBlend; varying vec3 vWPos; varying float vSlope;`)
        .replace('#include <map_fragment>', `
          vec2 tuv = vWPos.xz * uTexScale;
          float slopeK = smoothstep( 0.16, 0.58, vSlope );
          float wRock = clamp( vBlend.z + slopeK * 0.85, 0.0, 1.0 );
          float wSand = clamp( vBlend.y, 0.0, 1.0 );
          float wGrass = clamp( 1.0 - wRock - wSand, 0.0, 1.0 );
          vec3 cGrass = texture2D( uGrass, tuv ).rgb * 0.72 + texture2D( uGrass, tuv * 4.17 + 11.3 ).rgb * 0.42;
          vec3 cSand  = texture2D( uSand, tuv * 1.35 + 3.1 ).rgb;
          vec3 cRock  = texture2D( uRock, tuv * 0.85 ).rgb * 0.74 + texture2D( uRock, tuv * 3.3 + 7.7 ).rgb * 0.4;
          vec3 ground = cGrass * wGrass + cSand * wSand + cRock * wRock;
          // break up tiling with a large scale blotch
          float blotch = texture2D( uRock, tuv * 0.06 ).r;
          ground *= 0.88 + blotch * 0.24;
          diffuseColor.rgb *= ground;`)
        .replace('#include <color_fragment>', `
          #ifdef USE_COLOR
            float tLum = dot( vColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
            vec3 hue = vColor.rgb / max( 0.02, max( vColor.r, max( vColor.g, vColor.b ) ) );
            diffuseColor.rgb *= mix( vec3( 1.0 ), hue, 0.42 ) * ( 0.78 + tLum * 0.9 );
            float snowK = smoothstep( 0.52, 0.8, tLum );
            diffuseColor.rgb = mix( diffuseColor.rgb, vec3( 0.72, 0.76, 0.82 ) * ( 0.8 + blotch * 0.3 ), snowK * 0.9 );
          #endif`)
        .replace('#include <roughnessmap_fragment>', `
          float roughnessFactor = mix( 0.94, 0.66, wRock );
          roughnessFactor *= 0.9 + 0.2 * texture2D( uGrassN, tuv ).b;`)
        .replace('#include <normal_fragment_maps>', `
          vec3 nG = texture2D( uGrassN, tuv ).xyz * 2.0 - 1.0;
          vec3 nS = texture2D( uSandN, tuv * 1.35 + 3.1 ).xyz * 2.0 - 1.0;
          vec3 nR = texture2D( uRockN, tuv * 0.85 ).xyz * 2.0 - 1.0;
          vec3 tn = nG * wGrass + nS * wSand + nR * wRock;
          tn = normalize( vec3( tn.xy * uNormalScale, max( tn.z, 0.2 ) ) );
          normal = normalize( normal + normalMatrix * vec3( tn.x, 0.0, tn.y ) );`);
    };

    /** used if the shader fails to compile (ancient driver) or quality=low */
    this.simple = new THREE.MeshStandardMaterial({
      map: texLib.grass.map,
      normalMap: texLib.grass.normalMap,
      normalScale: new THREE.Vector2(0.7, 0.7),
      roughnessMap: texLib.grass.roughnessMap,
      roughness: 1,
      metalness: 0,
      vertexColors: false,
      dithering: true
    });
  }

  get material() { return this.broken ? this.simple : this.main; }

  /** called from renderer.debug.onShaderError */
  markBroken() {
    if (this.broken) return;
    this.broken = true;
    console.warn('[terrain] custom shader rejected → simple PBR material');
  }

  setEnv(envMap) {
    this.main.envMap = envMap;
    this.simple.envMap = envMap;
    this.main.needsUpdate = true;
    this.simple.needsUpdate = true;
  }
}

/* ---------------------------------------------------------------------------
 * Chunk geometry
 * -------------------------------------------------------------------------*/
const _biome = {};
const _col = new THREE.Color();
const _c2 = new THREE.Color();

/**
 * Builds a displaced, vertex-coloured, blend-weighted terrain tile.
 * @returns {THREE.BufferGeometry}
 */
export function buildChunkGeometry(originX, originZ, size = WORLD.chunkSize, seg = 16) {
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const count = pos.count;
  const colors = new Float32Array(count * 3);
  const blend = new Float32Array(count * 3);
  const uvs = geo.attributes.uv;
  const normals = geo.attributes.normal;
  const texScale = 0.062;

  const nrm = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const lx = pos.getX(i), lz = pos.getZ(i);
    const wx = originX + lx, wz = originZ + lz;
    const h = terrainHeight(wx, wz);
    pos.setY(i, h);

    // analytic normal
    const e = size / seg * 0.5;
    const hl = terrainHeight(wx - e, wz), hr = terrainHeight(wx + e, wz);
    const hd = terrainHeight(wx, wz - e), hu = terrainHeight(wx, wz + e);
    nrm.set(hl - hr, 2 * e, hd - hu).normalize();
    normals.setXYZ(i, nrm.x, nrm.y, nrm.z);

    // world-space UVs → neighbouring chunks line up perfectly
    uvs.setXY(i, wx * texScale, wz * texScale);

    const b = biomeAt(wx, wz, _biome);
    const slope = clamp01(1 - nrm.y);
    blend[i * 3] = b.wGrass;
    blend[i * 3 + 1] = b.wSand;
    blend[i * 3 + 2] = clamp01(b.wRock + smoothstep(0.34, 0.75, slope) * 0.6);

    // colour: biome tint, darkened in creases, bleached on peaks & snow
    _col.copy(b.tint);
    const grit = valueNoise(wx * 0.35, wz * 0.35, SEED + 3) * 0.5 + 0.5;
    _col.multiplyScalar(0.86 + grit * 0.28);
    if (slope > 0.2) { _c2.setHex(0x7b766f); _col.lerp(_c2, smoothstep(0.2, 0.72, slope) * 0.85); }
    if (b.vol > 0.2) { _c2.setHex(0x3b2c28); _col.lerp(_c2, b.vol * 0.7); }
    const alt = smoothstep(12, 26, h);
    if (alt > 0) { _c2.setHex(b.snow > 0.3 ? 0xf2f7fb : 0x9a958c); _col.lerp(_c2, alt * 0.55); }
    if (h < WORLD.waterLevel + 0.6) { _c2.setHex(0x4d4a3a); _col.lerp(_c2, smoothstep(WORLD.waterLevel + 0.6, WORLD.waterLevel - 1.2, h) * 0.7); }
    colors[i * 3] = _col.r; colors[i * 3 + 1] = _col.g; colors[i * 3 + 2] = _col.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aBlend', new THREE.BufferAttribute(blend, 3));
  geo.computeBoundingSphere();
  return geo;
}

/* ---------------------------------------------------------------------------
 * Water — one big scrolling sheet at sea level
 * -------------------------------------------------------------------------*/
export class WaterSystem {
  constructor(texLib, size = 900) {
    this.size = size;
    this.mat = new THREE.MeshStandardMaterial({
      color: 0x1d4a52,
      normalMap: texLib.waterNormal,
      normalScale: new THREE.Vector2(0.55, 0.55),
      roughness: 0.08,
      metalness: 0.0,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
      envMapIntensity: 1.6,
      side: THREE.DoubleSide
    });
    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * size * 0.045, uv.getY(i) * size * 0.045);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.position.y = WORLD.waterLevel;
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'water';
    this.time = 0;
  }

  setEnv(envMap) { this.mat.envMap = envMap; this.mat.needsUpdate = true; }

  update(dt, playerPos) {
    this.time += dt;
    this.mesh.position.x = playerPos.x;
    this.mesh.position.z = playerPos.z;
    const n = this.mat.normalMap;
    if (n) {
      n.offset.set(this.time * 0.012, this.time * 0.019);
    }
    // hide when there is clearly no water around (saves a transparent pass)
    this.mesh.visible = this.nearWater(playerPos);
  }

  nearWater(p) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const d = 26 + (i % 3) * 34;
      if (terrainHeight(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d) < WORLD.waterLevel + 1.2) return true;
    }
    return terrainHeight(p.x, p.z) < WORLD.waterLevel + 1.6;
  }
}

/* ---------------------------------------------------------------------------
 * Lava pools (volcanic biomes) — hazardous, emissive, animated
 * -------------------------------------------------------------------------*/
export function makeLavaMaterial(texLib) {
  const m = new THREE.MeshStandardMaterial({
    map: texLib.lava.map,
    emissiveMap: texLib.lava.emissiveMap,
    emissive: new THREE.Color(0xff5a1e),
    emissiveIntensity: 2.4,
    normalMap: texLib.lava.normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
    roughness: 0.85,
    metalness: 0.0
  });
  return m;
}

export { hash2i, clamp };
