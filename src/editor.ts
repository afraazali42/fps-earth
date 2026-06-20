import * as THREE from 'three';
import type { Input } from './input';
import type { World } from './world';
import { nextBlockId, saveMap, type MapBlock } from './gamemap';

// a friendly building palette (also shown as clickable swatches in the menu)
export const PALETTE = [
  0xb0b7c3, 0xc9803a, 0x4c8c5a, 0x4a6fb0, 0xb0506b, 0xd9b34a, 0x7a5bb0, 0x2e3742,
];

export interface ShapeDef {
  name: string;
  w: number;
  h: number;
  d: number;
}

// beginner-friendly building pieces; the size can then be tweaked in the menu
export const SHAPES: ShapeDef[] = [
  { name: 'Block', w: 2, h: 2, d: 2 },
  { name: 'Slab', w: 4, h: 0.5, d: 4 },
  { name: 'Wall', w: 4, h: 3, d: 0.5 },
  { name: 'Pillar', w: 1, h: 4, d: 1 },
  { name: 'Small', w: 1, h: 1, d: 1 },
];

interface UndoAction {
  added: MapBlock[];
  removed: MapBlock[];
}

const FLY_SPEED = 16;
const FAST_FLY = 32;
const LOOK_SENSITIVITY = 0.0022;
const MAX_REACH = 120;
const MAX_UNDO = 100;
const MIN_SIZE = 0.5;
const MAX_SIZE = 24;

const CENTER = new THREE.Vector2(0, 0);

/**
 * Build mode — Minecraft-creative feel. You're in first person with a crosshair:
 * move the mouse to look, WASD + Space/Shift to fly, left-click to place a piece
 * where the ghost shows, right-click to remove. R rotates the piece. The shape,
 * colour and size are chosen from the creation menu (opened with E, where the
 * mouse is freed) or the hotbar (number keys). The world interaction stays
 * locked to the crosshair; only the menu frees the cursor.
 */
export class Editor {
  yaw = 0;
  pitch = -0.3;
  shapeIndex = 0;
  colorIndex = 0;
  size = { ...SHAPES[0]! };
  /** piece rotation about the vertical axis, in 90° steps (0,1,2,3) */
  yawSteps = 0;
  /** fired after any change so the HUD/menu can refresh */
  onChange: (() => void) | null = null;

  private raycaster = new THREE.Raycaster();
  private ghost: THREE.Mesh;
  private marker: THREE.Group;
  private ghostValid = false;
  private ghostCenter = new THREE.Vector3();
  private hoverBlockId: string | undefined;
  private undoStack: UndoAction[] = [];
  private prevMouse0 = false;
  private prevMouse2 = false;
  private active = false;

  constructor(
    private world: World,
    private input: Input,
    private camera: THREE.PerspectiveCamera,
  ) {
    this.ghost = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: PALETTE[0], transparent: true, opacity: 0.5, depthWrite: false }),
    );
    this.ghost.visible = false;
    this.world.scene.add(this.ghost);

    this.marker = this.buildMarker();
    this.marker.visible = false;
    this.world.scene.add(this.marker);
  }

  get currentColor(): number {
    return PALETTE[this.colorIndex]!;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  /** degrees, for display */
  get rotationDeg(): number {
    return this.yawSteps * 90;
  }

  enter() {
    this.camera.position.set(this.world.spawn.x, this.world.spawn.y + 8, this.world.spawn.z + 14);
    this.pitch = -0.35;
    this.marker.visible = true;
    this.updateMarker();
    // don't let a held button from the entering click place immediately
    this.prevMouse0 = true;
    this.prevMouse2 = true;
    this.active = true;
    this.onChange?.();
  }

  exit() {
    this.ghost.visible = false;
    this.marker.visible = false;
    this.active = false;
  }

  /** Stop placing while the creation menu is open (mouse is freed there). */
  setInteractive(on: boolean) {
    this.active = on;
    if (!on) this.ghost.visible = false;
  }

  // --- selection (menu / hotbar) -------------------------------------------

  setShapeIndex(i: number) {
    if (i < 0 || i >= SHAPES.length) return;
    this.shapeIndex = i;
    this.size = { ...SHAPES[i]! };
    this.onChange?.();
  }
  setColorIndex(i: number) {
    if (i >= 0 && i < PALETTE.length) this.colorIndex = i;
    this.onChange?.();
  }
  adjustSize(axis: 'w' | 'h' | 'd', delta: number) {
    this.size[axis] = Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round((this.size[axis] + delta) * 2) / 2));
    this.onChange?.();
  }
  rotate() {
    this.yawSteps = (this.yawSteps + 1) % 4;
    this.onChange?.();
  }

  undo() {
    const action = this.undoStack.pop();
    if (!action) return;
    for (const b of action.added) this.world.removeBlock(b.id);
    for (const b of action.removed) this.world.addBlock(b);
    this.persist();
    this.onChange?.();
  }

  clear() {
    const removed = this.world.getBlocks().filter((b) => !b.locked);
    if (removed.length === 0) return;
    for (const b of removed) this.world.removeBlock(b.id);
    this.pushUndo({ added: [], removed });
    this.persist();
    this.onChange?.();
  }

  setSpawnAtCrosshair() {
    const hit = this.raycastCenter();
    if (!hit) return;
    this.world.setSpawn(hit.point.x, hit.point.y + 1, hit.point.z);
    this.updateMarker();
    this.persist();
  }

  // --- per-frame -----------------------------------------------------------

  update(dt: number) {
    if (!this.active) return; // paused while the creation menu is open
    // look (only accumulates while pointer-locked, i.e. while building)
    const { dx, dy } = this.input.consumeMouse();
    this.yaw -= dx * LOOK_SENSITIVITY;
    this.pitch -= dy * LOOK_SENSITIVITY;
    const limit = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));

    // fly
    const forward = (this.input.down('KeyW') ? 1 : 0) - (this.input.down('KeyS') ? 1 : 0);
    const strafe = (this.input.down('KeyD') ? 1 : 0) - (this.input.down('KeyA') ? 1 : 0);
    const lift = (this.input.down('Space') ? 1 : 0) - (this.input.down('ShiftLeft') ? 1 : 0);
    const speed = this.input.down('ShiftRight') ? FAST_FLY : FLY_SPEED;
    const move = new THREE.Vector3(strafe, 0, -forward);
    if (move.lengthSq() > 0) move.normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    move.y += lift;
    this.camera.position.addScaledVector(move, speed * dt);

    this.applyCamera();
    this.camera.updateMatrixWorld();

    this.updateGhost();
    this.handleClicks();
  }

  /** Aim the editor camera (test helper). */
  setView(yawDeg: number, pitchDeg: number, pos?: [number, number, number]) {
    this.yaw = (yawDeg * Math.PI) / 180;
    this.pitch = (pitchDeg * Math.PI) / 180;
    if (pos) this.camera.position.set(...pos);
    this.applyCamera();
    this.camera.updateMatrixWorld();
  }

  private applyCamera() {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  private raycastCenter(): THREE.Intersection | undefined {
    this.raycaster.setFromCamera(CENTER, this.camera);
    const hit = this.raycaster.intersectObjects(this.world.getBlockMeshes(), false)[0];
    return hit && hit.distance <= MAX_REACH ? hit : undefined;
  }

  private updateGhost() {
    const hit = this.raycastCenter();
    this.hoverBlockId = hit ? (hit.object.userData.blockId as string | undefined) : undefined;

    if (!this.active || !hit || !hit.face) {
      this.ghost.visible = false;
      this.ghostValid = false;
      return;
    }

    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    // footprint swaps with 90°/270° rotation
    const swap = this.yawSteps % 2 === 1;
    const ew = swap ? this.size.d : this.size.w;
    const ed = swap ? this.size.w : this.size.d;
    this.placementCenter(hit.point, n, ew, this.size.h, ed, this.ghostCenter);

    this.ghost.position.copy(this.ghostCenter);
    this.ghost.scale.set(this.size.w, this.size.h, this.size.d);
    this.ghost.rotation.set(0, (this.yawSteps * Math.PI) / 2, 0);
    (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(this.currentColor);
    this.ghost.visible = true;
    this.ghostValid = true;
  }

  private handleClicks() {
    const m0 = this.input.down('Mouse0');
    const m2 = this.input.down('Mouse2');
    if (this.active && m0 && !this.prevMouse0 && this.ghostValid) this.placePiece();
    if (this.active && m2 && !this.prevMouse2) this.deleteHovered();
    this.prevMouse0 = m0;
    this.prevMouse2 = m2;
  }

  private placePiece() {
    const block: MapBlock = {
      id: nextBlockId(),
      x: this.ghostCenter.x,
      y: this.ghostCenter.y,
      z: this.ghostCenter.z,
      w: this.size.w,
      h: this.size.h,
      d: this.size.d,
      color: this.currentColor,
    };
    if (this.yawSteps !== 0) block.rotation = [0, (this.yawSteps * Math.PI) / 2, 0];
    this.world.addBlock(block);
    this.pushUndo({ added: [block], removed: [] });
    this.persist();
    this.onChange?.();
  }

  private deleteHovered() {
    if (!this.hoverBlockId) return;
    const block = this.world.getBlock(this.hoverBlockId);
    if (!block || block.locked) return;
    const copy = { ...block };
    this.world.removeBlock(this.hoverBlockId);
    this.pushUndo({ added: [], removed: [copy] });
    this.persist();
    this.onChange?.();
  }

  /** Flush against the clicked surface, snapped to a 1 m grid perpendicular. */
  private placementCenter(p: THREE.Vector3, n: THREE.Vector3, ew: number, h: number, ed: number, out: THREE.Vector3) {
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    const snap = (v: number, size: number) => Math.round(v - size / 2) + size / 2;
    if (ay >= ax && ay >= az) {
      out.x = snap(p.x, ew);
      out.z = snap(p.z, ed);
      out.y = p.y + Math.sign(n.y || 1) * (h / 2);
    } else if (ax >= az) {
      out.y = snap(p.y, h);
      out.z = snap(p.z, ed);
      out.x = p.x + Math.sign(n.x || 1) * (ew / 2);
    } else {
      out.x = snap(p.x, ew);
      out.y = snap(p.y, h);
      out.z = p.z + Math.sign(n.z || 1) * (ed / 2);
    }
  }

  private pushUndo(action: UndoAction) {
    this.undoStack.push(action);
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }

  private persist() {
    saveMap(this.world.toMap());
  }

  private updateMarker() {
    const sp = this.world.spawn;
    this.marker.position.set(sp.x, sp.y, sp.z);
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
