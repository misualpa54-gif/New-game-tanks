/* ============================================================================
 * entities/player.js — the tank
 * ---------------------------------------------------------------------------
 * Endless auto-drive with left / right steering (hold both = brake).
 * Mass & momentum, slope-dependent speed, terrain-aligned suspension, prop
 * crushing vs. hard obstacles, water wading, lava burns, recoil, barrel heat
 * and a turret that auto-locks the best target in a forward cone.
 * ==========================================================================*/
import * as THREE from 'three';
import { TANK, WORLD } from '../config.js';
import { angleDelta, approach, clamp, clamp01, damp, deg2rad, lerp, rand } from '../core/util.js';
import { terrainHeight } from '../world/terrain.js';

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qYaw = new THREE.Quaternion();
const _qTilt = new THREE.Quaternion();
const _e = new THREE.Euler();
const _up = new THREE.Vector3(0, 1, 0);
const _cols = [];

/** props the tank drives straight through */
const CRUSHABLE = new Set(['bush', 'tuft', 'fern', 'shroom', 'crate', 'barrel', 'dead', 'rubble', 'crystal']);

export class Player {
  constructor(tankApi) {
    this.tank = tankApi;
    this.group = tankApi.group;
    this.pos = this.group.position;
    this.vel = new THREE.Vector3();
    this.forward = new THREE.Vector3(0, 0, 1);
    this.radius = TANK.radius;
    this.reset();
  }

  reset(x = 0, z = 0) {
    this.pos.set(x, terrainHeight(x, z), z);
    this.yaw = 0;
    this.speed = TANK.cruiseSpeed * 0.4;
    this.hp = TANK.hullHP;
    this.maxHp = TANK.hullHP;
    this.heat = 0;
    this.overheated = 0;
    this.cooldown = 0;
    this.shield = 0;
    this.overdrive = 0;
    this.alive = true;
    this.pitch = 0; this.roll = 0;
    this.turretYaw = 0;       // relative to hull
    this.gunPitch = 0;
    this.target = null;
    this.locked = false;
    this.distance = 0;
    this.steer = 0;
    this.inWater = false;
    this.onLava = false;
    this.lavaTick = 0;
    this.dustT = 0;
    this.impactCd = 0;
    this.stuckT = 0;
    this.bumpT = 0;
    this.tiltVel = 0;
    this.suspension = 0;
    this.airY = 0;
    this.fireQueued = false;
    this.group.quaternion.identity();
    this.vel.set(0, 0, 0);
  }

  get canFire() { return this.alive && this.cooldown <= 0 && this.overheated <= 0; }

  /**
   * @param {number} dt
   * @param {{left:boolean,right:boolean,fire:boolean}} input
   * @param {object} world {chunks, enemies, particles, onCrush, onBump, onLava, aimMode}
   */
  update(dt, input, world) {
    if (!this.alive) { this.tank.update(dt, { speed: 0, gunPitch: this.gunPitch }); return; }

    /* ---------------- steering / throttle ---------------- */
    const braking = input.left && input.right;
    const steerIn = braking ? 0 : (input.left ? 1 : 0) - (input.right ? 1 : 0);
    this.steer = damp(this.steer, steerIn, 9, dt);

    // slope along the hull: uphill costs speed, downhill adds it
    const fx = Math.sin(this.yaw), fz = Math.cos(this.yaw);
    const hAhead = terrainHeight(this.pos.x + fx * 2.4, this.pos.z + fz * 2.4);
    const hBehind = terrainHeight(this.pos.x - fx * 2.4, this.pos.z - fz * 2.4);
    const grade = (hAhead - hBehind) / 4.8;            // + = uphill

    let target = braking ? TANK.minSpeed : TANK.cruiseSpeed;
    if (this.overdrive > 0) target = TANK.boostSpeed + 2;
    target -= grade * 13;
    if (this.inWater) target *= 0.55;
    target = clamp(target, TANK.minSpeed * 0.6, TANK.boostSpeed + 4);
    const rate = target < this.speed ? (braking ? TANK.brake : TANK.accel * 1.3) : TANK.accel;
    this.speed = approach(this.speed, target, rate * dt);

    // pivot steering: slower speed ⇒ tighter turns (tracks counter-rotate)
    const turnRate = lerp(TANK.turnRateLowSpeed, TANK.turnRate, clamp01(this.speed / TANK.cruiseSpeed));
    this.yaw += this.steer * turnRate * dt;
    // turning bleeds a little speed (track friction)
    this.speed -= Math.abs(this.steer) * 1.4 * dt;

    this.forward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.vel.copy(this.forward).multiplyScalar(this.speed);
    const oldX = this.pos.x, oldZ = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    /* ---------------- world collisions ---------------- */
    this.impactCd -= dt;
    let touching = null;
    const cols = world.chunks.queryColliders(this.pos.x, this.pos.z, this.radius + 4, _cols);
    for (const c of cols) {
      const dx = this.pos.x - c.x, dz = this.pos.z - c.z;
      const rr = c.r + this.radius * 0.85;
      const d2 = dx * dx + dz * dz;
      if (d2 >= rr * rr) continue;
      const small = CRUSHABLE.has(c.kind) && (c.kind !== 'dead' || c.r < 0.55) && (c.kind !== 'rubble' || c.r < 0.9) && (c.kind !== 'crystal' || c.r < 0.8);
      if (small) {
        if (world.onCrush) world.onCrush(c, this);
        continue;
      }
      // hard obstacle: slide along it and lose momentum
      touching = c;
      const d = Math.sqrt(d2) || 0.001;
      const nx = dx / d, nz = dz / d;
      const pen = rr - d;
      this.pos.x += nx * pen;
      this.pos.z += nz * pen;
      const into = -(this.forward.x * nx + this.forward.z * nz);   // 1 = head-on
      if (into > 0.05) {
        // the tracks "walk" the hull around the obstacle: steer toward the
        // tangent on whichever side is closer (player input can override)
        let side = this.forward.x * nz - this.forward.z * nx;      // + = obstacle sits to our right
        if (Math.abs(side) < 0.08) side = ((c.x * 13.1 + c.z * 7.7) % 2) > 1 ? 0.1 : -0.1;
        this.yaw -= Math.sign(side) * (1.2 + into * 2.8) * dt;
        const impact = this.speed * into;
        if (this.impactCd <= 0 && impact > 4) {
          // one-off momentum loss on the actual crash, not every frame
          this.impactCd = 0.6;
          this.speed *= 1 - clamp01(into) * 0.6;
          if (world.onBump) world.onBump(c, impact, this);
        } else {
          this.speed = Math.max(this.speed * (1 - into * 1.5 * dt), TANK.minSpeed * 0.8);
        }
      }
    }

    // anti-wedge: a 40-tonne tank that keeps shoving the same obstacle for a
    // second simply flattens it — the endless drive can never get stuck
    if (touching && this.speed < TANK.cruiseSpeed * 0.7) {
      this.stuckT += dt;
      if (this.stuckT > 0.9) { this.stuckT = 0; if (world.onCrush) world.onCrush(touching, this, true); }
    } else this.stuckT = Math.max(0, this.stuckT - dt * 2);

    /* ---------------- terrain + suspension ---------------- */
    const ground = terrainHeight(this.pos.x, this.pos.z);
    this.inWater = ground < WORLD.waterLevel - 0.3;
    // fording: hull stays at least partially above the surface
    const rideY = this.inWater ? Math.max(ground, WORLD.waterLevel - 1.25) : ground;
    // crest jumps: if the ground drops away faster than gravity, go airborne
    if (this.pos.y - rideY > 0.35) {
      this.airY -= 26 * dt;
      this.pos.y += this.airY * dt;
      if (this.pos.y <= rideY) {
        if (this.airY < -9 && world.onLand) world.onLand(-this.airY, this);
        this.pos.y = rideY; this.airY = 0;
        this.suspension = -0.25;
      }
    } else {
      this.airY = (rideY - this.pos.y) / Math.max(dt, 1e-3) * 0.2;
      this.pos.y = damp(this.pos.y, rideY, 22, dt);
    }
    this.suspension = damp(this.suspension, 0, TANK.suspensionDamp, dt);

    // terrain-aligned hull: sample the four track corners
    const hw = 1.3, hl = 2.2;
    const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);   // right vector
    const hF = terrainHeight(this.pos.x + fx * hl, this.pos.z + fz * hl);
    const hB = terrainHeight(this.pos.x - fx * hl, this.pos.z - fz * hl);
    const hR = terrainHeight(this.pos.x + rx * hw, this.pos.z + rz * hw);
    const hL = terrainHeight(this.pos.x - rx * hw, this.pos.z - rz * hw);
    const targetPitch = this.airY < -2 ? this.pitch : -Math.atan2(hF - hB, hl * 2) * TANK.tiltStrength * 1.6;
    const targetRoll = Math.atan2(hR - hL, hw * 2) * TANK.tiltStrength * 1.6;
    // accel squat / brake dive
    const accelPitch = (target - this.speed) * 0.004;
    this.pitch = damp(this.pitch, targetPitch + accelPitch + this.suspension * 0.2, TANK.tiltDamp, dt);
    this.roll = damp(this.roll, targetRoll - this.steer * this.speed * 0.0035, TANK.tiltDamp, dt);

    _qYaw.setFromAxisAngle(_up, this.yaw);
    _e.set(this.pitch, 0, this.roll, 'XYZ');
    _qTilt.setFromEuler(_e);
    this.group.quaternion.copy(_qYaw).multiply(_qTilt);

    /* ---------------- hazards / fx ---------------- */
    const moved = Math.hypot(this.pos.x - oldX, this.pos.z - oldZ);
    this.distance += moved;
    this.dustT -= dt;
    if (this.dustT <= 0 && world.particles) {
      this.dustT = this.inWater ? 0.06 : 0.09;
      for (const s of [-1, 1]) {
        _v.set(this.pos.x - fx * 2.2 + rx * s * 1.3, this.pos.y + 0.2, this.pos.z - fz * 2.2 + rz * s * 1.3);
        if (this.inWater) { _v.y = WORLD.waterLevel + 0.05; world.particles.splash(_v, 0.35); }
        else world.particles.dust(_v, 0.35 + clamp01(this.speed / 18) * 0.4, world.dustColor || 0xa08d6c);
      }
    }

    const lava = world.chunks.lavaNear(this.pos.x, this.pos.z, 1.2);
    this.onLava = !!lava;
    if (this.onLava) {
      this.lavaTick -= dt;
      if (this.lavaTick <= 0) {
        this.lavaTick = 0.35;
        if (world.onLava) world.onLava(this);
      }
    }

    /* ---------------- timers ---------------- */
    this.cooldown -= dt;
    if (this.overheated > 0) {
      this.overheated -= dt;
      this.heat = Math.max(0, this.heat - TANK.heatCoolRate * 1.4 * dt);
    } else {
      this.heat = Math.max(0, this.heat - TANK.heatCoolRate * dt * (this.cooldown < -0.25 ? 1.35 : 0.6));
    }
    if (this.shield > 0) this.shield = Math.max(0, this.shield - dt);
    if (this.overdrive > 0) this.overdrive = Math.max(0, this.overdrive - dt);

    /* ---------------- turret targeting ---------------- */
    this.aim(dt, world);

    this.tank.update(dt, { speed: this.speed, gunPitch: this.gunPitch });
  }

  aim(dt, world) {
    const enemies = world.enemies || [];
    let best = null, bestScore = Infinity;
    if (world.aimMode !== 'free') {
      const cone = deg2rad(TANK.aimConeDeg);
      for (const e of enemies) {
        if (!e.alive || e.dying) continue;
        const dx = e.pos.x - this.pos.x, dz = e.pos.z - this.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > TANK.aimRange || d < 2) continue;
        const ang = Math.abs(angleDelta(this.yaw, Math.atan2(dx, dz)));
        // 360° turret, but targets inside the forward cone are strongly preferred;
        // the current target gets a stickiness bonus so the lock doesn't flicker
        const sticky = e === this.target ? 0.55 : 1;
        const outside = ang > cone ? 0.9 + (ang - cone) * 0.5 : 0;
        const score = (d / TANK.aimRange + Math.min(ang, cone) / cone * 0.8 + outside + (e.spec.boss ? -0.35 : 0)) * sticky;
        if (score < bestScore) { bestScore = score; best = e; }
      }
    }
    this.target = best;

    let wantYawWorld = this.yaw;
    let wantPitch = 0.02;
    if (best) {
      const sol = this.solveBallistics(best);
      wantYawWorld = sol.yaw;
      wantPitch = sol.pitch;
    }
    const rel = angleDelta(0, wantYawWorld - this.yaw);
    const step = TANK.turretSpeed * dt;
    this.turretYaw += clamp(angleDelta(this.turretYaw, rel), -step, step);
    this.gunPitch = damp(this.gunPitch, clamp(wantPitch - this.pitch * Math.cos(this.turretYaw), -0.12, 0.4), 8, dt);
    this.tank.turret.rotation.y = this.turretYaw;
    this.locked = !!best && Math.abs(angleDelta(this.turretYaw, rel)) < 0.08;
  }

  /** lead + gravity drop compensation → world yaw/pitch */
  solveBallistics(e) {
    const g = TANK.shellGravity, s = TANK.shellSpeed;
    const mx = this.pos.x, my = this.pos.y + 2.1, mz = this.pos.z;
    let tx = e.pos.x, ty = e.pos.y + e.height * 0.5, tz = e.pos.z;
    let t = Math.hypot(tx - mx, tz - mz) / s;
    for (let i = 0; i < 2; i++) {
      const vx = (e.vel ? e.vel.x : 0) + Math.sin(e.yaw) * (e.speedNow || 0);
      const vz = (e.vel ? e.vel.z : 0) + Math.cos(e.yaw) * (e.speedNow || 0);
      tx = e.pos.x + vx * t; tz = e.pos.z + vz * t;
      t = Math.hypot(tx - mx, tz - mz) / s;
    }
    const dh = Math.hypot(tx - mx, tz - mz);
    const drop = 0.5 * g * t * t;
    return { yaw: Math.atan2(tx - mx, tz - mz), pitch: Math.atan2(ty + drop - my, dh), dist: dh };
  }

  /** returns {pos, dir} for a shell or null if the gun can't fire */
  tryFire() {
    if (!this.canFire) return null;
    this.cooldown = this.overdrive > 0 ? TANK.cooldownOverdrive : TANK.cooldown;
    this.heat += this.overdrive > 0 ? TANK.heatPerShot * 0.35 : TANK.heatPerShot;
    if (this.heat >= 100) { this.heat = 100; this.overheated = TANK.overheatPenalty; }
    this.tank.fireKick(1);
    // recoil shoves the hull back and pitches it up
    this.speed = Math.max(TANK.minSpeed * 0.5, this.speed - TANK.recoil * 6);
    this.suspension += 0.35;
    const muzzle = this.tank.muzzle;
    muzzle.updateWorldMatrix(true, false);
    const pos = muzzle.getWorldPosition(new THREE.Vector3());
    const dir = this.tank.gun.getWorldDirection(new THREE.Vector3());
    return { pos, dir };
  }

  hurt(amount) {
    if (!this.alive) return 0;
    if (this.shield > 0) amount *= 0.2;
    this.hp -= amount;
    if (this.hp <= 0) { this.hp = 0; this.alive = false; }
    return amount;
  }

  heal(amount) { this.hp = Math.min(this.maxHp, this.hp + amount); }
}

export { CRUSHABLE, rand };
