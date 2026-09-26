# Credits & licences

IRONVERGE's code is MIT. All art below is **streamed at runtime** from public CDNs
(jsDelivr / Statically / githack mirrors of the three.js repository, and Poly Haven).
Nothing is re-hosted in this repo. Every asset has an in-engine procedural fallback,
so the game still runs with zero network access.

## Engine
| What | Source | Licence |
|---|---|---|
| three.js r186 (`0.186.1`) + addons (GLTFLoader, HDRLoader, Sky, EffectComposer, UnrealBloomPass, OutputPass, SkeletonUtils, BufferGeometryUtils) | npm via jsDelivr / unpkg | MIT |

## 3D models (glTF-Binary, three.js sample library)
| In-game creature | File | Author / origin | Licence |
|---|---|---|---|
| Scrap Mech | `RobotExpressive.glb` | Tomás Laulhé (Quaternius), mods by Don McCurdy | **CC0** |
| Beast Cultist | `Soldier.glb` | Mixamo character (Adobe) | Mixamo terms – free for use in projects |
| Harpy / Firebird / Plague Stork | `Parrot.glb`, `Flamingo.glb`, `Stork.glb` | "ROME – 3 Dreams of Black" (mirada / Google) | CC BY-NC-SA 3.0 ⚠︎ non-commercial |
| Nightmare | `Horse.glb` | "ROME – 3 Dreams of Black" (mirada / Google) | CC BY-NC-SA 3.0 ⚠︎ non-commercial |
| Rust Sentry | `gears.glb` | three.js examples | see three.js repository |

> **Commercial release?** Set the `visual` of `harpy`, `phoenix`, `stork`, `nightmare`
> and `sentry` in `src/config.js` to a `proc:` builder (e.g. `proc:birdFallback`,
> `proc:quadruped`, `proc:idolFallback`) and the game uses only CC0 / own procedural art.

Procedural (built in code, part of this repo, MIT): player tank, Dire Wolf, Tuskfiend,
Dune Skitter, Cyclops, Stone Golem, Minotaur, Barrow Wraith, Awakened Idol, Ember Wyrm,
Obsidian Titan, all trees / rocks / ruins / wrecks / crystals.

## Textures & lighting
| Use | File | Author / origin | Licence |
|---|---|---|---|
| Image-based lighting / sky | `quarry_01_1k.hdr` | Poly Haven (Greg Zaal / Sergej Majboroda) | **CC0** |
| Grass ground | `terrain/grasslight-big.jpg` | OpenGameArt ("dark grass") | CC-BY 3.0 |
| Bark / crates | `hardwood2_*.jpg` | three.js examples | see three.js repository |
| Ruins stone | `brick_*.jpg` | three.js examples | see three.js repository |
| Water normals | `waternormals.jpg` | three.js examples | see three.js repository |
| Lava pools | `lava/lavatile.jpg` | three.js examples | see three.js repository |
| Smoke | `opengameart/smoke1.png` | OpenGameArt | CC0 / CC-BY (OGA) |
| Snow / ice | `Ice002_1K-JPG_*` | ambientCG | **CC0** |
| Rock (bonus) | `rock_wall_02_diff_1k.jpg` | Poly Haven (Rob Tuytel) | **CC0** |

All other maps (camouflage, hide, tread, sand, dirt, snow, rock, lava fallback, sprites,
runes, normal/roughness maps) are painted procedurally at startup.

## Audio
Fully synthesised with the Web Audio API — no sound files.
