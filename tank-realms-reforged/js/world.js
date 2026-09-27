/* =============================================================================
 * TANK REALMS: REFORGED — world look (classic script, loaded before game.js)
 * -----------------------------------------------------------------------------
 *  • PBR ground: two scanned Poly Haven texture sets per realm, blended by slope
 *    + large noise patches, with anti-tiling and per-realm colour grading.
 *  • Image-based lighting from a real HDRI per realm.
 *  • Chunk planner: places GLB trees, scanned rocks, fallen logs, stumps, plants,
 *    grass, barrels, crates and barriers as GPU-instanced meshes. Each chunk uses
 *    only a few models (natural clusters + few draw calls → fast on phones).
 * If the models are not loaded yet, game.js falls back to the original
 * procedural trees/rocks — nothing ever breaks.
 * ===========================================================================*/
(function () {
  'use strict';
  const T = window.THREE;
  const A = window.Assets;

  // r128 → r155+ physically-correct lights: intensities are multiplied by PI;
  // the extra HDRI light lets us keep the fill lights lower than before.
  const LIGHT = { hemi: Math.PI * 0.42, amb: Math.PI * 0.30, sun: Math.PI * 0.88 };

  /* ---------------------------------------------------------------------------
   * GROUND MATERIAL
   * -------------------------------------------------------------------------*/
  const groundMats = new Map();
  const GROUND_VERT_PARS = '#include <common>\nattribute float tblend;\nvarying float vTBlend;\nvarying vec2 vWorldXZ;';
  const GROUND_VERT = '#include <begin_vertex>\nvTBlend = tblend;\nvec4 gWp = modelMatrix * vec4(position, 1.0); vWorldXZ = vec2(gWp.x, -gWp.z);';
  const GROUND_FRAG_PARS = [
    '#include <common>',
    'uniform sampler2D map2; uniform sampler2D normalMap2;',
    'uniform vec3 uTint1; uniform vec3 uTint2; uniform float uS1; uniform float uS2;',
    'varying float vTBlend; varying vec2 vWorldXZ;',
    // cheap value noise for macro variation + anti-tiling
    'float gHash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }',
    'float gNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);',
    '  return mix(mix(gHash(i), gHash(i+vec2(1,0)), f.x), mix(gHash(i+vec2(0,1)), gHash(i+vec2(1,1)), f.x), f.y); }',
  ].join('\n');
  const GROUND_MAP = [
    '#ifdef USE_MAP',
    '  vec2 gUv = vWorldXZ;',
    '  float gN = gNoise(gUv * 0.035) * 0.65 + gNoise(gUv * 0.11) * 0.35;',
    '  vec2 uvA = gUv / uS1; vec2 uvA2 = vec2(uvA.y, -uvA.x) * 0.61 + 0.37;',          // rotated + rescaled copy
    '  float at = smoothstep(0.38, 0.62, gNoise(gUv * 0.06 + 11.0));',
    '  vec4 c1 = mix(texture2D(map, uvA), texture2D(map, uvA2), at);',
    '  vec2 uvB = gUv / uS2; vec2 uvB2 = vec2(-uvB.y, uvB.x) * 0.57 + 0.21;',
    '  vec4 c2 = mix(texture2D(map2, uvB), texture2D(map2, uvB2), at);',
    '  float tb = clamp(vTBlend + (gN - 0.5) * 0.35, 0.0, 1.0);',
    '  tb = smoothstep(0.3, 0.7, tb);',                                                     // crisper transition
    '  vec3 gcol = mix(c1.rgb * uTint1, c2.rgb * uTint2, tb);',
    '  gcol *= 0.86 + gN * 0.28;',                                                          // macro brightness variation
    '  diffuseColor.rgb *= gcol;',
    '#endif',
  ].join('\n');
  const GROUND_NORMAL = T.ShaderChunk.normal_fragment_maps.replace(
    'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
    [
      'vec2 nUv = vWorldXZ;',
      'float nAt = smoothstep(0.38, 0.62, gNoise(nUv * 0.06 + 11.0));',
      'vec2 nA = nUv / uS1; vec2 nA2 = vec2(nA.y, -nA.x) * 0.61 + 0.37;',
      'vec2 nB = nUv / uS2; vec2 nB2 = vec2(-nB.y, nB.x) * 0.57 + 0.21;',
      'vec3 n1a = texture2D(normalMap, nA).xyz * 2.0 - 1.0; vec3 n1b = texture2D(normalMap, nA2).xyz * 2.0 - 1.0;',
      'n1b.xy = vec2(-n1b.y, n1b.x);',                       // undo the 90deg uv rotation
      'vec3 n2a = texture2D(normalMap2, nB).xyz * 2.0 - 1.0; vec3 n2b = texture2D(normalMap2, nB2).xyz * 2.0 - 1.0;',
      'n2b.xy = vec2(n2b.y, -n2b.x);',
      'vec3 n1 = mix(n1a, n1b, nAt); vec3 n2 = mix(n2a, n2b, nAt);',
      'float nTb = smoothstep(0.3, 0.7, clamp(vTBlend, 0.0, 1.0));',
      'vec3 mapN = normalize(mix(n1, n2, nTb));',
    ].join('\n'));

  function groundMaterial(biomeIdx) {
    const i = biomeIdx % A.BIOME_ENV.length;
    if (groundMats.has(i)) return groundMats.get(i);
    const be = A.BIOME_ENV[i];
    const s1 = A.groundSet(be.ground[0]), s2 = A.groundSet(be.ground[1]);
    const mat = new T.MeshStandardMaterial({
      map: s1.map, normalMap: s1.normalMap, normalScale: new T.Vector2(1.1, 1.1),
      roughness: be.rough != null ? be.rough : 0.92, metalness: 0.0, vertexColors: true,
    });
    const uniforms = {
      map2: { value: s2.map }, normalMap2: { value: s2.normalMap },
      uTint1: { value: new T.Color(be.tint || 0xffffff) }, uTint2: { value: new T.Color(be.tint2 || be.tint || 0xffffff) },
      uS1: { value: be.uv ? be.uv[0] : 10 }, uS2: { value: be.uv ? be.uv[1] : 14 },
    };
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', GROUND_VERT_PARS)
        .replace('#include <begin_vertex>', GROUND_VERT);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', GROUND_FRAG_PARS)
        .replace('#include <map_fragment>', GROUND_MAP)
        .replace('#include <normal_fragment_maps>', GROUND_NORMAL);
    };
    mat.customProgramCacheKey = () => 'trr-ground-v1';
    mat.userData.uniforms = uniforms;
    A.markShared(mat);
    groundMats.set(i, mat);
    return mat;
  }

  // How much of the SECOND ground layer shows at a point: steep slopes + big patches.
  // Per realm flavour: e.g. forest → moss rock on slopes, desert → cracked sandstone patches.
  const BLEND_STYLE = [
    { slope: 1.4, patch: 0.5, bias: -0.42 }, // forest: mossy rock on slopes
    { slope: 1.8, patch: 0.35, bias: -0.30 }, // tundra: bare rock pokes through snow
    { slope: 1.2, patch: 0.60, bias: -0.15 }, // volcanic
    { slope: 0.8, patch: 0.70, bias: -0.20 }, // desert: sandstone plates
    { slope: 0.9, patch: 0.75, bias: -0.10 }, // swamp: leafy mud / forest floor
    { slope: 1.4, patch: 0.60, bias: -0.15 }, // crystal
    { slope: 1.0, patch: 0.70, bias: -0.15 }, // autumn
    { slope: 0.9, patch: 0.65, bias: -0.25 }, // sakura: grass paths
    { slope: 1.3, patch: 0.60, bias: -0.15 }, // blood moon
    { slope: 1.2, patch: 0.60, bias: -0.15 }, // neon
  ];
  function groundBlend(biomeIdx, x, z, slope) {
    const st = BLEND_STYLE[biomeIdx % BLEND_STYLE.length];
    const patch = Math.sin(x * 0.043 + 1.3) * Math.cos(z * 0.051 - 0.7) * 0.6
                + Math.sin(x * 0.019 - z * 0.027 + 0.5) * 0.4;            // -1..1
    const v = 0.5 + patch * st.patch * 0.5 + slope * st.slope + st.bias;
    return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  /* ---------------------------------------------------------------------------
   * LIGHTING (HDRI environment)
   * -------------------------------------------------------------------------*/
  let envTarget = null;
  function applyEnvironment(scene, biomeIdx) {
    const be = A.BIOME_ENV[biomeIdx % A.BIOME_ENV.length];
    envTarget = biomeIdx;
    const rec = A.loadEnvironment(be.hdri);
    const set = (tex) => {
      if (envTarget !== biomeIdx || !tex) return;
      scene.environment = tex;
      scene.environmentIntensity = be.envI != null ? be.envI : 0.5;
    };
    if (rec.texture) set(rec.texture); else rec.promise.then(set);
  }

  /* ---------------------------------------------------------------------------
   * MATERIAL VARIANTS (leaf recolour / tint) — cached, shared
   * -------------------------------------------------------------------------*/
  const matCache = new Map();
  let greyLeafTwisted = null, greyLeafNormal = null;
  function variantMaterial(base, opts) {
    if (!opts || (!opts.leaf && !opts.tint)) return base;
    const key = base.uuid + '|' + (opts.leaf || 0) + '|' + (opts.tint || 0);
    let m = matCache.get(key);
    if (m) return m;
    const isLeaf = /lea(f|ves)/i.test(base.name || '');
    if (opts.leaf && isLeaf) {
      m = base.clone();
      if (/Twisted/i.test(base.name)) {
        greyLeafTwisted = greyLeafTwisted || A.loadTexture('textures/foliage/leaves_twisted_grey.webp', true);
        greyLeafTwisted.flipY = false;
        m.map = greyLeafTwisted;
        m.color = new T.Color(opts.leaf);
      } else if (/Leaves$/i.test(base.name) || /Normal/i.test(base.name)) {
        greyLeafNormal = greyLeafNormal || A.loadTexture('textures/foliage/leaves_normal_grey.webp', true);
        greyLeafNormal.flipY = false;
        m.map = greyLeafNormal;
        m.color = new T.Color(opts.leaf);
      } else {
        // pine needles are already green → multiply toward the target hue (gentle)
        m.color = new T.Color(0xffffff).lerp(new T.Color(opts.leaf), 0.75).multiplyScalar(1.25);
      }
    } else if (opts.tint && !isLeaf) {
      m = base.clone();
      m.color = base.color.clone().multiply(new T.Color(opts.tint));
    } else if (opts.tint && isLeaf) {
      m = base.clone();
      m.color = base.color.clone().multiply(new T.Color(opts.tint));
    } else return base;
    A.markShared(m);
    matCache.set(key, m);
    return m;
  }

  /* ---------------------------------------------------------------------------
   * CHUNK PLANNER
   * -------------------------------------------------------------------------*/
  const _m4 = new T.Matrix4(), _q = new T.Quaternion(), _q2 = new T.Quaternion(), _e = new T.Euler();
  const _p = new T.Vector3(), _s = new T.Vector3(), _up = new T.Vector3(0, 1, 0), _n = new T.Vector3();
  const ZERO = new T.Matrix4().makeScale(0, 0, 0);

  function loaded(list) { return (list || []).filter(e => { const g = A.getModel(e[0]); return g && g.userData.variants && g.userData.variants.length; }); }
  function pickWeighted(list, rnd) {
    let tot = 0; for (const e of list) tot += e[1];
    let r = rnd() * tot;
    for (const e of list) { r -= e[1]; if (r <= 0) return e; }
    return list[list.length - 1];
  }
  function subset(list, n, rnd) { // n distinct weighted picks
    const pool = list.slice(), out = [];
    while (pool.length && out.length < n) { const e = pickWeighted(pool, rnd); out.push(e); pool.splice(pool.indexOf(e), 1); }
    return out;
  }
  const rr = (rnd, a) => a[0] + rnd() * (a[1] - a[0]);

  function envReady(biomeIdx) {
    const be = A.BIOME_ENV[biomeIdx % A.BIOME_ENV.length];
    return loaded(be.trees).length + loaded(be.rocks).length > 0;
  }

  /**
   * Adds micro-ops that populate `chunk` with instanced GLB scenery.
   * ctx: { biomeIdx, biome, cx, cz, size, rnd, height(x,z), chunk, ops, quality }
   * Returns false when the realm's models are not ready (caller uses the procedural fallback).
   */
  function planChunk(ctx) {
    const be = A.BIOME_ENV[ctx.biomeIdx % A.BIOME_ENV.length];
    const trees = loaded(be.trees), rocks = loaded(be.rocks);
    if (!trees.length && !rocks.length) return false;
    const { rnd, chunk, size, ops, height, biome } = ctx;
    const ox = ctx.cx * size, oz = ctx.cz * size;
    const low = ctx.quality === 'low';
    chunk._ib = new Map();
    const taken = [];
    const free = (x, z, r) => {
      if (x < ox + 1 || x > ox + size - 1 || z < oz + 1 || z > oz + size - 1) return false;
      for (const t of taken) { const dx = t[0] - x, dz = t[1] - z, rr2 = t[2] + r; if (dx * dx + dz * dz < rr2 * rr2) return false; }
      return true;
    };
    const safe = (x, z, r) => Math.hypot(x, z) > r;   // keep the spawn clearing open

    // per-chunk model subsets → natural clusters + few draw calls
    const treeSet = subset(trees, 2, rnd);
    const rockSet = subset(rocks.filter(e => !(A.ENV[e[0]] || {}).big), 2, rnd);
    const bigSet = rocks.filter(e => (A.ENV[e[0]] || {}).big);
    const woodSet = subset(loaded(be.wood), 2, rnd);
    const plantSet = low ? [] : subset(loaded(be.plants), 3, rnd);
    const grassSet = low ? [] : subset(loaded(be.grass), 1, rnd);
    const propSet = loaded(be.props);

    // ---- place one model instance -------------------------------------------------
    function place(entry, x, z, o) {
      o = o || {};
      const id = entry[0], cfg = A.ENV[id] || {}, opts = entry[2];
      const g = A.getModel(id); if (!g) return null;
      const vars = g.userData.variants;
      const v = vars[Math.floor(rnd() * vars.length)];
      const sz = v.size;
      let s;
      if (cfg.h) s = rr(rnd, cfg.h) / Math.max(0.01, sz.y);
      else s = rr(rnd, cfg.w || [1, 1]) / Math.max(0.01, Math.max(sz.x, sz.z));
      if (o.scale) s *= o.scale;
      const foot = Math.max(sz.x, sz.z) * s;
      const y = height(x, z) - sz.y * s * (cfg.sink || 0);
      const yaw = o.yaw != null ? o.yaw : rnd() * Math.PI * 2;
      _e.set(0, yaw, 0); _q.setFromEuler(_e);
      if (cfg.kind === 'log' || cfg.kind === 'rock' || cfg.kind === 'stump' || cfg.kind === 'decor' || o.align) {
        // lean with the terrain so flat bottoms don't float on slopes
        const d = 0.8, hx = height(x + d, z) - height(x - d, z), hz = height(x, z + d) - height(x, z - d);
        _n.set(-hx / (2 * d), 1, -hz / (2 * d)).normalize();
        _q2.setFromUnitVectors(_up, _n); _q.premultiply(_q2);
      } else if (cfg.kind === 'tree') {
        _e.set((rnd() - 0.5) * 0.08, 0, (rnd() - 0.5) * 0.08); _q2.setFromEuler(_e); _q.premultiply(_q2);
      }
      _p.set(x, y, z); _s.set(s, s * (o.ys || 1), s);
      _m4.compose(_p, _q, _s);
      const refs = [];
      const cast = cfg.kind !== 'plant' && cfg.kind !== 'grass' && cfg.kind !== 'decor';
      v.parts.forEach((part, pi) => {
        const mat = variantMaterial(part.material, opts);
        const key = id + '#' + v.index + '#' + pi + '#' + mat.uuid;
        let b = chunk._ib.get(key);
        if (!b) { b = { geometry: part.geometry, material: mat, cast, matrices: [], mesh: null }; chunk._ib.set(key, b); }
        const M = new T.Matrix4().multiplyMatrices(_m4, part.matrix);
        b.matrices.push(M);
        refs.push({ b, i: b.matrices.length - 1 });
      });
      return { refs, foot, h: sz.y * s, y: height(x, z), cfg, id };
    }
    function addDestructible(res, x, z, type, hp) {
      if (!res) return;
      const cfg = res.cfg;
      const r = Math.max(0.5, res.foot * (cfg.r || 0.4));
      const H = Math.round(hp * (cfg.hp || 1));
      const d = { x, z, r, type, hp: H, maxHp: H, geos: [], inst: res.refs, dead: false, y: res.y, model: res.id, height: res.h };
      chunk.destructibles.push(d);
      chunk.colliders.push(d);
      return d;
    }

    // ---- TREES: groves + a few loners -----------------------------------------------
    const leafy = /Forest|Swamp|Autumn|Sakura|Frozen/.test(biome.name);
    const openness = leafy ? 0.7 : 0.45;
    const groveSpots = [];
    if (treeSet.length) {
      const groves = rnd() < openness ? 1 + Math.floor(rnd() * (leafy ? 3 : 2)) : 0;
      for (let gI = 0; gI < groves; gI++) {
        const gx = ox + 8 + rnd() * (size - 16), gz = oz + 8 + rnd() * (size - 16);
        groveSpots.push([gx, gz]);
        const n = 3 + Math.floor(rnd() * (leafy ? 5 : 3));
        const main = pickWeighted(treeSet, rnd);
        for (let t = 0; t < n; t++) {
          const a = rnd() * Math.PI * 2, d = 1.5 + rnd() * rnd() * 12;
          const x = gx + Math.cos(a) * d, z = gz + Math.sin(a) * d;
          if (!safe(x, z, 26) || !free(x, z, 2.2)) continue;
          const e = rnd() < 0.75 ? main : pickWeighted(treeSet, rnd);
          taken.push([x, z, 2.2]);
          ops.push(() => {
            const res = place(e, x, z);
            if (res) addDestructible(res, x, z, 'tree', 14 + res.h * 2.2);
          });
        }
      }
      const loners = Math.floor(rnd() * 3);
      for (let i = 0; i < loners; i++) {
        const x = ox + rnd() * size, z = oz + rnd() * size;
        if (!safe(x, z, 26) || !free(x, z, 2.5)) continue;
        const e = pickWeighted(treeSet, rnd);
        taken.push([x, z, 2.5]);
        ops.push(() => { const res = place(e, x, z); if (res) addDestructible(res, x, z, 'tree', 14 + res.h * 2.2); });
      }
    }

    // ---- ROCKS: clusters (one big + satellites) + rare cliff -------------------------
    const rockSpots = [];
    if (rockSet.length) {
      const clusters = Math.max(1, Math.round((biome.rockCount || 20) * (size * size) / (136 * 136) * 3.2 * (0.6 + rnd() * 0.8) / 3));
      for (let c = 0; c < clusters; c++) {
        const cx = ox + 4 + rnd() * (size - 8), cz = oz + 4 + rnd() * (size - 8);
        if (!safe(cx, cz, 20)) continue;
        rockSpots.push([cx, cz]);
        const n = 1 + Math.floor(rnd() * 3);
        for (let k = 0; k < n; k++) {
          const a = rnd() * Math.PI * 2, d = k === 0 ? 0 : 1.8 + rnd() * 2.5;
          const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
          const sc = k === 0 ? 1 : 0.45 + rnd() * 0.35;
          if (!free(x, z, 1.4 * sc)) continue;
          taken.push([x, z, 1.6 * sc]);
          const e = pickWeighted(rockSet, rnd);
          ops.push(() => {
            const res = place(e, x, z, { scale: sc });
            if (res) addDestructible(res, x, z, 'rock', 10 + res.foot * res.h * 3);
          });
        }
      }
    }
    if (bigSet.length && rnd() < 0.16) {
      const e = pickWeighted(bigSet, rnd);
      const x = ox + 14 + rnd() * (size - 28), z = oz + 14 + rnd() * (size - 28);
      if (safe(x, z, 40) && free(x, z, 9)) {
        taken.push([x, z, 9]);
        ops.push(() => {
          const res = place(e, x, z, { align: true });
          if (!res) return;
          // a long cliff: three colliders along its length share one HP pool
          const d = addDestructible(res, x, z, 'rock', 600);
          d.r = Math.min(4.5, res.foot * 0.2);
        });
      }
    }

    // ---- DEAD WOOD: fallen trunks, stumps, roots, branches ---------------------------
    if (woodSet.length) {
      const n = 1 + Math.floor(rnd() * (leafy ? 4 : 2));
      for (let i = 0; i < n; i++) {
        const near = groveSpots.length && rnd() < 0.7 ? groveSpots[Math.floor(rnd() * groveSpots.length)] : null;
        const a = rnd() * Math.PI * 2, d = near ? 6 + rnd() * 8 : 0;
        const x = near ? near[0] + Math.cos(a) * d : ox + rnd() * size, z = near ? near[1] + Math.sin(a) * d : oz + rnd() * size;
        if (!safe(x, z, 22) || !free(x, z, 2)) continue;
        taken.push([x, z, 2.4]);
        const e = pickWeighted(woodSet, rnd);
        ops.push(() => {
          const res = place(e, x, z);
          if (!res) return;
          const k = res.cfg.kind;
          if (k === 'log') addDestructible(res, x, z, 'tree', 22);
          else if (k === 'stump') addDestructible(res, x, z, 'tree', 14);
        });
      }
    }

    // ---- PLANTS: hug trees and rocks, plus some scattered ----------------------------
    if (plantSet.length) {
      const anchors = groveSpots.concat(rockSpots);
      const n = 6 + Math.floor(rnd() * 12);
      for (let i = 0; i < n; i++) {
        const an = anchors.length && rnd() < 0.65 ? anchors[Math.floor(rnd() * anchors.length)] : null;
        const a = rnd() * Math.PI * 2, d = an ? 2 + rnd() * 9 : 0;
        const x = an ? an[0] + Math.cos(a) * d : ox + rnd() * size, z = an ? an[1] + Math.sin(a) * d : oz + rnd() * size;
        if (!safe(x, z, 14) || x < ox || x > ox + size || z < oz || z > oz + size) continue;
        const e = pickWeighted(plantSet, rnd);
        ops.push(() => place(e, x, z));
      }
    }

    // ---- GRASS clumps (GLB grass replaces the old cones) ------------------------------
    if (grassSet.length && (biome.grassCount || 0) > 0) {
      const e = grassSet[0];
      const mul = be.grassMul != null ? be.grassMul : 1;
      const clumps = Math.round(Math.min(90, (biome.grassCount || 0) * (size * size) / (136 * 136) * 0.9) * mul);
      const tint = be.grassTint;
      ops.push(() => {
        for (let i = 0; i < clumps; i++) {
          const x = ox + rnd() * size, z = oz + rnd() * size;
          if (!safe(x, z, 8)) continue;
          place([e[0], 1, { tint }], x, z, { scale: 0.7 + rnd() * 0.6 });
        }
      });
    }

    // ---- PROPS: small supply camps (barrels, crates, barriers) -----------------------
    if (propSet.length && rnd() < 0.42) {
      const cx = ox + 8 + rnd() * (size - 16), cz = oz + 8 + rnd() * (size - 16);
      if (safe(cx, cz, 30) && free(cx, cz, 3.5)) {
        taken.push([cx, cz, 4]);
        const n = 2 + Math.floor(rnd() * 4);
        const baseYaw = rnd() * Math.PI * 2;
        for (let i = 0; i < n; i++) {
          const a = baseYaw + i * 1.3 + rnd() * 0.4, d = i === 0 ? 0 : 1.3 + rnd() * 1.6;
          const x = cx + Math.cos(a) * d, z = cz + Math.sin(a) * d;
          const e = pickWeighted(propSet, rnd);
          ops.push(() => {
            const res = place(e, x, z, { align: true });
            if (!res) return;
            const k = res.cfg.kind;
            const hp = k === 'barrier' ? 26 : k === 'crate' ? 8 : 4;
            addDestructible(res, x, z, k, hp);
          });
        }
      }
    }
    return true;
  }

  /** Turns the planned instance buckets into InstancedMeshes (added to chunk.meshes). */
  function commitChunk(chunk) {
    if (!chunk._ib) return;
    for (const b of chunk._ib.values()) {
      if (!b.matrices.length) continue;
      const m = new T.InstancedMesh(b.geometry, b.material, b.matrices.length);
      for (let i = 0; i < b.matrices.length; i++) m.setMatrixAt(i, b.matrices[i]);
      m.instanceMatrix.needsUpdate = true;
      m.castShadow = b.cast; m.receiveShadow = true;
      m.computeBoundingSphere();
      m.frustumCulled = true;
      b.mesh = m;
      chunk.meshes.push(m);
    }
  }

  /** Hides a destroyed instanced prop. */
  function hideInstances(dst) {
    if (!dst.inst) return;
    for (const r of dst.inst) {
      r.b.matrices[r.i] = ZERO;
      if (r.b.mesh) { r.b.mesh.setMatrixAt(r.i, ZERO); r.b.mesh.instanceMatrix.needsUpdate = true; }
    }
  }

  window.World = { LIGHT, groundMaterial, groundBlend, applyEnvironment, planChunk, commitChunk, hideInstances, envReady, variantMaterial };
})();
