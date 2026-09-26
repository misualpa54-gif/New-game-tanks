/* ============================================================================
 * world/textures.js — PBR texture library
 * ---------------------------------------------------------------------------
 * Strategy: every slot is filled IMMEDIATELY with a procedurally painted,
 * tileable, physically-plausible map (albedo / normal / roughness). Free CDN
 * photo scans (three.js sample textures: opengameart grass, AmbientCG ice,
 * hardwood, brick, lava, water normals, smoke) then hot-swap into the *same*
 * THREE.Texture object, so no material ever needs recompiling and the game
 * still looks right with zero network access.
 * ==========================================================================*/
import * as THREE from 'three';
import { ASSET_HOSTS, POLY_HAVEN, TEXTURES } from '../config.js';
import { clamp01, hash2i, lerp, smoothstep } from '../core/util.js';

let _anisotropy = 4;
export function setAnisotropy(v) { _anisotropy = Math.max(1, v | 0); }

function canvas(size, sizeY = size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = sizeY;
  return c;
}

function ctxOf(c) { return c.getContext('2d', { willReadFrequently: true }); }

function texFromCanvas(c, { srgb = true, repeat = 1, aniso = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso ? _anisotropy : 1;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

/* ---------------------------------------------------------------------------
 * Tileable value noise (seamless because it wraps on the texture lattice)
 * -------------------------------------------------------------------------*/
function tileNoise(x, y, period, seed) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const w = (a, b) => hash2i(((a % period) + period) % period, ((b % period) + period) % period, seed);
  const a = w(xi, yi), b = w(xi + 1, yi), c = w(xi, yi + 1), d = w(xi + 1, yi + 1);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function tileFbm(x, y, octaves, period, seed) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * tileNoise(x * freq, y * freq, period * freq, seed + i * 131);
    norm += amp; amp *= 0.52; freq *= 2;
  }
  return sum / norm;
}

/* ---------------------------------------------------------------------------
 * Generic painter: fn(u,v) -> [r,g,b] plus optional height channel
 * -------------------------------------------------------------------------*/
function paint(size, fn, { height = false } = {}) {
  const c = canvas(size);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const h = height ? new Float32Array(size * size) : null;
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const out = fn(u, v, x, y);
      const i = (y * size + x) * 4;
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2];
      d[i + 3] = out.length > 3 ? out[3] : 255;
      if (h) h[y * size + x] = out.length > 4 ? out[4] : (out[0] + out[1] + out[2]) / (3 * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: c, height: h, size };
}

/** Sobel height → tangent-space normal map (OpenGL convention, +Y up) */
function normalFromHeight(heightField, size, strength = 2.2) {
  const c = canvas(size);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const at = (x, y) => heightField[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
      const l = at(x - 1, y), r = at(x + 1, y);
      const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
      const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
      const dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
      let nx = -dx * strength, ny = dy * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      d[i] = (nx * 0.5 + 0.5) * 255;
      d[i + 1] = (ny * 0.5 + 0.5) * 255;
      d[i + 2] = (nz * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function roughnessFrom(heightField, size, base = 0.85, variance = 0.25) {
  const c = canvas(size);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < size * size; i++) {
    const v = clamp01(base + (heightField[i] - 0.5) * variance * 2) * 255;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ---------------------------------------------------------------------------
 * Procedural material sets
 * -------------------------------------------------------------------------*/
function groundSet(size, albedoFn, { normalStrength = 2.2, roughBase = 0.9, roughVar = 0.18 } = {}) {
  const p = paint(size, albedoFn, { height: true });
  return {
    map: texFromCanvas(p.canvas, { srgb: true }),
    normalMap: texFromCanvas(normalFromHeight(p.height, size, normalStrength), { srgb: false }),
    roughnessMap: texFromCanvas(roughnessFrom(p.height, size, roughBase, roughVar), { srgb: false }),
    height: p.height, size
  };
}

function mixRGB(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }

/* ---- grass (dark, dry-ish battlefield turf) ---- */
function grassAlbedo(u, v, x, y) {
  const n = tileFbm(u * 8, v * 8, 5, 8, 11);
  const blades = tileFbm(u * 64, v * 64, 3, 64, 77);
  const patches = tileFbm(u * 3, v * 3, 3, 3, 5);
  const dry = smoothstep(0.45, 0.85, patches * 0.6 + n * 0.4);
  let c = mixRGB([54, 88, 38], [96, 116, 52], dry);
  c = mixRGB(c, [120, 108, 62], smoothstep(0.62, 0.95, patches));   // worn dirt
  c = mixRGB(c, [38, 62, 28], smoothstep(0.55, 0.9, blades) * 0.55); // blade shadow
  const shade = 0.86 + blades * 0.3;
  return [c[0] * shade, c[1] * shade, c[2] * shade, 255, n * 0.55 + blades * 0.45];
}

/* ---- rock / granite ---- */
function rockAlbedo(u, v) {
  const base = tileFbm(u * 6, v * 6, 5, 6, 23);
  const crack = tileFbm(u * 18, v * 18, 4, 18, 91);
  const speck = tileNoise(u * 120, v * 120, 120, 7);
  let c = mixRGB([74, 72, 70], [128, 124, 118], base);
  c = mixRGB(c, [46, 44, 43], smoothstep(0.42, 0.22, crack));        // fissures
  c = mixRGB(c, [150, 146, 138], smoothstep(0.75, 1.0, base) * 0.5);
  const s = 0.82 + speck * 0.36;
  return [c[0] * s, c[1] * s, c[2] * s, 255, base * 0.6 + crack * 0.4];
}

/* ---- dirt / gravel ---- */
function dirtAlbedo(u, v) {
  const n = tileFbm(u * 10, v * 10, 5, 10, 33);
  const grit = tileNoise(u * 90, v * 90, 90, 19);
  const pebble = smoothstep(0.72, 0.95, tileFbm(u * 26, v * 26, 3, 26, 55));
  let c = mixRGB([86, 66, 47], [128, 102, 72], n);
  c = mixRGB(c, [150, 142, 130], pebble * 0.7);
  const s = 0.85 + grit * 0.3;
  return [c[0] * s, c[1] * s, c[2] * s, 255, n * 0.5 + pebble * 0.5];
}

/* ---- sand / dune ---- */
function sandAlbedo(u, v) {
  const ripple = Math.sin((u * 22 + tileFbm(u * 5, v * 5, 3, 5, 41) * 3.2) * Math.PI * 2) * 0.5 + 0.5;
  const grit = tileNoise(u * 140, v * 140, 140, 3);
  let c = mixRGB([186, 158, 106], [222, 198, 148], ripple * 0.75 + grit * 0.25);
  const s = 0.94 + grit * 0.14;
  return [c[0] * s, c[1] * s, c[2] * s, 255, ripple * 0.55 + grit * 0.45];
}

/* ---- snow / frost ---- */
function snowAlbedo(u, v) {
  const drift = tileFbm(u * 7, v * 7, 5, 7, 61);
  const crust = tileFbm(u * 24, v * 24, 3, 24, 17);
  let c = mixRGB([214, 226, 236], [248, 252, 255], drift);
  c = mixRGB(c, [176, 196, 214], smoothstep(0.55, 0.2, crust) * 0.4);
  return [c[0], c[1], c[2], 255, drift * 0.6 + crust * 0.4];
}

/* ---- bark (used when the free hardwood scan is unavailable) ---- */
function barkAlbedo(u, v) {
  const rings = Math.abs(Math.sin((v * 26 + tileFbm(u * 4, v * 4, 3, 4, 83) * 4) * Math.PI)) ** 0.6;
  const cracks = smoothstep(0.55, 0.9, tileFbm(u * 14, v * 40, 4, 14, 29));
  let c = mixRGB([58, 42, 30], [104, 78, 52], rings);
  c = mixRGB(c, [30, 22, 16], cracks);
  const moss = smoothstep(0.62, 0.9, tileFbm(u * 6, v * 6, 3, 6, 97));
  c = mixRGB(c, [74, 92, 44], moss * 0.45);
  return [c[0], c[1], c[2], 255, rings * 0.5 + cracks * 0.5];
}

/* ---- rusted / painted armour steel ---- */
function metalAlbedo(u, v, hue) {
  const brush = tileFbm(u * 2, v * 140, 3, 2, 5) * 0.5 + tileNoise(u * 200, v * 200, 200, 9) * 0.5;
  const wear = tileFbm(u * 9, v * 9, 4, 9, 71);
  const rust = smoothstep(0.66, 0.95, wear);
  let c = mixRGB(hue.dark, hue.light, brush);
  c = mixRGB(c, [112, 58, 32], rust * 0.75);
  c = mixRGB(c, [40, 38, 36], smoothstep(0.42, 0.2, wear) * 0.4);
  return [c[0], c[1], c[2], 255, brush * 0.4 + wear * 0.6];
}

/* ---- digital camouflage (per-faction, generated at runtime) ---- */
export function camoCanvas(size, palette, seed = 1234) {
  const c = canvas(size);
  const ctx = ctxOf(c);
  ctx.fillStyle = palette[0];
  ctx.fillRect(0, 0, size, size);
  const cell = size / 16;
  for (let layer = 1; layer < palette.length; layer++) {
    ctx.fillStyle = palette[layer];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const n = tileFbm(x * 0.42 + layer * 3.1, y * 0.42 - layer * 2.2, 3, 16, seed + layer * 977);
        if (n > 0.62 - layer * 0.03) {
          // blobby digital camo: draw the cell plus a random neighbour
          ctx.fillRect(x * cell, y * cell, cell + 0.6, cell + 0.6);
          if (hash2i(x, y, seed + layer) > 0.62) {
            const dx = hash2i(x, y, seed + layer * 7) > 0.5 ? 1 : -1;
            ctx.fillRect((x + dx) * cell, y * cell, cell + 0.6, cell * 0.7);
          }
        }
      }
    }
  }
  // grime + edge wear
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = tileFbm(x / size * 12, y / size * 12, 4, 12, 515);
      const g = tileNoise(x / size * 180, y / size * 180, 180, 33);
      const s = 0.72 + n * 0.34 + g * 0.16;
      const i = (y * size + x) * 4;
      d[i] *= s; d[i + 1] *= s; d[i + 2] *= s;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ---- sprite sheets: soft circle, spark, smoke puff, shockwave, scorch ---- */
function radialSprite(size, fn) {
  const c = canvas(size);
  const ctx = ctxOf(c);
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const h = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - h + 0.5) / h, dy = (y - h + 0.5) / h;
      const r = Math.min(1, Math.hypot(dx, dy));
      const a = Math.atan2(dy, dx);
      const [cr, cg, cb, ca] = fn(r, a, x / size, y / size);
      const i = (y * size + x) * 4;
      d[i] = cr; d[i + 1] = cg; d[i + 2] = cb; d[i + 3] = ca * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function softCircle(size = 64, color = [255, 255, 255], power = 2.2) {
  return texFromCanvas(radialSprite(size, (r) => {
    const a = clamp01(1 - r) ** power;
    return [color[0], color[1], color[2], a];
  }), { srgb: true, aniso: false });
}

export function sparkSprite(size = 64) {
  return texFromCanvas(radialSprite(size, (r, a) => {
    const core = clamp01(1 - r) ** 3;
    const streak = clamp01(1 - Math.abs(Math.sin(a * 2)) * 0.0 - r * 1.35) ** 2;
    const v = core * 0.8 + streak * 0.35;
    return [255, lerp(210, 255, core), lerp(120, 230, core), clamp01(v)];
  }), { srgb: true, aniso: false });
}

export function smokeSprite(size = 128) {
  return texFromCanvas(radialSprite(size, (r, a, u, v) => {
    const puff = tileFbm(u * 5, v * 5, 4, 5, 4242);
    const edge = clamp01(1 - r * 1.12);
    const a2 = edge * edge * (0.45 + puff * 0.75);
    const g = lerp(70, 190, puff) * (0.6 + edge * 0.5);
    return [g, g * 0.98, g * 0.95, clamp01(a2)];
  }), { srgb: true, aniso: false });
}

export function ringSprite(size = 128, color = [255, 190, 120]) {
  return texFromCanvas(radialSprite(size, (r) => {
    const band = Math.exp(-((r - 0.62) ** 2) / 0.012);
    const inner = clamp01(1 - r * 1.6) ** 2 * 0.25;
    const a = clamp01(band + inner);
    return [color[0], color[1], color[2], a];
  }), { srgb: true, aniso: false });
}

export function scorchSprite(size = 256) {
  const c = radialSprite(size, (r, a, u, v) => {
    const n = tileFbm(u * 6, v * 6, 5, 6, 8888);
    const blobs = smoothstep(0.5, 0.9, tileFbm(u * 14, v * 14, 3, 14, 777));
    const edge = clamp01(1 - r * (0.86 + n * 0.5));
    const a2 = clamp01(edge * edge * (0.55 + blobs * 0.6));
    const g = lerp(8, 42, blobs * edge);
    return [g, g * 0.92, g * 0.86, a2];
  });
  return texFromCanvas(c, { srgb: true, aniso: false });
}

/** glowing rune circle for magic casters / pickups */
export function runeSprite(size = 256, color = [120, 255, 200]) {
  const c = canvas(size);
  const ctx = ctxOf(c);
  const h = size / 2;
  ctx.clearRect(0, 0, size, size);
  const stroke = (r, w, alpha) => {
    ctx.beginPath(); ctx.arc(h, h, r, 0, Math.PI * 2);
    ctx.lineWidth = w; ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},${alpha})`;
    ctx.stroke();
  };
  stroke(h * 0.94, size * 0.012, 0.85);
  stroke(h * 0.82, size * 0.006, 0.5);
  stroke(h * 0.44, size * 0.01, 0.7);
  // spokes + glyphs
  ctx.strokeStyle = `rgba(${color[0]},${color[1]},${color[2]},0.75)`;
  ctx.lineWidth = size * 0.008;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(h + Math.cos(a) * h * 0.46, h + Math.sin(a) * h * 0.46);
    ctx.lineTo(h + Math.cos(a) * h * 0.8, h + Math.sin(a) * h * 0.8);
    ctx.stroke();
  }
  ctx.font = `${size * 0.12}px monospace`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(${color[0]},${color[1]},${color[2]},0.9)`;
  const glyphs = ['ᚠ', 'ᚢ', 'ᚦ', 'ᚨ', 'ᚱ', 'ᚲ'];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.fillText(glyphs[i], h + Math.cos(a) * h * 0.63, h + Math.sin(a) * h * 0.63);
  }
  const t = texFromCanvas(c, { srgb: true, aniso: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** procedural water surface normal map (own Source — never shared!) */
export function waterNormalCanvas(size = 256) {
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const w1 = Math.sin((u * 6 + tileFbm(u * 4, v * 4, 3, 4, 31) * 1.6) * Math.PI * 2);
      const w2 = Math.sin((v * 9 + tileFbm(u * 7, v * 7, 3, 7, 17) * 1.2) * Math.PI * 2);
      const cap = tileFbm(u * 22, v * 22, 4, 22, 91);
      h[y * size + x] = w1 * 0.3 + w2 * 0.22 + cap * 0.48;
    }
  }
  return normalFromHeight(h, size, 1.8);
}

/** leaf card: soft blob cluster with alpha */
export function leafSprite(size = 128, tint = [70, 120, 50]) {
  const c = canvas(size);
  const ctx = ctxOf(c);
  ctx.clearRect(0, 0, size, size);
  for (let i = 0; i < 130; i++) {
    const a = hash2i(i, 3, 77) * Math.PI * 2;
    const r = Math.sqrt(hash2i(i, 9, 13)) * size * 0.46;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r * 0.92;
    const rad = size * (0.035 + hash2i(i, 21, 5) * 0.05) * (1 - r / (size * 0.6));
    const l = 0.6 + hash2i(i, 33, 9) * 0.6;
    ctx.fillStyle = `rgba(${(tint[0] * l) | 0},${(tint[1] * l) | 0},${(tint[2] * l) | 0},${0.62 + hash2i(i, 41, 2) * 0.38})`;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(1, rad), Math.max(1, rad * 0.55), a, 0, Math.PI * 2);
    ctx.fill();
  }
  const t = texFromCanvas(c, { srgb: true, aniso: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** grass tuft alpha card */
export function tuftSprite(size = 128, tint = [96, 138, 58]) {
  const c = canvas(size);
  const ctx = ctxOf(c);
  ctx.clearRect(0, 0, size, size);
  ctx.lineCap = 'round';
  for (let i = 0; i < 44; i++) {
    const x = size * (0.06 + hash2i(i, 5, 31) * 0.88);
    const hgt = size * (0.34 + hash2i(i, 7, 17) * 0.6);
    const bend = (hash2i(i, 11, 3) - 0.5) * size * 0.36;
    const l = 0.65 + hash2i(i, 13, 29) * 0.6;
    ctx.strokeStyle = `rgba(${(tint[0] * l) | 0},${(tint[1] * l) | 0},${(tint[2] * l) | 0},0.95)`;
    ctx.lineWidth = size * (0.012 + hash2i(i, 17, 11) * 0.02);
    ctx.beginPath();
    ctx.moveTo(x, size);
    ctx.quadraticCurveTo(x + bend * 0.35, size - hgt * 0.6, x + bend, size - hgt);
    ctx.stroke();
  }
  const t = texFromCanvas(c, { srgb: true, aniso: false });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

/** tread / track pattern (albedo + height for normals) */
export function treadSet(size = 256) {
  const p = paint(size, (u, v) => {
    const link = Math.abs(((v * 12) % 1) - 0.5) * 2;              // track links
    const pad = smoothstep(0.35, 0.62, Math.abs(((u * 4) % 1) - 0.5) * 2);
    const cleats = smoothstep(0.82, 0.95, Math.sin(v * Math.PI * 2 * 12) * 0.5 + 0.5);
    const grit = tileNoise(u * 200, v * 200, 200, 12);
    let c = mixRGB([26, 25, 24], [62, 60, 57], 1 - link * 0.65);
    c = mixRGB(c, [86, 82, 76], pad * 0.55);
    c = mixRGB(c, [122, 96, 62], grit * 0.22);                     // caked dust
    c = mixRGB(c, [140, 136, 128], cleats * 0.5);
    const s = 0.85 + grit * 0.3;
    return [c[0] * s, c[1] * s, c[2] * s, 255, (1 - link * 0.7) * 0.6 + cleats * 0.4];
  }, { height: true });
  return {
    map: texFromCanvas(p.canvas, { srgb: true }),
    normalMap: texFromCanvas(normalFromHeight(p.height, size, 2.6), { srgb: false }),
    roughnessMap: texFromCanvas(roughnessFrom(p.height, size, 0.78, 0.2), { srgb: false })
  };
}

/** lava: emissive crust with glowing veins */
export function lavaSet(size = 256) {
  const p = paint(size, (u, v) => {
    const crust = tileFbm(u * 7, v * 7, 5, 7, 606);
    const veins = smoothstep(0.52, 0.72, tileFbm(u * 12, v * 12, 4, 12, 909));
    let c = mixRGB([24, 14, 12], [70, 34, 22], crust);
    c = mixRGB(c, [255, 168, 60], veins);
    c = mixRGB(c, [255, 240, 190], smoothstep(0.78, 0.95, veins) * 0.8);
    return [c[0], c[1], c[2], 255, crust];
  }, { height: true });
  const emis = paint(size, (u, v) => {
    const veins = smoothstep(0.5, 0.78, tileFbm(u * 12, v * 12, 4, 12, 909));
    const hot = smoothstep(0.72, 0.95, veins);
    return [255 * (0.35 + veins * 0.65), 90 * veins + 150 * hot, 30 * veins + 120 * hot, 255];
  });
  return {
    map: texFromCanvas(p.canvas, { srgb: true }),
    emissiveMap: texFromCanvas(emis.canvas, { srgb: true }),
    normalMap: texFromCanvas(normalFromHeight(p.height, size, 1.6), { srgb: false })
  };
}

/* ===========================================================================
 * TextureLibrary
 * =========================================================================*/
export class TextureLibrary {
  constructor(quality = 'medium') {
    this.quality = quality;
    this.real = [];            // names of slots currently holding CDN scans
    this.pending = [];
    this.hostIndex = 0;        // best-known asset mirror
    this.hostOk = false;
    this.disposed = false;

    /* ---- ground sets (procedural now, photo scans swapped in later) ---- */
    this.grass = groundSet(256, grassAlbedo, { normalStrength: 2.4, roughBase: 0.92 });
    this.rock = groundSet(256, rockAlbedo, { normalStrength: 3.0, roughBase: 0.8 });
    this.dirt = groundSet(256, dirtAlbedo, { normalStrength: 2.2, roughBase: 0.94 });
    this.sand = groundSet(256, sandAlbedo, { normalStrength: 1.5, roughBase: 0.88 });
    this.snow = groundSet(256, snowAlbedo, { normalStrength: 1.4, roughBase: 0.62 });

    /* ---- props ---- */
    this.bark = groundSet(256, barkAlbedo, { normalStrength: 3.2, roughBase: 0.88 });
    /** neutral hide/leather/skin — multiplies cleanly with any creature colour */
    this.hide = groundSet(128, (u, v) => {
      const pores = tileFbm(u * 34, v * 34, 3, 34, 8181);
      const fold = tileFbm(u * 7, v * 7, 4, 7, 4242);
      const hair = tileNoise(u * 190, v * 190, 190, 6);
      const g = lerp(150, 236, pores * 0.55 + fold * 0.3 + hair * 0.15);
      return [g, g * 0.99, g * 0.97, 255, pores * 0.5 + fold * 0.35 + hair * 0.15];
    }, { normalStrength: 1.9, roughBase: 0.9, roughVar: 0.16 });
    this.metal = groundSet(256, (u, v) => metalAlbedo(u, v, { dark: [52, 54, 56], light: [122, 126, 128] }), { normalStrength: 1.8, roughBase: 0.52, roughVar: 0.4 });
    this.rust = groundSet(256, (u, v) => metalAlbedo(u, v, { dark: [78, 48, 32], light: [150, 96, 58] }), { normalStrength: 2.6, roughBase: 0.72, roughVar: 0.3 });
    this.stone = groundSet(256, (u, v) => {
      const n = tileFbm(u * 5, v * 5, 5, 5, 1212);
      const block = smoothstep(0.46, 0.54, Math.abs(((u * 6) % 1) - 0.5)) * smoothstep(0.46, 0.54, Math.abs(((v * 3) % 1) - 0.5));
      let c = mixRGB([118, 112, 100], [168, 160, 146], n);
      c = mixRGB(c, [62, 58, 52], (1 - block) * 0.55);
      return [c[0], c[1], c[2], 255, n * 0.5 + block * 0.5];
    }, { normalStrength: 2.8, roughBase: 0.86 });

    /* ---- tank armour ---- */
    this.tread = treadSet(256);
    this.lava = lavaSet(256);

    /* ---- sprites ---- */
    this.soft = softCircle(64);
    this.spark = sparkSprite(64);
    this.smoke = smokeSprite(128);
    this.ring = ringSprite(128);
    this.scorch = scorchSprite(256);
    this.rune = runeSprite(256);
    this.runeWarm = runeSprite(256, [255, 170, 90]);
    this.leaf = leafSprite(128);
    this.leafAutumn = leafSprite(128, [158, 122, 44]);
    this.leafPine = leafSprite(128, [42, 88, 58]);
    this.tuft = tuftSprite(128);
    this.tuftDry = tuftSprite(128, [150, 140, 84]);

    /* ---- water (its own texture Source — never shared with the ground maps) ---- */
    this.waterNormal = texFromCanvas(waterNormalCanvas(256), { srgb: false });
    this.waterNormal.repeat.set(16, 16);

    /* ---- environment (filled by loadEnvironment) ---- */
    this.envMap = null;
  }

  /* --- camo paint for tanks (unique per faction / run) --- */
  camo(palette, seed) {
    const c = camoCanvas(256, palette, seed);
    const p = { canvas: c, size: 256, height: null };
    // derive a light normal map from the painted grime
    const size = 256;
    const h = new Float32Array(size * size);
    const ctx = ctxOf(c);
    const d = ctx.getImageData(0, 0, size, size).data;
    for (let i = 0; i < size * size; i++) h[i] = (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / (3 * 255);
    p.height = h;
    return {
      map: texFromCanvas(c, { srgb: true }),
      normalMap: texFromCanvas(normalFromHeight(h, size, 1.1), { srgb: false }),
      roughnessMap: texFromCanvas(roughnessFrom(h, size, 0.62, 0.34), { srgb: false })
    };
  }

  /* --------------------------------------------------------------------- */
  get wantsRealTextures() {
    const q = this.quality;
    return (name) => {
      const cfg = TEXTURES[name];
      if (!cfg) return false;
      if (q.realTextures === 'all') return true;
      return q.realTextures.includes(name);
    };
  }

  /** Resolve one relative asset path across the CDN mirrors. */
  async fetchImage(rel) {
    const order = [];
    for (let i = 0; i < ASSET_HOSTS.length; i++) order.push((this.hostIndex + i) % ASSET_HOSTS.length);
    let lastErr = null;
    for (const idx of order) {
      const url = ASSET_HOSTS[idx] + rel;
      try {
        const img = await loadImage(url);
        this.hostIndex = idx; this.hostOk = true;
        return img;
      } catch (e) { lastErr = e; }
    }
    // Poly Haven mirror for texture-like assets (CC0)
    const ph = polyHavenURL(rel);
    if (ph) {
      try { return await loadImage(ph); } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('no host for ' + rel);
  }

  /** Swap a CDN scan into an existing procedural texture slot. */
  async enhance(slotName, rel, { srgb = true, target = 'map' } = {}) {
    if (!this.wantsRealTextures(slotName)) return false;
    try {
      const img = await this.fetchImage(rel);
      const set = this[slotName];
      if (!set) return false;
      const tex = set[target];
      if (!tex) return false;
      tex.image = img;
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.source.needsUpdate = true;
      tex.needsUpdate = true;
      if (!this.real.includes(slotName + '.' + target)) this.real.push(slotName + '.' + target);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Load the HDRI (image based lighting) → returns texture or null */
  async loadEnvironment(loader, pmrem, renderer, rel = TEXTURES.env.url) {
    if (!this.wantsRealTextures('env')) return null;
    const order = [];
    for (let i = 0; i < ASSET_HOSTS.length; i++) order.push((this.hostIndex + i) % ASSET_HOSTS.length);
    for (const idx of order) {
      const url = ASSET_HOSTS[idx] + rel;
      try {
        const hdr = await loader.loadAsync(url);
        hdr.mapping = THREE.EquirectangularReflectionMapping;
        this.hostIndex = idx;
        const envRT = pmrem.fromEquirectangular(hdr);
        this.envMap = envRT.texture;
        this.envBackground = hdr;
        this.real.push('env');
        return { envMap: this.envMap, background: hdr };
      } catch (e) { /* next mirror */ }
    }
    return null;
  }

  /** core textures fetched before the first frame (small + high impact) */
  async loadCore(onDone) {
    const jobs = [
      this.enhance('grass', TEXTURES.grass.url, { srgb: true }),
      this.loadWaterNormal(),
      this.loadSmokeSprite()
    ];
    const res = await Promise.all(jobs);
    if (onDone) onDone(res);
    return res;
  }

  async loadWaterNormal() {
    if (!this.wantsRealTextures('waterNrm')) return false;
    try {
      const img = await this.fetchImage(TEXTURES.waterNrm.url);
      this.waterNormal.image = img;
      this.waterNormal.colorSpace = THREE.NoColorSpace;
      this.waterNormal.source.needsUpdate = true;
      this.waterNormal.needsUpdate = true;
      this.real.push('waterNormal');
      return true;
    } catch (e) { return false; }
  }

  async loadSmokeSprite() {
    if (!this.wantsRealTextures('smoke')) return false;
    try {
      const img = await this.fetchImage(TEXTURES.smoke.url);
      // keep alpha: composite the scan over transparency using its luminance
      const size = 128;
      const c = canvas(size);
      const ctx = ctxOf(c);
      ctx.drawImage(img, 0, 0, size, size);
      const d = ctx.getImageData(0, 0, size, size);
      const px = d.data;
      for (let i = 0; i < size * size; i++) {
        const lum = (px[i * 4] * 0.3 + px[i * 4 + 1] * 0.59 + px[i * 4 + 2] * 0.11);
        const dx = (i % size) / size - 0.5, dy = ((i / size) | 0) / size - 0.5;
        const fall = clamp01(1 - Math.hypot(dx, dy) * 2.05);
        px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = lerp(60, 210, lum / 255);
        px[i * 4 + 3] = clamp01(fall * fall * (0.25 + (lum / 255) * 0.85)) * 255;
      }
      ctx.putImageData(d, 0, 0);
      this.smoke.image = c;
      this.smoke.source.needsUpdate = true;
      this.smoke.needsUpdate = true;
      this.real.push('smoke');
      return true;
    } catch (e) { return false; }
  }

  /** heavier scans streamed in the background after the match starts */
  loadExtra(onProgress) {
    const jobs = [
      ['bark', TEXTURES.woodDiff.url, 'map', true],
      ['bark', TEXTURES.woodBump.url, 'normalMap', false, 'bumpToNormal'],
      ['bark', TEXTURES.woodRough.url, 'roughnessMap', false],
      ['stone', TEXTURES.brickDiff.url, 'map', true],
      ['stone', TEXTURES.brickBump.url, 'normalMap', false, 'bumpToNormal'],
      ['stone', TEXTURES.brickRough.url, 'roughnessMap', false],
      ['rock', POLY_HAVEN + 'Textures/jpg/1k/rock_wall_02/rock_wall_02_diff_1k.jpg', 'map', true, null, true],
      ['snow', TEXTURES.ice.url, 'map', true],
      ['snow', TEXTURES.iceNrm.url, 'normalMap', false]
    ];
    let done = 0;
    const total = jobs.length;
    return Promise.all(jobs.map(async ([slot, url, target, srgb, mode, absolute]) => {
      try {
        if (mode === 'bumpToNormal') {
          const img = absolute ? await loadImage(url) : await this.fetchImage(url);
          const set = this[slot];
          if (set && set[target]) {
            const nc = bumpImageToNormal(img, 256, 2.6);
            set[target].image = nc;
            set[target].colorSpace = THREE.NoColorSpace;
            set[target].source.needsUpdate = true;
            set[target].needsUpdate = true;
            this.real.push(slot + '.' + target);
          }
        } else if (absolute) {
          const img = await loadImage(url);
          const set = this[slot];
          if (set && set[target]) {
            set[target].image = img;
            set[target].colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
            set[target].source.needsUpdate = true;
            set[target].needsUpdate = true;
            this.real.push(slot + '.' + target);
          }
        } else {
          const rel = url;
          await this.enhance(slot, rel, { srgb, target });
        }
      } catch (e) { /* procedural stays */ }
      done++;
      if (onProgress) onProgress(done, total);
    }));
  }

  /** lava texture for hazard pools (emissive) */
  async loadLava() {
    if (!this.wantsRealTextures('lava')) return false;
    try {
      const img = await this.fetchImage(TEXTURES.lava.url);
      this.lava.map.image = img;
      this.lava.map.source.needsUpdate = true;
      this.lava.map.needsUpdate = true;
      this.real.push('lava');
      return true;
    } catch (e) { return false; }
  }

  /** raise anisotropy on every texture once the renderer capabilities are known */
  applyAnisotropy(max) {
    setAnisotropy(max);
    const seen = new Set();
    const apply = (t) => { if (t && t.isTexture && !seen.has(t)) { seen.add(t); t.anisotropy = Math.min(max, Math.max(t.anisotropy, 2)); t.needsUpdate = true; } };
    for (const key of Object.keys(this)) {
      const v = this[key];
      if (!v) continue;
      if (v.isTexture) apply(v);
      else if (typeof v === 'object') {
        for (const k in v) apply(v[k]);
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const seen = new Set();
    const walk = (o) => {
      if (!o || seen.has(o)) return;
      if (o.isTexture) { seen.add(o); o.dispose(); return; }
      if (typeof o === 'object') for (const k in o) { if (o[k] && o[k].isTexture) { seen.add(o[k]); o[k].dispose(); } }
    };
    for (const key of Object.keys(this)) walk(this[key]);
  }
}

/* ---------------------------------------------------------------------------
 * helpers
 * -------------------------------------------------------------------------*/
function polyHavenURL(rel) {
  // only maps that we deliberately mirror on Poly Haven
  if (/ambientcg\/Ice002_1K-JPG_Color/.test(rel)) {
    return POLY_HAVEN + 'Textures/jpg/1k/ice_02/ice_02_diff_1k.jpg';
  }
  return null;
}

export function loadImage(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; reject(new Error('timeout ' + url)); } }, timeout);
    img.onload = () => { if (!done) { done = true; clearTimeout(timer); resolve(img); } };
    img.onerror = (e) => { if (!done) { done = true; clearTimeout(timer); reject(e || new Error('error ' + url)); } };
    img.src = url;
  });
}

/** convert a greyscale bump scan into a normal-map canvas */
export function bumpImageToNormal(img, size, strength = 2.4) {
  const src = canvas(size);
  const sctx = ctxOf(src);
  sctx.drawImage(img, 0, 0, size, size);
  const sd = sctx.getImageData(0, 0, size, size).data;
  const h = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) h[i] = (sd[i * 4] * 0.3 + sd[i * 4 + 1] * 0.59 + sd[i * 4 + 2] * 0.11) / 255;
  return normalFromHeight(h, size, strength);
}

export { normalFromHeight, roughnessFrom, paint, texFromCanvas, tileFbm, tileNoise, canvas as makeCanvas };
