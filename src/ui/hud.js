/* ============================================================================
 * ui/hud.js — DOM HUD + 2D overlay (health bars, damage numbers, radar,
 * off-screen threat arrows). The overlay is a single canvas redrawn each
 * frame, which is far cheaper on mobile than hundreds of DOM nodes.
 * ==========================================================================*/
import * as THREE from 'three';
import { clamp, clamp01, formatDistance, formatNumber } from '../core/util.js';

const $ = (id) => document.getElementById(id);
const _p = new THREE.Vector3();

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), hullFill: $('hullFill'), hullTxt: $('hullTxt'), heatFill: $('heatFill'), heatTxt: $('heatTxt'),
      shieldChip: $('chipShield'), shieldTxt: $('shieldTxt'), overChip: $('chipOver'), overTxt: $('overTxt'),
      waveNum: $('waveNum'), waveLabel: $('waveLabel'), scoreNum: $('scoreNum'), comboNum: $('comboNum'),
      killNum: $('killNum'), distNum: $('distNum'), killfeed: $('killfeed'),
      bossBar: $('bossBar'), bossName: $('bossName'), bossFill: $('bossFill'),
      radar: $('radar'), fireCd: $('fireCd'), flash: $('flash'), lowHp: $('lowHp'), btnFire: $('btnFire')
    };
    this.radarCtx = this.el.radar.getContext('2d');

    this.overlay = document.createElement('canvas');
    this.overlay.id = 'overlay';
    this.el.hud.insertBefore(this.overlay, this.el.hud.firstChild);
    this.octx = this.overlay.getContext('2d');
    this.floaters = [];
    this.banner = null;
    this.dpr = 1;
    this._cache = {};
    this.resize();
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); this.el.hud.setAttribute('aria-hidden', v ? 'false' : 'true'); }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.overlay.width = Math.round(window.innerWidth * this.dpr);
    this.overlay.height = Math.round(window.innerHeight * this.dpr);
  }

  set(key, el, value, prop = 'textContent') {
    if (this._cache[key] === value) return;
    this._cache[key] = value;
    el[prop] = value;
  }

  flash(color = 'rgba(255,60,40,0.35)', ms = 160) {
    const f = this.el.flash;
    f.style.background = color;
    f.style.opacity = '1';
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => { f.style.opacity = '0'; }, ms);
  }

  feed(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'feed ' + cls;
    d.textContent = text;
    this.el.killfeed.prepend(d);
    while (this.el.killfeed.children.length > 4) this.el.killfeed.lastChild.remove();
    setTimeout(() => d.classList.add('out'), 2200);
    setTimeout(() => d.remove(), 2800);
  }

  showBanner(title, sub = '', color = '#ffd36a', dur = 2.4) {
    this.banner = { title, sub, color, t: 0, dur };
  }

  /** world-anchored floating text */
  floatText(pos, text, color = '#fff', size = 22, life = 0.9) {
    if (this.floaters.length > 40) this.floaters.shift();
    this.floaters.push({ x: pos.x, y: pos.y, z: pos.z, text, color, size, life, max: life, vy: 2.4 });
  }

  update(dt, g) {
    const p = g.player;
    const e = this.el;
    const hpK = clamp01(p.hp / p.maxHp);
    this.set('hullW', e.hullFill.style, (hpK * 100).toFixed(1) + '%', 'width');
    this.set('hullT', e.hullTxt, String(Math.ceil(p.hp)));
    e.hullFill.classList.toggle('crit', hpK < 0.3);
    const heatK = clamp01(p.heat / 100);
    this.set('heatW', e.heatFill.style, (heatK * 100).toFixed(1) + '%', 'width');
    this.set('heatT', e.heatTxt, p.overheated > 0 ? 'OVERHEAT' : heatK > 0.75 ? 'HOT' : 'READY');
    e.heatFill.classList.toggle('over', p.overheated > 0);
    e.shieldChip.classList.toggle('on', p.shield > 0);
    e.overChip.classList.toggle('on', p.overdrive > 0);
    this.set('sh', e.shieldTxt, Math.ceil(p.shield) + 's');
    this.set('od', e.overTxt, Math.ceil(p.overdrive) + 's');
    this.set('wave', e.waveNum, String(g.wave));
    this.set('score', e.scoreNum, formatNumber(g.score));
    this.set('combo', e.comboNum, g.combo > 1 ? ' ×' + g.combo : '');
    this.set('kills', e.killNum, g.kills + ' KILLS');
    this.set('dist', e.distNum, formatDistance(p.distance));
    e.lowHp.style.opacity = hpK < 0.3 ? String(0.35 + Math.sin(g.time * 6) * 0.25) : '0';

    // fire button cooldown ring
    const cdK = p.overheated > 0 ? 1 : clamp01(p.cooldown / 0.34);
    this.set('cd', e.fireCd.style, `conic-gradient(rgba(255,120,60,.55) ${cdK * 360}deg, transparent 0)`, 'background');
    e.btnFire.classList.toggle('locked', !!p.locked);
    e.btnFire.classList.toggle('hot', p.overheated > 0);

    // boss
    const boss = g.enemies.boss;
    e.bossBar.classList.toggle('hidden', !boss);
    if (boss) {
      this.set('bossN', e.bossName, boss.name.toUpperCase() + (boss.enraged ? ' — ENRAGED' : ''));
      this.set('bossW', e.bossFill.style, (clamp01(boss.hp / boss.maxHp) * 100).toFixed(1) + '%', 'width');
    }

    this.drawRadar(g);
    this.drawOverlay(dt, g);
  }

  drawRadar(g) {
    const ctx = this.radarCtx, W = ctx.canvas.width, H = ctx.canvas.height;
    const cx = W / 2, cy = H / 2, R = W / 2 - 4;
    const range = 110;
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.clip();
    ctx.fillStyle = 'rgba(8,18,14,0.55)'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(120,255,180,0.18)'; ctx.lineWidth = 1;
    for (const r of [0.33, 0.66, 1]) { ctx.beginPath(); ctx.arc(cx, cy, R * r, 0, Math.PI * 2); ctx.stroke(); }
    // sweep
    const sweep = (g.time * 1.6) % (Math.PI * 2);
    const grad = ctx.createConicGradient ? ctx.createConicGradient(sweep, cx, cy) : null;
    if (grad) {
      grad.addColorStop(0, 'rgba(120,255,180,0.28)'); grad.addColorStop(0.12, 'rgba(120,255,180,0)'); grad.addColorStop(1, 'rgba(120,255,180,0)');
      ctx.fillStyle = grad; ctx.fillRect(0, 0, W, H);
    }
    const p = g.player;
    const cos = Math.cos(p.yaw), sin = Math.sin(p.yaw);
    const plot = (x, z) => {
      const dx = x - p.pos.x, dz = z - p.pos.z;
      // rotate so the tank always points up
      const rx = -(dx * cos - dz * sin), rz = dx * sin + dz * cos;
      return [cx + (rx / range) * R, cy - (rz / range) * R];
    };
    for (const pk of g.pickups.list) {
      const [x, y] = plot(pk.pos.x, pk.pos.z);
      ctx.fillStyle = '#' + pk.def.color.toString(16).padStart(6, '0');
      ctx.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const e of g.enemies.list) {
      if (!e.alive || e.dying) continue;
      let [x, y] = plot(e.pos.x, e.pos.z);
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy);
      if (d > R - 4) { x = cx + dx / d * (R - 4); y = cy + dy / d * (R - 4); }
      ctx.fillStyle = e.spec.boss ? '#ff3b6b' : e.flying ? '#ffd36a' : '#ff5a3a';
      ctx.beginPath(); ctx.arc(x, y, e.spec.boss ? 6 : 3.2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    // player chevron
    ctx.fillStyle = '#9dffc8';
    ctx.beginPath(); ctx.moveTo(cx, cy - 8); ctx.lineTo(cx + 6, cy + 6); ctx.lineTo(cx, cy + 3); ctx.lineTo(cx - 6, cy + 6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(160,255,200,0.5)'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  }

  project(x, y, z, camera) {
    _p.set(x, y, z).project(camera);
    return { x: (_p.x * 0.5 + 0.5) * this.overlay.width, y: (-_p.y * 0.5 + 0.5) * this.overlay.height, behind: _p.z > 1 };
  }

  drawOverlay(dt, g) {
    const ctx = this.octx, W = this.overlay.width, H = this.overlay.height, s = this.dpr;
    ctx.clearRect(0, 0, W, H);
    const cam = g.camera;

    // enemy health bars (only damaged ones, plus lock-on bracket)
    for (const e of g.enemies.list) {
      if (!e.alive || e.dying) continue;
      const pr = this.project(e.pos.x, e.pos.y + e.height + 0.8, e.pos.z, cam);
      if (pr.behind || pr.x < -50 || pr.x > W + 50 || pr.y < -50 || pr.y > H + 50) continue;
      const locked = g.player.target === e;
      if (e.hp < e.maxHp || locked) {
        const w = (e.spec.boss ? 90 : 44) * s, h = 5 * s;
        const k = clamp01(e.hp / e.maxHp);
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(pr.x - w / 2 - s, pr.y - s, w + 2 * s, h + 2 * s);
        ctx.fillStyle = k > 0.5 ? '#7dff9a' : k > 0.25 ? '#ffd36a' : '#ff4d3a';
        ctx.fillRect(pr.x - w / 2, pr.y, w * k, h);
      }
      if (locked) {
        const c = this.project(e.pos.x, e.pos.y + e.height * 0.5, e.pos.z, cam);
        const r = (18 + Math.sin(g.time * 10) * 2) * s * (e.spec.boss ? 2 : 1);
        ctx.strokeStyle = g.player.locked ? 'rgba(255,90,60,0.95)' : 'rgba(255,220,120,0.8)';
        ctx.lineWidth = 2.2 * s;
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 2 + g.time * 1.5;
          ctx.beginPath(); ctx.arc(c.x, c.y, r, a, a + 0.8); ctx.stroke();
        }
        ctx.font = `600 ${11 * s}px system-ui,sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(255,230,200,0.9)';
        ctx.fillText(e.name.toUpperCase(), c.x, c.y + r + 14 * s);
      }
    }

    // off-screen threat arrows (enemies close but not visible)
    const cxS = W / 2, cyS = H / 2;
    for (const e of g.enemies.list) {
      if (!e.alive || e.dying) continue;
      const d = Math.hypot(e.pos.x - g.player.pos.x, e.pos.z - g.player.pos.z);
      if (d > 60) continue;
      const pr = this.project(e.pos.x, e.pos.y + 1, e.pos.z, cam);
      const inside = !pr.behind && pr.x > 0 && pr.x < W && pr.y > 0 && pr.y < H;
      if (inside) continue;
      let dx = pr.x - cxS, dy = pr.y - cyS;
      if (pr.behind) { dx = -dx; dy = -dy; }
      const a = Math.atan2(dy, dx);
      const m = Math.min(W, H) * 0.42;
      const x = cxS + Math.cos(a) * m, y = cyS + Math.sin(a) * m;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = e.spec.boss ? 'rgba(255,60,110,0.9)' : 'rgba(255,90,60,0.8)';
      ctx.beginPath(); ctx.moveTo(12 * s, 0); ctx.lineTo(-6 * s, -8 * s); ctx.lineTo(-6 * s, 8 * s); ctx.closePath(); ctx.fill();
      ctx.restore();
    }

    // floating numbers
    ctx.textAlign = 'center';
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.life -= dt;
      if (f.life <= 0) { this.floaters.splice(i, 1); continue; }
      f.y += f.vy * dt;
      const pr = this.project(f.x, f.y, f.z, cam);
      if (pr.behind) continue;
      const k = f.life / f.max;
      ctx.globalAlpha = clamp(k * 1.6, 0, 1);
      ctx.font = `800 ${f.size * s * (1 + (1 - k) * 0.2)}px system-ui,sans-serif`;
      ctx.lineWidth = 3 * s; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(f.text, pr.x, pr.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, pr.x, pr.y);
    }
    ctx.globalAlpha = 1;

    // banner
    if (this.banner) {
      const b = this.banner;
      b.t += dt;
      const k = b.t < 0.25 ? b.t / 0.25 : b.t > b.dur - 0.4 ? Math.max(0, (b.dur - b.t) / 0.4) : 1;
      if (b.t >= b.dur) this.banner = null;
      else {
        ctx.globalAlpha = k;
        const y = H * 0.3;
        ctx.font = `900 ${Math.min(54, W / s / 11) * s}px system-ui,sans-serif`;
        ctx.lineWidth = 6 * s; ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.strokeText(b.title, W / 2, y);
        ctx.fillStyle = b.color; ctx.fillText(b.title, W / 2, y);
        if (b.sub) {
          ctx.font = `700 ${16 * s}px system-ui,sans-serif`;
          ctx.fillStyle = 'rgba(255,255,255,0.9)';
          ctx.fillText(b.sub, W / 2, y + 30 * s);
        }
        ctx.globalAlpha = 1;
      }
    }
  }
}
