/* ============================================================================
 * TANK REALMS: REFORGED — boot (ES module)
 *  1. loads three.js r186 + GLTFLoader / HDRLoader / SkeletonUtils from the CDN
 *  2. exposes them as window.THREE for the classic game scripts
 *  3. loads the asset library, preloads realm 1 + the first creatures (progress bar)
 *  4. starts the original Tank Realms game code (js/game.js)
 *  5. keeps streaming the other realms' assets in the background
 * ==========================================================================*/
const BOOT = window.TRR_BOOT;
const bar = document.getElementById('boot-bar');
const stage = document.getElementById('boot-stage');
const setStage = (t) => { if (stage) stage.textContent = t; };
const setBar = (k) => { if (bar) bar.style.width = Math.round(Math.max(0, Math.min(1, k)) * 100) + '%'; };

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = resolve;
    s.onerror = () => reject(new Error('failed to load ' + src));
    document.body.appendChild(s);
  });
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

async function boot() {
  setStage('Loading 3D engine (three.js r186)…');
  let NS, GLTF, HDR, SKU;
  try {
    [NS, GLTF, HDR, SKU] = await Promise.all([
      import('three'),
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/loaders/HDRLoader.js'),
      import('three/addons/utils/SkeletonUtils.js'),
    ]);
  } catch (err) {
    console.error(err);
    if (BOOT && BOOT.failover('import failed')) { setStage('Engine CDN unavailable — trying another…'); return; }
    setStage('Could not load the 3D engine. Check your internet connection and reload.');
    return;
  }
  if (BOOT) BOOT.commit();
  const T = Object.assign({}, NS);                  // module namespaces are frozen — make a mutable copy
  T.GLTFLoader = GLTF.GLTFLoader;
  T.HDRLoader = HDR.HDRLoader;
  T.SkeletonUtils = SKU;
  window.THREE = T;
  setBar(0.08);

  setStage('Loading realm assets…');
  await loadScript('js/assets.js');
  await loadScript('js/world.js');
  await loadScript('js/creatures.js');

  const A = window.Assets;
  A.onProgress((done, pending) => { setBar(0.08 + 0.87 * (pending ? done / pending : 1)); setStage('Loading realm assets… ' + done + ' / ' + pending); });
  // realm 1 scenery + the first creatures; never block longer than 35 s (procedural fallback)
  const first = Promise.all([A.ensureBiome(0), window.Creatures.preload(1, true)]);
  await Promise.race([first, wait(35000)]);
  // textures are tracked by the progress counter too — give them a moment to finish
  const t0 = performance.now();
  while (A.progress.done < A.progress.pending && performance.now() - t0 < 12000) await wait(100);

  setStage('Starting…');
  setBar(1);
  await loadScript('js/game.js');
  const ov = document.getElementById('boot-overlay');
  if (ov) { ov.classList.add('done'); setTimeout(() => ov.remove(), 600); }

  // background streaming: remaining realms (one at a time), then all creature models
  const BIOME_COUNT = A.BIOME_ENV.length;
  for (let k = 1; k <= BIOME_COUNT; k++) {
    const i = k % BIOME_COUNT;
    await A.ensureBiome(i);
    refreshProceduralChunks(i);
  }
  window.Creatures.preload(99);
}

// if a realm was entered before its models arrived, swap its procedural chunks for GLB ones
function refreshProceduralChunks(biomeIdx) {
  try {
    if (typeof state === 'undefined' || state.currentBiome !== biomeIdx) return;
    if (!window.World || !window.World.envReady(biomeIdx)) return; // all models failed → keep the procedural look
    if (typeof envChunks === 'undefined' || typeof buildChunkTask !== 'function') return;
    for (const [key, ch] of envChunks) {
      if (ch._ib) continue;
      const p = key.split(',');
      buildChunkTask(+p[0], +p[1], false, true);
    }
  } catch (e) { /* non-fatal */ }
}
// the game may start in a realm whose models are still streaming (saved runs, fast realm hops)
setInterval(() => {
  try { if (typeof state !== 'undefined' && window.Assets && window.Assets.biomeReady(state.currentBiome)) refreshProceduralChunks(state.currentBiome); } catch (e) {}
}, 4000);

boot();
