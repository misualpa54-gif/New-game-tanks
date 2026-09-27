/* ============================================================================
 * core/audio.js — fully synthesised sound (Web Audio API, zero downloads)
 * Cannon boom, explosions, impacts, creature attacks, pickups, UI blips and a
 * diesel engine loop whose pitch follows the tank speed. Spatialised by a
 * simple distance/pan model relative to the player.
 * ==========================================================================*/
import { clamp, clamp01, rand } from './util.js';

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
    this.engine = null;
    this.listener = { x: 0, z: 0, yaw: 0 };
    this._lastPlay = new Map();
  }

  /** must be called from a user gesture (mobile autoplay rules) */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.8 : 0;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4;
    this.master.connect(comp).connect(this.ctx.destination);
    // shared noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startEngine();
  }

  setEnabled(on) {
    this.enabled = on;
    if (this.master) this.master.gain.setTargetAtTime(on ? 0.8 : 0, this.ctx.currentTime, 0.05);
  }

  setListener(x, z, yaw) { this.listener.x = x; this.listener.z = z; this.listener.yaw = yaw; }

  /** distance attenuation + stereo pan for a world position */
  spatial(pos) {
    if (!pos) return { gain: 1, pan: 0 };
    const dx = pos.x - this.listener.x, dz = pos.z - this.listener.z;
    const d = Math.hypot(dx, dz);
    const gain = clamp(1 / (1 + d * 0.035), 0.05, 1);
    const yaw = this.listener.yaw;
    const right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    return { gain, pan: clamp(right / 40, -0.9, 0.9) };
  }

  out(pos, vol) {
    const s = this.spatial(pos);
    const g = this.ctx.createGain();
    g.gain.value = vol * s.gain;
    if (this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = s.pan;
      g.connect(p).connect(this.master);
    } else g.connect(this.master);
    return g;
  }

  throttle(key, ms) {
    const now = performance.now();
    if (now - (this._lastPlay.get(key) || 0) < ms) return false;
    this._lastPlay.set(key, now);
    return true;
  }

  noiseBurst(dest, { dur = 0.5, freq = 800, q = 0.8, type = 'lowpass', attack = 0.004, sweepTo = null, vol = 1 }) {
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rand(0.85, 1.15);
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, rand(0, 1.2));
    src.stop(t + dur + 0.05);
  }

  tone(dest, { f0 = 200, f1 = 60, dur = 0.3, type = 'sine', vol = 1, attack = 0.005 }) {
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(10, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /* ---------------- public sfx ---------------- */
  play(name, pos, power = 1) {
    if (!this.ctx || !this.enabled) return;
    try {
      switch (name) {
        case 'cannon': {
          const o = this.out(null, 0.95);
          this.tone(o, { f0: 150, f1: 38, dur: 0.55, vol: 1 });
          this.noiseBurst(o, { dur: 0.45, freq: 2600, sweepTo: 180, vol: 0.9 });
          this.noiseBurst(o, { dur: 1.2, freq: 420, sweepTo: 60, vol: 0.5, attack: 0.02 });
          break;
        }
        case 'explode': {
          if (!this.throttle('explode', 45)) return;
          const o = this.out(pos, 0.9 * clamp(power, 0.4, 2));
          this.tone(o, { f0: 110, f1: 28, dur: 0.9 * clamp(power, 0.6, 1.8), vol: 1 });
          this.noiseBurst(o, { dur: 1.1 * clamp(power, 0.6, 2), freq: 1400, sweepTo: 90, vol: 1, attack: 0.008 });
          break;
        }
        case 'impact': {
          if (!this.throttle('impact', 40)) return;
          const o = this.out(pos, 0.5);
          this.noiseBurst(o, { dur: 0.18, freq: 3200, type: 'bandpass', q: 1.2, vol: 0.9 });
          this.tone(o, { f0: 900, f1: 300, dur: 0.12, type: 'triangle', vol: 0.3 });
          break;
        }
        case 'hitPlayer': {
          if (!this.throttle('hitPlayer', 70)) return;
          const o = this.out(null, 0.7);
          this.tone(o, { f0: 240, f1: 90, dur: 0.25, type: 'square', vol: 0.35 });
          this.noiseBurst(o, { dur: 0.3, freq: 1800, type: 'bandpass', q: 2, vol: 0.8 });
          break;
        }
        case 'crush': {
          if (!this.throttle('crush', 60)) return;
          const o = this.out(pos, 0.5);
          this.noiseBurst(o, { dur: 0.3, freq: 900, type: 'bandpass', q: 0.8, vol: 0.9 });
          break;
        }
        case 'bump': {
          const o = this.out(null, 0.7);
          this.tone(o, { f0: 90, f1: 40, dur: 0.3, vol: 0.9 });
          this.noiseBurst(o, { dur: 0.25, freq: 700, vol: 0.6 });
          break;
        }
        case 'pickup': {
          const o = this.out(null, 0.5);
          this.tone(o, { f0: 520, f1: 1040, dur: 0.18, type: 'triangle', vol: 0.8 });
          setTimeout(() => this.ctx && this.tone(o, { f0: 780, f1: 1560, dur: 0.22, type: 'triangle', vol: 0.7 }), 90);
          break;
        }
        case 'overheat': {
          const o = this.out(null, 0.5);
          this.noiseBurst(o, { dur: 1.0, freq: 5000, type: 'highpass', q: 0.5, vol: 0.6, attack: 0.05 });
          break;
        }
        case 'dry': {
          if (!this.throttle('dry', 120)) return;
          const o = this.out(null, 0.35);
          this.tone(o, { f0: 1600, f1: 1200, dur: 0.05, type: 'square', vol: 0.4 });
          break;
        }
        case 'kill': {
          if (!this.throttle('kill', 50)) return;
          const o = this.out(pos, 0.5);
          this.tone(o, { f0: 330 * power, f1: 110, dur: 0.35, type: 'sawtooth', vol: 0.25 });
          break;
        }
        case 'bolt': case 'spell': case 'plasma': case 'cast': {
          if (!this.throttle('bolt', 70)) return;
          const o = this.out(pos, 0.35);
          this.tone(o, { f0: name === 'plasma' ? 900 : 600, f1: 180, dur: 0.25, type: 'sawtooth', vol: 0.4 });
          break;
        }
        case 'bullet': {
          if (!this.throttle('bullet', 50)) return;
          const o = this.out(pos, 0.4);
          this.noiseBurst(o, { dur: 0.08, freq: 2400, type: 'bandpass', vol: 0.8 });
          break;
        }
        case 'boulder': case 'bomb': case 'leap': {
          if (!this.throttle('whoosh', 90)) return;
          const o = this.out(pos, 0.4);
          this.noiseBurst(o, { dur: 0.5, freq: 300, sweepTo: 1200, type: 'bandpass', q: 1.5, vol: 0.7, attack: 0.1 });
          break;
        }
        case 'flame': {
          if (!this.throttle('flame', 110)) return;
          const o = this.out(pos, 0.5);
          this.noiseBurst(o, { dur: 0.35, freq: 900, type: 'lowpass', vol: 0.8, attack: 0.03 });
          break;
        }
        case 'roar': case 'screech': {
          if (!this.throttle('roar', 400)) return;
          const o = this.out(pos, name === 'roar' ? 0.9 : 0.4);
          const f = name === 'roar' ? 90 : 700;
          this.tone(o, { f0: f, f1: f * 0.55, dur: name === 'roar' ? 1.2 : 0.4, type: 'sawtooth', vol: 0.5, attack: 0.08 });
          this.noiseBurst(o, { dur: name === 'roar' ? 1.1 : 0.35, freq: f * 4, type: 'bandpass', q: 1.2, vol: 0.5, attack: 0.08 });
          break;
        }
        case 'wave': {
          const o = this.out(null, 0.4);
          [0, 120, 240].forEach((ms, i) => setTimeout(() => this.ctx && this.tone(o, { f0: 220 * (i + 2), f1: 220 * (i + 2), dur: 0.3, type: 'triangle', vol: 0.5 }), ms));
          break;
        }
        case 'boss': {
          const o = this.out(null, 0.7);
          this.tone(o, { f0: 55, f1: 45, dur: 2.2, type: 'sawtooth', vol: 0.5, attack: 0.3 });
          this.tone(o, { f0: 82, f1: 70, dur: 2.2, type: 'sawtooth', vol: 0.35, attack: 0.3 });
          break;
        }
        case 'click': {
          const o = this.out(null, 0.3);
          this.tone(o, { f0: 900, f1: 700, dur: 0.06, type: 'triangle', vol: 0.5 });
          break;
        }
        case 'gameover': {
          const o = this.out(null, 0.6);
          this.tone(o, { f0: 220, f1: 55, dur: 1.6, type: 'sawtooth', vol: 0.4, attack: 0.05 });
          break;
        }
      }
    } catch (e) { /* audio must never crash the game */ }
  }

  /* ---------------- engine loop ---------------- */
  startEngine() {
    const c = this.ctx;
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 38;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = 19;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 2;
    const g = c.createGain(); g.gain.value = 0;
    const g2 = c.createGain(); g2.gain.value = 0.4;
    // track rattle
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 3;
    const ng = c.createGain(); ng.gain.value = 0;
    o1.connect(lp); o2.connect(g2).connect(lp);
    lp.connect(g).connect(this.master);
    n.connect(bp).connect(ng).connect(this.master);
    o1.start(); o2.start(); n.start();
    this.engine = { o1, o2, lp, g, ng, bp };
  }

  updateEngine(speed, running) {
    if (!this.engine || !this.ctx) return;
    const t = this.ctx.currentTime;
    const k = clamp01(speed / 20);
    const on = running && this.enabled ? 1 : 0;
    this.engine.o1.frequency.setTargetAtTime(34 + k * 34, t, 0.2);
    this.engine.o2.frequency.setTargetAtTime(17 + k * 17, t, 0.2);
    this.engine.lp.frequency.setTargetAtTime(200 + k * 380, t, 0.2);
    this.engine.g.gain.setTargetAtTime(on * (0.08 + k * 0.07), t, 0.3);
    this.engine.ng.gain.setTargetAtTime(on * k * 0.035, t, 0.3);
    this.engine.bp.frequency.setTargetAtTime(1200 + k * 1400, t, 0.3);
  }
}
