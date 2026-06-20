import * as THREE from 'three';
import type { Input } from './input';
import type { World } from './world';
import { nextBlockId, saveMap, type MapBlock } from './gamemap';

// a friendly building palette (also shown as clickable swatches)
export const PALETTE = [
  0xb0b7c3, 0xc9803a, 0x4c8c5a, 0x4a6fb0, 0xb0506b, 0xd9b34a, 0x7a5bb0, 0x2e3742,
];

export interface ShapeDef {
  name: string;
  w: number;
  h: number;
  d: number;
}

// beginner-friendly building pieces; integer sizes so same-size pieces tile
export const SHAPES: ShapeDef[] = [
  { name: 'Block', w: 2, h: 2, d: 2 },
  { name: 'Slab', w: 4, h: 0.5, d: 4 },
  { name: 'Wall', w: 4, h: 3, d: 0.5 },
  { name: 'Pillar', w: 1, h: 4, d: 1 },
  { name: 'Small', w: 1, h: 1, d: 1 },
];

export type Tool = 'place' | 'delete';

interface UndoAction {
  added: MapBlock[];
  removed: MapBlock[];
}

const FLY_SPEED = 18;
const FAST_FLY = 36;
const DRAG_SENSITIVITY = 0.004;
const MAX_REACH = 120;
const MAX_UNDO = 100;

/**
 * Build mode — a free-mouse editor (Roblox-Studio-like), the foundation for an
 * editor that's simple for beginners yet deep for power users.
 *
 * The mouse is a normal cursor: move it over the world and a ghost shows where
 * the current piece will land; left-click to place (or remove, with the Delete
 * tool). Hold the right mouse button and drag to look around; WASD + Space/Shift
 * fly. A visible toolbar (built in main.ts) drives the tool, shape, colour, and
 * actions like Undo and Clear — so nothing important is hidden behind a keybind.
 */
export class Editor {
  yaw = 0;
  pitch = -0.4;
  tool: Tool = 'place';
  shapeIndex = 0;
  colorIndex = 0;
  /** fired after any change so the toolbar can refresh (undo availability etc.) */
  onChange: (() => void) | null = null;

  private raycaster = new THREE.Raycaster();
  private ghost: THREE.Mesh;
  private marker: THREE.Group;
  private cursor = new THREE.Vector2(0, 0);
  private hasCursor = false;
  private ghostValid = false;
  private ghostCenter = new THREE.Vector3();
  private hoverBlockId: string | undefined;
  private looking = false;
  private undoStack: UndoAction[] = [];

  // bound DOM handlers (so we can detach on exit)
  private onMove = (e: MouseEvent) => this.handleMove(e);
  private onDown = (e: MouseEvent) => this.handleDown(e);
  private onUp = (e: MouseEvent) => this.handleUp(e);
  private onContext = (e: Event) => e.preventDefault();

  constructor(
    private world: World,
    private input: Input,
    private camera: THREE.PerspectiveCamera,
    private canvas: HTMLElement,
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

  get currentShape(): ShapeDef {
    return SHAPES[this.shapeIndex]!;
  }
  get currentColor(): number {
    return PALETTE[this.colorIndex]!;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  enter() {
    this.camera.position.set(this.world.spawn.x, this.world.spawn.y + 10, this.world.spawn.z + 18);
    this.yaw = 0;
    this.pitch = -0.45;
    this.applyCamera();
    this.marker.visible = true;
    this.updateMarker();
    this.canvas.addEventListener('mousemove', this.onMove);
    this.canvas.addEventListener('mousedown', this.onDown);
    window.addEventListener('mouseup', this.onUp);
    this.canvas.addEventListener('contextmenu', this.onContext);
    this.onChange?.();
  }

  exit() {
    this.ghost.visible = false;
    this.marker.visible = false;
    this.looking = false;
    this.canvas.removeEventListener('mousemove', this.onMove);
    this.canvas.removeEventListener('mousedown', this.onDown);
    window.removeEventListener('mouseup', this.onUp);
    this.canvas.removeEventListener('contextmenu', this.onContext);
  }

  // --- toolbar API ---------------------------------------------------------

  setTool(tool: Tool) {
    this.tool = tool;
    this.onChange?.();
  }
  setShapeIndex(i: number) {
    if (i >= 0 && i < SHAPES.length) this.shapeIndex = i;
    this.onChange?.();
  }
  setColorIndex(i: number) {
    if (i >= 0 && i < PALETTE.length) this.colorIndex = i;
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

  /** Wipe everything you can delete back to a blank canvas (undoable). */
  clear() {
    const removed = this.world.getBlocks().filter((b) => !b.locked);
    if (removed.length === 0) return;
    for (const b of removed) this.world.removeBlock(b.id);
    this.pushUndo({ added: [], removed });
    this.persist();
    this.onChange?.();
  }

  setSpawnAtCursor() {
    const hit = this.raycastCursor();
    if (!hit) return;
    this.world.setSpawn(hit.point.x, hit.point.y + 1, hit.point.z);
    this.updateMarker();
    this.persist();
  }

  // --- per-frame -----------------------------------------------------------

  update(dt: number) {
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
  }

  /** Aim the editor camera (test helper). */
  setView(yawDeg: number, pitchDeg: number, pos?: [number, number, number]) {
    this.yaw = (yawDeg * Math.PI) / 180;
    this.pitch = (pitchDeg * Math.PI) / 180;
    if (pos) this.camera.position.set(...pos);
    this.applyCamera();
    this.camera.updateMatrixWorld();
  }

  // --- input handlers ------------------------------------------------------

  private handleMove(e: MouseEvent) {
    // the canvas fills the viewport from the top-left, so map straight from the
    // window size — robust even if the canvas's layout box is momentarily 0
    this.cursor.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.cursor.y = -(e.clientY / window.innerHeight) * 2 + 1;
    this.hasCursor = true;
    if (this.looking) {
      this.yaw -= e.movementX * DRAG_SENSITIVITY;
      this.pitch -= e.movementY * DRAG_SENSITIVITY;
      const limit = Math.PI / 2 - 0.02;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    }
  }

  private handleDown(e: MouseEvent) {
    if (e.button === 2) {
      this.looking = true;
    } else if (e.button === 0) {
      if (this.tool === 'place') this.placeAtCursor();
      else this.deleteAtCursor();
    }
  }

  private handleUp(e: MouseEvent) {
    if (e.button === 2) this.looking = false;
  }

  // --- placement -----------------------------------------------------------

  private applyCamera() {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  private raycastCursor(): THREE.Intersection | undefined {
    if (!this.hasCursor) return undefined;
    this.raycaster.setFromCamera(this.cursor, this.camera);
    const hit = this.raycaster.intersectObjects(this.world.getBlockMeshes(), false)[0];
    return hit && hit.distance <= MAX_REACH ? hit : undefined;
  }

  private updateGhost() {
    const hit = this.raycastCursor();
    this.hoverBlockId = hit ? (hit.object.userData.blockId as string | undefined) : undefined;

    if (this.tool === 'delete') {
      // highlight the block the cursor is over
      const block = this.hoverBlockId ? this.world.getBlock(this.hoverBlockId) : undefined;
      if (block && !block.locked) {
        this.ghost.scale.set(block.w + 0.06, block.h + 0.06, block.d + 0.06);
        this.ghost.position.set(block.x, block.y, block.z);
        (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(0xff4444);
        this.ghost.visible = true;
      } else {
        this.ghost.visible = false;
      }
      this.ghostValid = false;
      return;
    }

    if (!hit || !hit.face) {
      this.ghost.visible = false;
      this.ghostValid = false;
      return;
    }

    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    this.placementCenter(hit.point, n, this.currentShape, this.ghostCenter);
    const s = this.currentShape;
    this.ghost.scale.set(s.w, s.h, s.d);
    this.ghost.position.copy(this.ghostCenter);
    (this.ghost.material as THREE.MeshBasicMaterial).color.setHex(this.currentColor);
    this.ghost.visible = true;
    this.ghostValid = true;
  }

  private placeAtCursor() {
    if (!this.ghostValid) return;
    const s = this.currentShape;
    const block: MapBlock = {
      id: nextBlockId(),
      x: this.ghostCenter.x,
      y: this.ghostCenter.y,
      z: this.ghostCenter.z,
      w: s.w,
      h: s.h,
      d: s.d,
      color: this.currentColor,
    };
    this.world.addBlock(block);
    this.pushUndo({ added: [block], removed: [] });
    this.persist();
    this.onChange?.();
  }

  private deleteAtCursor() {
    if (!this.hoverBlockId) return;
    const block = this.world.getBlock(this.hoverBlockId);
    if (!block || block.locked) return;
    const copy = { ...block };
    this.world.removeBlock(this.hoverBlockId);
    this.pushUndo({ added: [], removed: [copy] });
    this.persist();
    this.onChange?.();
  }

  /**
   * Where a new block lands: flush against the surface you clicked, snapped to a
   * 1 m grid on the two perpendicular axes (so same-size pieces tile).
   */
  private placementCenter(p: THREE.Vector3, n: THREE.Vector3, s: ShapeDef, out: THREE.Vector3) {
    const ax = Math.abs(n.x);
    const ay = Math.abs(n.y);
    const az = Math.abs(n.z);
    const snapEdge = (v: number, size: number) => Math.round(v - size / 2) + size / 2;
    if (ay >= ax && ay >= az) {
      out.x = snapEdge(p.x, s.w);
      out.z = snapEdge(p.z, s.d);
      out.y = p.y + Math.sign(n.y || 1) * (s.h / 2);
    } else if (ax >= az) {
      out.y = snapEdge(p.y, s.h);
      out.z = snapEdge(p.z, s.d);
      out.x = p.x + Math.sign(n.x || 1) * (s.w / 2);
    } else {
      out.x = snapEdge(p.x, s.w);
      out.y = snapEdge(p.y, s.h);
      out.z = p.z + Math.sign(n.z || 1) * (s.d / 2);
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
