# Tank Realms: Reforged

A remake of **Tank Realms v26.8**. Same game, same tank, same endless levels —
but the whole world is now built from **real 3D models, photographed ground
materials and HDRI sky lighting** instead of boxes and coloured cones.

* **Player tank:** unchanged, the one from `tank_realms_v26.8.html`.
* **Enemies:** 33 creature types built from real animated GLB models — animals,
  birds, monsters, robots and humanoids — each with its own behaviour.
* **Scenery:** scanned rocks, dead wood, shrubs, grass, trees, barrels and
  crates; every biome has its own ground material and its own sky.
* **Water:** completely removed. Every biome is dry land now.

---

## How to play (no coding needed)

### 1. On your computer

Open a terminal in this repository and type:

```
npm start
```

then open this address in your browser:

```
http://localhost:8080/tank-realms-reforged/index.html
```

The first screen is a loading bar. It downloads about 26 MB of models and
textures from your own machine, so it takes a few seconds. After that the game
starts like the original.

### 2. On GitHub Pages

Push this repository to GitHub and turn on **Settings → Pages → Deploy from
branch → main**. The game is then at:

```
https://<your-name>.github.io/New-game-tanks/tank-realms-reforged/index.html
```

Everything it needs is inside this folder, so it works online straight away.

### 3. On a phone

Start the game on the computer (`npm start`), then on the phone — connected to
the **same Wi-Fi** — open your computer's local address, for example:

```
http://192.168.1.20:8080/tank-realms-reforged/index.html
```

(Replace `192.168.1.20` with the number the terminal prints, or with the one you
find in your Wi-Fi settings.)

---

## Controls

| Device | Move | Shoot |
|---|---|---|
| Phone / tablet | **Left half of the screen** — a joystick appears under your thumb | **Right half of the screen** — hold it and the tank auto-fires |
| Computer | **WASD** (or arrow keys) | **Space bar** |

The right side is *auto-fire*: you hold it and the turret keeps shooting at the
nearest enemy. The extra buttons in the corner are pause ⏸, settings ⚙,
sound 🔊, camera 📷 and aim assist 🎯. One of them also switches graphics
quality (Auto / High / Low) if the game feels heavy.

---

## What is new compared with v26.8

* **Real models everywhere.** Trees, rocks, stumps, roots, branches, ferns,
  shrubs, grass tufts, barrels and crates are GLB models instead of geometry
  built in code. They are placed by the chunk system, spread per biome.
* **Ground that matches the biome.** Each biome blends two photographed PBR
  materials — one for flat ground, one for slopes and patches — so a forest
  floor, snow, sand, mud, cracked rock and neon gravel all look different.
* **Real sky lighting.** Every biome is lit and reflected by a different HDRI
  panorama (converted to an environment map at load time).
* **33 creature types** with their own models, animations and attack styles
  (see the table below).
* **Telegraphed attacks.** Slams, lightning lines, meteor rain, spike lines,
  spore clouds and healing pulses all draw a glowing ring on the ground before
  they fire, so you can drive out of the way.
* **Destructible scenery.** Barrels and crates explode when you shoot them.

What stayed the same: the tank, the endless levels, the bosses, the shop and
armoury, the awards, the save system and the sound.

---

## The creatures

| From level | Enemies |
|---|---|
| 1 | Tusk Boar (charges), Ember Fox (flanks), Quack Bomb (explodes when killed) |
| 2 | Dusk Bat (dives in packs of 3), Grey Wolf (pack hunter) |
| 3 | Feather Shrike (flyer), Sporecap (spore clouds) |
| 4 | Swamp Shaman (**heals other enemies**), Crate Mimic (hides as a crate) |
| 5 | **Iron Rhino** (armoured front — shoot it from the side), Sentinel Bot, Cactoro |
| 6 | Bomb Stork, Orc Brute (slam), Fire Imp |
| 7 | Thunder Stag (lightning charge), Rogue Gunslinger, Rock Sprite |
| 8 | Flame-ingo, Wraith (phases in and out — invulnerable while phased) |
| 9 | War Bull, Tiki Spirit, Voidling |
| 10 | Nightmare Steed, Dullahan, Storm Djinn |
| 11 | Ember Drake (flame breath) |
| Bosses | **Elder Wyrm**, **Golem King**, **Frost Giant** |

Behaviours: *charger* (telegraphs a line, then charges), *flanker* (circles you
and dives in), *diver* (flies above and dive-bombs), *caster/healer* (shoots
orbs and heals nearby enemies), *mimic* (looks like a crate until it wakes up),
*strafe*, *sprite*, *wraith* and the three bosses.

If a model ever fails to load, that creature is drawn as the original coloured
tank shape, so the game keeps working.

---

## The biomes

| # | Biome | Ground | Sky (HDRI) |
|---|---|---|---|
| 0 | Enchanted Forest | forest floor + mossy rock | quarry |
| 1 | Frozen Tundra | snow + cliff rock | sunrise beach |
| 2 | Volcanic Wasteland | volcanic rock + rocky terrain | sunset |
| 3 | Golden Desert | beach sand + cracked sandstone | sunrise |
| 4 | Mystic Swamp | wet mud + leaves | moonless night |
| 5 | Crystal Caverns | cliff rock + clean pebbles | moonless night |
| 6 | Autumn Grove | fallen leaves + forest soil | sunset |
| 7 | Sakura Valley | leafy grass + grass path | sunrise |
| 8 | Blood Moon Canyon | cracked sandstone + dry pebbles | sunset |
| 9 | Neon Void | river pebbles + lichen rock | moonless night |

---

## Technical notes

* **Files**
  * `index.html` — the original v26.8 markup plus a loading overlay.
  * `js/cdn.js` — injects the three.js import map (jsDelivr → unpkg → local).
  * `js/boot.js` — loads three.js, the models, the textures and the HDRIs, then
    starts the game and removes the loading bar.
  * `js/assets.js` — model/texture/HDRI catalogue and per-biome look.
  * `js/world.js` — chunk building, instanced scenery, ground material.
  * `js/creatures.js` — creature models, animation mapping and AI behaviours.
  * `js/game.js` — the original v26.8 game, with small hooks for the above.
  * `assets/` — models (26 MB), ground textures, HDRI skies.
  * `dev/preview.html` — a contact sheet: `dev/preview.html?m=trees/Pine_1,rocks/boulder_01`
* **Engine:** three.js `0.186.1` from a CDN. Add `?cdn=unpkg` to use unpkg, or
  `?cdn=local` to use the copy in `../vendor/three` (created by
  `npm run vendor` in the repository root). It remembers your choice, and if a
  CDN fails it automatically falls back to the next one.
* **Performance:** scenery uses instanced meshes and a per-frame build budget,
  so chunks stream in without stutter. If it still feels heavy, switch graphics
  to **Low** in the settings panel (fewer shadows, fewer particles, lower pixel
  ratio).
* **Offline:** all art is inside this folder. Only three.js itself comes from a
  CDN, and that is cached by the browser after the first run.
* **No water** anywhere in the code: the old water planes, reflections and
  water normals are gone.

## Credits

See **[CREDITS.md](CREDITS.md)** for the licence of every model, texture and
HDRI. Short version: almost everything is **CC0** (public domain); the four
three.js bird/horse models are **CC BY-NC-SA (non-commercial)** and the rhino's
licence is unknown — the credits file explains how to swap them out.
