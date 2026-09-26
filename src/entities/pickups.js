/* ============================================================================
 * entities/pickups.js — supply drops (repair, coolant, overdrive, shield, relic)
 * Floating rune-marked caches; drive through them to collect.
 * ==========================================================================*/
import * as THREE from 'three';
import { PICKUPS } from '../config.js';
import { rand, weightedPick } from '../core/util.js';
import { terrainHeight } from '../world/terrain.js';

const ICONS = { repair: '+', coolant: '❄', overdrive: '»', shield: '◈', relic: '★' };

export class PickupManager {
  constructor(scene, lib) {
    this.scene = scene;
    this.lib = lib;
    this.list = [];
    this.boxGeo = new THREE.BoxGeometry(1.3, 1.3, 1.3);
    this.runeGeo = new THREE.PlaneGeometry(4.2, 4.2);
    this.runeGeo.rotateX(-Math.PI / 2);
    this.beamGeo = new THREE.CylinderGeometry(0.5, 0.9, 14, 12, 1, true);
    this.beamGeo.translate(0, 7, 0);
    this.mats = {};
    for (const [k, def] of Object.entries(PICKUPS)) {
      this.mats[k] = {
        box: new THREE.MeshStandardMaterial({
          color: 0x2a2a2e, map: lib.metal.map, normalMap: lib.metal.normalMap, metalness: 0.8, roughness: 0.4,
          emissive: new THREE.Color(def.color), emissiveIntensity: 0.9
        }),
        rune: new THREE.MeshBasicMaterial({ map: lib.rune, color: def.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.8 }),
        beam: new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }),
        glow: new THREE.SpriteMaterial({ map: lib.soft, color: def.color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, opacity: 0.9 })
      };
    }
  }

  spawn(pos, kind = null) {
    const entries = Object.entries(PICKUPS).map(([key, d]) => ({ key, weight: d.weight }));
    const k = kind || weightedPick(entries).key;
    const def = PICKUPS[k];
    const m = this.mats[k];
    const g = new THREE.Group();
    const box = new THREE.Mesh(this.boxGeo, m.box);
    box.castShadow = true;
    box.position.y = 1.6;
    g.add(box);
    const rune = new THREE.Mesh(this.runeGeo, m.rune);
    rune.position.y = 0.12;
    g.add(rune);
    const beam = new THREE.Mesh(this.beamGeo, m.beam);
    g.add(beam);
    const glow = new THREE.Sprite(m.glow);
    glow.scale.setScalar(3.2);
    glow.position.y = 1.6;
    g.add(glow);
    g.position.set(pos.x, terrainHeight(pos.x, pos.z), pos.z);
    this.scene.add(g);
    const p = { kind: k, def, group: g, box, rune, glow, pos: g.position, life: 30, t: rand(0, 6), icon: ICONS[k] };
    this.list.push(p);
    return p;
  }

  update(dt, player, onCollect) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.t += dt;
      p.life -= dt;
      p.box.rotation.y += dt * 1.6;
      p.box.rotation.x = Math.sin(p.t * 1.3) * 0.25;
      p.box.position.y = 1.7 + Math.sin(p.t * 2.4) * 0.3;
      p.glow.position.y = p.box.position.y;
      p.rune.rotation.y -= dt * 0.8;
      p.pos.y = terrainHeight(p.pos.x, p.pos.z);
      const blink = p.life < 6 ? (Math.sin(p.t * 16) > 0 ? 1 : 0.2) : 1;
      p.glow.material.opacity = 0.9 * blink;
      const dx = p.pos.x - player.pos.x, dz = p.pos.z - player.pos.z;
      const d2 = dx * dx + dz * dz;
      const far = d2 > 220 * 220;
      if (player.alive && d2 < 4.2 * 4.2) { onCollect(p); this.remove(i); continue; }
      if (p.life <= 0 || far) this.remove(i);
    }
  }

  remove(i) {
    const p = this.list[i];
    this.scene.remove(p.group);
    this.list.splice(i, 1);
  }

  clear() { while (this.list.length) this.remove(this.list.length - 1); }
}
