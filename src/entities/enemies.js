/* ============================================================================
 * entities/enemies.js — the bestiary brain
 * ---------------------------------------------------------------------------
 * Behaviours: charger · leaper · flyer · bomber · shooter · brute · caster ·
 * turret · bossFlyer · bossBrute. All enemies share one update path: steer →
 * separate → avoid props → follow terrain → animate. Damage and scoring are
 * reported to the game through callbacks (no gameplay imports here).
 * ==========================================================================*/
import * as THREE from 'three';
import { ENEMIES } from '../config.js';
import { angleDelta, clamp, clamp01, damp, lerp, rand, TAU } from '../core/util.js';
import { terrainHeight } from '../world/terrain.js';
import { WORLD } from '../config.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _cols = [];

let UID = 1;

export class Enemy {
  constructor(type, inst, pos) {
    const spec = ENEMIES[type];
    this.id = UID++;
    this.type = type;
    this.spec = spec;
    this.name = spec.name;
    this.inst = inst;
    this.root = new THREE.Group();
    this.root.name = 'enemy:' + type;
    this.root.add(inst.group);
    this.pos = this.root.position;
    this.pos.copy(pos);
    this.vel = new THREE.Vector3();
    this.yaw = rand(0, TAU);
    this.hp = this.maxHp = spec.hp;
    this.radius = spec.radius * (spec.boss ? 1 : 1);
    this.height = inst.height || spec.height;
    this.alive = true;
    this.dying = false;
    this.dieT = 0;
    this.flying = !!spec.flying;
    this.altitude = this.flying ? (spec.boss ? 13 : rand(5.5, 9)) : 0;
    this.attackCd = rand(0.6, 1.4) * spec.attackCd;
    this.attackT = 0;       // 0..1 animation progress of an attack
    this.state = 'approach';
    this.stateT = 0;
    this.orbitDir = Math.random() > 0.5 ? 1 : -1;
    this.hitPulse = 0;
    this.speedNow = 0;
    this.airVel = 0;
    this.airborne = false;
    this.meleeCd = 0;
    this.ramCd = 0;
    this.burst = 0;
    this.burstT = 0;
    this.lastSeenBehind = 0;
    this.lookYaw = 0;
    this.enraged = false;
    this.pos.y = terrainHeight(this.pos.x, this.pos.z) + this.altitude;
    this.root.rotation.y = this.yaw;
  }

  get center() { return _v2.set(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z); }
}

export class EnemyManager {
  constructor(scene, models, particles, projectiles) {
    this.scene = scene;
    this.models = models;
    this.particles = particles;
    this.projectiles = projectiles;
    this.list = [];
    this.boss = null;
    this.callbacks = {};   // onPlayerDamage(amount, src, pos) · onKill(enemy) · onAttackSound(kind, pos)
  }

  spawn(type, pos) {
    const inst = this.models.instance(type, Math.random() * 9999);
    if (!inst) return null;
    const e = new Enemy(type, inst, pos);
    this.scene.add(e.root);
    this.list.push(e);
    if (e.spec.boss) this.boss = e;
    // spawn-in flourish
    this.particles.magicBurst(_v.set(pos.x, e.pos.y + 0.6, pos.z), e.spec.accent, e.spec.boss ? 3 : 0.9);
    return e;
  }

  get aliveCount() { let n = 0; for (const e of this.list) if (e.alive && !e.dying) n++; return n; }

  /** deal damage; returns true when this hit killed it */
  damage(e, amount, from) {
    if (!e.alive || e.dying) return false;
    e.hp -= amount;
    e.hitPulse = 1;
    if (e.spec.boss && e.hp < e.maxHp * 0.5 && !e.enraged) {
      e.enraged = true;
      this.particles.magicBurst(e.center.clone(), 0xff3b2a, 3.2);
    }
    if (from) {
      // knockback for small creatures
      const mass = clamp(e.maxHp / 40, 1, 30);
      _v.set(e.pos.x - from.x, 0, e.pos.z - from.z).normalize().multiplyScalar(amount * 0.22 / mass);
      e.vel.add(_v);
    }
    if (e.hp <= 0) { this.kill(e); return true; }
    return false;
  }

  kill(e) {
    e.dying = true;
    e.dieT = 0;
    e.hp = 0;
    const c = e.center.clone();
    const organic = !/mech|sentry|idol|golem|titan/.test(e.type);
    if (organic) {
      this.particles.ichor(c, e.type === 'wraith' ? 0x6affd8 : e.type === 'phoenix' ? 0xff9a3a : 0x7a1622, e.spec.boss ? 3 : 1.2);
      this.particles.explosion(c, { power: e.spec.boss ? 3.5 : 0.7, color: e.spec.accent, scorch: !e.flying, debrisColor: e.spec.tint });
    } else {
      this.particles.explosion(c, { power: e.spec.boss ? 4 : 1.3, color: 0xffa53a, debrisColor: e.spec.tint });
    }
    if (this.callbacks.onKill) this.callbacks.onKill(e);
    if (this.boss === e) this.boss = null;
  }

  remove(e) {
    e.alive = false;
    this.scene.remove(e.root);
    if (e.inst.mixer) e.inst.mixer.stopAllAction();
    const i = this.list.indexOf(e);
    if (i >= 0) this.list.splice(i, 1);
    if (this.boss === e) this.boss = null;
  }

  clear() {
    for (const e of this.list.slice()) this.remove(e);
    this.list.length = 0;
    this.boss = null;
  }

  /* ----------------------------------------------------------------------- */
  update(dt, player, chunks, time) {
    const P = player.pos;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (!e.alive) continue;

      if (e.dying) {
        e.dieT += dt;
        const k = clamp01(e.dieT / 0.9);
        e.root.rotation.z = lerp(0, e.flying ? 1.4 : 1.2, k);
        if (e.flying) { e.pos.y -= dt * (6 + e.dieT * 18); const g = terrainHeight(e.pos.x, e.pos.z); if (e.pos.y < g) e.pos.y = g; }
        else e.pos.y -= dt * 0.9 * k;
        e.root.scale.setScalar(Math.max(0.01, 1 - Math.max(0, k - 0.6) * 2.4));
        e.inst.update(dt * 0.5, { speed: 0, dying: true });
        if (e.dieT > 1.0) this.remove(e);
        continue;
      }

      // recycle enemies that fell far behind the endless drive
      const dx = P.x - e.pos.x, dz = P.z - e.pos.z;
      const dist = Math.hypot(dx, dz);
      const behind = (dx * Math.sin(player.yaw) + dz * Math.cos(player.yaw)) > 0;   // enemy is behind the tank
      if (!e.spec.boss && (dist > 190 || (behind && dist > 75 && spec_slow(e, player)))) { this.relocate(e, player); continue; }

      e.stateT += dt;
      e.attackCd -= dt;
      e.meleeCd -= dt;
      e.ramCd -= dt;
      if (e.attackT > 0) e.attackT = Math.min(1, e.attackT + dt * 2.2);
      if (e.attackT >= 1) e.attackT = 0;
      e.hitPulse = Math.max(0, e.hitPulse - dt * 5);

      const spec = e.spec;
      const rage = e.enraged ? 1.35 : 1;
      const toPlayerYaw = Math.atan2(dx, dz);
      let desiredYaw = toPlayerYaw;
      let desiredSpeed = spec.speed * rage;

      switch (spec.behavior) {
        case 'charger': this.bCharger(e, dt, player, dist, toPlayerYaw); desiredYaw = e.wantYaw; desiredSpeed = e.wantSpeed; break;
        case 'leaper': this.bLeaper(e, dt, player, dist, toPlayerYaw); desiredYaw = e.wantYaw; desiredSpeed = e.wantSpeed; break;
        case 'flyer': this.bFlyer(e, dt, player, dist, toPlayerYaw); desiredYaw = e.wantYaw; desiredSpeed = e.wantSpeed; break;
        case 'bomber': this.bBomber(e, dt, player, dist, toPlayerYaw); desiredYaw = e.wantYaw; desiredSpeed = e.wantSpeed; break;
        case 'shooter': this.bShooter(e, dt, player, dist, toPlayerYaw); desiredYaw = e.wantYaw; desiredSpeed = e.wantSpeed; break;
        case 'caster': this.bCaster(e, dt, player, dist, toPlayerYaw); desiredYaw = e.wantYaw; desiredSpeed = e.wantSpeed; break;
        case 'brute': case 'bossBrute': this.bBrute(e, dt, player, dist, toPlayerYaw, rage); desiredYaw = e.wantYaw; desiredSpeed = e.wantSpeed; break;
        case 'turret': this.bTurret(e, dt, player, dist, toPlayerYaw); desiredYaw = toPlayerYaw; desiredSpeed = 0; break;
        case 'bossFlyer': this.bDragon(e, dt, player, dist, toPlayerYaw, rage); desiredYaw = e.wantYaw; desiredSpeed = e.wantSpeed; break;
      }

      // turning (big things turn slowly)
      const turnRate = spec.boss ? 1.4 : e.flying ? 3.2 : spec.hp > 120 ? 2.2 : 4.5;
      const d = angleDelta(e.yaw, desiredYaw);
      e.yaw += clamp(d, -turnRate * dt, turnRate * dt);
      e.speedNow = damp(e.speedNow, desiredSpeed, 4, dt);

      // integrate
      _dir.set(Math.sin(e.yaw), 0, Math.cos(e.yaw));
      e.pos.x += (_dir.x * e.speedNow + e.vel.x) * dt;
      e.pos.z += (_dir.z * e.speedNow + e.vel.z) * dt;
      e.vel.multiplyScalar(Math.max(0, 1 - dt * 3.5));

      // separation between enemies (cheap O(n²), n ≤ 30)
      for (let j = 0; j < this.list.length; j++) {
        const o = this.list[j];
        if (o === e || !o.alive || o.dying || o.flying !== e.flying) continue;
        const sx = e.pos.x - o.pos.x, sz = e.pos.z - o.pos.z;
        const rr = e.radius + o.radius;
        const d2 = sx * sx + sz * sz;
        if (d2 < rr * rr && d2 > 1e-4) {
          const dd = Math.sqrt(d2), push = (rr - dd) * 0.5;
          e.pos.x += (sx / dd) * push; e.pos.z += (sz / dd) * push;
        }
      }

      // walkers avoid trees/rocks, and stay out of deep water
      if (!e.flying && spec.speed > 0) {
        const cols = chunks.queryColliders(e.pos.x, e.pos.z, e.radius + 3, _cols);
        for (const c of cols) {
          const cx = e.pos.x - c.x, cz = e.pos.z - c.z;
          const rr = c.r + e.radius * 0.8;
          const d2 = cx * cx + cz * cz;
          if (d2 < rr * rr && d2 > 1e-4) {
            const dd = Math.sqrt(d2);
            e.pos.x += (cx / dd) * (rr - dd);
            e.pos.z += (cz / dd) * (rr - dd);
            // slide around: nudge heading tangentially
            e.yaw += e.orbitDir * dt * 2.5;
          }
        }
      }

      // vertical: terrain follow / flight / leaping
      const ground = terrainHeight(e.pos.x, e.pos.z);
      if (e.airborne) {
        e.airVel -= 30 * dt;
        e.pos.y += e.airVel * dt;
        if (e.pos.y <= ground) { e.pos.y = ground; e.airborne = false; this.onLand(e, player); }
      } else if (e.flying) {
        const floor = Math.max(ground, WORLD.waterLevel);
        const targetY = floor + e.altitude + Math.sin(time * 1.7 + e.id) * 0.8;
        e.pos.y = damp(e.pos.y, targetY, 2.6, dt);
      } else {
        const wading = ground < WORLD.waterLevel;
        e.pos.y = damp(e.pos.y, wading ? Math.max(ground, WORLD.waterLevel - e.height * 0.35) : ground, 14, dt);
      }

      // facing + animation
      e.root.rotation.y = e.yaw;
      e.root.rotation.z = e.flying ? clamp(-d * 0.6, -0.5, 0.5) : 0;
      const pulse = 1 + e.hitPulse * 0.12;
      e.root.scale.set(pulse, 1 + e.hitPulse * 0.06, pulse);
      e.lookYaw = clamp(angleDelta(e.yaw, toPlayerYaw), -0.8, 0.8);
      e.inst.update(dt, { speed: e.speedNow, attack: e.attackT, lookYaw: e.lookYaw, lookPitch: e.flying ? 0.3 : 0 });

      // contact damage with the tank (and the tank rams back)
      if (!e.flying || e.pos.y - player.pos.y < 3) {
        const rr = e.radius + player.radius;
        if (dist < rr) {
          const push = rr - dist;
          if (spec.speed > 0) {
            e.pos.x -= (dx / (dist || 1)) * push;
            e.pos.z -= (dz / (dist || 1)) * push;
          }
          if (this.callbacks.onContact) this.callbacks.onContact(e, dist);
        }
      }
    }
  }

  /* ---------------------------- behaviours ------------------------------- */
  melee(e, player, range, damage, knock = 0) {
    const d = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
    if (d > range + player.radius + e.radius || e.meleeCd > 0) return false;
    e.meleeCd = e.spec.attackCd;
    e.attackT = 0.001;
    if (this.callbacks.onPlayerDamage) this.callbacks.onPlayerDamage(damage, e, e.pos, knock);
    return true;
  }

  bCharger(e, dt, player, dist, toYaw) {
    e.wantYaw = toYaw;
    e.wantSpeed = e.spec.speed * (e.enraged ? 1.35 : 1);
    if (e.state === 'recoil') {
      e.wantYaw = toYaw + Math.PI + e.orbitDir * 0.6;
      e.wantSpeed = e.spec.speed * 0.6;
      if (e.stateT > 0.7) { e.state = 'approach'; e.stateT = 0; }
      return;
    }
    // lead the moving tank so chargers intercept instead of tail-chasing
    const lead = clamp(dist / Math.max(4, e.spec.speed), 0, 1.6);
    const tx = player.pos.x + player.vel.x * lead, tz = player.pos.z + player.vel.z * lead;
    e.wantYaw = Math.atan2(tx - e.pos.x, tz - e.pos.z);
    if (this.melee(e, player, 1.2, e.spec.damage, 4)) { e.state = 'recoil'; e.stateT = 0; }
  }

  bLeaper(e, dt, player, dist, toYaw) {
    const lead = clamp(dist / 14, 0, 1.2);
    const tx = player.pos.x + player.vel.x * lead, tz = player.pos.z + player.vel.z * lead;
    e.wantYaw = Math.atan2(tx - e.pos.x, tz - e.pos.z);
    e.wantSpeed = e.airborne ? e.spec.speed * 1.6 : e.spec.speed;
    if (!e.airborne && dist < 16 && dist > 5 && e.attackCd <= 0) {
      e.airborne = true;
      e.airVel = 13;
      e.attackCd = e.spec.attackCd;
      e.attackT = 0.001;
      if (this.callbacks.onAttackSound) this.callbacks.onAttackSound('leap', e.pos);
    }
    this.melee(e, player, 0.8, e.spec.damage * 0.6);
  }

  onLand(e, player) {
    this.particles.dust(e.pos, 1.2);
    const d = Math.hypot(player.pos.x - e.pos.x, player.pos.z - e.pos.z);
    if (d < e.radius + player.radius + 1.5 && this.callbacks.onPlayerDamage) {
      this.callbacks.onPlayerDamage(e.spec.damage, e, e.pos, 3);
    }
  }

  bFlyer(e, dt, player, dist, toYaw) {
    // orbit + strafe, periodically dive
    const orbitR = 18;
    if (e.state === 'dive') {
      e.wantYaw = toYaw;
      e.wantSpeed = e.spec.speed * 1.6;
      e.altitude = damp(e.altitude, 1.6, 3, dt);
      if (this.melee(e, player, 1.5, e.spec.damage, 2) || e.stateT > 2.4) { e.state = 'climb'; e.stateT = 0; }
      return;
    }
    if (e.state === 'climb') {
      e.altitude = damp(e.altitude, 7.5, 2, dt);
      e.wantYaw = toYaw + Math.PI * 0.75 * e.orbitDir;
      e.wantSpeed = e.spec.speed;
      if (e.stateT > 1.4) { e.state = 'approach'; e.stateT = 0; }
      return;
    }
    const tangent = toYaw + (Math.PI / 2) * e.orbitDir * clamp((orbitR * 1.6 - dist) / orbitR, -0.2, 1);
    e.wantYaw = dist > orbitR * 2.2 ? toYaw : tangent;
    e.wantSpeed = Math.max(e.spec.speed, player.speed * 1.1 + 4);
    if (e.attackCd <= 0 && dist < 44) {
      e.attackCd = e.spec.attackCd * rand(0.8, 1.3);
      if (Math.random() < 0.45) { e.state = 'dive'; e.stateT = 0; }
      else this.shoot(e, player, 'bolt', { damage: e.spec.damage, spread: 0.05 });
    }
  }

  bBomber(e, dt, player, dist, toYaw) {
    // overfly the tank ahead of its path and drop fire bombs
    const tx = player.pos.x + player.vel.x * 1.2, tz = player.pos.z + player.vel.z * 1.2;
    e.wantYaw = Math.atan2(tx - e.pos.x, tz - e.pos.z);
    if (e.state === 'pass') { e.wantYaw = e.passYaw; if (e.stateT > 1.8) { e.state = 'approach'; e.stateT = 0; } }
    e.wantSpeed = Math.max(e.spec.speed, player.speed + 6);
    e.altitude = 10;
    const hd = Math.hypot(tx - e.pos.x, tz - e.pos.z);
    if (hd < 6 && e.attackCd <= 0) {
      e.attackCd = e.spec.attackCd;
      e.attackT = 0.001;
      for (let i = 0; i < 2; i++) {
        _v.set(e.pos.x, e.pos.y - 0.5, e.pos.z);
        _dir.set(Math.sin(e.yaw) * 0.4 + rand(-0.15, 0.15), -1, Math.cos(e.yaw) * 0.4 + rand(-0.15, 0.15));
        this.projectiles.spawn('bomb', _v, _dir, { owner: e, byPlayer: false, damage: e.spec.damage, speed: 8 });
      }
      e.state = 'pass'; e.stateT = 0; e.passYaw = e.yaw;
      if (this.callbacks.onAttackSound) this.callbacks.onAttackSound('screech', e.pos);
    }
  }

  bShooter(e, dt, player, dist, toYaw) {
    const want = e.type === 'mech' ? 26 : 22;
    const tangent = toYaw + (Math.PI / 2) * e.orbitDir;
    if (dist > want + 10) { e.wantYaw = toYaw; e.wantSpeed = e.spec.speed; }
    else if (dist < want - 8) { e.wantYaw = toYaw + Math.PI; e.wantSpeed = e.spec.speed * 0.8; }
    else { e.wantYaw = tangent; e.wantSpeed = e.spec.speed * 0.55; }
    if (e.stateT > 3.5) { e.orbitDir *= -1; e.stateT = 0; }
    if (e.attackCd <= 0 && dist < 58) {
      e.attackCd = e.spec.attackCd * rand(0.85, 1.25);
      e.attackT = 0.001;
      const kind = e.type === 'mech' ? 'plasma' : 'spell';
      this.shoot(e, player, kind, { damage: e.spec.damage, spread: 0.035, height: e.height * 0.65 });
      if (e.type === 'mech') setTimeout(() => { if (e.alive && !e.dying) this.shoot(e, player, 'plasma', { damage: e.spec.damage * 0.7, spread: 0.06, height: e.height * 0.65 }); }, 180);
    }
  }

  bCaster(e, dt, player, dist, toYaw) {
    const want = 24;
    e.wantYaw = dist > want ? toYaw : toYaw + (Math.PI / 2) * e.orbitDir;
    e.wantSpeed = dist > want ? Math.max(e.spec.speed, player.speed * 0.9) : e.spec.speed * 0.8;
    e.altitude = 2.2;
    if (e.attackCd <= 0 && dist < 50) {
      e.attackCd = e.spec.attackCd * (e.enraged ? 0.6 : 1);
      e.attackT = 0.001;
      for (let i = -1; i <= 1; i++) this.shoot(e, player, 'spell', { damage: e.spec.damage * 0.7, yawOff: i * 0.16, height: e.height * 0.8 });
      if (this.callbacks.onAttackSound) this.callbacks.onAttackSound('cast', e.pos);
    }
  }

  bBrute(e, dt, player, dist, toYaw, rage) {
    const lead = clamp(dist / 20, 0, 1.5);
    const tx = player.pos.x + player.vel.x * lead, tz = player.pos.z + player.vel.z * lead;
    e.wantYaw = Math.atan2(tx - e.pos.x, tz - e.pos.z);
    e.wantSpeed = e.spec.speed * rage;
    const boss = e.spec.boss;
    if (e.state === 'windup') {
      e.wantSpeed = 0;
      if (e.stateT > 0.55) {
        e.state = 'approach'; e.stateT = 0;
        // throw a boulder (or a volley for the titan)
        const n = boss ? (e.enraged ? 5 : 3) : 1;
        for (let i = 0; i < n; i++) {
          this.lob(e, player, 'boulder', { damage: e.spec.damage * (boss ? 0.8 : 1), offset: (i - (n - 1) / 2) * 5 });
        }
      }
      return;
    }
    if (dist < e.radius + player.radius + 3.2 && e.meleeCd <= 0) {
      // ground slam: shockwave
      e.meleeCd = e.spec.attackCd * 1.2;
      e.attackT = 0.001;
      this.particles.explosion(_v.set(e.pos.x, e.pos.y + 0.3, e.pos.z), { power: boss ? 2.6 : 1.4, color: 0xd8b070, smokeColor: 0x6b5d4a, debrisColor: 0x6b5d4a });
      if (this.callbacks.onPlayerDamage) this.callbacks.onPlayerDamage(e.spec.damage, e, e.pos, 8);
      if (this.callbacks.onShake) this.callbacks.onShake(boss ? 1.2 : 0.6);
      return;
    }
    if (e.attackCd <= 0 && dist > 14 && dist < (boss ? 80 : 55)) {
      e.attackCd = e.spec.attackCd * (boss ? 1.1 : 1.6);
      e.state = 'windup'; e.stateT = 0; e.attackT = 0.001;
    }
  }

  bTurret(e, dt, player, dist, toYaw) {
    if (e.attackCd <= 0 && dist < 62) {
      e.attackCd = e.spec.attackCd;
      e.attackT = 0.001;
      e.burst = e.type === 'sentry' ? 3 : 1;
      e.burstT = 0;
    }
    if (e.burst > 0) {
      e.burstT -= dt;
      if (e.burstT <= 0) {
        e.burst--; e.burstT = 0.16;
        this.shoot(e, player, e.type === 'idol' ? 'spell' : 'bolt', { damage: e.spec.damage * (e.type === 'sentry' ? 0.55 : 1), spread: 0.04, height: e.height * 0.7 });
      }
    }
  }

  bDragon(e, dt, player, dist, toYaw, rage) {
    // circle high, strafe with fire breath, carpet-bomb fireballs
    const orbitR = 34;
    e.altitude = damp(e.altitude, e.state === 'breath' ? 7 : 13, 1.5, dt);
    const tangent = toYaw + (Math.PI / 2) * e.orbitDir * clamp((orbitR * 1.5 - dist) / orbitR, -0.3, 1);
    e.wantYaw = dist > orbitR * 2 ? toYaw : tangent;
    e.wantSpeed = Math.max(e.spec.speed * rage, player.speed + 5);
    if (e.state === 'breath') {
      e.wantYaw = toYaw;
      e.attackT = Math.min(0.5, e.attackT || 0.25);
      e.burstT -= dt;
      if (e.burstT <= 0) {
        e.burstT = 0.06;
        this.shoot(e, player, 'flame', { damage: 4 * rage, spread: 0.12, height: e.height * 0.62, fromHead: 3 });
      }
      if (e.stateT > 1.8) { e.state = 'approach'; e.stateT = 0; e.attackT = 0; }
      return;
    }
    if (e.attackCd <= 0) {
      e.attackCd = e.spec.attackCd * (e.enraged ? 1.4 : 2.0);
      if (dist < 38 && Math.random() < 0.6) { e.state = 'breath'; e.stateT = 0; e.burstT = 0; if (this.callbacks.onAttackSound) this.callbacks.onAttackSound('roar', e.pos); }
      else {
        const n = e.enraged ? 6 : 4;
        for (let i = 0; i < n; i++) this.lob(e, player, 'bomb', { damage: e.spec.damage * 0.55, offset: (i - (n - 1) / 2) * 5, lead: 1.1 });
      }
    }
  }

  /* ---- ranged helpers ---- */
  shoot(e, player, kind, o = {}) {
    const h = o.height != null ? o.height : e.height * 0.6;
    const fwd = o.fromHead || 0;
    _v.set(e.pos.x + Math.sin(e.yaw) * (e.radius * 0.6 + fwd), e.pos.y + h, e.pos.z + Math.cos(e.yaw) * (e.radius * 0.6 + fwd));
    const speed = kind === 'flame' ? 30 : kind === 'plasma' ? 58 : kind === 'spell' ? 38 : 44;
    const d = Math.hypot(player.pos.x - _v.x, player.pos.z - _v.z);
    const t = d / speed;
    const tx = player.pos.x + player.vel.x * t, tz = player.pos.z + player.vel.z * t;
    const ty = player.pos.y + 1.2;
    _dir.set(tx - _v.x, ty - _v.y, tz - _v.z).normalize();
    if (o.yawOff) _dir.applyAxisAngle(UP, o.yawOff);
    const sp = o.spread || 0;
    if (sp) { _dir.x += rand(-sp, sp); _dir.y += rand(-sp, sp) * 0.5; _dir.z += rand(-sp, sp); _dir.normalize(); }
    this.projectiles.spawn(kind, _v, _dir, { owner: e, byPlayer: false, damage: o.damage != null ? o.damage : e.spec.damage, color: e.spec.accent });
    if (this.callbacks.onAttackSound) this.callbacks.onAttackSound(kind, e.pos);
  }

  /** ballistic lob that lands where the tank WILL be */
  lob(e, player, kind, o = {}) {
    const speed = kind === 'boulder' ? 34 : 26;
    const g = kind === 'boulder' ? 24 : 18;
    _v.set(e.pos.x, e.pos.y + e.height * 0.9, e.pos.z);
    const lead = o.lead != null ? o.lead : 1;
    // estimate flight time from horizontal distance
    let tx = player.pos.x, tz = player.pos.z;
    let t = Math.hypot(tx - _v.x, tz - _v.z) / (speed * 0.7);
    tx = player.pos.x + player.vel.x * t * lead;
    tz = player.pos.z + player.vel.z * t * lead;
    // sideways offset (volleys)
    const side = o.offset || 0;
    const fx = tx - _v.x, fz = tz - _v.z;
    const fl = Math.hypot(fx, fz) || 1;
    tx += (-fz / fl) * side; tz += (fx / fl) * side;
    const ty = terrainHeight(tx, tz);
    const dx = tx - _v.x, dz = tz - _v.z, dy = ty - _v.y;
    const dh = Math.hypot(dx, dz);
    t = clamp(dh / (speed * 0.75), 0.5, 3.2);
    const vx = dx / t, vz = dz / t;
    const vy = (dy + 0.5 * g * t * t) / t;
    _dir.set(vx, vy, vz);
    const spd = _dir.length();
    _dir.normalize();
    this.projectiles.spawn(kind, _v, _dir, { owner: e, byPlayer: false, damage: o.damage, speed: spd, gravity: g, life: t + 1.5 });
    if (this.callbacks.onAttackSound) this.callbacks.onAttackSound(kind, e.pos);
  }

  relocate(e, player) {
    // teleport a straggler into the band ahead of the tank
    const fwdYaw = player.yaw + rand(-0.9, 0.9);
    const r = rand(70, 105);
    e.pos.x = player.pos.x + Math.sin(fwdYaw) * r;
    e.pos.z = player.pos.z + Math.cos(fwdYaw) * r;
    e.pos.y = terrainHeight(e.pos.x, e.pos.z) + e.altitude;
    e.state = 'approach'; e.stateT = 0;
    e.airborne = false;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** can this enemy never catch up with the tank? */
function spec_slow(e, player) { return (e.spec.speed || 0) < player.speed * 1.05; }
