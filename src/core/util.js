/* ============================================================================
 * core/util.js — math, deterministic noise, seeded RNG
 * The whole infinite world is a pure function of (x, z, seed) so travelling
 * 10 km in any direction reproduces exactly the same terrain & props.
 * ==========================================================================*/

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (e0, e1, x) => { const t = clamp01((x - e0) / (e1 - e0 || 1e-6)); return t * t * (3 - 2 * t); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const approach = (a, b, delta) => (a < b ? Math.min(a + delta, b) : Math.max(a - delta, b));
export const rand = (a, b) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = (arr) => arr[(Math.random() * arr.length) | 0];

/** shortest signed angular difference a→b */
export function angleDelta(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export const deg2rad = (d) => (d * Math.PI) / 180;

/* ---------------------------------------------------------------------------
 * Hashing / RNG
 * -------------------------------------------------------------------------*/
export function hash2i(x, y, seed = 1337) {
  let h = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export function hash3i(x, y, z, seed = 1337) {
  let h = seed ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

/** mulberry32 — fast, seedable, good enough for scatter */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(x, y, salt = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(salt | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/* ---------------------------------------------------------------------------
 * Value noise + fBm (2D). Smooth, tileable-free, deterministic.
 * -------------------------------------------------------------------------*/
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export function valueNoise(x, y, seed = 1337) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = fade(xf), v = fade(yf);
  const a = hash2i(xi, yi, seed);
  const b = hash2i(xi + 1, yi, seed);
  const c = hash2i(xi, yi + 1, seed);
  const d = hash2i(xi + 1, yi + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v) * 2 - 1;
}

export function fbm(x, y, octaves = 4, lacunarity = 2.02, gain = 0.5, seed = 1337) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 7919);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / (norm || 1);
}

export function ridged(x, y, octaves = 3, seed = 91) {
  let amp = 1, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(valueNoise(x * freq, y * freq, seed + i * 104729));
    sum += amp * n * n;
    norm += amp;
    amp *= 0.5;
    freq *= 2.07;
  }
  return sum / (norm || 1);
}

/** cheap 1D noise for wobble/antenna sway */
export function noise1(x, seed = 7) {
  const xi = Math.floor(x), xf = x - xi;
  return lerp(hash2i(xi, 0, seed), hash2i(xi + 1, 0, seed), fade(xf)) * 2 - 1;
}

/* ---------------------------------------------------------------------------
 * small helpers used all over
 * -------------------------------------------------------------------------*/
export function formatNumber(n) {
  n = Math.max(0, Math.floor(n));
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return String(n);
}

export function formatDistance(m) {
  if (m >= 1000) return (m / 1000).toFixed(m >= 10000 ? 1 : 2) + ' km';
  return Math.floor(m) + ' m';
}

/** weighted pick from [{key, weight}] */
export function weightedPick(list, rng = Math.random) {
  let total = 0;
  for (const it of list) total += it.weight;
  let r = rng() * total;
  for (const it of list) {
    r -= it.weight;
    if (r <= 0) return it;
  }
  return list[list.length - 1];
}

/** move `current` toward `target` angle by max `step` radians */
export function rotateToward(current, target, step) {
  const d = angleDelta(current, target);
  if (Math.abs(d) <= step) return target;
  return current + Math.sign(d) * step;
}

/** store/load helpers that never throw (Safari private mode…) */
export const storage = {
  get(k, dflt = null) { try { const v = localStorage.getItem(k); return v === null ? dflt : JSON.parse(v); } catch (e) { return dflt; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } }
};
