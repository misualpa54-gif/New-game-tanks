# Tank Realms: Reforged — credits & licences

**Tank Realms: Reforged** is a remake of `tank_realms_v26.8.html`. It keeps that game's
rules, tank and level flow, and replaces the scenery and the enemies with real
3D models (GLB) and photographed materials (PBR textures + HDRI lighting).

All assets are **stored in this folder** (`assets/…`), so the game runs without
any internet connection. Only the three.js engine itself is loaded from a CDN
(see `?cdn=` in the README).

---

## Engine

| What | Source | Licence |
|---|---|---|
| three.js `0.186.1` + addons (GLTFLoader, HDRLoader, SkeletonUtils) | jsDelivr / unpkg (npm) | MIT |

Everything else below is bundled in `assets/`.

---

## 3D models — creatures (`assets/models/creatures`, `assets/models/humanoids`)

### Quaternius — **CC0** (public domain)
`quaternius.com` · low-poly animated animals and monsters

| File | Used for |
|---|---|
| `Pig.glb` | Tusk Boar |
| `Wolf.glb` | Grey Wolf |
| `Stag.glb` | Thunder Stag |
| `Bull.glb` | War Bull |
| `Ghost.glb`, `Demon.glb`, `Alien.glb`, `Tribal.glb`, `Hywirl.glb` | Wraith, Fire Imp, Voidling, Tiki Spirit, Storm Djinn |
| `Mushnub_Evolved.glb`, `Cactoro.glb` | Sporecap, Cactoro |
| `Goleling.glb`, `Goleling_Evolved.glb`, `Dragon.glb`, `Dragon_Evolved.glb` | Rock Sprite, Ember Drake, Golem King, Frost Giant, Elder Wyrm |
| `RobotExpressive.glb` | Sentinel Bot |
| `Peasant.glb`, `Superhero.glb`, `UAL_anims.glb` | Swamp Shaman, Rogue Gunslinger, Dullahan, Orc Brute |

`RobotExpressive` was additionally modified by Don McCurdy for the three.js examples.
The `UAL_anims.glb` file only carries animation clips (no mesh) — it drives the
humanoid characters.

### three.js / Khronos sample models

| File | Used for | Author | Licence |
|---|---|---|---|
| `Fox.glb` | Ember Fox | PixelMannen / @tomkranis, via KhronosGroup glTF-Sample-Models | **CC BY 4.0** |
| `Parrot.glb`, `Flamingo.glb`, `Stork.glb`, `Horse.glb` | Feather Shrike, Flame-ingo, Bomb Stork, Nightmare Steed | "ROME – 3 Dreams of Black" (Mirada / Google), via three.js examples | **CC BY-NC-SA 3.0** ⚠ non-commercial |
| `Duck.glb` | Quack Bomb | KhronosGroup glTF-Sample-Models | CC0 / public domain |
| `Bat.glb` | Dusk Bat | three.js examples | MIT (three.js repository) |

### Other

| File | Used for | Source | Licence |
|---|---|---|---|
| `Rhino2.glb` | Iron Rhino | mi2lab animal model set (GitHub) | not stated — credit only, replace before any commercial release |

> **Heads-up for a commercial release:** the four "ROME" bird/horse models are
> **CC BY-NC-SA (non-commercial)** and the Rhino licence is unknown. To ship
> commercially, delete `Parrot.glb`, `Flamingo.glb`, `Stork.glb`, `Horse.glb`
> and `Rhino2.glb` and remove the matching entries in `CREATURE_MODELS`
> (`js/assets.js`). Every creature then falls back to another model or to the
> original procedural tank shapes automatically.

---

## 3D models — scenery

### Poly Haven — **CC0**
`polyhaven.com` · photographed / 3D-scanned nature assets

*Rocks & ground debris:* `boulder_01`, `namaqualand_boulder_02`, `namaqualand_cliff_02`,
`rock_face_01`, `rock_face_02`, `rock_moss_set_01`, `rock_moss_set_02`, `stone_01`, `rock_07`

*Dead wood:* `dead_tree_trunk`, `dead_tree_trunk_02`, `dead_quiver_trunk`,
`tree_stump_01`, `tree_stump_02`, `root_cluster_01`, `pine_roots`, `dry_branches_medium_01`

*Plants:* `fern_02`, `shrub_01`, `shrub_03`, `shrub_04`, `shrub_sorrel_01`,
`weed_plant_02`, `grass_medium_01`, `cheiridopsis_succulent`,
`crystalline_iceplant`, `othonna_cerarioides`, `wild_rooibos_bush`

*Trees:* `quiver_tree_01`, `quiver_tree_02`

*Props:* `barrel_03`, `Barrel_01`, `wooden_crate_02`, `concrete_road_barrier`

The Namaqualand plants, rocks and quiver trees come from Poly Haven's
Namaqualand scan collection (photogrammetry captured in South Africa), released
under CC0.

### Stylised low-poly nature pack
`trees/Pine_1…Pine_5`, `trees/TwistedTree_1`, `trees/TwistedTree_2`,
`trees/DeadTree_1…DeadTree_5`, `plants/Fern_1`, `plants/Bush_Common`,
`plants/Grass_Common_Tall`, `plants/Grass_Wispy_Tall`

These come from a free low-poly nature asset pack distributed for game use
(texture names `Bark_NormalTree`, `Bark_TwistedTree`, `Bark_DeadTree`,
`Leaves_TwistedTree`, `Leaf_Pine`, `Grass`). They are redistributed here in good
faith. If you are the author of this pack and would like different attribution or
removal, open an issue on this repository and it will be done immediately.

---

## Ground materials (`assets/textures/ground`)

Photographed PBR sets — **Poly Haven, CC0**. Two sets are blended per biome
(flat ground gets the first set, steep slopes and patches get the second), so
every biome has its own ground look:

`aerial_beach_02`, `aerial_rocks_02`, `brown_mud_leaves_01`, `clean_pebbles`,
`cliff_side`, `dry_river_pebbles`, `forest_ground_04`, `forest_leaves_02`,
`forrest_ground_01`, `forrest_ground_03`, `ganges_river_pebbles`, `grass_path_2`,
`leafy_grass`, `lichen_rock`, `mossy_rock`, `rocky_terrain_02`,
`sandstone_cracks`, `snow_02`

The `_diff` (colour) and `_nor` (normal) maps are used; the look is finished with
per-biome colour tints and roughness.

Foliage masks (`assets/textures/foliage/leaves_normal_grey.webp`,
`leaves_twisted_grey.webp`) are part of the stylised tree pack above.

---

## Image-based lighting / HDRI skies (`assets/hdri`)

All **Poly Haven, CC0**:

| File | Used by |
|---|---|
| `quarry_01.hdr` | Enchanted Forest |
| `blouberg_sunrise_2.hdr` | Frozen Tundra, Golden Desert |
| `venice_sunset.hdr` | Volcanic Wasteland, Autumn Grove, Blood Moon Canyon |
| `moonless_golf.hdr` | Mystic Swamp, Crystal Caverns, Neon Void |
| `spruit_sunrise.hdr` | Sakura Valley |

Each HDRI is converted at load time into a PMREM environment map, so the models
are lit and reflected by a real photographed sky.

---

## Audio

No sound files. Every sound (engine, shots, explosions, music) is synthesised in
the browser with the Web Audio API, same as the original game.

## Code

The game logic is adapted from `tank_realms_v26.8.html` (kept in
`../backups/tank-realms-v26.8/` for reference). The new files — `js/boot.js`,
`js/cdn.js`, `js/assets.js`, `js/world.js`, `js/creatures.js` and the hooks inside
`js/game.js` — are part of this repository under the same licence as the project.
