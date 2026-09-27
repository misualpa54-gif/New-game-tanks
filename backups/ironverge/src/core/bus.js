/* ============================================================================
 * core/bus.js — tiny event bus. Keeps audio / particles / HUD / gameplay
 * decoupled (no circular imports, easy to mute or replace a subsystem).
 * ==========================================================================*/

const listeners = new Map();

export const bus = {
  on(type, fn) {
    let set = listeners.get(type);
    if (!set) { set = new Set(); listeners.set(type, set); }
    set.add(fn);
    return () => bus.off(type, fn);
  },
  off(type, fn) {
    const set = listeners.get(type);
    if (set) set.delete(fn);
  },
  emit(type, payload) {
    const set = listeners.get(type);
    if (!set) return;
    // copy so a handler may unsubscribe safely
    for (const fn of Array.from(set)) {
      try { fn(payload, type); } catch (err) { console.error('[bus:' + type + ']', err); }
    }
  },
  clear() { listeners.clear(); }
};

/* canonical event names (documentation only) */
export const EV = {
  SHOT: 'shot',             // {pos, dir, power, byPlayer}
  EXPLODE: 'explode',       // {pos, power, kind:'shell'|'enemy'|'big', color}
  IMPACT: 'impact',         // {pos, normal, power, kind}
  HIT: 'hit',               // {pos, damage, kill, enemy, byPlayer}
  DAMAGE: 'damage',         // {amount, hp, maxHp, source}
  KILL: 'kill',             // {name, pos, score, combo, boss}
  PICKUP: 'pickup',         // {kind, name, pos}
  WAVE: 'wave',             // {wave, boss}
  SCORE: 'score',           // {score, delta}
  SHAKE: 'shake',           // {power, decay}
  STATE: 'state',           // {state:'menu'|'playing'|'paused'|'over'}
  TICK: 'tick',             // {dt, time}
  GAMEOVER: 'gameover',     // {stats}
  AUDIO_UNLOCK: 'audio'
};
