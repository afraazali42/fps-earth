import * as THREE from 'three';
import type { World } from './world';
import type { FlagWire } from './host';

// match the team colours used for players: Good Guys blue, Bad Guys red
const TEAM_COLORS = [0x4a80ff, 0xe0473a];

/**
 * Renders the two capture-the-flag flags — a pole with a coloured cloth. The
 * host owns where each flag is (at base, carried, or dropped); this just draws
 * them there. Hidden entirely unless capture-the-flag is the active mode.
 */
export class Flags {
  private groups: THREE.Group[] = [];

  constructor(world: World) {
    for (let team = 0; team < 2; team++) {
      const g = this.buildFlag(TEAM_COLORS[team]!);
      g.visible = false;
      world.scene.add(g);
      this.groups.push(g);
    }
  }

  update(flags: FlagWire[], enabled: boolean) {
    for (let i = 0; i < this.groups.length; i++) {
      const g = this.groups[i]!;
      const f = flags[i];
      if (!enabled || !f) {
        g.visible = false;
        continue;
      }
      g.visible = true;
      // ride above the carrier's head when carried, else sit on the ground
      g.position.set(f.x, f.y + (f.carrier ? 1.5 : 0), f.z);
    }
  }

  private buildFlag(color: number): THREE.Group {
    const group = new THREE.Group();
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8),
      new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.6 }),
    );
    pole.position.y = 1.3;
    const cloth = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.7, 0.06),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5, side: THREE.DoubleSide }),
    );
    cloth.position.set(0.58, 2.2, 0);
    group.add(pole, cloth);
    return group;
  }
}
