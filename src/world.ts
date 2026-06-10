import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { GameConfig } from './config';

export interface BoxOptions {
  /** width, height, depth in metres */
  size: [number, number, number];
  /** centre of the box in world space */
  position: [number, number, number];
  color?: number;
  /** euler rotation in radians */
  rotation?: [number, number, number];
}

/**
 * Owns both the visual scene (Three.js) and the physics scene (Rapier).
 * Every solid object goes through addBox() so the two always stay in sync.
 * This is deliberately the seed of the future map format: a map is a list
 * of boxes — exactly what the map editor will produce.
 */
export class World {
  scene = new THREE.Scene();
  physics: RAPIER.World;

  constructor(config: GameConfig) {
    // world gravity will matter once dynamic props exist; players integrate
    // gravity themselves from the same config value
    this.physics = new RAPIER.World(new RAPIER.Vector3(0, config.gravity, 0));
    this.setupSkyAndLights();
    this.buildTestMap();
  }

  /** Adds one solid box to both the visual scene and the physics world. */
  addBox({ size, position, color = 0x8d99ae, rotation }: BoxOptions): THREE.Mesh {
    const [w, h, d] = size;

    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
    );
    mesh.position.set(...position);
    if (rotation) mesh.rotation.set(...rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(...position);
    if (rotation) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...rotation));
      bodyDesc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
    const body = this.physics.createRigidBody(bodyDesc);
    this.physics.createCollider(RAPIER.ColliderDesc.cuboid(w / 2, h / 2, d / 2), body);

    return mesh;
  }

  private setupSkyAndLights() {
    const sky = 0xbfd9ff;
    this.scene.background = new THREE.Color(sky);
    this.scene.fog = new THREE.Fog(sky, 60, 220);

    const hemi = new THREE.HemisphereLight(0xdfeeff, 0x3a4a3f, 1.1);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff3df, 2.4);
    sun.position.set(45, 70, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -70;
    sun.shadow.camera.right = 70;
    sun.shadow.camera.top = 70;
    sun.shadow.camera.bottom = -70;
    sun.shadow.camera.near = 10;
    sun.shadow.camera.far = 180;
    this.scene.add(sun);
  }

  /** A hand-placed playground to test movement: stairs, ramp, crates, jumps. */
  private buildTestMap() {
    // ground slab, 120 x 120 m
    this.addBox({ size: [120, 1, 120], position: [0, -0.5, 0], color: 0x49845c });

    const grid = new THREE.GridHelper(120, 60, 0xffffff, 0xffffff);
    const gridMat = grid.material as THREE.LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = 0.12;
    grid.position.y = 0.02;
    this.scene.add(grid);

    // crate cluster near spawn
    this.addBox({ size: [2, 2, 2], position: [-6, 1, -4], color: 0xc9803a });
    this.addBox({ size: [2, 2, 2], position: [-3.5, 1, -5], color: 0xb3552e });
    this.addBox({ size: [2, 2, 2], position: [-4.8, 3, -4.4], color: 0xd9a441, rotation: [0, 0.4, 0] });

    // long wall for cover
    this.addBox({ size: [10, 3, 0.8], position: [8, 1.5, -8], color: 0x77879a });

    // staircase: five 0.4 m steps the character controller walks up automatically
    for (let i = 0; i < 5; i++) {
      this.addBox({
        size: [3, 0.4, 1.2],
        position: [-10, 0.2 + 0.4 * i, -10 - 1.2 * i],
        color: 0x9aa3ad,
      });
    }
    // platform at the top of the stairs (top surface at y = 2.0)
    this.addBox({ size: [4, 0.4, 4], position: [-10, 1.8, -17.4], color: 0x5c6bc0 });

    // ramp: rises from y=0 at z=-12 up to y≈2.6 at z=-20
    this.addBox({ size: [4, 0.3, 8.5], position: [14, 1.3, -16], color: 0x90a4ae, rotation: [0.31, 0, 0] });
    // platform the ramp leads onto
    this.addBox({ size: [5, 0.4, 5], position: [14, 2.4, -22.5], color: 0x5c6bc0 });

    // floating pads for jump practice
    this.addBox({ size: [2, 0.4, 2], position: [2, 1.2, -14], color: 0xe0b14d });
    this.addBox({ size: [2, 0.4, 2], position: [5, 1.6, -16.5], color: 0xe0b14d });
    this.addBox({ size: [2, 0.4, 2], position: [8, 2.0, -19], color: 0xe0b14d });

    // a few scattered blocks for variety
    this.addBox({ size: [3, 3, 3], position: [18, 1.5, 2], color: 0x6b5cc0 });
    this.addBox({ size: [1, 1, 1], position: [20.5, 0.5, 5], color: 0xe0b14d });
    this.addBox({ size: [3, 3, 3], position: [-16, 1.5, 6], color: 0xa05c6b, rotation: [0, 0.6, 0] });

    // tall landmark tower in the far corner — helps you stay oriented
    this.addBox({ size: [3, 16, 3], position: [-45, 8, -45], color: 0x4a5866 });
  }
}
