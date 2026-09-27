/* ============================================================================
 * core/input.js — mobile-first controls
 * Three transparent on-screen buttons (◀ ▶ FIRE) with true multi-touch via
 * Pointer Events, plus keyboard / mouse for desktop testing. Each button
 * tracks its own set of pointer ids so sliding a thumb off a button releases
 * it, and two thumbs on ◀ ▶ reliably register "brake".
 * ==========================================================================*/

export class Input {
  constructor() {
    this.state = { left: false, right: false, fire: false };
    this.pointers = { left: new Set(), right: new Set(), fire: new Set() };
    this.keys = { left: false, right: false, fire: false };
    this.mouseFire = false;
    this.enabled = false;
    this.onPause = null;
    this.onAnyGesture = null;
    this._bind();
  }

  _bind() {
    const buttons = document.querySelectorAll('.tbtn[data-key]');
    buttons.forEach((btn) => {
      const key = btn.dataset.key;
      const down = (e) => {
        e.preventDefault();
        if (this.onAnyGesture) this.onAnyGesture();
        try { btn.setPointerCapture(e.pointerId); } catch (_) { /* old iOS */ }
        this.pointers[key].add(e.pointerId);
        this._sync();
        if (navigator.vibrate && key === 'fire') { try { navigator.vibrate(12); } catch (_) { /* ignore */ } }
      };
      const up = (e) => {
        this.pointers[key].delete(e.pointerId);
        this._sync();
      };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
      // with capture the pointer stays bound; release when it slides far away
      btn.addEventListener('pointermove', (e) => {
        if (!this.pointers[key].has(e.pointerId)) return;
        const r = btn.getBoundingClientRect();
        const pad = 36;
        if (e.clientX < r.left - pad || e.clientX > r.right + pad || e.clientY < r.top - pad || e.clientY > r.bottom + pad) {
          this.pointers[key].delete(e.pointerId);
          this._sync();
        }
      });
      btn.addEventListener('contextmenu', (e) => e.preventDefault());
    });

    const map = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'fire', KeyW: 'fire', ArrowUp: 'fire', KeyJ: 'fire' };
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP' || e.code === 'Escape') { if (this.onPause) this.onPause(); return; }
      const k = map[e.code];
      if (!k) return;
      if (this.onAnyGesture) this.onAnyGesture();
      e.preventDefault();
      this.keys[k] = true;
      this._sync();
    });
    window.addEventListener('keyup', (e) => {
      const k = map[e.code];
      if (!k) return;
      this.keys[k] = false;
      this._sync();
    });

    // desktop: click anywhere on the 3D view to fire
    const canvas = document.getElementById('gl');
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) { this.mouseFire = true; this._sync(); if (this.onAnyGesture) this.onAnyGesture(); }
    });
    window.addEventListener('pointerup', (e) => { if (e.pointerType === 'mouse') { this.mouseFire = false; this._sync(); } });

    window.addEventListener('blur', () => this.releaseAll());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseAll(); });
    // stop iOS rubber-banding / double-tap zoom while playing
    document.addEventListener('touchmove', (e) => { if (this.enabled) e.preventDefault(); }, { passive: false });
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('dblclick', (e) => e.preventDefault());
  }

  _sync() {
    const s = this.state;
    s.left = this.pointers.left.size > 0 || this.keys.left;
    s.right = this.pointers.right.size > 0 || this.keys.right;
    s.fire = this.pointers.fire.size > 0 || this.keys.fire || this.mouseFire;
    document.getElementById('btnLeft')?.classList.toggle('on', s.left);
    document.getElementById('btnRight')?.classList.toggle('on', s.right);
    document.getElementById('btnFire')?.classList.toggle('on', s.fire);
  }

  releaseAll() {
    for (const k of Object.keys(this.pointers)) this.pointers[k].clear();
    this.keys.left = this.keys.right = this.keys.fire = false;
    this.mouseFire = false;
    this._sync();
  }
}
