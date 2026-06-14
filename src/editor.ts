import * as THREE from 'three';
import type { Input } from './input';
import type { World } from './world';
import { GRID, nextBlockId, saveMap } from './gamemap';

const HALF = GRID / 2;
const FLY_SPEED = 16;
const FAST_FLY = 32;
const LOOK_SENSITIVITY = 0.0022;
const MAX_REACH = 80;

// a friendly building palette (number keys 1–8 pick)
export const PALETTE = [
  0xb0b7c3, 0xc9803a, 0x4c8c5a, 0x4a6fb0, 0xb0506b, 0xd9b34a, 0x7a5bb0, 0x2e3742,
];

const CENTER = new THREE.Vector2(0, 0);

// horizontal grid lattice (…-2,0,2,4…); vertical lattice sits a half-cell up so
// cubes rest on the ground (…1,3,5…)
const snapH = (v: number) => Math.round(v / GRID) * GRID;
const snapV = (v: number) => Math.round((v - HALF) / GRID) * GRID + HALF;

/**
 * Build mode: a free-fly camera, left-click to place a block on the face you're
 * looking at, right-click to remove one, number keys to pick a colour, F to set
 * the spawn point. Edits save to the browser immediately. Produces a GameMap the
 * rest of the game plays in — the heart of the whole project.
 */
export class Editor {
  yaw = 0;
  pitch = -0.3;
  colorIndex = 0;

  private raycaster = new THREE.Raycaster();
  private ghost: THREE.Mesh;
  private marker: THREE.Group;
  private ghostValid = false;
  private ghostCell = new THREE.Vector3();
  private hoverBlockId: string | undefined;

  // edge detection so one click = one action
  private prev: Record<string, boolean> = {};

  constructor(
    private world: World,
    private input: Input,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(GRID, GRID, GRID),
      new THREE.MeshBasicMaterial({
        color: PALETTE[0],
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      }),
    );
    this.ghost.visible = false;
    this.world.scene.add(this.ghost);

    this.marker = this.buildMarker();
    this.marker.visible = false;
    this.world.scene.add(this.marker);
  }

  /** Entering build mode: lift to an overview and show the helpers. */
  enter() {
    this.camera.position.set(this.world.spawn.x, this.world.spawn.y + 9, this.world.spawn.z + 16);
    this.yaw = 0;
    this.pitch = -0.4;
    this.applyCamera();
    this.ghost.visible = false;
    this.marker.visible = true;
    this.updateMarker();
  }

  exit() {
    this.ghost.visible = false;
    this.marker.visible = false;
  }

  get currentColor(): number {
    return PALETTE[this.colorIndex]!;
  }

  /** Aim the editor camera (test helper). */
  setView(yawDeg: number, pitchDeg: number, pos?: [number, number, number]) {
    this.yaw = (yawDeg * Math.PI) / 180;
    this.pitch = (pitchDeg * Math.PI) / 180;
    if (pos) this.camera.position.set(...pos);
    this.applyCamera();
  }

  update(dt: number) {
    // look
    const { dx, dy } = this.input.consumeMouse();
    this.yaw -= dx * LOOK_SENSITIVITY;
    this.pitch -= dy * LOOK_SENSITIVITY;
    const limit = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));

    // free-fly movement
    const forward = (this.input.down('KeyW') ? 1 : 0) - (this.input.down('KeyS') ? 1 : 0);
    const strafe = (this.input.down('KeyD') ? 1 : 0) - (this.input.down('KeyA') ? 1 : 0);
    const lift = (this.input.down('Space') ? 1 : 0) - (this.input.down('ShiftLeft') ? 1 : 0);
    const speed = this.input.down('ShiftRight') ? FAST_FLY : FLY_SPEED;

    const move = new THREE.Vector3(strafe, 0, -forward);
    if (move.lengthSq() > 0) move.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    move.y += lift;
    this.camera.position.addScaledVector(move, speed * dt);
    this.applyCamera();
    // the raycaster reads camera.matrixWorld, which Three.js only refreshes at
    // render time — update it now so placement matches what we're looking at
    this.camera.updateMatrixWorld();

    this.updateGhost();
    this.handleActions();
  }

  private applyCamera() {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  private updateGhost() {
    this.raycaster.setFromCamera(CENTER, this.camera);
    const hits = this.raycaster.intersectObjects(this.world.getBlockMeshes(), false);
    const hit = hits[0];

    if (!hit || hit.distance > MAX_REACH || !hit.face) {
      this.ghost.visible = false;
      this.ghostValid = false;
      this.hoverBlockId = undefined;
      return;
    }

    this.hoverBlockId = hit.object.userData.blockId as string | undefined;

    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    const p = hit.point;
    this.ghostCell.set(
      snapH(p.x + n.x * HALF),
      snapV(p.y + n.y * HALF),
      snapH(p.z + n.z * HALF),
    );
    this.ghost.position.copy(this.ghostCell);
    (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(this.currentColor);
    this.ghost.visible = true;
    this.ghostValid = true;
  }

  private handleActions() {
    // colour select (Digit1..Digit8)
    for (let i = 0; i < PALETTE.length; i++) {
      if (this.pressed(`Digit${i + 1}`)) this.colorIndex = i;
    }

    if (this.pressed('Mouse0') && this.ghostValid) this.placeBlock();
    if (this.pressed('Mouse2')) this.deleteHovered();
    if (this.pressed('KeyF')) this.setSpawnFromAim();

    // remember this frame's button states for next-frame edge detection
    for (const code of ['Mouse0', 'Mouse2', 'KeyF', ...digits()]) {
      this.prev[code] = this.input.down(code);
    }
  }

  private pressed(code: string): boolean {
    return this.input.down(code) && !this.prev[code];
  }

  /** Place a cube at the ghost cell unless one is already there. */
  placeBlock() {
    const { x, y, z } = this.ghostCell;
    if (this.occupied(x, y, z)) return;
    this.world.addBlock({ id: nextBlockId(), x, y, z, w: GRID, h: GRID, d: GRID, color: this.currentColor });
    this.persist();
  }

  private deleteHovered() {
    if (!this.hoverBlockId) return;
    const block = this.world.getBlock(this.hoverBlockId);
    if (!block || block.locked) return;
    this.world.removeBlock(this.hoverBlockId);
    this.persist();
  }

  private setSpawnFromAim() {
    this.raycaster.setFromCamera(CENTER, this.camera);
    const hit = this.raycaster.intersectObjects(this.world.getBlockMeshes(), false)[0];
    if (!hit) return;
    this.world.setSpawn(hit.point.x, hit.point.y + 1, hit.point.z);
    this.updateMarker();
    this.persist();
  }

  private occupied(x: number, y: number, z: number): boolean {
    return this.world
      .getBlocks()
      .some((b) => Math.abs(b.x - x) < 0.1 && Math.abs(b.y - y) < 0.1 && Math.abs(b.z - z) < 0.1);
  }

  private persist() {
    saveMap(this.world.toMap());
  }

  private updateMarker() {
    const s = this.world.spawn;
    this.marker.position.set(s.x, s.y, s.z);
  }

  private buildMarker(): THREE.Group {
    const group = new THREE.Group();
    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.12, 2, 8),
      new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.85 }),
    );
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.9, 0.08, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0x39ff88, transparent: true, opacity: 0.55 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = -1;
    group.add(post, ring);
    return group;
  }
}

function digits(): string[] {
  return ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8'];
}
