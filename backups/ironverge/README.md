# IRONVERGE — Endless 3D Tank Warfare

A mobile-first HTML5 3D tank game built on **three.js r186** (latest), streamed
from CDN. Drive forever across an infinite, procedurally generated world with a
semi top-down camera and fight waves of animals, demi-humans, mythological
creatures and haunted machines.

**Controls:** three transparent buttons — **◀ steer · ▶ steer · FIRE**.
Hold both ◀ ▶ together to brake. The tank always drives forward, and the turret
auto-locks targets.

## Play

It's a static site with no build step:

```bash
npm start            # zero-dependency static server → http://localhost:8080
```

To test on a phone, open `http://<your-LAN-IP>:8080` on it. Any static host works
(GitHub Pages, Netlify, Cloudflare Pages). Just serve the repo root.

Desktop controls: `A`/`D` or `←`/`→` to steer, `Space` or click to fire, `P` to pause.

URL flags: `?quality=low|medium|high` · `?cdn=jsdelivr|unpkg|local`

## Features

- **Infinite world.** Deterministic seeded terrain (fBm + ridged noise) streamed
  in 48 m chunks around the tank. It has six biomes (plains, forest, desert, rocky
  highlands, snow, volcanic), plus lakes, lava pools and seamless world-space
  texturing.
- **Realistic PBR look.** A three-layer blended terrain shader (albedo + normal +
  roughness), HDRI image-based lighting (Poly Haven CC0), real-time sun shadows,
  ACES tone mapping, bloom, fog tinted to the current biome, and animated water.
- **Free CDN assets.** glTF models and texture scans load from the three.js
  sample library via jsDelivr/Statically mirrors. Each one has a hand-built
  procedural fallback, so the game still runs fully offline.
- **Dense scatter.** About 19 prop types (pine, oak, palm, dead trees, boulders,
  spires, rubble, crystals, glowing shrooms, bushes, grass cards, ferns, columns,
  ruined walls, arches, crates, fuel barrels, burnt tank wrecks, lava). They're
  drawn with instanced meshes: tens of thousands of objects in about 40 draw calls.
- **Bestiary.**
  - Animals: Dire Wolf, Tuskfiend boar, Dune Skitter spider
  - Mythic flyers: Harpy, Firebird, Plague Stork
  - Nightmare horse
  - Demi-humans: Beast Cultist, Cyclops, Minotaur
  - Constructs: Scrap Mech, Stone Golem, Rust Sentry, Awakened Idol
  - Spectres: Barrow Wraith
  - Bosses every 5th wave: **Ember Wyrm** (dragon) and **Obsidian Titan**
- **Enemy AI.** Ten behaviours: charger, leaper, orbiting diver, bomber,
  kiting shooter, caster, boulder-throwing brute, turret, and two boss patterns.
  They include target leading, flocking separation and obstacle avoidance.
- **Tank mechanics.**
  - Momentum, and speed that changes with slope
  - Pivot steering, and a hull aligned to the terrain with suspension
  - Crest jumps
  - Crushing small props; hard obstacles slide the tank along, and it never
    wedges
  - Slow wading through water; lava burns
  - Cannon recoil and barrel overheating
  - Ballistic shells with lead and drop compensation
  - Splash damage and chain-reaction barrels
  - Ramming
- **Loop.** Endless waves, combo multiplier, pickups (repair, coolant, overdrive,
  shield, relic caches), score, distance, a locally saved best run, radar, and
  off-screen threat arrows.
- **Mobile-ready.**
  - Multi-touch Pointer Events
  - Layout that respects safe areas, in portrait or landscape
  - Haptics and auto fullscreen
  - Adaptive resolution
  - Auto quality detection
  - Synthesised Web Audio sound: no audio downloads

## Project layout

```
index.html            screens + HUD + transparent touch controls
styles.css
src/cdn.js            CDN picker → import map (jsDelivr → unpkg → ./vendor) with automatic fail-over
src/main.js           boot, loading, menus, settings
src/game.js           renderer, combat rules, waves, camera, states
src/config.js         ALL tuning: tank feel, enemy stats, waves, asset catalogue, quality presets
src/world/            terrain · chunks (streaming) · props · textures (PBR) · sky · models (GLB + procedural)
src/entities/         player · enemies (AI) · projectiles · particles · pickups
src/core/             util (noise/RNG) · input · audio · event bus
src/ui/hud.js         HUD, radar, overlay (health bars, damage numbers)
scripts/smoke-test.mjs  headless simulation test (npm run check)
```

## Offline / self-hosted engine

```bash
npm install && npm run vendor   # copies three.js into ./vendor/three
# open  index.html?cdn=local
```

## Credits

See [CREDITS.md](CREDITS.md). A few of the streamed sample models are
**non-commercial** (CC BY-NC-SA). The credits file explains how to switch to the
100 % CC0/procedural roster with one line per enemy.
