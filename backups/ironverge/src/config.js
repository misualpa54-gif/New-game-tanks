/* ============================================================================
 * IRONVERGE — tuning + content tables
 * Everything gameplay-feel related lives here.
 * ==========================================================================*/

const BOOT = (typeof window !== 'undefined' && window.IRONVERGE_BOOT) || {};

export const VERSION = BOOT.version || '1.0.0';

/* ---------------------------------------------------------------------------
 * Asset catalogue — all free (CC0 / CC-BY) files streamed from CDN mirrors.
 * Every entry can fail; the game always has a procedural fallback.
 * -------------------------------------------------------------------------*/
export const ASSET_HOSTS = BOOT.assetMirrors || [
  'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r186/examples/'
];
export const POLY_HAVEN = BOOT.polyHaven || 'https://dl.polyhaven.org/file/ph-assets/';

/** relative to an ASSET_HOSTS entry */
export const TEXTURES = {
  grass:      { url: 'textures/terrain/grasslight-big.jpg',     srgb: true,  size: 2.6, tier: 'core' },
  woodDiff:   { url: 'textures/hardwood2_diffuse.jpg',          srgb: true,  size: 0.4, tier: 'extra' },
  woodBump:   { url: 'textures/hardwood2_bump.jpg',             srgb: false, size: 0.1, tier: 'extra' },
  woodRough:  { url: 'textures/hardwood2_roughness.jpg',        srgb: false, size: 0.1, tier: 'extra' },
  brickDiff:  { url: 'textures/brick_diffuse.jpg',              srgb: true,  size: 1.0, tier: 'extra' },
  brickBump:  { url: 'textures/brick_bump.jpg',                 srgb: false, size: 0.8, tier: 'extra' },
  brickRough: { url: 'textures/brick_roughness.jpg',            srgb: false, size: 0.2, tier: 'extra' },
  waterNrm:   { url: 'textures/waternormals.jpg',               srgb: false, size: 0.24, tier: 'core' },
  lava:       { url: 'textures/lava/lavatile.jpg',              srgb: true,  size: 0.55, tier: 'extra' },
  smoke:      { url: 'textures/opengameart/smoke1.png',         srgb: true,  size: 0.09, tier: 'core' },
  ice:        { url: 'textures/ambientcg/Ice002_1K-JPG_Color.jpg', srgb: true, size: 1.0, tier: 'extra' },
  iceNrm:     { url: 'textures/ambientcg/Ice002_1K-JPG_NormalGL.jpg', srgb: false, size: 1.2, tier: 'extra' },
  scratchNrm: { url: 'textures/pbr/Scratched_gold/Scratched_gold_01_1K_Normal.png', srgb: false, size: 1.0, tier: 'extra' },
  env:        { url: 'textures/equirectangular/quarry_01_1k.hdr', hdr: true, size: 1.4, tier: 'core' },
  envAlt:     { url: 'textures/equirectangular/752-hdri-skies-com_1k.hdr', hdr: true, size: 1.2, tier: 'extra' }
};

/** glTF-Binary models from the three.js sample library (CC0 / CC-BY, see CREDITS.md) */
export const MODELS = {
  harpyParrot:   { url: 'models/gltf/Parrot.glb',                        size: 0.10, tier: 'core' },
  harpyFlamingo: { url: 'models/gltf/Flamingo.glb',                      size: 0.08, tier: 'core' },
  harpyStork:    { url: 'models/gltf/Stork.glb',                         size: 0.08, tier: 'core' },
  hound:         { url: 'models/gltf/duck.glb',                          size: 0.03, tier: 'extra' },
  nightmare:     { url: 'models/gltf/Horse.glb',                         size: 0.18, tier: 'core' },
  mech:          { url: 'models/gltf/RobotExpressive/RobotExpressive.glb', size: 0.46, tier: 'core' },
  soldier:       { url: 'models/gltf/Soldier.glb',                       size: 2.10, tier: 'extra' },
  xbot:          { url: 'models/gltf/Xbot.glb',                          size: 2.90, tier: 'extra' },
  idol:          { url: 'models/gltf/Nefertiti/Nefertiti.glb',           size: 1.20, tier: 'extra' },
  bust:          { url: 'models/gltf/tennyson-bust.glb',                 size: 0.46, tier: 'extra' },
  gears:         { url: 'models/gltf/gears.glb',                         size: 0.08, tier: 'extra' },
  steampunk:     { url: 'models/gltf/steampunk_camera.glb',              size: 3.90, tier: 'luxury' },
  relic:         { url: 'models/gltf/BoomBox.glb',                       size: 2.20, tier: 'luxury' }
};

/* ---------------------------------------------------------------------------
 * Quality presets — auto-selected from the device, user-overridable in the menu
 * -------------------------------------------------------------------------*/
export const QUALITY = {
  low: {
    pixelRatio: 1.0, chunkRadius: 2, chunkSeg: 12, scatter: 0.45, shadowMap: 0,
    bloom: false, envHdr: false, fogFar: 210, maxEnemies: 12, particles: 0.5,
    realTextures: ['waterNrm', 'smoke'], dynamicScale: true
  },
  medium: {
    pixelRatio: 1.5, chunkRadius: 3, chunkSeg: 16, scatter: 0.8, shadowMap: 1024,
    bloom: true, envHdr: true, fogFar: 320, maxEnemies: 20, particles: 0.8,
    realTextures: ['grass', 'waterNrm', 'smoke', 'env', 'woodDiff', 'woodBump', 'woodRough', 'brickDiff'],
    dynamicScale: true
  },
  high: {
    pixelRatio: 2.0, chunkRadius: 4, chunkSeg: 24, scatter: 1.25, shadowMap: 2048,
    bloom: true, envHdr: true, fogFar: 460, maxEnemies: 30, particles: 1.0,
    realTextures: 'all', dynamicScale: true
  }
};

/* ---------------------------------------------------------------------------
 * World
 * -------------------------------------------------------------------------*/
export const WORLD = {
  chunkSize: 48,            // world units per chunk
  buildBudgetPerFrame: 1,   // chunks generated per frame (avoids hitches)
  waterLevel: -2.4,
  lavaLevel: -3.4,
  heightAmp: 9.0,           // rolling hills
  hillFreq: 0.0085,
  detailFreq: 0.055,
  microFreq: 0.22,
  biomeFreq: 0.0022,
  scatterMargin: 6          // keep props away from chunk borders (no seams)
};

/* ---------------------------------------------------------------------------
 * Player tank — deliberately "heavy": momentum, ground grip, recoil, heat
 * -------------------------------------------------------------------------*/
export const TANK = {
  hullHP: 100,
  cruiseSpeed: 15.5,        // auto-forward endless drive (units/s)
  minSpeed: 5.0,            // while braking (both steer buttons held)
  boostSpeed: 21.0,         // on steep downhill / overdrive
  accel: 11.0,
  brake: 26.0,
  turnRate: 1.55,           // rad/s at cruise
  turnRateLowSpeed: 2.1,
  tiltStrength: 0.55,       // hull pitch/roll following terrain normal
  tiltDamp: 7.0,
  suspensionDamp: 9.0,
  radius: 2.35,             // collision cylinder
  treadScroll: 0.055,

  shellSpeed: 118,
  shellLife: 2.6,
  shellDamage: 34,
  shellSplash: 4.6,         // splash radius
  shellSplashDamage: 18,
  shellGravity: 9.0,
  cooldown: 0.34,           // s between shots
  cooldownOverdrive: 0.15,
  heatPerShot: 7.5,
  heatCoolRate: 21,         // per second
  overheatPenalty: 1.6,     // lockout seconds when the barrel cooks off
  recoil: 0.42,
  muzzleLight: 5.2,

  aimRange: 105,
  aimConeDeg: 46,
  turretSpeed: 3.6,         // rad/s
  shieldTime: 8,
  overdriveTime: 10
};

/* ---------------------------------------------------------------------------
 * Enemy roster — animals, demi-humans, mythological creatures, objects
 * visual: 'glb:<key>' streams a free model, 'proc:<key>' is built in-engine.
 * -------------------------------------------------------------------------*/
export const ENEMIES = {
  wolf: {
    name: 'Dire Wolf', visual: 'proc:quadruped', tint: 0x6d6156, accent: 0xff5a2a,
    hp: 34, speed: 12.5, radius: 1.5, height: 1.5, score: 60, damage: 9,
    behavior: 'charger', attackCd: 1.0, scale: 1.25, minWave: 1, weight: 12, drops: 0.22
  },
  boar: {
    name: 'Tuskfiend', visual: 'proc:boar', tint: 0x7a5b43, accent: 0xffb03a,
    hp: 70, speed: 9.5, radius: 1.9, height: 1.7, score: 90, damage: 15,
    behavior: 'charger', attackCd: 1.4, scale: 1.5, minWave: 2, weight: 9, drops: 0.25
  },
  spider: {
    name: 'Dune Skitter', visual: 'proc:spider', tint: 0x3d3a44, accent: 0x7dffb0,
    hp: 26, speed: 14.0, radius: 1.3, height: 1.2, score: 70, damage: 7,
    behavior: 'leaper', attackCd: 1.6, scale: 1.4, minWave: 2, weight: 8, drops: 0.2
  },
  harpy: {
    name: 'Harpy', visual: 'glb:harpyParrot', tint: 0xff6a8a, accent: 0xffd36a,
    hp: 24, speed: 17.0, radius: 1.4, height: 1.0, score: 85, damage: 8,
    behavior: 'flyer', attackCd: 2.0, scale: 3.4, minWave: 1, weight: 11, drops: 0.24, flying: true
  },
  phoenix: {
    name: 'Firebird', visual: 'glb:harpyFlamingo', tint: 0xff7a2a, accent: 0xffe07a,
    hp: 30, speed: 19.0, radius: 1.5, height: 1.2, score: 110, damage: 10,
    behavior: 'bomber', attackCd: 2.4, scale: 3.6, minWave: 3, weight: 8, drops: 0.3, flying: true
  },
  stork: {
    name: 'Plague Stork', visual: 'glb:harpyStork', tint: 0xbcd6ff, accent: 0x8affd0,
    hp: 22, speed: 16.0, radius: 1.4, height: 1.1, score: 80, damage: 7,
    behavior: 'flyer', attackCd: 1.9, scale: 3.4, minWave: 2, weight: 7, drops: 0.22, flying: true
  },
  cultist: {
    name: 'Beast Cultist', visual: 'glb:soldier', tint: 0x9a4b3a, accent: 0xffcc66,
    hp: 40, speed: 7.2, radius: 1.1, height: 1.9, score: 95, damage: 11,
    behavior: 'shooter', attackCd: 1.5, scale: 1.05, minWave: 3, weight: 10, drops: 0.28, yawOffset: Math.PI
  },
  mech: {
    name: 'Scrap Mech', visual: 'glb:mech', tint: 0x7f8c99, accent: 0x46e0ff,
    hp: 62, speed: 8.4, radius: 1.5, height: 2.2, score: 130, damage: 13,
    behavior: 'shooter', attackCd: 1.7, scale: 1.35, minWave: 4, weight: 9, drops: 0.3
  },
  nightmare: {
    name: 'Nightmare', visual: 'glb:nightmare', tint: 0x2a2233, accent: 0xff3b1f,
    hp: 58, speed: 18.5, radius: 1.7, height: 2.2, score: 150, damage: 14,
    behavior: 'charger', attackCd: 1.2, scale: 1.5, minWave: 5, weight: 7, drops: 0.32
  },
  cyclops: {
    name: 'Cyclops', visual: 'proc:cyclops', tint: 0x8d7a5f, accent: 0xffe08a,
    hp: 130, speed: 6.0, radius: 2.4, height: 4.6, score: 220, damage: 20,
    behavior: 'brute', attackCd: 2.2, scale: 1.0, minWave: 5, weight: 7, drops: 0.35
  },
  golem: {
    name: 'Stone Golem', visual: 'proc:golem', tint: 0x6f6f74, accent: 0xff7a1a,
    hp: 210, speed: 4.2, radius: 2.6, height: 4.2, score: 300, damage: 26,
    behavior: 'brute', attackCd: 2.8, scale: 1.0, minWave: 7, weight: 6, drops: 0.4
  },
  minotaur: {
    name: 'Minotaur', visual: 'proc:minotaur', tint: 0x5c4132, accent: 0xff4d2a,
    hp: 165, speed: 8.6, radius: 2.2, height: 3.8, score: 260, damage: 22,
    behavior: 'charger', attackCd: 1.6, scale: 1.0, minWave: 6, weight: 6, drops: 0.36
  },
  wraith: {
    name: 'Barrow Wraith', visual: 'proc:wraith', tint: 0x31415e, accent: 0x6affd8,
    hp: 88, speed: 10.5, radius: 1.4, height: 2.6, score: 210, damage: 16,
    behavior: 'caster', attackCd: 2.0, scale: 1.0, minWave: 8, weight: 7, drops: 0.4, flying: true
  },
  idol: {
    name: 'Awakened Idol', visual: 'proc:idolFallback', tint: 0xc9b48d, accent: 0x7affb0,
    hp: 150, speed: 0, radius: 2.0, height: 3.0, score: 180, damage: 14,
    behavior: 'turret', attackCd: 1.8, scale: 1.9, minWave: 4, weight: 6, drops: 0.34
  },
  sentry: {
    name: 'Rust Sentry', visual: 'glb:gears', tint: 0x9a8a6a, accent: 0xff5a3a,
    hp: 110, speed: 0, radius: 1.8, height: 2.4, score: 160, damage: 12,
    behavior: 'turret', attackCd: 1.4, scale: 2.2, minWave: 3, weight: 6, drops: 0.3
  },
  // ── bosses ───────────────────────────────────────────────────────────────
  dragon: {
    name: 'Ember Wyrm', visual: 'proc:dragon', tint: 0x8e2b1c, accent: 0xffae3a,
    hp: 1500, speed: 13.0, radius: 5.0, height: 6.0, score: 2500, damage: 30,
    behavior: 'bossFlyer', attackCd: 1.6, scale: 1.0, minWave: 5, weight: 0, boss: true,
    drops: 1.0, flying: true
  },
  titan: {
    name: 'Obsidian Titan', visual: 'proc:titan', tint: 0x3a3a44, accent: 0xff3b6b,
    hp: 2200, speed: 4.6, radius: 4.2, height: 9.0, score: 3200, damage: 38,
    behavior: 'bossBrute', attackCd: 2.0, scale: 1.0, minWave: 10, weight: 0, boss: true,
    drops: 1.0
  }
};

/* which boss shows up on a given boss wave (every BOSS_EVERY waves) */
export const BOSS_ROTATION = ['dragon', 'titan', 'dragon', 'titan'];
export const BOSS_EVERY = 5;

/* ---------------------------------------------------------------------------
 * Waves / spawning
 * -------------------------------------------------------------------------*/
export const SPAWN = {
  baseCount: 4,
  perWave: 1.35,
  maxAliveBase: 9,
  spawnRingMin: 62,
  spawnRingMax: 108,
  waveDelay: 3.2,
  spawnInterval: 0.85,
  pickupChance: 0.26,
  pickupEvery: 26         // seconds between guaranteed pickup drops
};

export const PICKUPS = {
  repair:    { name: 'FIELD REPAIR', color: 0x59ff8a, value: 34, weight: 34 },
  coolant:   { name: 'COOLANT',      color: 0x6ad4ff, value: 1,  weight: 22 },
  overdrive: { name: 'OVERDRIVE',    color: 0xffd24a, value: 10, weight: 18 },
  shield:    { name: 'AEGIS SHIELD', color: 0xb98aff, value: 8,  weight: 14 },
  relic:     { name: 'RELIC CACHE',  color: 0xff9d3a, value: 450, weight: 12 }
};

/* ---------------------------------------------------------------------------
 * Camera — semi top-down
 * -------------------------------------------------------------------------*/
export const CAMERA = {
  fov: 52,
  near: 0.6,
  far: 1400,
  height: 28,           // default; user adjustable 14..46
  back: 20,             // behind the tank along -forward
  lookAhead: 9,
  dampPos: 6.5,
  dampLook: 9.0,
  kickFire: 0.55,
  maxYawOffset: 0.25
};

export const SCORE = {
  distanceWeight: 0.35,   // points per metre driven
  comboWindow: 3.6,       // seconds to keep a combo alive
  comboMax: 9
};
