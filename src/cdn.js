/* ============================================================================
 * IRONVERGE — CDN bootstrap  (CLASSIC script, runs before any ES module)
 * ---------------------------------------------------------------------------
 * Everything in this game is streamed from public CDNs. This file:
 *   1. picks a three.js provider (jsDelivr → unpkg → local ./vendor copy)
 *   2. injects the matching <script type="importmap"> BEFORE the first module
 *      resolves a bare specifier (required by the HTML spec)
 *   3. publishes the mirror list used by the asset loader (models / textures)
 *   4. handles fail-over: if a provider dies, the next one is tried on reload
 * ==========================================================================*/
(function () {
  'use strict';

  var THREE_VERSION = '0.186.1';   // latest three.js release (pinned)
  var THREE_TAG = 'r186';          // matching git tag for example assets

  // npm-package based providers: they all ship build/three.module.js + examples/jsm/*
  var PROVIDERS = [
    {
      id: 'jsdelivr',
      label: 'jsDelivr (npm)',
      base: 'https://cdn.jsdelivr.net/npm/three@' + THREE_VERSION,
      core: '/build/three.module.js',
      addons: '/examples/jsm/'
    },
    {
      id: 'unpkg',
      label: 'unpkg (npm)',
      base: 'https://unpkg.com/three@' + THREE_VERSION,
      core: '/build/three.module.js',
      addons: '/examples/jsm/'
    },
    {
      id: 'local',
      label: 'local ./vendor',
      base: './vendor/three',
      core: '/build/three.module.js',
      addons: '/examples/jsm/'
    }
  ];

  /* GitHub-hosted free asset mirrors (three.js examples: models, HDRIs, PBR maps).
     Order matters — the first one that answers is remembered for the session. */
  var ASSET_MIRRORS = [
    'https://cdn.jsdelivr.net/gh/mrdoob/three.js@' + THREE_TAG + '/examples/',
    'https://cdn.statically.io/gh/mrdoob/three.js/' + THREE_TAG + '/examples/',
    'https://rawcdn.githack.com/mrdoob/three.js/' + THREE_TAG + '/examples/',
    'https://raw.githack.com/mrdoob/three.js/' + THREE_TAG + '/examples/'
  ];

  /* extra CC0 texture house (Poly Haven) — optional, always has a procedural fallback */
  var POLYHAVEN = 'https://dl.polyhaven.org/file/ph-assets/';

  var KEY = 'ironverge.cdn';
  var BAD = 'ironverge.cdn.bad';

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

  function badList() {
    try { return JSON.parse(lsGet(BAD) || '[]'); } catch (e) { return []; }
  }

  function pickIndex() {
    var bad = badList();
    // explicit ?cdn=<id|index> wins
    var q = new URLSearchParams(location.search).get('cdn');
    if (q !== null) {
      var byId = PROVIDERS.findIndex(function (p) { return p.id === q; });
      var idx = byId >= 0 ? byId : parseInt(q, 10);
      if (!isNaN(idx) && PROVIDERS[idx]) return idx;
    }
    var saved = parseInt(lsGet(KEY) || '0', 10);
    if (!isNaN(saved) && PROVIDERS[saved] && bad.indexOf(PROVIDERS[saved].id) === -1) return saved;
    for (var i = 0; i < PROVIDERS.length; i++) {
      if (bad.indexOf(PROVIDERS[i].id) === -1) return i;
    }
    return 0; // everything failed → try the primary once more
  }

  var index = pickIndex();
  var provider = PROVIDERS[index];

  var coreURL = provider.base + provider.core;
  var addonsURL = provider.base + provider.addons;

  /* ---- inject the import map (must happen before the first module load) ---- */
  var map = {
    imports: {
      'three': coreURL,
      'three/addons/': addonsURL,
      // referenced by a few r186 addons (never loaded by this game)
      'three/webgpu': provider.base + '/build/three.webgpu.js',
      'three/tsl': provider.base + '/build/three.tsl.js'
    }
  };
  var el = document.createElement('script');
  el.type = 'importmap';
  el.textContent = JSON.stringify(map);
  document.head.appendChild(el);

  /* ---- public boot record consumed by the ES modules ---- */
  window.IRONVERGE_BOOT = {
    version: '1.0.0',
    threeVersion: THREE_VERSION,
    threeTag: THREE_TAG,
    providers: PROVIDERS,
    providerIndex: index,
    provider: provider,
    importMap: map,
    assetMirrors: ASSET_MIRRORS,
    polyHaven: POLYHAVEN,
    /** mark the active provider as broken and reload on the next one */
    failover: function (reason) {
      var bad = badList();
      if (bad.indexOf(provider.id) === -1) bad.push(provider.id);
      lsSet(BAD, JSON.stringify(bad));
      var next = -1;
      for (var i = 0; i < PROVIDERS.length; i++) {
        if (bad.indexOf(PROVIDERS[i].id) === -1) { next = i; break; }
      }
      if (next === -1) { // all dead → reset and give up to the UI
        lsSet(BAD, '[]');
        return false;
      }
      lsSet(KEY, String(next));
      console.warn('[IRONVERGE] CDN "' + provider.id + '" unavailable (' + reason + ') → retrying with "' + PROVIDERS[next].id + '"');
      // drop an explicit ?cdn= override, otherwise we would reload into the same dead provider forever
      setTimeout(function () {
        var u = new URL(location.href);
        if (u.searchParams.has('cdn')) { u.searchParams.delete('cdn'); location.replace(u.toString()); }
        else location.reload();
      }, 60);
      return true;
    },
    /** remember a working provider so the next visit skips the dead ones */
    commit: function () {
      lsSet(KEY, String(index));
      lsSet(BAD, '[]');
    }
  };

  /* tiny status line so a stuck load is never a mystery */
  window.addEventListener('error', function (e) {
    var st = document.getElementById('loadStage');
    if (st && e && e.message && /import|module|Failed to fetch|three/i.test(e.message)) {
      st.textContent = 'Engine load problem: ' + e.message;
    }
  });
})();
