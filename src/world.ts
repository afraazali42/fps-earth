import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { GameConfig } from './config';
import type { GameMap, MapBlock } from './gamemap';

export interface BoxOptions {
  /** width, height, depth in metres */
  size: [number, number, number];
  /** centre of the box in world space */
  position: [number, number, number];
  color?: number;
  /** euler rotation in radians */
  rotation?: [number, number, number];
}

interface BlockHandle {
  block: MapBlock;
  mesh: THREE.Mesh;
  body: RAPIER.RigidBody;
}

/**
 * Owns both the visual scene (Three.js) and the physics scene (Rapier), and
 * builds the world from a GameMap. Map blocks are tracked by id so the editor
 * can add and remove them; the two representations (visual + physics) always
 * stay in sync.
 */
export class World {
  scene = new THREE.Scene();
  physics: RAPIER.World;
  spawn = { x: 0, y: 2, z: 14 };

  private blocks = new Map<string, BlockHandle>();

  constructor(config: GameConfig, map: GameMap) {
    // world gravity will matter once dynamic props exist; players integrate
    // gravity themselves from the same config value
    this.physics = new RAPIER.World(new RAPIER.Vector3(0, config.gravity, 0));
    this.setupSkyAndLights();
    this.addGrid();
    this.loadMap(map);
  }

  /** Update world gravity live (used when the host changes the rules). */
  setGravity(g: number) {
    this.physics.gravity = new RAPIER.Vector3(0, g, 0);
  }

  /** Replace the whole world with a new map. */
  loadMap(map: GameMap) {
    for (const id of [...this.blocks.keys()]) this.removeBlock(id);
    for (const block of map.blocks) this.addBlock(block);
    this.spawn = { ...map.spawn };
  }

  /** Add one map block (visual mesh + physics collider), tracked by id. */
  addBlock(block: MapBlock): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(block.w, block.h, block.d),
      new THREE.MeshStandardMaterial({ color: block.color, roughness: 0.85 }),
    );
    mesh.position.set(block.x, block.y, block.z);
    if (block.rotation) mesh.rotation.set(...block.rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.blockId = block.id;
    this.scene.add(mesh);

    const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(block.x, block.y, block.z);
    if (block.rotation) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...block.rotation));
      bodyDesc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
    }
    const body = this.physics.createRigidBody(bodyDesc);
    this.physics.createCollider(
      RAPIER.ColliderDesc.cuboid(block.w / 2, block.h / 2, block.d / 2),
      body,
    );

    this.blocks.set(block.id, { block, mesh, body });
  }

  removeBlock(id: string): void {
    const handle = this.blocks.get(id);
    if (!handle) return;
    this.scene.remove(handle.mesh);
    handle.mesh.geometry.dispose();
    (handle.mesh.material as THREE.Material).dispose();
    this.physics.removeRigidBody(handle.body);
    this.blocks.delete(id);
  }

  getBlock(id: string): MapBlock | undefined {
    return this.blocks.get(id)?.block;
  }

  getBlocks(): MapBlock[] {
    return [...this.blocks.values()].map((h) => h.block);
  }

  /** Meshes for the editor's raycaster. */
  getBlockMeshes(): THREE.Mesh[] {
    return [...this.blocks.values()].map((h) => h.mesh);
  }

  setSpawn(x: number, y: number, z: number) {
    this.spawn = { x, y, z };
  }

  /** The current world as serialisable map data (for saving). */
  toMap(): GameMap {
    return { blocks: this.getBlocks().map((b) => ({ ...b })), spawn: { ...this.spawn } };
  }

  /** Untracked scenery box (used for things like target posts). */
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

  private addGrid() {
    const grid = new THREE.GridHelper(80, 40, 0xffffff, 0xffffff);
    const gridMat = grid.material as THREE.LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = 0.1;
    grid.position.y = 0.03;
    this.scene.add(grid);
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
}
