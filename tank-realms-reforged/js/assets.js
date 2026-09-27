/* =============================================================================
 * TANK REALMS: REFORGED — asset library (classic script, loaded before game.js)
 * -----------------------------------------------------------------------------
 * Every model / texture / HDRI here is a FREE online asset (CC0 / CC-BY), bundled
 * locally in ./assets so the game works on GitHub Pages and offline. Sources are
 * listed in CREDITS.md. Everything has a procedural fallback: if a file fails to
 * load, the original Tank Realms geometry is used instead — the game never breaks.
 * ===========================================================================*/
(function () {
  'use strict';
  const T = window.THREE;
  const BASE = window.TRR_ASSET_BASE || 'assets/';

  const gltfLoader = new T.GLTFLoader();
  const texLoader = new T.TextureLoader();
  const hdrLoader = new T.HDRLoader();

  function markShared(res) { res.userData = res.userData || {}; res.userData.__shared = true; return res; }

  /* ---------------------------------------------------------------------------
   * ENVIRONMENT CATALOGUE
   *   h: [min,max] target HEIGHT in world units (1 unit ≈ 1.3 m; the tank is 2.2 tall)
   *   w: [min,max] target WIDTH (largest horizontal side) — for flat things (logs, sets)
   *   split: the file is a SET of separate objects → each mesh becomes its own variant
   *   r: collision radius as a fraction of the placed footprint
   *   hp: hit points multiplier (destructible cover)
   *   sink: push this far (fraction of height) into the ground (hides flat bottoms on slopes)
   * -------------------------------------------------------------------------*/
  const ENV = {
    // ---- trees ----
    'trees/Pine_1': { kind: 'tree', h: [7, 10], r: 0.16 }, 'trees/Pine_2': { kind: 'tree', h: [7, 10], r: 0.16 },
    'trees/Pine_3': { kind: 'tree', h: [7, 10.5], r: 0.16 }, 'trees/Pine_4': { kind: 'tree', h: [8.5, 11.5], r: 0.14 },
    'trees/Pine_5': { kind: 'tree', h: [7, 9.5], r: 0.16 },
    'trees/TwistedTree_1': { kind: 'tree', h: [7.5, 10.5], r: 0.12 }, 'trees/TwistedTree_2': { kind: 'tree', h: [8, 11], r: 0.12 },
    'trees/DeadTree_1': { kind: 'tree', h: [6, 8.5], r: 0.12 }, 'trees/DeadTree_2': { kind: 'tree', h: [6.5, 9], r: 0.12 },
    'trees/DeadTree_3': { kind: 'tree', h: [7, 9.5], r: 0.12 }, 'trees/DeadTree_4': { kind: 'tree', h: [7, 9.5], r: 0.12 },
    'trees/DeadTree_5': { kind: 'tree', h: [7.5, 10], r: 0.12 },
    'trees/quiver_tree_01': { kind: 'tree', h: [5.5, 7.5], r: 0.3 }, 'trees/quiver_tree_02': { kind: 'tree', h: [3.8, 5.2], r: 0.35 },
    // ---- scanned rocks ----
    'rocks/boulder_01': { kind: 'rock', h: [1.6, 3.4], r: 0.5, sink: 0.12 },
    'rocks/namaqualand_boulder_02': { kind: 'rock', w: [3, 5.5], r: 0.42, sink: 0.1 },
    'rocks/rock_face_01': { kind: 'rock', h: [3, 5], r: 0.42, sink: 0.12, hp: 2 },
    'rocks/rock_face_02': { kind: 'rock', h: [2.4, 4.2], r: 0.45, sink: 0.12, hp: 1.6 },
    'rocks/rock_moss_set_01': { kind: 'rock', split: true, w: [1.2, 2.8], r: 0.5, sink: 0.15 },
    'rocks/rock_moss_set_02': { kind: 'rock', split: true, w: [1.0, 2.4], r: 0.5, sink: 0.15 },
    'rocks/rock_07': { kind: 'rock', w: [1.4, 2.6], r: 0.45, sink: 0.2 },
    'rocks/stone_01': { kind: 'rock', w: [0.8, 1.6], r: 0.45, sink: 0.2 },
    'rocks/namaqualand_cliff_02': { kind: 'rock', w: [16, 22], r: 0.22, sink: 0.08, hp: 6, big: true },
    // ---- dead wood / fallen trees ----
    'wood/dead_tree_trunk': { kind: 'log', w: [5, 7.5], r: 0.16, sink: 0.1 },
    'wood/dead_tree_trunk_02': { kind: 'log', w: [5.5, 8], r: 0.16, sink: 0.1 },
    'wood/tree_stump_01': { kind: 'stump', w: [1.6, 2.4], r: 0.4, sink: 0.08 },
    'wood/tree_stump_02': { kind: 'stump', w: [1.6, 2.4], r: 0.4, sink: 0.08 },
    'wood/root_cluster_01': { kind: 'stump', w: [3.5, 5], r: 0.3, sink: 0.06 },
    'wood/pine_roots': { kind: 'decor', w: [2.2, 3.2], sink: 0.05 },
    'wood/dry_branches_medium_01': { kind: 'decor', w: [1.8, 2.8], sink: 0.05 },
    'wood/dead_quiver_trunk': { kind: 'stump', h: [2.2, 3.4], r: 0.35, sink: 0.04 },
    // ---- plants (no collision) ----
    'plants/fern_02': { kind: 'plant', split: true, w: [1.1, 1.8] },
    'plants/Fern_1': { kind: 'plant', w: [1.4, 2.2] },
    'plants/Bush_Common': { kind: 'plant', h: [1.2, 1.9], sink: 0.05 },
    'plants/shrub_01': { kind: 'plant', split: true, h: [0.8, 1.5] },
    'plants/shrub_03': { kind: 'plant', split: true, h: [0.9, 1.6] },
    'plants/shrub_04': { kind: 'plant', split: true, h: [0.8, 1.4] },
    'plants/weed_plant_02': { kind: 'plant', split: true, h: [0.4, 0.9] },
    'plants/wild_rooibos_bush': { kind: 'plant', split: true, h: [0.6, 1.2] },
    'plants/othonna_cerarioides': { kind: 'plant', split: true, h: [0.8, 1.5] },
    'plants/cheiridopsis_succulent': { kind: 'plant', split: true, w: [0.6, 1.1] },
    'plants/crystalline_iceplant': { kind: 'plant', split: true, w: [0.6, 1.1] },
    'plants/shrub_sorrel_01': { kind: 'plant', split: true, w: [0.5, 0.9] },
    'plants/grass_medium_01': { kind: 'plant', split: true, h: [0.5, 0.9] },
    'plants/Grass_Common_Tall': { kind: 'grass', h: [0.8, 1.3] },
    'plants/Grass_Wispy_Tall': { kind: 'grass', h: [0.8, 1.3] },
    // ---- props ----
    'props/barrel_03': { kind: 'barrel', h: [1.15, 1.3], r: 0.6 },
    'props/Barrel_01': { kind: 'xbarrel', h: [1.15, 1.3], r: 0.6 },          // red explosive barrel
    'props/wooden_crate_02': { kind: 'crate', w: [1.4, 1.7], r: 0.55 },
    'props/concrete_road_barrier': { kind: 'barrier', w: [2.6, 3.0], r: 0.4, hp: 2.5 },
  };

  /* ---------------------------------------------------------------------------
   * PER-BIOME LOOK (index = Tank Realms BIOMES index)
   *   ground: [primary, secondary] PBR sets (assets/textures/ground/<name>_{diff,nor}.webp)
   *   tint / tint2: colour multipliers for the two ground layers
   *   uv: world units per texture repeat for [primary, secondary]
   *   hdri: image-based lighting (assets/hdri/<name>.hdr)   envI: its intensity
   *   lists are [modelId, weight, {leaf, tint}] — leaf = recolour MegaKit foliage, tint = whole model
   * -------------------------------------------------------------------------*/
  const B = (o) => o;
  const BIOME_ENV = [
    B({ // 0 Enchanted Forest
      ground: ['forest_ground_04', 'mossy_rock'], tint: 0xeef2e2, tint2: 0xdfe6cf, uv: [9, 13], rough: 0.95,
      hdri: 'quarry_01', envI: 0.55,
      trees: [['trees/Pine_1', 1], ['trees/Pine_2', 1], ['trees/Pine_3', 1], ['trees/Pine_4', 0.6],
              ['trees/TwistedTree_1', 0.7, { leaf: 0x6f9a3c }], ['trees/TwistedTree_2', 0.7, { leaf: 0x5e8c34 }]],
      rocks: [['rocks/boulder_01', 1], ['rocks/rock_moss_set_01', 1.4], ['rocks/rock_moss_set_02', 1.2], ['rocks/rock_face_02', 0.35]],
      wood: [['wood/dead_tree_trunk', 1], ['wood/dead_tree_trunk_02', 1], ['wood/tree_stump_01', 0.8], ['wood/tree_stump_02', 0.6], ['wood/root_cluster_01', 0.4], ['wood/pine_roots', 0.5], ['wood/dry_branches_medium_01', 0.6]],
      plants: [['plants/fern_02', 0.25], ['plants/Fern_1', 0.8, { tint: 0xcfe6b0 }], ['plants/Bush_Common', 0.9, { leaf: 0x5f8f38 }], ['plants/shrub_03', 0.8], ['plants/weed_plant_02', 0.7]],
      grass: [['plants/Grass_Common_Tall', 1], ['plants/Grass_Wispy_Tall', 0.6]], grassTint: 0x9ec46a,
      props: [['props/barrel_03', 1], ['props/Barrel_01', 0.7], ['props/wooden_crate_02', 1]],
    }),
    B({ // 1 Frozen Tundra (no water any more — frozen rock fields instead)
      ground: ['snow_02', 'cliff_side'], tint: 0xf4f8ff, tint2: 0xc9d4e0, uv: [10, 14], rough: 0.75,
      hdri: 'blouberg_sunrise_2', envI: 0.7,
      trees: [['trees/Pine_1', 1, { leaf: 0xa9c7bd }], ['trees/Pine_3', 1, { leaf: 0xb5d0c8 }], ['trees/Pine_5', 1, { leaf: 0x9fbdb3 }], ['trees/DeadTree_1', 0.5, { tint: 0xc4ccd4 }], ['trees/DeadTree_3', 0.4, { tint: 0xc4ccd4 }]],
      rocks: [['rocks/boulder_01', 1, { tint: 0xd4dde8 }], ['rocks/rock_face_01', 0.5, { tint: 0xdde5ee }], ['rocks/rock_face_02', 0.5, { tint: 0xdde5ee }], ['rocks/rock_07', 0.8, { tint: 0xc6d0dc }], ['rocks/stone_01', 0.6, { tint: 0xd0d8e2 }]],
      wood: [['wood/dead_tree_trunk', 0.6, { tint: 0xc0c8d0 }], ['wood/tree_stump_02', 0.5, { tint: 0xc8d0d8 }]],
      plants: [['plants/crystalline_iceplant', 1, { tint: 0xc8e0ff }]],
      grass: [['plants/Grass_Wispy_Tall', 1]], grassTint: 0xb9c9cf, grassMul: 0.3,
      props: [['props/barrel_03', 1], ['props/wooden_crate_02', 0.8], ['props/concrete_road_barrier', 0.5]],
    }),
    B({ // 2 Volcanic Wasteland
      ground: ['aerial_rocks_02', 'rocky_terrain_02'], tint: 0x6a5a52, tint2: 0x54463f, uv: [12, 16], rough: 0.9,
      hdri: 'venice_sunset', envI: 0.45,
      trees: [['trees/DeadTree_1', 1, { tint: 0x2e2622 }], ['trees/DeadTree_2', 1, { tint: 0x2a221e }], ['trees/DeadTree_4', 0.8, { tint: 0x302824 }], ['trees/DeadTree_5', 0.6, { tint: 0x2a221e }]],
      rocks: [['rocks/boulder_01', 1, { tint: 0x5a4c46 }], ['rocks/rock_face_01', 0.7, { tint: 0x4e4440 }], ['rocks/rock_face_02', 0.7, { tint: 0x4e4440 }], ['rocks/namaqualand_cliff_02', 0.12, { tint: 0x4a3e3a }], ['rocks/rock_07', 0.8, { tint: 0x3a3230 }]],
      wood: [['wood/dead_tree_trunk', 0.8, { tint: 0x2a2220 }], ['wood/dead_tree_trunk_02', 0.6, { tint: 0x2a2220 }], ['wood/tree_stump_01', 0.5, { tint: 0x2e2622 }]],
      plants: [],
      grass: [], grassTint: 0x3a2a20,
      props: [['props/Barrel_01', 1.3], ['props/barrel_03', 0.6, { tint: 0x8a7a70 }], ['props/concrete_road_barrier', 0.6, { tint: 0x9a8a80 }]],
    }),
    B({ // 3 Golden Desert
      ground: ['aerial_beach_02', 'sandstone_cracks'], tint: 0xffe8c2, tint2: 0xf0d2a4, uv: [11, 15], rough: 0.95,
      hdri: 'blouberg_sunrise_2', envI: 0.6,
      trees: [['trees/quiver_tree_01', 1.2], ['trees/quiver_tree_02', 1]],
      rocks: [['rocks/namaqualand_boulder_02', 1.3], ['rocks/boulder_01', 0.6, { tint: 0xf0d2aa }], ['rocks/namaqualand_cliff_02', 0.14], ['rocks/rock_07', 0.5, { tint: 0xe8c89a }]],
      wood: [['wood/dead_quiver_trunk', 1], ['wood/dry_branches_medium_01', 0.8, { tint: 0xe0d0b0 }], ['wood/dead_tree_trunk', 0.4, { tint: 0xd8c4a0 }]],
      plants: [['plants/cheiridopsis_succulent', 1], ['plants/othonna_cerarioides', 0.8], ['plants/wild_rooibos_bush', 0.8]],
      grass: [['plants/Grass_Wispy_Tall', 1]], grassTint: 0xd8c07a, grassMul: 0.25,
      props: [['props/barrel_03', 1], ['props/Barrel_01', 0.8], ['props/concrete_road_barrier', 0.8], ['props/wooden_crate_02', 0.8]],
    }),
    B({ // 4 Mystic Swamp (no water any more — boggy mud)
      ground: ['brown_mud_leaves_01', 'forrest_ground_01'], tint: 0xb8c49a, tint2: 0xa8b48a, uv: [9, 12], rough: 0.8,
      hdri: 'moonless_golf', envI: 0.75,
      trees: [['trees/TwistedTree_1', 1, { leaf: 0x6b7a3a }], ['trees/TwistedTree_2', 1, { leaf: 0x5d6e34 }], ['trees/DeadTree_2', 0.8, { tint: 0x7a806a }], ['trees/DeadTree_3', 0.6, { tint: 0x707860 }]],
      rocks: [['rocks/rock_moss_set_01', 1.2], ['rocks/rock_moss_set_02', 1.2], ['rocks/boulder_01', 0.4, { tint: 0x9aa88a }]],
      wood: [['wood/root_cluster_01', 1], ['wood/pine_roots', 1], ['wood/dead_tree_trunk_02', 1, { tint: 0x9aa08a }], ['wood/tree_stump_02', 0.8], ['wood/dry_branches_medium_01', 0.6]],
      plants: [['plants/fern_02', 0.3, { tint: 0xb8c890 }], ['plants/weed_plant_02', 1], ['plants/shrub_01', 0.8, { tint: 0xb0c088 }], ['plants/Fern_1', 0.6, { tint: 0xa8c080 }]],
      grass: [['plants/Grass_Common_Tall', 1], ['plants/Grass_Wispy_Tall', 1]], grassTint: 0x7a8a4a,
      props: [['props/barrel_03', 1, { tint: 0xa0a890 }], ['props/wooden_crate_02', 0.8, { tint: 0xa0a890 }]],
    }),
    B({ // 5 Crystal Caverns
      ground: ['cliff_side', 'clean_pebbles'], tint: 0x9aa6c8, tint2: 0x8a96b8, uv: [12, 9], rough: 0.7,
      hdri: 'moonless_golf', envI: 0.9,
      trees: [],
      rocks: [['rocks/rock_face_01', 1, { tint: 0x8a96c0 }], ['rocks/rock_face_02', 1, { tint: 0x8a96c0 }], ['rocks/boulder_01', 0.8, { tint: 0x7a86b0 }], ['rocks/rock_07', 0.8, { tint: 0x8090c0 }], ['rocks/namaqualand_cliff_02', 0.12, { tint: 0x7a86b0 }]],
      wood: [],
      plants: [['plants/crystalline_iceplant', 1, { tint: 0xa0c0ff }]],
      grass: [], grassTint: 0x5a6a9a,
      props: [['props/barrel_03', 0.6, { tint: 0x9aa6c8 }], ['props/wooden_crate_02', 0.5, { tint: 0x9aa6c8 }]],
    }),
    B({ // 6 Autumn Grove
      ground: ['forest_leaves_02', 'forrest_ground_03'], tint: 0xf4e2c8, tint2: 0xe8d2b4, uv: [9, 12], rough: 0.95,
      hdri: 'venice_sunset', envI: 0.6,
      trees: [['trees/TwistedTree_1', 1], ['trees/TwistedTree_2', 1, { leaf: 0xe08a32 }], ['trees/TwistedTree_1', 0.8, { leaf: 0xd8a040 }], ['trees/DeadTree_2', 0.4], ['trees/Pine_2', 0.4, { leaf: 0x8a8a3a }]],
      rocks: [['rocks/boulder_01', 1], ['rocks/rock_moss_set_02', 1], ['rocks/rock_07', 0.6]],
      wood: [['wood/dead_tree_trunk', 1], ['wood/dead_tree_trunk_02', 1], ['wood/tree_stump_01', 1], ['wood/dry_branches_medium_01', 1]],
      plants: [['plants/shrub_04', 1, { tint: 0xe8b070 }], ['plants/Bush_Common', 1, { leaf: 0xd8782a }], ['plants/weed_plant_02', 0.6, { tint: 0xd8a860 }], ['plants/fern_02', 0.2, { tint: 0xe0a860 }]],
      grass: [['plants/Grass_Wispy_Tall', 1]], grassTint: 0xc8964a,
      props: [['props/barrel_03', 1], ['props/wooden_crate_02', 1], ['props/Barrel_01', 0.5]],
    }),
    B({ // 7 Sakura Valley (no water any more — grassy meadows)
      ground: ['leafy_grass', 'grass_path_2'], tint: 0xf2f6e8, tint2: 0xf0eee0, uv: [8, 11], rough: 0.95,
      hdri: 'spruit_sunrise', envI: 0.65,
      trees: [['trees/TwistedTree_1', 1, { leaf: 0xf5a3c8 }], ['trees/TwistedTree_2', 1, { leaf: 0xf8b6d4 }], ['trees/TwistedTree_1', 0.6, { leaf: 0xffc8de }], ['trees/Pine_3', 0.25]],
      rocks: [['rocks/rock_moss_set_01', 1], ['rocks/boulder_01', 0.6, { tint: 0xe8dcdc }], ['rocks/stone_01', 0.6]],
      wood: [['wood/tree_stump_01', 0.6], ['wood/dead_tree_trunk', 0.5]],
      plants: [['plants/shrub_sorrel_01', 1.3], ['plants/Bush_Common', 1, { leaf: 0xf2a0c4 }], ['plants/fern_02', 0.25], ['plants/shrub_03', 0.6]],
      grass: [['plants/Grass_Common_Tall', 1], ['plants/Grass_Wispy_Tall', 0.6]], grassTint: 0x9ccc6a,
      props: [['props/wooden_crate_02', 1], ['props/barrel_03', 0.8]],
    }),
    B({ // 8 Blood Moon Canyon
      ground: ['sandstone_cracks', 'dry_river_pebbles'], tint: 0xc07a6a, tint2: 0x9a5a4a, uv: [12, 14], rough: 0.95,
      hdri: 'venice_sunset', envI: 0.5,
      trees: [['trees/DeadTree_3', 1, { tint: 0x4a2a24 }], ['trees/DeadTree_4', 1, { tint: 0x422420 }], ['trees/DeadTree_5', 0.6, { tint: 0x4a2a24 }]],
      rocks: [['rocks/namaqualand_boulder_02', 1, { tint: 0xc07060 }], ['rocks/boulder_01', 0.8, { tint: 0xa05a4c }], ['rocks/namaqualand_cliff_02', 0.18, { tint: 0xb06656 }], ['rocks/rock_face_01', 0.5, { tint: 0xa05a4c }]],
      wood: [['wood/dead_quiver_trunk', 0.8, { tint: 0xb08070 }], ['wood/dry_branches_medium_01', 0.8, { tint: 0x9a6a5a }], ['wood/dead_tree_trunk', 0.5, { tint: 0x7a4a40 }]],
      plants: [['plants/othonna_cerarioides', 0.5, { tint: 0xb07060 }]],
      grass: [], grassTint: 0x6a2a20,
      props: [['props/Barrel_01', 1], ['props/concrete_road_barrier', 0.8, { tint: 0xc09080 }], ['props/barrel_03', 0.6, { tint: 0xb08070 }]],
    }),
    B({ // 9 Neon Void
      ground: ['ganges_river_pebbles', 'lichen_rock'], tint: 0x4a4460, tint2: 0x3a3450, uv: [8, 12], rough: 0.55,
      hdri: 'moonless_golf', envI: 1.0,
      trees: [['trees/DeadTree_1', 0.5, { tint: 0x1a1628 }], ['trees/DeadTree_2', 0.5, { tint: 0x1a1628 }]],
      rocks: [['rocks/rock_face_01', 1, { tint: 0x3a3452 }], ['rocks/rock_face_02', 1, { tint: 0x3a3452 }], ['rocks/boulder_01', 1, { tint: 0x2e2a44 }], ['rocks/rock_07', 0.6, { tint: 0x2a2640 }]],
      wood: [],
      plants: [],
      grass: [], grassTint: 0x2a2440,
      props: [['props/barrel_03', 0.6, { tint: 0x6a60a0 }], ['props/Barrel_01', 0.6]],
    }),
  ];

  /* ---------------------------------------------------------------------------
   * CREATURE MODELS (see creatures.js for their stats + behaviour)
   *   h: target height (world units), yaw: extra rotation so the model faces +Z,
   *   anims: separate animation library bound by bone names (UAL for humanoids)
   * -------------------------------------------------------------------------*/
  const CREATURE_MODELS = {
    boar:      { model: 'creatures/Pig', h: 1.9, tint: 0x5b3b2b, rough: 0.9 },
    fox:       { model: 'creatures/Fox', h: 1.7 },
    bat:       { model: 'creatures/Bat', h: 1.5 },
    rhino:     { model: 'creatures/Rhino2', h: 2.7, tint: 0x8a8580 },
    mimic:     { model: 'props/wooden_crate_02', w: 2.0 },
    shaman:    { model: 'humanoids/Superhero', anims: 'humanoids/UAL_anims', h: 2.35, skin: 0x7ab0a0 },
    duck:      { model: 'creatures/Duck', h: 1.6, yaw: -Math.PI / 2 },
    sentinel:  { model: 'creatures/RobotExpressive', h: 2.7 },
    brute:     { model: 'humanoids/Superhero', anims: 'humanoids/UAL_anims', h: 2.6, skin: 0x6f9a4a },
    gunslinger:{ model: 'humanoids/Superhero', anims: 'humanoids/UAL_anims', h: 2.3, skin: 0xb07a5a },
    dullahan:  { model: 'humanoids/Peasant', anims: 'humanoids/UAL_anims', h: 2.35, tint: 0x6a6a7a },
    wolf:      { model: 'creatures/Wolf', h: 1.85 },
    stag:      { model: 'creatures/Stag', h: 2.6 },
    bull:      { model: 'creatures/Bull', h: 2.3 },
    steed:     { model: 'creatures/Horse', h: 2.5, tint: 0x3a3040 },
    parrot:    { model: 'creatures/Parrot', h: 1.25, fly: true },
    stork:     { model: 'creatures/Stork', h: 1.3, fly: true, yaw: -Math.PI / 2 },
    flamingo:  { model: 'creatures/Flamingo', h: 1.8, fly: true },
    imp:       { model: 'creatures/Demon', h: 1.9 },
    wraith:    { model: 'creatures/Ghost', h: 2.0 },
    sprite:    { model: 'creatures/Goleling', h: 1.6 },
    djinn:     { model: 'creatures/Hywirl', h: 2.0 },
    tiki:      { model: 'creatures/Tribal', h: 2.0 },
    sporecap:  { model: 'creatures/Mushnub_Evolved', h: 2.1 },
    cactoro:   { model: 'creatures/Cactoro', h: 2.0 },
    voidling:  { model: 'creatures/Alien', h: 1.9 },
    drake:     { model: 'creatures/Dragon', h: 2.2 },
    wyrm:      { model: 'creatures/Dragon_Evolved', h: 5.6 },       // boss
    golemking: { model: 'creatures/Goleling_Evolved', h: 5.0 },     // boss
    frostgiant:{ model: 'humanoids/Superhero', anims: 'humanoids/UAL_anims', h: 6.2, skin: 0x9ac4e8 }, // boss
  };

  /* ---------------------------------------------------------------------------
   * LOADER
   * -------------------------------------------------------------------------*/
  const models = new Map();   // id -> { promise, data, failed }
  const textures = new Map(); // url -> texture (shared)
  let pending = 0, done = 0;
  const listeners = new Set();
  function notify() { listeners.forEach(fn => { try { fn(done, pending); } catch (e) {} }); }

  function prepareModel(id, g) {
    const scene = g.scene;
    scene.updateMatrixWorld(true);
    scene.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true; o.receiveShadow = true;
        markShared(o.geometry);
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          markShared(m);
          ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap'].forEach(k => { if (m[k]) { m[k].anisotropy = 4; markShared(m[k]); } });
          if (m.alphaTest > 0 || m.transparent) { m.alphaTest = Math.max(m.alphaTest || 0, 0.45); m.transparent = false; m.side = T.DoubleSide; }
        });
      }
    });
    const cfg = ENV[id] || {};
    // static variants (instancing) — skinned/animated models are cloned instead
    let root = scene;
    while (root.children.length === 1 && !root.children[0].isMesh && root.children[0].children.length) root = root.children[0];
    const groups = cfg.split ? root.children.filter(c => { let has = false; c.traverse(x => { if (x.isMesh) has = true; }); return has; }) : [root];
    const variants = [];
    const box = new T.Box3(), tmp = new T.Box3();
    for (const gnode of groups) {
      box.makeEmpty();
      const parts = [];
      gnode.traverse(o => {
        if (o.isMesh && !o.isSkinnedMesh) {
          if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
          tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld);
          box.union(tmp);
          parts.push({ geometry: o.geometry, material: o.material, matrix: o.matrixWorld.clone(), name: (o.material && o.material.name) || '' });
        }
      });
      if (!parts.length || box.isEmpty()) continue;
      const size = box.getSize(new T.Vector3());
      const center = box.getCenter(new T.Vector3());
      const off = new T.Matrix4().makeTranslation(-center.x, -box.min.y, -center.z);
      parts.forEach(p => p.matrix.premultiply(off));
      variants.push({ parts, size, index: variants.length });
    }
    g.userData = g.userData || {};
    g.userData.variants = variants;
    g.userData.id = id;
    return g;
  }

  function loadModel(id) {
    let rec = models.get(id);
    if (rec) return rec.promise;
    rec = { data: null, failed: false, promise: null };
    models.set(id, rec);
    pending++; notify();
    rec.promise = new Promise(resolve => {
      gltfLoader.load(BASE + 'models/' + id + '.glb', g => {
        try { rec.data = prepareModel(id, g); } catch (e) { console.warn('[assets] prepare failed', id, e); rec.failed = true; }
        done++; notify(); resolve(rec.data);
      }, undefined, err => {
        console.warn('[assets] model failed (procedural fallback used):', id, err && err.message);
        rec.failed = true; done++; notify(); resolve(null);
      });
    });
    return rec.promise;
  }
  function getModel(id) { const r = models.get(id); return r && r.data; }
  function modelFailed(id) { const r = models.get(id); return !!(r && r.failed); }

  function loadTexture(url, srgb, repeat) {
    if (textures.has(url)) return textures.get(url);
    pending++; notify();
    const t = texLoader.load(BASE + url, () => { done++; notify(); }, undefined, () => { done++; notify(); console.warn('[assets] texture failed', url); t.userData.failed = true; });
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = T.SRGBColorSpace;
    markShared(t);
    textures.set(url, t);
    return t;
  }

  /* ---------- ground sets ---------- */
  function groundSet(name) {
    return {
      map: loadTexture('textures/ground/' + name + '_diff.webp', true),
      normalMap: loadTexture('textures/ground/' + name + '_nor.webp', false),
    };
  }

  /* ---------- HDRI → PMREM environment ---------- */
  const envCache = new Map();
  let pmrem = null, rendererRef = null;
  function setRenderer(r) { rendererRef = r; }
  function loadEnvironment(name) {
    if (envCache.has(name)) return envCache.get(name);
    const rec = { texture: null, promise: null };
    envCache.set(name, rec);
    pending++; notify();
    rec.promise = new Promise(resolve => {
      hdrLoader.load(BASE + 'hdri/' + name + '.hdr', tex => {
        try {
          if (!pmrem && rendererRef) pmrem = new T.PMREMGenerator(rendererRef);
          tex.mapping = T.EquirectangularReflectionMapping;
          rec.texture = pmrem ? pmrem.fromEquirectangular(tex).texture : tex;
          if (pmrem) tex.dispose();
          markShared(rec.texture);
        } catch (e) { console.warn('[assets] env failed', name, e); }
        done++; notify(); resolve(rec.texture);
      }, undefined, () => { done++; notify(); resolve(null); });
    });
    return rec;
  }

  /* ---------- lists / preloading ---------- */
  function biomeModelIds(i) {
    const b = BIOME_ENV[i % BIOME_ENV.length];
    const ids = new Set();
    ['trees', 'rocks', 'wood', 'plants', 'grass', 'props'].forEach(k => (b[k] || []).forEach(e => ids.add(e[0])));
    return [...ids];
  }
  function ensureBiome(i) {
    const b = BIOME_ENV[i % BIOME_ENV.length];
    const ps = biomeModelIds(i).map(loadModel);
    groundSet(b.ground[0]); groundSet(b.ground[1]);
    if (rendererRef) loadEnvironment(b.hdri);
    return Promise.all(ps);
  }
  function biomeReady(i) { return biomeModelIds(i).every(id => getModel(id) || modelFailed(id)); }

  function creatureModelIds(key) {
    const c = CREATURE_MODELS[key]; if (!c) return [];
    return c.anims ? [c.model, c.anims] : [c.model];
  }
  function ensureCreature(key) { return Promise.all(creatureModelIds(key).map(loadModel)); }
  function creatureReady(key) { const ids = creatureModelIds(key); return ids.length > 0 && ids.every(id => getModel(id)); }

  /* sequential background queue so first-realm assets always win the bandwidth */
  const bgQueue = []; let bgBusy = false;
  function queueBackground(ids) {
    ids.forEach(id => { if (!models.has(id) && !bgQueue.includes(id)) bgQueue.push(id); });
    pumpBackground();
  }
  function pumpBackground() {
    if (bgBusy || !bgQueue.length) return;
    bgBusy = true;
    const id = bgQueue.shift();
    loadModel(id).then(() => { bgBusy = false; setTimeout(pumpBackground, 30); });
  }

  window.Assets = {
    BASE, ENV, BIOME_ENV, CREATURE_MODELS, markShared,
    loadModel, getModel, modelFailed, loadTexture, groundSet, setRenderer, loadEnvironment,
    ensureBiome, biomeReady, biomeModelIds, ensureCreature, creatureReady, creatureModelIds,
    queueBackground,
    onProgress(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    get progress() { return { done, pending }; },
  };
})();
