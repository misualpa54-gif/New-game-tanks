/* ============================================================================
 * TANK REALMS: REFORGED — CDN bootstrap (CLASSIC script, runs before any module)
 * ---------------------------------------------------------------------------
 *  1. picks a three.js provider (jsDelivr → unpkg → local ../vendor copy)
 *  2. injects the <script type="importmap"> before the first module loads
 *  3. fail-over: if a provider is down, the next one is tried on reload
 * Game assets (GLB models, PBR textures, HDRIs) are bundled in ./assets.
 * ==========================================================================*/
(function () {
  'use strict';
  var THREE_VERSION = '0.186.1'; // latest three.js release (pinned)
  var PROVIDERS = [
    { id: 'jsdelivr', base: 'https://cdn.jsdelivr.net/npm/three@' + THREE_VERSION },
    { id: 'unpkg', base: 'https://unpkg.com/three@' + THREE_VERSION },
    { id: 'local', base: '../vendor/three' }
  ];
  var KEY = 'trr.cdn', BAD = 'trr.cdn.bad';
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function badList() { try { return JSON.parse(lsGet(BAD) || '[]'); } catch (e) { return []; } }

  function pickIndex() {
    var bad = badList();
    var q = new URLSearchParams(location.search).get('cdn');
    if (q !== null) {
      var byId = PROVIDERS.findIndex(function (p) { return p.id === q; });
      var idx = byId >= 0 ? byId : parseInt(q, 10);
      if (!isNaN(idx) && PROVIDERS[idx]) return idx;
    }
    var saved = parseInt(lsGet(KEY) || '0', 10);
    if (!isNaN(saved) && PROVIDERS[saved] && bad.indexOf(PROVIDERS[saved].id) === -1) return saved;
    for (var i = 0; i < PROVIDERS.length; i++) if (bad.indexOf(PROVIDERS[i].id) === -1) return i;
    return 0;
  }
  var index = pickIndex();
  var provider = PROVIDERS[index];
  var map = { imports: {
    'three': provider.base + '/build/three.module.js',
    'three/addons/': provider.base + '/examples/jsm/',
    'three/webgpu': provider.base + '/build/three.webgpu.js',
    'three/tsl': provider.base + '/build/three.tsl.js'
  } };
  var el = document.createElement('script');
  el.type = 'importmap';
  el.textContent = JSON.stringify(map);
  document.head.appendChild(el);

  window.TRR_BOOT = {
    threeVersion: THREE_VERSION, provider: provider, providers: PROVIDERS,
    failover: function (reason) {
      var bad = badList();
      if (bad.indexOf(provider.id) === -1) bad.push(provider.id);
      lsSet(BAD, JSON.stringify(bad));
      var next = -1;
      for (var i = 0; i < PROVIDERS.length; i++) if (bad.indexOf(PROVIDERS[i].id) === -1) { next = i; break; }
      if (next === -1) { lsSet(BAD, '[]'); return false; }
      lsSet(KEY, String(next));
      console.warn('[TRR] CDN "' + provider.id + '" unavailable (' + reason + ') → trying "' + PROVIDERS[next].id + '"');
      setTimeout(function () {
        var u = new URL(location.href);
        if (u.searchParams.has('cdn')) { u.searchParams.delete('cdn'); location.replace(u.toString()); } else location.reload();
      }, 60);
      return true;
    },
    commit: function () { lsSet(KEY, String(index)); lsSet(BAD, '[]'); }
  };
})();
