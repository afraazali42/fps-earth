import * as THREE from 'three';
import type { Input } from './input';
import { World, rampGeometry } from './world';
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
  type?: 'ramp';
}

export const SHAPES: ShapeDef[] = [
  { name: 'Block', w: 2, h: 2, d: 2 },
  { name: 'Slab', w: 4, h: 0.5, d: 4 },
  { name: 'Wall', w: 4, h: 3, d: 0.5 },
  { name: 'Pillar', w: 1, h: 4, d: 1 },
  { name: 'Small', w: 1, h: 1, d: 1 },
  { name: 'Ramp', w: 4, h: 2, d: 4, type: 'ramp' },
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
 * Build mode — Minecraft-creative feel, with a Select mode for editing what
 * you've already built.
 *
 * Build: first person + crosshair, left-click places the piece, right-click
 * removes one; the piece's shape/colour/size/rotation come from the hotbar and
 * the creation menu (E). Select (toggle with Tab): the crosshair highlights a
 * block; left-click selects it; then the menu recolours / resizes / rotates it,
 * or you can duplicate, delete, or move it. Everything is undoable.
 */
export class Editor {
  yaw = 0;
  pitch = -0.3;
  // brush (placing new blocks)
  shapeIndex = 0;
  colorIndex = 0;
  size = { ...SHAPES[0]! };
  yawSteps = 0;
  // select / edit
  selecting = false;
  selectedId: string | undefined;
  moving = false;

  onChange: (() => void) | null = null;

  private raycaster = new THREE.Raycaster();
  private ghost: THREE.Mesh;
  private rampGhost: THREE.Mesh;
  private marker: THREE.Group;
  private hoverBox: THREE.LineSegments;
  private selBox: THREE.LineSegments;
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
    const ghostMat = () =>
      new THREE.MeshBasicMaterial({ color: PALETTE[0], transparent: true, opacity: 0.5, depthWrite: false });
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), ghostMat());
    this.rampGhost = new THREE.Mesh(rampGeometry(1, 1, 1), ghostMat());
    this.ghost.visible = false;
    this.rampGhost.visible = false;
    this.world.scene.add(this.ghost, this.rampGhost);

    this.hoverBox = this.makeOutline(0xffffff, 0.55);
    this.selBox = this.makeOutline(0x46e0ff, 1);
    this.world.scene.add(this.hoverBox, this.selBox);

    this.marker = this.buildMarker();
    this.marker.visible = false;
    this.world.scene.add(this.marker);
  }

  get currentColor(): number {
    return PALETTE[this.colorIndex]!;
  }
  get currentType(): 'ramp' | undefined {
    return SHAPES[this.shapeIndex]!.type;
  }
  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  get rotationDeg(): number {
    return this.yawSteps * 90;
  }
  get hasSelection(): boolean {
    return this.selectedId !== undefined && this.world.getBlock(this.selectedId) !== undefined;
  }
  /** A copy of the selected block's data (for the menu display). */
  get selectedBlock(): MapBlock | undefined {
    return this.selectedId ? this.world.getBlock(this.selectedId) : undefined;
  }

  enter() {
    this.camera.position.set(this.world.spawn.x, this.world.spawn.y + 8, this.world.spawn.z + 14);
    this.pitch = -0.35;
    this.marker.visible = true;
    this.updateMarker();
    this.prevMouse0 = true;
    this.prevMouse2 = true;
    this.active = true;
    this.onChange?.();
  }

  exit() {
    this.hideGhost();
    this.marker.visible = false;
    this.hoverBox.visible = false;
    this.selBox.visible = false;
    this.active = false;
  }

  setInteractive(on: boolean) {
    this.active = on;
    if (!on) this.hideGhost();
  }

  // --- mode ----------------------------------------------------------------

  setSelecting(on: boolean) {
    this.selecting = on;
    this.moving = false;
    if (!on) this.deselect();
    this.hideGhost();
    this.hoverBox.visible = false;
    this.onChange?.();
  }

  deselect() {
    this.selectedId = undefined;
    this.selBox.visible = false;
    this.moving = false;
    this.onChange?.();
  }

  // --- brush selection (menu / hotbar) -------------------------------------

  setShapeIndex(i: number) {
    if (i < 0 || i >= SHAPES.length) return;
    this.shapeIndex = i;
    this.size = { ...SHAPES[i]! };
    this.onChange?.();
  }

  /** Colour: edits the selection if one is active, else the brush. */
  applyColor(i: number) {
    if (i < 0 || i >= PALETTE.length) return;
    if (this.hasSelection) {
      this.edit((b) => ({ ...b, color: PALETTE[i]! }));
    } else {
      this.colorIndex = i;
      this.onChange?.();
    }
  }

  applySize(axis: 'w' | 'h' | 'd', delta: number) {
    if (this.hasSelection) {
      this.edit((b) => ({ ...b, [axis]: clampSize(b[axis] + delta) }));
    } else {
      this.size[axis] = clampSize(this.size[axis] + delta);
      this.onChange?.();
    }
  }

  applyRotate() {
    if (this.hasSelection) {
      this.edit((b) => {
        const cur = b.rotation ? b.rotation[1] : 0;
        const next = (Math.round(cur / (Math.PI / 2)) + 1) % 4;
        return { ...b, rotation: next === 0 ? undefined : [0, (next * Math.PI) / 2, 0] };
      });
    } else {
      this.yawSteps = (this.yawSteps + 1) % 4;
      this.onChange?.();
    }
  }

  // --- edit the selected block ---------------------------------------------

  deleteSelection() {
    const block = this.selectedBlock;
    if (!block || block.locked) return;
    this.world.removeBlock(block.id);
    this.pushUndo({ added: [], removed: [{ ...block }] });
    this.selectedId = undefined;
    this.selBox.visible = false;
    this.persist();
    this.onChange?.();
  }

  duplicateSelection() {
    const block = this.selectedBlock;
    if (!block) return;
    const copy: MapBlock = { ...block, id: nextBlockId(), x: block.x + (block.w || 2) };
    delete copy.locked;
    this.world.addBlock(copy);
    this.pushUndo({ added: [{ ...copy }], removed: [] });
    this.selectedId = copy.id;
    this.persist();
    this.onChange?.();
  }

  /** Begin moving the selected block — it follows the crosshair until you click. */
  startMove() {
    if (this.hasSelection) this.moving = true;
  }

  private edit(change: (b: MapBlock) => MapBlock) {
    const before = this.selectedBlock;
    if (!before || before.locked) return;
    const after = change({ ...before });
    after.id = before.id;
    this.world.replaceBlock(after);
    this.pushUndo({ added: [{ ...after }], removed: [{ ...before }] });
    this.persist();
    this.onChange?.();
  }

  undo() {
    const action = this.undoStack.pop();
    if (!action) return;
    for (const b of action.added) this.world.removeBlock(b.id);
    for (const b of action.removed) this.world.addBlock(b);
    if (this.selectedId && !this.world.getBlock(this.selectedId)) this.selectedId = undefined;
    this.persist();
    this.onChange?.();
  }

  clear() {
    const removed = this.world.getBlocks().filter((b) => !b.locked);
    if (removed.length === 0) return;
    for (const b of removed) this.world.removeBlock(b.id);
    this.pushUndo({ added: [], removed });
    this.selectedId = undefined;
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
    if (!this.active) return;
    const { dx, dy } = this.input.consumeMouse();
    this.yaw -= dx * LOOK_SENSITIVITY;
    this.pitch -= dy * LOOK_SENSITIVITY;
    const limit = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));

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

    const m0 = this.input.down('Mouse0');
    const m2 = this.input.down('Mouse2');
    const click0 = m0 && !this.prevMouse0;
    const click2 = m2 && !this.prevMouse2;

    if (this.moving) {
      this.updateMoveGhost();
      if (click0) this.commitMove();
      else if (click2) this.moving = false;
    } else if (this.selecting) {
      this.updateHover();
      if (click0 && this.hoverBlockId) this.select(this.hoverBlockId);
      else if (click2) this.deselect();
    } else {
      this.updateGhost();
      if (click0 && this.ghostValid) this.placePiece();
      else if (click2) this.deleteHovered();
    }
    this.refreshSelectionBox();

    this.prevMouse0 = m0;
    this.prevMouse2 = m2;
  }

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

  private updateHover() {
    const hit = this.raycastCenter();
    const id = hit ? (hit.object.userData.blockId as string | undefined) : undefined;
    const block = id ? this.world.getBlock(id) : undefined;
    this.hoverBlockId = block && !block.locked ? id : undefined;
    if (this.hoverBlockId && this.hoverBlockId !== this.selectedId && block) {
      this.placeOutline(this.hoverBox, block);
    } else {
      this.hoverBox.visible = false;
    }
  }

  private select(id: string) {
    this.selectedId = id;
    this.refreshSelectionBox();
    this.onChange?.();
  }

  private refreshSelectionBox() {
    const block = this.selectedBlock;
    if (block) this.placeOutline(this.selBox, block);
    else {
      this.selBox.visible = false;
      if (this.selectedId) this.selectedId = undefined;
    }
  }

  private updateMoveGhost() {
    const block = this.selectedBlock;
    const hit = this.raycastCenter();
    if (!block || !hit || !hit.face) {
      this.hideGhost();
      return;
    }
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    const rotY = block.rotation ? block.rotation[1] : 0;
    const swap = Math.round(rotY / (Math.PI / 2)) % 2 === 1;
    const ew = swap ? block.d : block.w;
    const ed = swap ? block.w : block.d;
    this.placementCenter(hit.point, n, ew, block.h, ed, this.ghostCenter);
    this.showGhost(block.type, block.w, block.h, block.d, rotY, block.color);
  }

  private commitMove() {
    const block = this.selectedBlock;
    if (!block || !(this.ghost.visible || this.rampGhost.visible)) return;
    this.edit((b) => ({ ...b, x: this.ghostCenter.x, y: this.ghostCenter.y, z: this.ghostCenter.z }));
    this.moving = false;
    this.hideGhost();
  }

  private updateGhost() {
    const hit = this.raycastCenter();
    this.hoverBlockId = hit ? (hit.object.userData.blockId as string | undefined) : undefined;
    if (!this.active || !hit || !hit.face) {
      this.hideGhost();
      this.ghostValid = false;
      return;
    }
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
    const swap = this.yawSteps % 2 === 1;
    const ew = swap ? this.size.d : this.size.w;
    const ed = swap ? this.size.w : this.size.d;
    this.placementCenter(hit.point, n, ew, this.size.h, ed, this.ghostCenter);
    this.showGhost(this.currentType, this.size.w, this.size.h, this.size.d, (this.yawSteps * Math.PI) / 2, this.currentColor);
    this.ghostValid = true;
  }

  private showGhost(type: 'ramp' | undefined, w: number, h: number, d: number, rotY: number, color: number) {
    const g = type === 'ramp' ? this.rampGhost : this.ghost;
    const other = type === 'ramp' ? this.ghost : this.rampGhost;
    other.visible = false;
    g.position.copy(this.ghostCenter);
    g.scale.set(w, h, d);
    g.rotation.set(0, rotY, 0);
    (g.material as THREE.MeshBasicMaterial).color.setHex(color);
    g.visible = true;
  }

  private hideGhost() {
    this.ghost.visible = false;
    this.rampGhost.visible = false;
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
    if (this.currentType) block.type = this.currentType;
    this.world.addBlock(block);
    this.pushUndo({ added: [{ ...block }], removed: [] });
    this.persist();
    this.onChange?.();
  }

  private deleteHovered() {
    if (!this.hoverBlockId) return;
    const block = this.world.getBlock(this.hoverBlockId);
    if (!block || block.locked) return;
    this.world.removeBlock(this.hoverBlockId);
    this.pushUndo({ added: [], removed: [{ ...block }] });
    this.persist();
    this.onChange?.();
  }

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

  private placeOutline(outline: THREE.LineSegments, block: MapBlock) {
    outline.position.set(block.x, block.y, block.z);
    outline.scale.set(block.w + 0.06, block.h + 0.06, block.d + 0.06);
    outline.rotation.set(0, block.rotation ? block.rotation[1] : 0, 0);
    outline.visible = true;
  }

  private makeOutline(color: number, opacity: number): THREE.LineSegments {
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    const seg = new THREE.LineSegments(
      edges,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false }),
    );
    seg.renderOrder = 999;
    seg.visible = false;
    return seg;
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

function clampSize(v: number): number {
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(v * 2) / 2));
}
