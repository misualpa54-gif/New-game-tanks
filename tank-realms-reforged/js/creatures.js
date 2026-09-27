/* =============================================================================
 * TANK REALMS: REFORGED — creature enemies (classic script, loaded before game.js)
 * -----------------------------------------------------------------------------
 * Animals, demi-humans, robots and mythical monsters built from free online GLB
 * models (Quaternius, Khronos, three.js examples — see CREDITS.md).
 * Each creature plugs into the original Tank interface (mesh, turretPivot, barrel,
 * hp, move/aimAt/takeDamage/die) so every existing system — bullets, homing
 * missiles, splash, kill rewards, level scaling, elites — works unchanged.
 * Behaviour is added per creature by `Creatures.ai()` (called from updatePhysics).
 * ===========================================================================*/
(function () {
  'use strict';
  const T = window.THREE;
  const A = window.Assets;
  const UP = new T.Vector3(0, 1, 0);

  // Biome indices: 0 Forest 1 Tundra 2 Volcanic 3 Desert 4 Swamp 5 Crystal 6 Autumn 7 Sakura 8 Blood Moon 9 Neon
  /* ---------------------------------------------------------------------------
   * ROSTER — stats use the same scale as the original tanks (soldier: 50 hp, 12 dmg)
   * -------------------------------------------------------------------------*/
  const TYPES = {
    // ---------- animals ----------
    boar:     { name: 'Tusk Boar', color: 0x8b5a3c, hp: 60, speed: 1.15, damage: 16, size: 1, points: 120, minLevel: 1, biomes: [0, 6, 4], ai: 'charger', creature: 'boar',
                desc: 'Paws the ground, then CHARGES — sidestep it!' },
    fox:      { name: 'Ember Fox', color: 0xf97316, hp: 38, speed: 1.45, damage: 9, size: 1, points: 110, minLevel: 1, biomes: [0, 6, 1], ai: 'flanker', creature: 'fox', proj: 0xff7a1a, pack: 2,
                desc: 'Circles to your flank, spits embers and lunges' },
    duck:     { name: 'Quack Bomb', color: 0xfacc15, hp: 30, speed: 1.75, damage: 28, size: 1, points: 90, minLevel: 1, biomes: [4, 7], ai: 'quackbomb', creature: 'duck', deathBlast: 5,
                desc: 'Waddles in and EXPLODES — shoot it early!' },
    bat:      { name: 'Dusk Bat', color: 0x5b3a5e, hp: 22, speed: 1.9, damage: 9, size: 1, points: 70, minLevel: 2, biomes: [4, 8, 5], ai: 'diver', creature: 'bat', hover: 3.4, pack: 3, dive: 'bite',
                desc: 'Swarms in threes and dive-bombs from above' },
    wolf:     { name: 'Grey Wolf', color: 0x9ca3af, hp: 42, speed: 1.6, damage: 12, size: 1, points: 110, minLevel: 2, biomes: [1, 0, 6], ai: 'flanker', creature: 'wolf', pack: 3, noBolt: true,
                desc: 'Hunts in packs — flanks and bites' },
    parrot:   { name: 'Feather Shrike', color: 0x22c55e, hp: 30, speed: 1.5, damage: 7, size: 1, points: 100, minLevel: 3, biomes: [7, 0, 4], ai: 'diver', creature: 'parrot', hover: 4.2, dive: 'volley', proj: 0x4ade80, pack: 2,
                desc: 'Rains feather volleys from the sky' },
    rhino:    { name: 'Iron Rhino', color: 0x78716c, hp: 170, speed: 0.9, damage: 26, size: 1.2, points: 260, minLevel: 5, biomes: [3, 2], ai: 'charger', creature: 'rhino', armorFront: 0.3, knock: 2.6,
                desc: 'Armored front plate — hit it from the SIDE' },
    stork:    { name: 'Bomb Stork', color: 0xe5e7eb, hp: 40, speed: 1.4, damage: 24, size: 1, points: 150, minLevel: 6, biomes: [7, 4], ai: 'diver', creature: 'stork', hover: 5.2, dive: 'bomb',
                desc: 'Flies overhead and drops egg bombs — keep moving' },
    stag:     { name: 'Thunder Stag', color: 0x93c5fd, hp: 120, speed: 1.2, damage: 22, size: 1.1, points: 230, minLevel: 7, biomes: [0, 1, 6], ai: 'charger', creature: 'stag', lightning: true,
                desc: 'Calls lightning where you stand, then charges' },
    flamingo: { name: 'Flame-ingo', color: 0xfb7185, hp: 48, speed: 1.5, damage: 8, size: 1, points: 150, minLevel: 8, biomes: [2, 3, 7], ai: 'diver', creature: 'flamingo', hover: 4.4, dive: 'strafe', proj: 0xff4d2e,
                desc: 'Strafing fire runs from above' },
    bull:     { name: 'War Bull', color: 0x7f1d1d, hp: 200, speed: 1.05, damage: 32, size: 1.25, points: 300, minLevel: 9, biomes: [3, 6], ai: 'charger', creature: 'bull', knock: 3.2,
                desc: 'Unstoppable charges that send you flying' },
    steed:    { name: 'Nightmare Steed', color: 0x4c1d95, hp: 130, speed: 1.35, damage: 22, size: 1.1, points: 260, minLevel: 10, biomes: [8, 2], ai: 'charger', creature: 'steed', nova: 6, proj: 0xa855f7,
                desc: 'Charges and bursts into a ring of shadow bolts' },
    // ---------- objects / robots ----------
    mimic:    { name: 'Crate Mimic', color: 0xa16207, hp: 70, speed: 1.4, damage: 18, size: 1, points: 170, minLevel: 4, ai: 'mimic', creature: 'mimic', noIntro: true,
                desc: 'That crate just BIT you — it was a mimic!' },
    sentinel: { name: 'Sentinel Bot', color: 0x38bdf8, hp: 120, speed: 0.75, damage: 9, size: 1.1, points: 220, minLevel: 5, biomes: [9, 5], ai: 'sentinel', creature: 'sentinel', proj: 0x38bdf8,
                desc: 'Five-shot laser bursts — punches up close' },
    // ---------- demi-humans ----------
    shaman:   { name: 'Swamp Shaman', color: 0x10b981, hp: 55, speed: 0.85, damage: 12, size: 1, points: 180, minLevel: 4, biomes: [4, 2, 8], ai: 'caster', creature: 'shaman', proj: 0x34d399, healer: true,
                desc: 'HEALS nearby enemies — kill it first!' },
    brute:    { name: 'Orc Brute', color: 0x4d7c0f, hp: 150, speed: 0.9, damage: 30, size: 1.2, points: 240, minLevel: 6, biomes: [2, 8], ai: 'brute', creature: 'brute',
                desc: 'Ground-slam shockwave — stay out of the ring' },
    gunslinger:{ name: 'Rogue Gunslinger', color: 0xd97706, hp: 65, speed: 1.25, damage: 12, size: 1, points: 190, minLevel: 7, biomes: [3, 6], ai: 'gunslinger', creature: 'gunslinger', proj: 0xfbbf24,
                desc: 'Double-taps and combat-rolls out of your aim' },
    dullahan: { name: 'Dullahan', color: 0x6d28d9, hp: 160, speed: 1.1, damage: 24, size: 1.15, points: 300, minLevel: 10, biomes: [8, 6], ai: 'dullahan', creature: 'dullahan', proj: 0xc084fc,
                desc: 'Headless knight — hurls its cursed head at you' },
    // ---------- mythical monsters ----------
    sporecap: { name: 'Sporecap', color: 0xa3e635, hp: 90, speed: 0.55, damage: 7, size: 1.1, points: 150, minLevel: 3, biomes: [4, 0, 6], ai: 'sporecap', creature: 'sporecap',
                desc: 'Leaves poison spore clouds — don\'t linger' },
    cactoro:  { name: 'Cactoro', color: 0x65a30d, hp: 110, speed: 0.45, damage: 9, size: 1.1, points: 170, minLevel: 5, biomes: [3], ai: 'cactoro', creature: 'cactoro', proj: 0xbef264,
                desc: 'Roots itself and fires spine novas' },
    imp:      { name: 'Fire Imp', color: 0xef4444, hp: 50, speed: 1.3, damage: 11, size: 1, points: 150, minLevel: 6, biomes: [2, 8], ai: 'imp', creature: 'imp', hover: 2.4, proj: 0xff5a1f,
                desc: 'Hovering devil — triple fireballs' },
    sprite:   { name: 'Rock Sprite', color: 0xa8a29e, hp: 34, speed: 1.6, damage: 6, size: 1, points: 90, minLevel: 7, biomes: [5, 9, 3], ai: 'sprite', creature: 'sprite', hover: 2.8, proj: 0xd6d3d1, pack: 2,
                desc: 'Tiny golems that orbit you and pelt pebbles' },
    wraith:   { name: 'Wraith', color: 0xcbd5e1, hp: 70, speed: 1.4, damage: 16, size: 1, points: 200, minLevel: 8, biomes: [8, 1, 9], ai: 'wraith', creature: 'wraith', hover: 1.6, proj: 0xe2e8f0,
                desc: 'Phases out (immune!), then strikes — shoot when solid' },
    tiki:     { name: 'Tiki Spirit', color: 0xb45309, hp: 80, speed: 1.0, damage: 10, size: 1, points: 180, minLevel: 9, biomes: [3, 4], ai: 'tiki', creature: 'tiki', hover: 2.2, proj: 0xf59e0b,
                desc: 'Dart fans — enraged when wounded' },
    voidling: { name: 'Voidling', color: 0x7c3aed, hp: 70, speed: 1.1, damage: 12, size: 1, points: 200, minLevel: 9, biomes: [9, 5], ai: 'voidling', creature: 'voidling', proj: 0x8b5cf6,
                desc: 'Blinks around you and fires void bolts' },
    djinn:    { name: 'Storm Djinn', color: 0x0ea5e9, hp: 95, speed: 1.1, damage: 10, size: 1, points: 220, minLevel: 10, biomes: [3, 5], ai: 'djinn', creature: 'djinn', hover: 2.6, proj: 0x7dd3fc,
                desc: 'Wind-blast rings in every direction' },
    drake:    { name: 'Ember Drake', color: 0xdc2626, hp: 150, speed: 1.05, damage: 4, size: 1.1, points: 280, minLevel: 11, biomes: [2, 1], ai: 'drake', creature: 'drake', hover: 3.0, proj: 0xff6a00,
                desc: 'Breathes a cone of fire — keep your distance' },
    // ---------- bosses ----------
    wyrm:     { name: 'ELDER WYRM', color: 0xb91c1c, hp: 800, speed: 0.8, damage: 16, size: 2.6, points: 2200, boss: true, ai: 'wyrm', creature: 'wyrm', hover: 4.2, proj: 0xff6a00,
                desc: 'BOSS — fire breath sweeps and meteor rain' },
    golemking:{ name: 'GOLEM KING', color: 0x78716c, hp: 950, speed: 0.45, damage: 26, size: 3, points: 2400, boss: true, ai: 'golemking', creature: 'golemking', hover: 1.4, proj: 0xd6d3d1,
                desc: 'BOSS — earth slams and rock sprite minions' },
    frostgiant:{ name: 'FROST GIANT', color: 0x60a5fa, hp: 1000, speed: 0.4, damage: 22, size: 3.2, points: 2600, boss: true, ai: 'frostgiant', creature: 'frostgiant', proj: 0x93c5fd,
                desc: 'BOSS — ice spike lines and frost stomps' },
  };
  Object.values(TYPES).forEach(t => { if (t.fireRate == null) t.fireRate = 0; });

  // animation role → clip name candidates (first match wins)
  const ROLE_CLIPS = {
    idle:   ['Idle', 'Idle_Loop', 'Flying_Idle', 'Survey', 'Flying', 'Standing'],
    walk:   ['Walk', 'Walking', 'WalkSlow', 'Jog_Fwd_Loop', 'Flying_Idle', 'Flying'],
    run:    ['Run', 'Running', 'Gallop', 'Sprint_Loop', 'Fast_Flying', 'Jog_Fwd_Loop', 'Walk', 'Flying'],
    attack: ['Attack', 'Attack_Headbutt', 'Bite_Front', 'Punch', 'Headbutt', 'Punch_Cross', 'Sword_Attack', 'Spell_Simple_Shoot', 'Pistol_Shoot', 'Jump'],
    hit:    ['HitRecieve', 'HitReact', 'Idle_HitReact1', 'Hit_Chest'],
    death:  ['Death', 'Death01'],
    jump:   ['Jump', 'Jump_Loop', 'WalkJump'],
    cast:   ['Spell_Simple_Shoot', 'Punch', 'Attack', 'Yes'],
    roll:   ['Roll'],
  };
  const ROLE_OVERRIDE = {
    gunslinger: { idle: 'Pistol_Idle_Loop', attack: 'Pistol_Shoot' },
    shaman: { idle: 'Spell_Simple_Idle_Loop', attack: 'Spell_Simple_Shoot' },
    dullahan: { attack: 'Sword_Attack' },
    brute: { attack: 'Punch_Cross' },
    frostgiant: { attack: 'Punch_Cross', cast: 'Spell_Simple_Shoot' },
    stag: { attack: 'Attack_Headbutt' }, bull: { attack: 'Attack_Headbutt' },
  };

  /* ---------------------------------------------------------------------------
   * HELPERS
   * -------------------------------------------------------------------------*/
  const _v = new T.Vector3(), _v2 = new T.Vector2(), _from = new T.Vector3(), _to = new T.Vector3(), _dir = new T.Vector3(), _box = new T.Box3(), _sz = new T.Vector3(), _ctr = new T.Vector3();
  const now = () => clock.getElapsedTime();
  const rand = (a, b) => a + Math.random() * (b - a);
  const wrapA = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

  function ready(type) { const d = TYPES[type]; return !!(d && A.creatureReady(d.creature)); }
  function isCreatureType(type) { return !!TYPES[type]; }

  function register(ENEMY_TYPES) {
    for (const k in TYPES) ENEMY_TYPES[k] = TYPES[k];
  }

  function hurt(amount, sx, sz, mult) {
    if (!player || player.isDead || !state.isPlaying) return;
    player.takeDamage(amount * ((state.diffMult && state.diffMult.dmg) || 1) * (mult || 1));
    try { showDamageDirection(sx, sz); } catch (e) {}
    const ov = document.getElementById('damage-overlay');
    if (ov) { ov.style.opacity = '0.5'; setTimeout(() => { ov.style.opacity = '0'; }, 150); }
    try { updateHUD(); } catch (e) {}
    if (player.hp <= 0 && state.isPlaying) endGame();
  }

  function go(e, step, x, z, mult) {
    const base = e.speedMult || 1;
    e.speedMult = base * (mult || 1);
    step(_v2.set(x, z));
    e.speedMult = base;
  }

  // aimed shots from the creature's mouth/hands toward the player (true 3D aim so flyers hit)
  function fire(e, o) {
    o = o || {};
    const def = e.typeData;
    e.barrel.getWorldPosition(_from);
    _to.copy(player.mesh.position); _to.y += 1.0;
    if (o.lead) { _to.x += player.velocity.x / Math.max(0.001, 1 / 60) * o.lead; _to.z += player.velocity.z / Math.max(0.001, 1 / 60) * o.lead; }
    if (o.at) _to.copy(o.at);
    _dir.subVectors(_to, _from).normalize();
    const n = o.count || 1, spread = o.spread != null ? o.spread : 0.15;
    e.projColor = o.color || def.proj || 0xff4444;
    for (let i = 0; i < n; i++) {
      const d = _dir.clone();
      if (n > 1) d.applyAxisAngle(UP, (i - (n - 1) / 2) * spread);
      if (o.jitter) d.applyAxisAngle(UP, (Math.random() - 0.5) * o.jitter);
      spawnBullet(e, d, o.dmg != null ? o.dmg : def.damage);
      if (o.life) bullets[bullets.length - 1].group.userData.life = o.life;
    }
  }
  // ring of shots in every direction (tilted down for flyers so they reach tank height)
  function radial(e, n, o) {
    o = o || {};
    const c = e.creature, def = e.typeData;
    const tilt = -((c.alt || 0) + c.h * 0.55 - 1.2) / 16;
    const off = o.offset != null ? o.offset : Math.random() * Math.PI * 2;
    e.projColor = o.color || def.proj || 0xff4444;
    for (let i = 0; i < n; i++) {
      const a = off + i / n * Math.PI * 2;
      spawnBullet(e, _dir.set(Math.sin(a), tilt, Math.cos(a)).normalize(), o.dmg != null ? o.dmg : def.damage);
      if (o.life) bullets[bullets.length - 1].group.userData.life = o.life;
    }
  }

  /* ---------- telegraphed ground blasts ---------- */
  const FX = { tele: [], orbs: [], clouds: [], dying: [], bolts: [] };
  const GEO = {};
  function geo() {
    if (GEO.ring) return GEO;
    GEO.ring = A.markShared(new T.RingGeometry(0.88, 1, 48).rotateX(-Math.PI / 2));
    GEO.disc = A.markShared(new T.CircleGeometry(1, 40).rotateX(-Math.PI / 2));
    GEO.orb = A.markShared(new T.SphereGeometry(0.34, 12, 10));
    GEO.glow = A.markShared(new T.SphereGeometry(0.72, 12, 10));
    GEO.puff = A.markShared(new T.SphereGeometry(1, 10, 8));
    GEO.bolt = A.markShared(new T.CylinderGeometry(0.18, 0.35, 1, 6, 1, true).translate(0, 0.5, 0));
    GEO.egg = A.markShared(new T.SphereGeometry(0.42, 10, 8).scale(1, 1.3, 1));
    GEO.spike = A.markShared(new T.ConeGeometry(0.55, 2.6, 6).translate(0, 1.3, 0));
    return GEO;
  }
  function telegraph(x, z, r, delay, dmg, color, o) {
    o = o || {};
    const g = geo();
    const y = getTerrainHeight(x, z) + 0.22;
    const ringM = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
    const discM = new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false });
    const ring = new T.Mesh(g.ring, ringM), disc = new T.Mesh(g.disc, discM);
    ring.scale.setScalar(r); disc.scale.setScalar(0.01);
    ring.position.set(x, y, z); disc.position.set(x, y + 0.02, z);
    ring.renderOrder = disc.renderOrder = 3;
    scene.add(ring, disc);
    let egg = null;
    if (o.egg) { egg = new T.Mesh(g.egg, new T.MeshStandardMaterial({ color: 0xf5f5f4, roughness: 0.5 })); egg.position.set(x, y + o.egg, z); scene.add(egg); }
    FX.tele.push({ x, z, y, r, delay, t: 0, dmg, color, ring, disc, egg, eggH: o.egg || 0, mult: o.mult || 1, kind: o.kind || 'blast', hitsEnemies: !!o.hitsEnemies });
  }
  function updateTele(dt) {
    for (let i = FX.tele.length - 1; i >= 0; i--) {
      const t = FX.tele[i];
      t.t += dt;
      const k = Math.min(1, t.t / t.delay);
      t.disc.scale.setScalar(Math.max(0.01, t.r * k));
      t.ring.material.opacity = 0.55 + Math.sin(t.t * 18) * 0.3;
      if (t.egg) t.egg.position.y = t.y + t.eggH * (1 - k * k);
      if (t.t >= t.delay) {
        const pos = new T.Vector3(t.x, t.y + 0.6, t.z);
        if (t.kind === 'lightning') {
          const bolt = new T.Mesh(geo().bolt, new T.MeshBasicMaterial({ color: 0xe0f2fe, transparent: true, opacity: 0.95, depthWrite: false }));
          bolt.position.set(t.x, t.y, t.z); bolt.scale.set(1, 26, 1);
          scene.add(bolt); FX.bolts.push({ m: bolt, t: 0.18 });
          createExplosion(pos, 10, 0x93c5fd, 'spark');
        } else if (t.kind === 'spike') {
          const sp = new T.Mesh(geo().spike, new T.MeshStandardMaterial({ color: 0xbfdbfe, roughness: 0.15, metalness: 0.1, emissive: 0x1e3a8a, emissiveIntensity: 0.4 }));
          sp.position.set(t.x, t.y - 0.3, t.z); sp.rotation.set(rand(-0.25, 0.25), rand(0, 6), rand(-0.25, 0.25));
          scene.add(sp); FX.bolts.push({ m: sp, t: 1.1, spike: true });
          createExplosion(pos, 6, 0xbfdbfe, 'spark');
        } else {
          createExplosion(pos, t.r > 5 ? 16 : 10, t.color, 'spark');
        }
        state.cameraShake = Math.max(state.cameraShake || 0, t.r > 5 ? 0.45 : 0.22);
        if (player && !player.isDead) {
          const dx = player.mesh.position.x - t.x, dz = player.mesh.position.z - t.z;
          if (dx * dx + dz * dz < t.r * t.r) hurt(t.dmg, t.x, t.z, t.mult);
        }
        if (t.hitsEnemies) blastEnemies(t.x, t.z, t.r, t.dmg * 1.5);
        scene.remove(t.ring, t.disc); t.ring.material.dispose(); t.disc.material.dispose();
        if (t.egg) { scene.remove(t.egg); t.egg.material.dispose(); }
        FX.tele.splice(i, 1);
      }
    }
    for (let i = FX.bolts.length - 1; i >= 0; i--) {
      const b = FX.bolts[i];
      b.t -= dt;
      if (b.spike) { b.m.position.y += dt * (b.t > 0.9 ? 6 : b.t < 0.3 ? -5 : 0); }
      else b.m.material.opacity = Math.max(0, b.t / 0.18);
      if (b.t <= 0) { scene.remove(b.m); b.m.material.dispose(); FX.bolts.splice(i, 1); }
    }
  }
  function blastEnemies(x, z, r, dmg) {
    for (let j = enemies.length - 1; j >= 0; j--) {
      const o = enemies[j];
      if (o.isDead) continue;
      const dx = o.mesh.position.x - x, dz = o.mesh.position.z - z;
      if (dx * dx + dz * dz < r * r) {
        o.takeDamage(dmg);
        if (o.isDead) { try { handleEnemyKill(o, false, 'blast'); } catch (e) {} enemies.splice(j, 1); }
      }
    }
  }

  /* ---------- homing orbs ---------- */
  function orb(e, o) {
    const g = geo();
    const color = o.color || e.typeData.proj || 0x34d399;
    const core = new T.Mesh(g.orb, new T.MeshBasicMaterial({ color: 0xffffff }));
    const glow = new T.Mesh(g.glow, new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, depthWrite: false }));
    const grp = new T.Group(); grp.add(core, glow);
    e.barrel.getWorldPosition(grp.position);
    scene.add(grp);
    _dir.subVectors(player.mesh.position, grp.position).setY(0).normalize();
    FX.orbs.push({ g: grp, glow, vel: _dir.clone().multiplyScalar(o.speed || 14), speed: o.speed || 14, turn: o.turn || 2.2, life: o.life || 4.5,
      dmg: (o.dmg != null ? o.dmg : e.typeData.damage), mult: e.damageMult || 1, color });
  }
  function updateOrbs(dt) {
    for (let i = FX.orbs.length - 1; i >= 0; i--) {
      const o = FX.orbs[i];
      o.life -= dt;
      let dead = o.life <= 0;
      if (player && !player.isDead) {
        _to.copy(player.mesh.position); _to.y += 1.1;
        _dir.subVectors(_to, o.g.position).normalize().multiplyScalar(o.speed);
        o.vel.lerp(_dir, Math.min(1, o.turn * dt)).setLength(o.speed);
        o.g.position.addScaledVector(o.vel, dt);
        const floor = getTerrainHeight(o.g.position.x, o.g.position.z) + 0.6;
        if (o.g.position.y < floor) o.g.position.y = floor;
        o.glow.scale.setScalar(1 + Math.sin(now() * 14 + i) * 0.18);
        if (o.g.position.distanceToSquared(_to) < 3.2) { hurt(o.dmg, o.g.position.x, o.g.position.z, o.mult); dead = true; }
        // player shells can pop orbs
        for (const b of bullets) {
          if (!b.group.userData.isPlayer) continue;
          if (b.group.position.distanceToSquared(o.g.position) < 2.2) { dead = true; break; }
        }
      }
      if (dead) {
        createExplosion(o.g.position.clone(), 4, o.color, 'spark');
        scene.remove(o.g); o.g.children.forEach(m => m.material.dispose());
        FX.orbs.splice(i, 1);
      }
    }
  }

  /* ---------- lingering clouds (spores) ---------- */
  function cloud(x, z, r, dur, dps, color, mult) {
    const g = geo();
    const grp = new T.Group();
    const y = getTerrainHeight(x, z);
    const mat = new T.MeshStandardMaterial({ color, transparent: true, opacity: 0.32, depthWrite: false, roughness: 1, emissive: color, emissiveIntensity: 0.25 });
    for (let i = 0; i < 7; i++) {
      const p = new T.Mesh(g.puff, mat);
      const a = i / 7 * Math.PI * 2, d = i ? r * 0.55 : 0;
      p.position.set(Math.cos(a) * d, 0.6 + Math.random() * 0.8, Math.sin(a) * d);
      p.scale.setScalar(r * (i ? 0.45 : 0.6));
      p.userData.ph = Math.random() * 6;
      grp.add(p);
    }
    grp.position.set(x, y, z);
    scene.add(grp);
    FX.clouds.push({ g: grp, mat, x, z, r, t: 0, dur, dps, mult: mult || 1, tick: 0 });
  }
  function updateClouds(dt) {
    for (let i = FX.clouds.length - 1; i >= 0; i--) {
      const c = FX.clouds[i];
      c.t += dt;
      const fade = c.t < 0.4 ? c.t / 0.4 : c.t > c.dur - 0.8 ? Math.max(0, (c.dur - c.t) / 0.8) : 1;
      c.mat.opacity = 0.32 * fade;
      c.g.children.forEach(p => { p.position.y += Math.sin(now() * 2 + p.userData.ph) * dt * 0.3; p.rotation.y += dt * 0.4; });
      c.tick -= dt;
      if (c.tick <= 0 && player && !player.isDead) {
        c.tick = 0.5;
        const dx = player.mesh.position.x - c.x, dz = player.mesh.position.z - c.z;
        if (dx * dx + dz * dz < c.r * c.r) hurt(c.dps * 0.5, c.x, c.z, c.mult);
      }
      if (c.t >= c.dur) { scene.remove(c.g); c.mat.dispose(); FX.clouds.splice(i, 1); }
    }
  }

  /* ---------------------------------------------------------------------------
   * BUILD — turns a Tank shell into a creature (called from the Tank constructor)
   * -------------------------------------------------------------------------*/
  function build(tank) {
    const def = tank.typeData;
    const cfg = A.CREATURE_MODELS[def.creature];
    const gltf = A.getModel(cfg.model);
    const lib = cfg.anims ? A.getModel(cfg.anims) : null;
    const src = gltf.scene;
    const model = (T.SkeletonUtils && T.SkeletonUtils.clone) ? T.SkeletonUtils.clone(src) : src.clone(true);
    // per-instance materials (hit flash, tints, cloak)
    model.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = false;
      if (o.isSkinnedMesh || o.morphTargetInfluences) o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      const cl = mats.map(m => {
        const n = m.clone();
        n.userData = {};
        if (!n.emissive) n.emissive = new T.Color(0);
        if (n.map && !o.geometry.attributes.uv) { n.map = null; n.color.setHex(def.color); }   // e.g. Bat: no UVs → flat colour
        if (n.metalness >= 0.99 && !n.metalnessMap) { n.metalness = 0.05; n.roughness = Math.max(0.6, n.roughness); }
        if (cfg.tint) n.color.multiply(new T.Color(cfg.tint));
        if (cfg.skin) n.color.multiply(new T.Color(cfg.skin));
        if (def.creature === 'frostgiant') { n.emissive = new T.Color(0x0b2a55); }
        if (def.creature === 'wraith') { n.transparent = true; n.opacity = 0.85; }
        return n;
      });
      o.material = Array.isArray(o.material) ? cl : cl[0];
    });
    model.rotation.y = cfg.yaw || 0;
    model.updateMatrixWorld(true);
    _box.setFromObject(model, true);
    _box.getSize(_sz); _box.getCenter(_ctr);
    const s = cfg.h ? cfg.h / Math.max(0.001, _sz.y) : cfg.w / Math.max(0.001, Math.max(_sz.x, _sz.z));
    model.scale.setScalar(s);
    model.position.set(-_ctr.x * s, -_box.min.y * s, -_ctr.z * s);
    const h = _sz.y * s, len = Math.max(_sz.x, _sz.z) * s;

    const body = new T.Group();
    body.add(model);
    tank.mesh.add(body);

    // dullahan: remove the head bone, add a floating cursed head (it throws it!)
    let head = null;
    if (def.creature === 'dullahan') {
      model.traverse(o => { if (o.isBone && /^head$|Head$/i.test(o.name) && !head) { o.scale.setScalar(0.001); head = o; } });
      const skull = new T.Mesh(new T.SphereGeometry(0.28, 12, 10), new T.MeshStandardMaterial({ color: 0x2e1065, emissive: 0xa855f7, emissiveIntensity: 1.4 }));
      skull.position.set(0.55, h * 0.95, 0.2);
      body.add(skull); head = skull;
    }
    let orbMesh = null;
    if (def.healer || def.creature === 'frostgiant') { // glowing focus orb above casters
      orbMesh = new T.Mesh(new T.SphereGeometry(0.26, 14, 12), new T.MeshStandardMaterial({ color: 0xffffff, emissive: def.proj || 0x34d399, emissiveIntensity: 2 }));
      orbMesh.position.set(0, h + 0.45, 0);
      body.add(orbMesh);
    }
    let eyes = null;
    if (def.creature === 'mimic') {
      eyes = new T.Group();
      const em = new T.MeshStandardMaterial({ color: 0x000000, emissive: 0xffcc00, emissiveIntensity: 2.5 });
      [-0.35, 0.35].forEach(x => { const m = new T.Mesh(new T.SphereGeometry(0.11, 8, 6), em); m.position.set(x, h * 0.72, len * 0.26); eyes.add(m); });
      eyes.visible = false;
      body.add(eyes);
    }

    // turret pivot (aim) + invisible barrel = where shots come from
    tank.turretPivot = new T.Group();
    tank.turretPivot.position.y = h * 0.55;
    tank.mesh.add(tank.turretPivot);
    tank.barrel = new T.Object3D();
    tank.barrel.position.set(0, 0, Math.max(0.5, len * 0.45));
    tank.turretPivot.add(tank.barrel);
    tank.muzzlePos = tank.barrel.position.clone();

    const c = {
      key: def.creature, def, cfg, body, model, h, len, head, orbMesh, eyes,
      mixer: null, clips: [], roles: {}, cur: null, curAction: null, oneShotUntil: 0,
      hover: def.hover || 0, alt: def.hover || 0, t: 0, phase: 'approach', phaseT: 0, cd: rand(0.5, 2), cd2: rand(1, 3),
      side: Math.random() < 0.5 ? -1 : 1, orbitR: rand(11, 16), lift: h + (def.hover || 0) + 0.9, dir: new T.Vector2(),
    };
    tank.creature = c;
    // animations
    const clips = (lib && lib.animations ? lib.animations : []).concat(gltf.animations || []);
    if (clips.length) {
      c.mixer = new T.AnimationMixer(model);
      c.clips = clips;
      const ov = ROLE_OVERRIDE[def.creature] || {};
      for (const role in ROLE_CLIPS) {
        const names = ov[role] ? [ov[role]].concat(ROLE_CLIPS[role]) : ROLE_CLIPS[role];
        let clip = null;
        for (const n of names) { clip = clips.find(k => k.name === n); if (clip) break; }
        if (!clip && clips.length === 1) clip = clips[0]; // morph-animated birds: one flap clip
        c.roles[role] = clip;
      }
      if (!c.roles.idle) c.roles.idle = c.roles.walk || clips[0];
      play(c, 'idle');
      if (c.curAction) c.curAction.time = Math.random() * (c.curAction.getClip().duration || 1);
    }
    // per-type hooks
    if (def.armorFront) tank.damageFilter = (amt) => {
      if (!player) return amt;
      const yaw = tank.mesh.rotation.y + body.rotation.y;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const dx = player.mesh.position.x - tank.mesh.position.x, dz = player.mesh.position.z - tank.mesh.position.z;
      const d = Math.hypot(dx, dz) || 1;
      if ((fx * dx + fz * dz) / d > 0.45) {
        if (!tank._clangAt || now() - tank._clangAt > 0.25) { tank._clangAt = now(); createExplosion(tank.mesh.position.clone().add(new T.Vector3(fx * 1.6, c.h * 0.6, fz * 1.6)), 3, 0xd4d4d8, 'armor'); }
        return amt * def.armorFront;
      }
      return amt;
    };
    if (def.ai === 'wraith') tank.damageFilter = (amt) => (c.phased ? 0 : amt);
    if (def.ai === 'mimic') {
      tank.disguised = true;
      tank.onDamaged = () => { if (tank.disguised) reveal(tank); };
    }
    tank.onDamaged = tank.onDamaged || ((amt) => { if (Math.random() < 0.5 && c.roles.hit && now() > c.oneShotUntil) play(c, 'hit', true); });
    return tank;
  }

  function play(c, role, once, timeScale) {
    if (!c.mixer) return 0;
    const clip = c.roles[role] || (once ? null : c.roles.idle);
    if (!clip) return 0;
    const a = c.mixer.clipAction(clip);
    if (!once && c.curAction === a) { if (timeScale) a.timeScale = timeScale; return clip.duration; }
    a.reset();
    a.setLoop(once ? T.LoopOnce : T.LoopRepeat, Infinity);
    a.clampWhenFinished = !!once;
    a.timeScale = timeScale || 1;
    a.enabled = true;
    a.fadeIn(0.15).play();
    if (c.curAction && c.curAction !== a) c.curAction.fadeOut(0.15);
    c.curAction = a; c.cur = role;
    c.oneShotUntil = once ? now() + clip.duration / (timeScale || 1) * 0.92 : 0;
    return clip.duration;
  }

  // locomotion blend + body facing (runs every frame for every creature)
  function animate(e, dt, faceAim) {
    const c = e.creature;
    const speed = e.velocity.length() / Math.max(dt, 1e-3);
    if (c.mixer && now() > c.oneShotUntil) {
      if (c.single) {}
      else if (speed < 1.2) play(c, 'idle');
      else if (speed < 9 && c.roles.walk && c.roles.walk !== c.roles.run) play(c, 'walk', false, Math.min(1.8, Math.max(0.6, speed / 5)));
      else play(c, 'run', false, Math.min(1.8, Math.max(0.7, speed / 11)));
    }
    // face the aim direction when slow/attacking; otherwise face the travel direction
    let want = 0;
    if (faceAim || speed < 2.5) want = wrapA(e.turretPivot.rotation.y);
    c.body.rotation.y += wrapA(want - c.body.rotation.y) * (1 - Math.exp(-10 * dt));
    // flyers: altitude + bob
    if (c.hover || c.alt) {
      c.body.position.y = c.alt + Math.sin(now() * 2.6 + c.side) * 0.18;
      e.turretPivot.position.y = c.body.position.y + c.h * 0.55;
    }
    if (c.orbMesh) c.orbMesh.position.y = c.h + 0.45 + Math.sin(now() * 3) * 0.12;
    if (c.head && c.head.isMesh) c.head.position.y = c.h * 0.95 + Math.sin(now() * 2.2) * 0.1;
    e._hpBarLift = c.h + c.body.position.y + 0.9;
  }

  /* ---------------------------------------------------------------------------
   * AI — returns after moving/attacking; the caller keeps its idle/hp-bar logic
   * -------------------------------------------------------------------------*/
  function ai(e, dt, toPlayer, dist, step) {
    const c = e.creature;
    if (!c) return;
    const def = e.typeData;
    c.t += dt; c.phaseT += dt; c.cd -= dt; c.cd2 -= dt;
    const inv = 1 / (dist || 1), fx = toPlayer.x * inv, fz = toPlayer.z * inv;
    const t = now();
    let faceAim = true;
    const set = (p) => { c.phase = p; c.phaseT = 0; };
    const toward = (m) => go(e, step, fx, fz, m);
    const away = (m) => go(e, step, -fx, -fz, m);
    const strafe = (m, s) => go(e, step, -fz * (s || c.side), fx * (s || c.side), m);
    const keepRange = (lo, hi, m) => { if (dist > hi) toward(m); else if (dist < lo) away(m); else strafe(0.6 * (m || 1)); };
    const orbit = (R, m) => { // steer toward a point on a circle around the player
      const a = Math.atan2(e.mesh.position.z - player.mesh.position.z, e.mesh.position.x - player.mesh.position.x) + c.side * 0.55;
      const tx = player.mesh.position.x + Math.cos(a) * R - e.mesh.position.x, tz = player.mesh.position.z + Math.sin(a) * R - e.mesh.position.z;
      const l = Math.hypot(tx, tz) || 1; go(e, step, tx / l, tz / l, m);
    };
    const fireRoll = (base) => enemyFireRoll(base, dt);
    e.aimAt(player.mesh.position, dt);

    switch (def.ai) {
      /* ---------------- CHARGERS: boar, rhino, bull, stag, steed ---------------- */
      case 'charger': {
        if (c.phase === 'approach') {
          if (dist > 11) toward(1); else strafe(0.7);
          if (dist < 20 && c.cd <= 0) { set('windup'); c.dir.set(fx, fz); play(c, 'idle', false, 2.2); }
          if (def.lightning && c.cd2 <= 0 && dist < 34) { // thunder stag: lightning where you stand
            c.cd2 = rand(5, 7);
            play(c, 'attack', true);
            const px = player.mesh.position.x, pz = player.mesh.position.z;
            telegraph(px, pz, 3.2, 1.0, def.damage, 0x93c5fd, { kind: 'lightning', mult: e.damageMult });
            telegraph(px + rand(-6, 6), pz + rand(-6, 6), 3.2, 1.3, def.damage, 0x93c5fd, { kind: 'lightning', mult: e.damageMult });
          }
        } else if (c.phase === 'windup') {
          c.dir.set(fx, fz);
          c.body.position.x = Math.sin(t * 60) * 0.06; // quiver
          if (Math.random() < 0.25) createExplosion(e.mesh.position.clone().add(new T.Vector3(-fx * 1.2, 0.2, -fz * 1.2)), 1, 0x9a8a70, 'ground');
          if (c.phaseT > 0.75) { set('dash'); c.body.position.x = 0; c.hitDone = false; play(c, 'run', false, 1.8); }
        } else if (c.phase === 'dash') {
          faceAim = false;
          go(e, step, c.dir.x, c.dir.y, 2.7);
          if (!c.hitDone && dist < 2.6 + c.len * 0.3) {
            c.hitDone = true;
            play(c, 'attack', true);
            hurt(def.damage, e.mesh.position.x, e.mesh.position.z, e.damageMult);
            const k = def.knock || 1.6;
            player.mesh.position.x += c.dir.x * k; player.mesh.position.z += c.dir.y * k;
            state.cameraShake = Math.max(state.cameraShake || 0, 0.35);
          }
          if (c.phaseT > 1.15) {
            if (def.nova) { radial(e, def.nova, { dmg: def.damage * 0.6 }); }
            set('recover'); c.cd = rand(2.2, 3.4);
          }
        } else { // recover
          if (c.phaseT > 0.9) set('approach');
        }
        break;
      }
      /* ---------------- FLANKERS: fox, wolf ---------------- */
      case 'flanker': {
        if (c.phase === 'approach') {
          faceAim = false;
          if (dist > 22) toward(1.1); else orbit(c.orbitR, 1.05);
          if (!def.noBolt && c.cd2 <= 0 && dist < 26) { c.cd2 = rand(2.2, 3.2); fire(e, { dmg: def.damage }); play(c, 'attack', true); }
          if (dist < 17 && c.cd <= 0) { set('lunge'); c.hitDone = false; c.dir.set(fx, fz); }
        } else if (c.phase === 'lunge') {
          faceAim = false;
          c.dir.set(fx, fz);
          go(e, step, c.dir.x, c.dir.y, 2.3);
          if (!c.hitDone && dist < 3.1) {
            c.hitDone = true; play(c, 'attack', true);
            hurt(def.damage * 1.2, e.mesh.position.x, e.mesh.position.z, e.damageMult);
            set('retreat');
          }
          if (c.phaseT > 1.4) set('retreat');
        } else { // retreat
          faceAim = false;
          go(e, step, -fx + (-fz * c.side) * 0.6, -fz + (fx * c.side) * 0.6, 1.4);
          if (c.phaseT > 0.9) { set('approach'); c.cd = rand(2.4, 4); c.side = -c.side; }
        }
        break;
      }
      /* ---------------- FLYERS: bat, parrot, stork, flamingo ---------------- */
      case 'diver': {
        const H = c.hover;
        if (c.phase === 'approach') {
          c.alt += (H - c.alt) * Math.min(1, dt * 2);
          if (dist > 26) toward(1.1); else orbit(def.dive === 'bomb' ? 4 : 13, 1.0);
          if (def.dive === 'volley' && c.cd2 <= 0 && dist < 28) { c.cd2 = rand(2.0, 2.8); fire(e, { count: 3, spread: 0.2 }); }
          if (def.dive === 'bomb') {
            const flat = Math.hypot(toPlayer.x, toPlayer.z);
            if (flat < 7 && c.cd2 <= 0) {
              c.cd2 = rand(1.6, 2.4);
              const vx = player.velocity.x * 30, vz = player.velocity.z * 30; // lead the target a little
              telegraph(player.mesh.position.x + vx, player.mesh.position.z + vz, 3.6, 1.05, def.damage, 0xfbbf24, { egg: c.alt + c.h, mult: e.damageMult });
            }
          }
          if ((def.dive === 'bite' || def.dive === 'strafe' || (def.dive === 'volley' && Math.random() < 0.3)) && c.cd <= 0 && dist < 22) { set('dive'); c.hitDone = false; }
        } else if (c.phase === 'dive') {
          faceAim = false;
          toward(2.1);
          c.alt += (0.9 - c.alt) * Math.min(1, dt * 3.5);
          if (def.dive === 'strafe' && c.cd2 <= 0) { c.cd2 = 0.16; fire(e, { jitter: 0.25, life: 0.5 }); }
          if (!c.hitDone && dist < 3) {
            c.hitDone = true;
            hurt(def.damage * (def.dive === 'bite' ? 1.2 : 0.8), e.mesh.position.x, e.mesh.position.z, e.damageMult);
            set('climb');
          }
          if (c.phaseT > 1.6) set('climb');
        } else { // climb away
          faceAim = false;
          go(e, step, -fx + -fz * c.side, -fz + fx * c.side, 1.5);
          c.alt += (H - c.alt) * Math.min(1, dt * 2.2);
          if (c.phaseT > 1.2) { set('approach'); c.cd = rand(2.5, 4.2); }
        }
        break;
      }
      /* ---------------- QUACK BOMB (duck) ---------------- */
      case 'quackbomb': {
        faceAim = false;
        toward(1);
        c.body.rotation.z = Math.sin(t * 16) * 0.22;        // waddle
        c.body.position.y = Math.abs(Math.sin(t * 16)) * 0.18;
        if (dist < 3.6) { e.hp = 0; c.selfDestruct = true; e.die(); }
        break;
      }
      /* ---------------- CRATE MIMIC ---------------- */
      case 'mimic': {
        if (e.disguised) {
          faceAim = false;
          if (e.hpBar) e.hpBar.visible = false;
          if (dist < 11 || c.t > 22) reveal(e); // never stall a level
          break;
        }
        if (e.hpBar) e.hpBar.visible = true;
        c.hop = (c.hop || 0) + dt;
        const period = 0.55, k = (c.hop % period) / period;
        c.body.position.y = Math.sin(k * Math.PI) * 1.1;
        c.body.scale.set(1 + (k < 0.12 ? 0.18 : 0), k < 0.12 ? 0.8 : 1.05, 1 + (k < 0.12 ? 0.18 : 0));
        c.model.rotation.x = -Math.sin(k * Math.PI) * 0.25;
        toward(1.25);
        if (dist < 3 && c.cd <= 0) { c.cd = 0.8; hurt(def.damage, e.mesh.position.x, e.mesh.position.z, e.damageMult); }
        break;
      }
      /* ---------------- CASTER: shaman (heals allies) ---------------- */
      case 'caster': {
        keepRange(15, 24, 1);
        if (c.cd <= 0) { // heal pulse
          c.cd = 4.2;
          let healed = 0;
          for (const o of enemies) {
            if (o === e || o.isDead || o.hp >= o.maxHp || o.disguised) continue;
            if (o.mesh.position.distanceToSquared(e.mesh.position) < 18 * 18) { o.heal(Math.max(10, o.maxHp * 0.12)); healed++; }
          }
          if (healed) { play(c, 'cast', true); pulseRing(e.mesh.position, 18, 0x34d399); }
        }
        if (c.cd2 <= 0 && dist < 30) { c.cd2 = rand(2.6, 3.4); play(c, 'attack', true); orb(e, { speed: 13, turn: 2.0 }); }
        break;
      }
      /* ---------------- SENTINEL ROBOT ---------------- */
      case 'sentinel': {
        if (dist < 5) {
          if (c.cd2 <= 0) { c.cd2 = 1.2; play(c, 'attack', true); hurt(def.damage * 2.2, e.mesh.position.x, e.mesh.position.z, e.damageMult); player.mesh.position.x += fx * 1.5; player.mesh.position.z += fz * 1.5; }
        } else keepRange(16, 26, 1);
        if ((c.burst || 0) > 0) {
          if (t > (c.burstAt || 0)) { c.burst--; c.burstAt = t + 0.12; fire(e, { jitter: 0.06 }); }
        } else if (c.cd <= 0 && dist < 32) { c.cd = rand(2.8, 3.6); c.burst = 5; }
        break;
      }
      /* ---------------- ORC BRUTE ---------------- */
      case 'brute': {
        if (c.phase === 'approach') {
          toward(1);
          if (dist < 6.5 && c.cd <= 0) {
            set('slam'); play(c, 'attack', true, 0.8);
            telegraph(e.mesh.position.x, e.mesh.position.z, 6.5, 0.75, def.damage, 0x84cc16, { mult: e.damageMult });
          }
          if (c.cd2 <= 0 && dist > 14 && dist < 30) { c.cd2 = rand(4, 6); telegraph(player.mesh.position.x, player.mesh.position.z, 3, 1.1, def.damage * 0.7, 0xa16207, { egg: 6, mult: e.damageMult }); play(c, 'cast', true); }
        } else if (c.phase === 'slam') {
          if (c.phaseT > 1.0) { set('approach'); c.cd = rand(2, 3); }
        }
        break;
      }
      /* ---------------- ROGUE GUNSLINGER ---------------- */
      case 'gunslinger': {
        if (c.phase === 'roll') {
          faceAim = false;
          go(e, step, -fz * c.side, fx * c.side, 2.6);
          if (c.phaseT > 0.45) set('approach');
          break;
        }
        keepRange(12, 20, 1);
        if ((c.burst || 0) > 0) { if (t > (c.burstAt || 0)) { c.burst--; c.burstAt = t + 0.16; fire(e, { lead: 0.25 }); play(c, 'attack', true); } }
        else if (c.cd <= 0 && dist < 28) { c.cd = rand(1.4, 2.0); c.burst = 2; }
        if (c.cd2 <= 0 && dist < 22) { c.cd2 = rand(2.8, 4.2); c.side = Math.random() < 0.5 ? -1 : 1; set('roll'); play(c, 'roll', true, 1.3); }
        break;
      }
      /* ---------------- DULLAHAN ---------------- */
      case 'dullahan': {
        toward(dist > 4 ? 1.1 : 0.2);
        if (dist < 4.6 && c.cd <= 0) { c.cd = 1.3; play(c, 'attack', true); hurt(def.damage, e.mesh.position.x, e.mesh.position.z, e.damageMult); }
        if (c.cd2 <= 0 && dist > 8 && dist < 30) {
          c.cd2 = rand(3, 4); play(c, 'cast', true);
          orb(e, { speed: 16, turn: 2.6, dmg: def.damage * 0.8, color: 0xc084fc });
          if (c.head) { c.head.visible = false; setTimeout(() => { if (c.head) c.head.visible = true; }, 1500); }
        }
        break;
      }
      /* ---------------- SPORECAP ---------------- */
      case 'sporecap': {
        if (dist > 7) toward(1); else strafe(0.5);
        if (c.cd <= 0 && dist < 16) { c.cd = rand(3.5, 4.5); play(c, 'attack', true); cloud(e.mesh.position.x, e.mesh.position.z, 4.5, 4.5, def.damage * 2, 0x9acd32, e.damageMult); }
        break;
      }
      /* ---------------- CACTORO ---------------- */
      case 'cactoro': {
        if (dist > 15) toward(1); else if (dist < 5) { if (c.cd2 <= 0) { c.cd2 = 1; play(c, 'attack', true); hurt(def.damage * 1.6, e.mesh.position.x, e.mesh.position.z, e.damageMult); } }
        if (c.cd <= 0 && dist < 26) {
          c.cd = rand(2.4, 3.2); play(c, 'jump', true);
          radial(e, 10, { life: 0.6 });
          setTimeout(() => { if (!e.isDead && player) fire(e, { count: 3, spread: 0.12 }); }, 350);
        }
        break;
      }
      /* ---------------- FIRE IMP ---------------- */
      case 'imp': {
        keepRange(13, 20, 1.1);
        if (c.cd <= 0 && dist < 28) { c.cd = rand(1.8, 2.4); fire(e, { count: 3, spread: 0.18 }); }
        break;
      }
      /* ---------------- ROCK SPRITE ---------------- */
      case 'sprite': {
        faceAim = true;
        orbit(10, 1.1);
        if (c.cd <= 0 && dist < 24) { c.cd = rand(0.8, 1.2); fire(e, { jitter: 0.1 }); }
        break;
      }
      /* ---------------- WRAITH ---------------- */
      case 'wraith': {
        if (c.phase === 'approach' || c.phase === 'phase') {
          if (!c.phased) setPhased(e, true);
          if (dist > 3.4) toward(1.8); else { set('strike'); setPhased(e, false); play(c, 'attack', true); }
          if (c.phaseT > 3.2) { set('linger'); setPhased(e, false); }
        } else if (c.phase === 'strike') {
          if (!c.hitDone) {
            c.hitDone = true;
            if (dist < 4.2) { hurt(def.damage, e.mesh.position.x, e.mesh.position.z, e.damageMult); e.hp = Math.min(e.maxHp, e.hp + def.damage); e.updateHpBar(); }
          }
          set('linger');
        } else { // linger — solid and shootable
          keepRange(8, 14, 0.8);
          if (c.phaseT > 0.6 && c.cd <= 0) { c.cd = 5; fire(e, { count: 2, spread: 0.2 }); }
          if (c.phaseT > 2.2) { set('approach'); c.hitDone = false; }
        }
        break;
      }
      /* ---------------- TIKI SPIRIT ---------------- */
      case 'tiki': {
        const rage = e.hp < e.maxHp * 0.5;
        keepRange(12, 20, rage ? 1.3 : 1);
        if (c.cd <= 0 && dist < 26) { c.cd = rage ? rand(1.1, 1.5) : rand(2.2, 2.8); fire(e, { count: 5, spread: 0.16 }); play(c, 'attack', true); }
        break;
      }
      /* ---------------- VOIDLING ---------------- */
      case 'voidling': {
        keepRange(10, 18, 1);
        if (c.cd <= 0 && dist < 34) {
          c.cd = rand(3, 3.8);
          createExplosion(e.mesh.position.clone().setY(e.mesh.position.y + 1), 6, 0x8b5cf6, 'spark');
          const a = Math.random() * Math.PI * 2, d = rand(10, 15);
          e.mesh.position.x = player.mesh.position.x + Math.cos(a) * d;
          e.mesh.position.z = player.mesh.position.z + Math.sin(a) * d;
          e.velocity.set(0, 0, 0);
          createExplosion(e.mesh.position.clone().setY(e.mesh.position.y + 1), 6, 0x8b5cf6, 'spark');
          c.burst = 3; c.burstAt = t + 0.35;
        }
        if ((c.burst || 0) > 0 && t > c.burstAt) { c.burst--; c.burstAt = t + 0.18; fire(e, {}); play(c, 'attack', true); }
        break;
      }
      /* ---------------- STORM DJINN ---------------- */
      case 'djinn': {
        keepRange(12, 22, 1);
        c.body.rotation.y += dt * 1.5;
        if (c.cd <= 0 && dist < 28) { c.cd = rand(3, 3.8); radial(e, 10); play(c, 'attack', true); }
        if (c.cd2 <= 0 && dist < 26) { c.cd2 = rand(1.6, 2.2); fire(e, {}); }
        break;
      }
      /* ---------------- EMBER DRAKE ---------------- */
      case 'drake': {
        if (c.phase === 'breath') {
          if (c.cd2 <= 0) { c.cd2 = 0.09; fire(e, { jitter: 0.35, life: 0.42 }); }
          if (dist > 6) toward(0.4);
          if (c.phaseT > 1.5) { set('approach'); c.cd = rand(3, 4); }
        } else {
          keepRange(9, 16, 1);
          if (c.cd <= 0 && dist < 17) { set('breath'); play(c, 'attack', true); }
        }
        break;
      }
      /* ---------------- BOSS: ELDER WYRM ---------------- */
      case 'wyrm': {
        if (c.phase === 'breath') {
          const sweep = Math.sin(c.phaseT * 2.2) * 0.6;
          if (c.cd2 <= 0) { c.cd2 = 0.07; fire(e, { jitter: 0.2, life: 0.55, spread: 0 }); bullets[bullets.length - 1].group.userData.vel.applyAxisAngle(UP, sweep); }
          if (c.phaseT > 2.4) { set('approach'); c.cd = e.attackInterval || 3; }
        } else if (c.phase === 'rain') {
          if (c.phaseT > 0.3 && !c.rained) {
            c.rained = true;
            for (let i = 0; i < 7; i++) { const a = Math.random() * 6.28, d = i === 0 ? 0 : rand(3, 11); telegraph(player.mesh.position.x + Math.cos(a) * d, player.mesh.position.z + Math.sin(a) * d, 3.4, 1.2 + i * 0.12, def.damage * 1.4, 0xff6a00, { egg: 14, mult: e.damageMult }); }
          }
          if (c.phaseT > 1.6) { set('approach'); c.cd = e.attackInterval || 3; }
        } else {
          keepRange(12, 22, 1);
          if (c.cd <= 0) {
            const r = Math.random();
            if (r < 0.45 && dist < 20) { set('breath'); play(c, 'attack', true); }
            else if (r < 0.8) { set('rain'); c.rained = false; play(c, 'cast', true); }
            else { radial(e, 16, { dmg: def.damage }); c.cd = 2; }
          }
        }
        break;
      }
      /* ---------------- BOSS: GOLEM KING ---------------- */
      case 'golemking': {
        keepRange(8, 18, 1);
        if (c.cd <= 0) {
          c.cd = e.attackInterval || 3.6;
          play(c, 'attack', true);
          if (dist < 12) telegraph(e.mesh.position.x, e.mesh.position.z, 9, 1.0, def.damage, 0xa8a29e, { mult: e.damageMult });
          else { radial(e, 14, { dmg: def.damage * 0.6 }); setTimeout(() => { if (!e.isDead) radial(e, 14, { dmg: def.damage * 0.6 }); }, 400); }
        }
        if (!c.sum1 && e.hp < e.maxHp * 0.66) { c.sum1 = true; summon(e, 'sprite', 3); }
        if (!c.sum2 && e.hp < e.maxHp * 0.33) { c.sum2 = true; summon(e, 'sprite', 4); }
        break;
      }
      /* ---------------- BOSS: FROST GIANT ---------------- */
      case 'frostgiant': {
        keepRange(10, 20, 1);
        if (c.cd <= 0) {
          c.cd = e.attackInterval || 3.8;
          const r = Math.random();
          if (dist < 11 || r < 0.3) { play(c, 'attack', true, 0.7); telegraph(e.mesh.position.x, e.mesh.position.z, 10, 1.1, def.damage * 1.2, 0x93c5fd, { mult: e.damageMult }); }
          else if (r < 0.7) { // ice spike line toward the player
            play(c, 'cast', true);
            for (let i = 1; i <= 8; i++) { const d = i * (dist / 7); telegraph(e.mesh.position.x + fx * d, e.mesh.position.z + fz * d, 2.3, 0.5 + i * 0.11, def.damage, 0xbfdbfe, { kind: 'spike', mult: e.damageMult }); }
          } else { play(c, 'cast', true); fire(e, { count: 7, spread: 0.13 }); }
        }
        break;
      }
    }
    animate(e, dt, faceAim);
  }

  function setPhased(e, on) {
    const c = e.creature;
    c.phased = on;
    c.model.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { m.transparent = true; m.opacity = on ? 0.22 : 0.9; }); } });
  }
  function reveal(e) {
    if (!e.disguised) return;
    e.disguised = false;
    const c = e.creature;
    if (c.eyes) c.eyes.visible = true;
    if (e.hpBar) e.hpBar.visible = true;
    createExplosion(e.mesh.position.clone().setY(e.mesh.position.y + 1), 6, 0xa16207, 'tree');
    try { showEnemyIntro('mimic'); } catch (err) {}
    state.cameraShake = Math.max(state.cameraShake || 0, 0.2);
  }
  function summon(boss, type, n) {
    if (!ready(type)) return;
    for (let i = 0; i < n; i++) { const a = Math.random() * 6.28; makeScaledEnemy(type, boss.mesh.position.x + Math.cos(a) * 6, boss.mesh.position.z + Math.sin(a) * 6); }
    try { showBossBanner('⚔ ' + boss.typeData.name + ' SUMMONS MINIONS!'); } catch (err) {}
  }
  const pulses = [];
  function pulseRing(pos, r, color) {
    const m = new T.Mesh(geo().ring, new T.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, depthWrite: false }));
    m.position.set(pos.x, getTerrainHeight(pos.x, pos.z) + 0.3, pos.z);
    m.scale.setScalar(0.5);
    scene.add(m);
    pulses.push({ m, r, t: 0 });
  }
  function updatePulses(dt) {
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += dt;
      const k = p.t / 0.7;
      p.m.scale.setScalar(0.5 + p.r * k);
      p.m.material.opacity = 0.8 * (1 - k);
      if (k >= 1) { scene.remove(p.m); p.m.material.dispose(); pulses.splice(i, 1); }
    }
  }

  /* ---------------------------------------------------------------------------
   * DEATH — plays the death animation, then sinks into the ground
   * -------------------------------------------------------------------------*/
  function startDeath(e) {
    const c = e.creature;
    if (!c) return false;
    const def = e.typeData;
    if (def.deathBlast) { // quack bomb: boom (hurts the player if close, and other enemies)
      const r = def.deathBlast;
      createExplosion(e.mesh.position.clone(), 14, 0xff9900, 'spark');
      state.cameraShake = Math.max(state.cameraShake || 0, 0.5);
      const dx = player.mesh.position.x - e.mesh.position.x, dz = player.mesh.position.z - e.mesh.position.z;
      if (dx * dx + dz * dz < r * r) hurt(def.damage, e.mesh.position.x, e.mesh.position.z, e.damageMult);
      if (!c.selfDestruct) setTimeout(() => blastEnemies(e.mesh.position.x, e.mesh.position.z, r, 40), 0);
      scene.remove(e.mesh); disposeObject3D(e.mesh);
      return true;
    }
    if (def.ai === 'sporecap') cloud(e.mesh.position.x, e.mesh.position.z, 5, 3.5, def.damage * 2, 0x9acd32, e.damageMult);
    if (c.phased) setPhased(e, false);
    const dur = c.roles.death ? play(c, 'death', true) : 0;
    c.dieDur = dur ? Math.min(2.2, dur) : 0.7;
    c.dieT = 0; c.fallSide = Math.random() < 0.5 ? -1 : 1;
    createExplosion(e.mesh.position.clone().setY(e.mesh.position.y + c.h * 0.5 + c.alt), e.isBoss ? 16 : 5, def.color, 'spark');
    FX.dying.push(e);
    return true;
  }
  function updateDying(dt) {
    for (let i = FX.dying.length - 1; i >= 0; i--) {
      const e = FX.dying[i], c = e.creature;
      c.dieT += dt;
      if (c.mixer) c.mixer.update(dt);
      if (c.alt > 0) { c.alt = Math.max(0, c.alt - dt * (4 + c.dieT * 12)); c.body.position.y = c.alt; }
      if (!c.roles.death) c.body.rotation.z += (c.fallSide * Math.PI / 2 - c.body.rotation.z) * Math.min(1, dt * 6);
      if (c.dieT > c.dieDur + 0.5) e.mesh.position.y -= dt * 1.4 * Math.max(1, c.h / 2.5);
      if (c.dieT > c.dieDur + 1.6) {
        scene.remove(e.mesh); disposeObject3D(e.mesh);
        FX.dying.splice(i, 1);
      }
    }
  }

  /* ---------------------------------------------------------------------------
   * PER-FRAME + LIFECYCLE
   * -------------------------------------------------------------------------*/
  function update(dt) {
    for (const e of enemies) {
      if (e.creature && e.creature.mixer && !e.isDead) e.creature.mixer.update(dt);
    }
    updateDying(dt);
    updateTele(dt);
    updateOrbs(dt);
    updateClouds(dt);
    updatePulses(dt);
  }
  function reset() {
    FX.dying.forEach(e => { scene.remove(e.mesh); disposeObject3D(e.mesh); });
    FX.tele.forEach(t => { scene.remove(t.ring, t.disc); t.ring.material.dispose(); t.disc.material.dispose(); if (t.egg) { scene.remove(t.egg); t.egg.material.dispose(); } });
    FX.orbs.forEach(o => { scene.remove(o.g); o.g.children.forEach(m => m.material.dispose()); });
    FX.clouds.forEach(c => { scene.remove(c.g); c.mat.dispose(); });
    FX.bolts.forEach(b => { scene.remove(b.m); b.m.material.dispose(); });
    pulses.forEach(p => { scene.remove(p.m); p.m.material.dispose(); });
    FX.dying = []; FX.tele = []; FX.orbs = []; FX.clouds = []; FX.bolts = []; pulses.length = 0;
  }

  /* ---------------------------------------------------------------------------
   * SPAWN SELECTION + PRELOADING
   * -------------------------------------------------------------------------*/
  function pickForLevel(level, biome) {
    const pool = [];
    let tot = 0;
    for (const k in TYPES) {
      const d = TYPES[k];
      if (d.boss || d.minLevel > level) continue;
      if (!A.creatureReady(d.creature)) { A.ensureCreature(d.creature); continue; }
      let w = 1;
      if (d.biomes && d.biomes.indexOf(biome) >= 0) w *= 2.6;
      if (level - d.minLevel < 3) w *= 1.4; // fresh arrivals show up more
      pool.push([k, w]); tot += w;
    }
    if (!pool.length) return null;
    let r = Math.random() * tot;
    for (const p of pool) { r -= p[1]; if (r <= 0) return p[0]; }
    return pool[pool.length - 1][0];
  }
  function preload(level, immediate) {
    const keys = [];
    for (const k in TYPES) {
      const d = TYPES[k];
      if (d.boss ? level >= 3 : d.minLevel <= level + 2) keys.push(d.creature);
    }
    if (immediate) return Promise.all(keys.map(A.ensureCreature));
    const ids = [];
    keys.forEach(k => A.creatureModelIds(k).forEach(id => ids.push(id)));
    A.queueBackground(ids);
    return null;
  }
  function packSize(type) { const d = TYPES[type]; return d && d.pack ? d.pack : 1; }

  window.Creatures = { TYPES, register, ready, isCreatureType, build, ai, update, startDeath, reset, pickForLevel, preload, packSize, reveal };
  window.registerCreatureTypes = register;
})();
