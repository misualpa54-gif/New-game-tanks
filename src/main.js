/* ============================================================================
 * main.js — boot, screens, settings. Contains NO bare 'three' import so a dead
 * CDN can be detected here and failed over to the next provider.
 * ==========================================================================*/

const BOOT = window.IRONVERGE_BOOT || {};
const $ = (id) => document.getElementById(id);

const TIPS = [
  'Hold LEFT + RIGHT together to brake hard and turn on the spot.',
  'The turret auto-locks the best target in front of you — keep enemies ahead.',
  'Firing too fast overheats the barrel. Grab blue COOLANT caches.',
  'Ram small creatures at full speed. Big ones will stop you dead.',
  'Shoot fuel barrels near enemies for chain explosions.',
  'Lava pools in volcanic lands burn your tracks — steer around them.',
  'Every 5th wave a boss arrives: the Ember Wyrm or the Obsidian Titan.',
  'Water slows the tank to a crawl. Deep lakes are for fording, not fighting.'
];

/* ---------------- settings ---------------- */
function detectQuality() {
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);
  const mem = navigator.deviceMemory || 4;
  const cores = navigator.hardwareConcurrency || 4;
  if (mobile && (mem <= 3 || cores <= 4)) return 'low';
  if (mobile) return 'medium';
  return mem >= 8 && cores >= 8 ? 'high' : 'medium';
}

function loadSettings() {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('ironverge.settings') || '{}'); } catch (e) { s = {}; }
  const q = new URLSearchParams(location.search).get('quality');
  return {
    quality: q || s.quality || detectQuality(),
    camHeight: s.camHeight || 28,
    aim: s.aim || 'assist',
    sound: s.sound || 'on',
    shake: s.shake || 'on'
  };
}
function saveSettings(s) { try { localStorage.setItem('ironverge.settings', JSON.stringify(s)); } catch (e) { /* */ } }

/* ---------------- screens ---------------- */
function show(id) {
  for (const s of ['loading', 'menu', 'pause', 'over', 'fatal']) $(s).classList.toggle('hidden', s !== id);
}
function hideAll() { for (const s of ['loading', 'menu', 'pause', 'over', 'fatal']) $(s).classList.add('hidden'); }

let logLines = [];
function progress(k, msg) {
  $('loadFill').style.width = Math.round(k * 100) + '%';
  $('loadPct').textContent = Math.round(k * 100) + '%';
  $('loadStage').textContent = msg;
  logLines.push(msg);
  if (logLines.length > 4) logLines.shift();
  $('loadLog').textContent = logLines.join('\n');
}

function fatal(msg) {
  show('fatal');
  $('fatalMsg').textContent = msg;
  const pick = $('cdnPick');
  pick.innerHTML = '';
  (BOOT.providers || []).forEach((p, i) => {
    const o = document.createElement('option');
    o.value = p.id; o.textContent = p.label; if (i === BOOT.providerIndex) o.selected = true;
    pick.appendChild(o);
  });
  $('btnRetry').onclick = () => {
    const u = new URL(location.href);
    u.searchParams.set('cdn', pick.value);
    try { localStorage.removeItem('ironverge.cdn.bad'); } catch (e) { /* */ }
    location.href = u.toString();
  };
}

function statsHTML(s) {
  const mins = Math.floor(s.time / 60), secs = Math.floor(s.time % 60);
  const dist = s.distance >= 1000 ? (s.distance / 1000).toFixed(2) + ' km' : Math.floor(s.distance) + ' m';
  return `<div><span>SCORE</span><b>${s.score.toLocaleString()}</b></div>
          <div><span>WAVE</span><b>${s.wave}</b></div>
          <div><span>KILLS</span><b>${s.kills}</b></div>
          <div><span>DISTANCE</span><b>${dist}</b></div>
          <div><span>TIME</span><b>${mins}:${String(secs).padStart(2, '0')}</b></div>`;
}

/* ---------------- boot ---------------- */
async function boot() {
  const settings = loadSettings();
  let tipI = Math.floor(Math.random() * TIPS.length);
  $('tipTxt').textContent = 'Tip: ' + TIPS[tipI];
  const tipTimer = setInterval(() => { tipI = (tipI + 1) % TIPS.length; $('tipTxt').textContent = 'Tip: ' + TIPS[tipI]; }, 3800);

  // quick WebGL sanity check
  const test = document.createElement('canvas');
  if (!(test.getContext('webgl2') || test.getContext('webgl'))) {
    fatal('Your browser/device does not support WebGL. Try Chrome, Safari or Firefox with hardware acceleration enabled.');
    return;
  }

  progress(0.02, `Loading three.js r${(BOOT.threeVersion || '').split('.')[1] || ''} from ${BOOT.provider ? BOOT.provider.label : 'CDN'}`);
  let mod;
  try {
    mod = await import('./game.js');
  } catch (err) {
    console.error(err);
    if (BOOT.failover && BOOT.failover(err && err.message)) { progress(0.02, 'CDN unreachable — switching provider…'); return; }
    fatal('Could not load the 3D engine from any CDN. Check your connection and retry. (' + (err && err.message) + ')');
    return;
  }
  if (BOOT.commit) BOOT.commit();

  const game = new mod.Game($('gl'), settings);
  window.IRONVERGE = game;   // handy for debugging: IRONVERGE.debugStats()
  try {
    await game.init(progress);
  } catch (err) {
    console.error(err);
    fatal('Engine failed to start: ' + (err && err.message));
    return;
  }
  clearInterval(tipTimer);

  /* ---- menu ---- */
  const refreshBest = () => { $('bestScore').textContent = game.best.score.toLocaleString(); $('bestWave').textContent = game.best.wave; };
  refreshBest();
  $('setQuality').value = settings.quality;
  $('setCam').value = settings.camHeight;
  $('setAim').value = settings.aim;
  $('setSound').value = settings.sound;
  $('setShake').value = settings.shake;
  $('creditsBody').textContent = `three.js ${BOOT.threeVersion} via ${BOOT.provider.label} · sky: ${game.sky.mode} · ` +
    `${game.models.stats.loaded} glTF models streamed (${game.models.stats.failed} fell back to procedural) · ` +
    `${game.lib.real.length} CDN texture maps`;

  $('setQuality').onchange = (e) => { settings.quality = e.target.value; saveSettings(settings); location.reload(); };
  $('setCam').oninput = (e) => { settings.camHeight = +e.target.value; saveSettings(settings); };
  $('setAim').onchange = (e) => { settings.aim = e.target.value; saveSettings(settings); };
  $('setSound').onchange = (e) => { settings.sound = e.target.value; saveSettings(settings); game.audio.setEnabled(settings.sound !== 'off'); syncSoundBtn(); };
  $('setShake').onchange = (e) => { settings.shake = e.target.value; saveSettings(settings); };

  const syncSoundBtn = () => $('btnSound').classList.toggle('off', settings.sound === 'off');
  syncSoundBtn();

  const deploy = () => {
    game.audio.unlock();
    game.audio.play('click');
    hideAll();
    game.startRun();
    tryFullscreen();
  };
  $('btnPlay').onclick = deploy;
  $('btnAgain').onclick = deploy;
  $('btnRestart').onclick = deploy;
  $('btnResume').onclick = () => { hideAll(); game.resume(); };
  $('btnQuit').onclick = () => { game.quitToMenu(); refreshBest(); show('menu'); };
  $('btnOverMenu').onclick = () => { game.quitToMenu(); refreshBest(); show('menu'); };
  $('btnPause').onclick = () => game.pause();
  $('btnSound').onclick = () => {
    settings.sound = settings.sound === 'off' ? 'on' : 'off';
    $('setSound').value = settings.sound;
    saveSettings(settings);
    game.audio.unlock();
    game.audio.setEnabled(settings.sound !== 'off');
    syncSoundBtn();
  };

  game.on('pause', (s) => { $('pauseStats').innerHTML = statsHTML(s); show('pause'); });
  game.on('resume', () => hideAll());
  game.on('gameover', (s) => {
    $('overStats').innerHTML = statsHTML(s) + (s.newBest ? '<div class="nb">NEW BEST!</div>' : '');
    $('overTag').textContent = `Destroyed by ${s.source || 'the wilds'} on wave ${s.wave}.`;
    refreshBest();
    show('over');
  });

  // auto-pause when the app goes to background
  document.addEventListener('visibilitychange', () => { if (document.hidden) game.pause(); });

  show('menu');
}

function tryFullscreen() {
  const mobile = navigator.maxTouchPoints > 1;
  if (!mobile) return;
  const el = document.documentElement;
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req && !document.fullscreenElement) {
    try {
      const p = req.call(el, { navigationUI: 'hide' });
      if (p && p.then) p.then(() => { try { screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}); } catch (e) { /* */ } }).catch(() => {});
    } catch (e) { /* iOS Safari */ }
  }
}

boot();
