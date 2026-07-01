import * as THREE from 'three';
import type { Input } from './input';
import { World, rampGeometry } from './world';
import { nextBlockId, type MapBlock } from './gamemap';
import { saveCurrent } from './mapstore';

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
const BOX_DRAG_THRESHOLD = 40; // view-sweep (px) before a select-mode hold becomes a box
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
  moving = false;
  private sel = new Set<string>();
  private primary: string | undefined; // the menu's anchor block
  // clipboard for copy/paste (survives map switches within a session)
  private clipboard: { blocks: MapBlock[]; refX: number; refZ: number; baseY: number } | null = null;
  // box-select (drag a region in select mode)
  private boxing = false;
  private boxStart = new THREE.Vector3();
  private boxEnd = new THREE.Vector3();
  private boxMoved = 0;
  private lookMag = 0; // how much the view moved this frame (click-vs-drag test)
  private previewBoxes: THREE.LineSegments[] = []; // outlines of would-be-selected blocks

  onChange: (() => void) | null = null;

  private raycaster = new THREE.Raycaster();
  private ghost: THREE.Mesh;
  private rampGhost: THREE.Mesh;
  private marker: THREE.Group;
  private hoverBox: THREE.LineSegments;
  private selBoxes: THREE.LineSegments[] = []; // one outline per selected block
  private regionBox: THREE.Mesh; // the translucent footprint while box-selecting
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
    this.world.scene.add(this.hoverBox);

    this.regionBox = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x46e0ff, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    this.regionBox.visible = false;
    this.world.scene.add(this.regionBox);

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
    return this.sel.size > 0;
  }
  get selectionCount(): number {
    return this.sel.size;
  }
  get canPaste(): boolean {
    return this.clipboard !== null;
  }
  get clipboardCount(): number {
    return this.clipboard ? this.clipboard.blocks.length : 0;
  }
  /** The "primary" block id — the menu's anchor (last one clicked). */
  get selectedId(): string | undefined {
    return this.primary;
  }
  selectionIds(): string[] {
    return [...this.sel];
  }
  /** A copy of the primary selected block's data (for the menu display). */
  get selectedBlock(): MapBlock | undefined {
    return this.primary ? this.world.getBlock(this.primary) : undefined;
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
    this.hideSelBoxes();
    this.boxing = false;
    this.hideBoxPreview();
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
    this.sel.clear();
    this.primary = undefined;
    this.hideSelBoxes();
    this.boxing = false;
    this.hideBoxPreview();
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

  /** Colour: edits the selection (all of it) if one is active, else the brush. */
  applyColor(i: number) {
    if (i < 0 || i >= PALETTE.length) return;
    if (this.hasSelection) {
      this.editSelection((b) => ({ ...b, color: PALETTE[i]! }));
    } else {
      this.colorIndex = i;
      this.onChange?.();
    }
  }

  applySize(axis: 'w' | 'h' | 'd', delta: number) {
    if (this.hasSelection) {
      this.editSelection((b) => ({ ...b, [axis]: clampSize(b[axis] + delta) }));
    } else {
      this.size[axis] = clampSize(this.size[axis] + delta);
      this.onChange?.();
    }
  }

  applyRotate() {
    if (this.hasSelection) {
      this.editSelection((b) => {
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
    const removed: MapBlock[] = [];
    for (const id of this.sel) {
      const b = this.world.getBlock(id);
      if (!b || b.locked) continue;
      this.world.removeBlock(id);
      removed.push({ ...b });
    }
    if (removed.length === 0) return;
    this.pushUndo({ added: [], removed });
    this.sel.clear();
    this.primary = undefined;
    this.hideSelBoxes();
    this.persist();
    this.onChange?.();
  }

  duplicateSelection() {
    const blocks = this.selectionIds()
      .map((id) => this.world.getBlock(id))
      .filter((b): b is MapBlock => !!b);
    if (blocks.length === 0) return;
    // offset the copies just past the selection's right edge, so nothing overlaps
    // and the whole group keeps its shape
    let minX = Infinity;
    let maxX = -Infinity;
    for (const b of blocks) {
      minX = Math.min(minX, b.x - b.w / 2);
      maxX = Math.max(maxX, b.x + b.w / 2);
    }
    const dx = Math.max(2, maxX - minX);
    const added: MapBlock[] = [];
    const next = new Set<string>();
    let last: string | undefined;
    for (const b of blocks) {
      const copy: MapBlock = { ...b, id: nextBlockId(), x: b.x + dx };
      delete copy.locked;
      this.world.addBlock(copy);
      added.push({ ...copy });
      next.add(copy.id);
      last = copy.id;
    }
    this.pushUndo({ added, removed: [] });
    this.sel = next;
    this.primary = last;
    this.refreshSelectionBox();
    this.persist();
    this.onChange?.();
  }

  /** Copy the current selection to the clipboard (relative to its base centre). */
  copySelection() {
    const blocks = this.selectionIds()
      .map((id) => this.world.getBlock(id))
      .filter((b): b is MapBlock => !!b && !b.locked)
      .map(cloneBlock);
    if (blocks.length === 0) return;
    let sx = 0;
    let sz = 0;
    let baseY = Infinity;
    for (const b of blocks) {
      sx += b.x;
      sz += b.z;
      baseY = Math.min(baseY, b.y - b.h / 2);
    }
    this.clipboard = { blocks, refX: sx / blocks.length, refZ: sz / blocks.length, baseY };
    this.onChange?.();
  }

  /** Paste at the crosshair (or, aiming at nothing, just beside where it was copied). */
  paste() {
    const c = this.clipboard;
    if (!c) return;
    const hit = this.raycastCenter();
    if (hit) {
      this.pasteAt(hit.point.x, hit.point.y, hit.point.z);
    } else {
      let minX = Infinity;
      let maxX = -Infinity;
      for (const b of c.blocks) {
        minX = Math.min(minX, b.x - b.w / 2);
        maxX = Math.max(maxX, b.x + b.w / 2);
      }
      this.pasteAt(c.refX + Math.max(2, maxX - minX), c.baseY, c.refZ);
    }
  }

  /** Drop the clipboard so its base-centre lands at (x, y, z); selects the copies. */
  pasteAt(x: number, y: number, z: number) {
    const c = this.clipboard;
    if (!c) return;
    const added: MapBlock[] = [];
    const next = new Set<string>();
    let last: string | undefined;
    for (const b of c.blocks) {
      const nb = cloneBlock(b);
      nb.id = nextBlockId();
      nb.x = x + (b.x - c.refX);
      nb.y = y + (b.y - c.baseY);
      nb.z = z + (b.z - c.refZ);
      delete nb.locked;
      this.world.addBlock(nb);
      added.push(cloneBlock(nb));
      next.add(nb.id);
      last = nb.id;
    }
    if (added.length === 0) return;
    this.pushUndo({ added, removed: [] });
    this.sel = next;
    this.primary = last;
    this.refreshSelectionBox();
    this.persist();
    this.onChange?.();
  }

  /** Begin moving the selection — it follows the crosshair (by its anchor) until you click. */
  startMove() {
    if (this.hasSelection) this.moving = true;
  }

  /** Apply a change to EVERY selected block, batched into a single undo step. */
  private editSelection(change: (b: MapBlock) => MapBlock) {
    const added: MapBlock[] = [];
    const removed: MapBlock[] = [];
    for (const id of this.sel) {
      const before = this.world.getBlock(id);
      if (!before || before.locked) continue;
      const after = change({ ...before });
      after.id = before.id;
      this.world.replaceBlock(after);
      added.push({ ...after });
      removed.push({ ...before });
    }
    if (added.length === 0) return;
    this.pushUndo({ added, removed });
    this.persist();
    this.onChange?.();
  }

  undo() {
    const action = this.undoStack.pop();
    if (!action) return;
    for (const b of action.added) this.world.removeBlock(b.id);
    for (const b of action.removed) this.world.addBlock(b);
    this.pruneSelection();
    this.persist();
    this.onChange?.();
  }

  clear() {
    const removed = this.world.getBlocks().filter((b) => !b.locked);
    if (removed.length === 0) return;
    for (const b of removed) this.world.removeBlock(b.id);
    this.pushUndo({ added: [], removed });
    this.sel.clear();
    this.primary = undefined;
    this.hideSelBoxes();
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
    this.lookMag = Math.abs(dx) + Math.abs(dy);
    this.yaw -= dx * LOOK_SENSITIVITY;
    this.pitch -= dy * LOOK_SENSITIVITY;
    const limit = Math.PI / 2 - 0.02;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));

    const forward = (this.input.down('KeyW') ? 1 : 0) - (this.input.down('KeyS') ? 1 : 0);
    const strafe = (this.input.down('KeyD') ? 1 : 0) - (this.input.down('KeyA') ? 1 : 0);
    // in select mode, ShiftLeft means "add to selection", so don't also sink the camera
    const sink = this.input.down('ShiftLeft') && !this.selecting ? 1 : 0;
    const lift = (this.input.down('Space') ? 1 : 0) - sink;
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
      const shift = this.input.down('ShiftLeft');
      if (click0) {
        // start a potential box from wherever the crosshair is pointing
        const hit = this.raycastCenter();
        this.boxing = !!hit;
        if (hit) {
          this.boxStart.copy(hit.point);
          this.boxEnd.copy(hit.point);
        }
        this.boxMoved = 0;
      } else if (this.boxing && m0) {
        // holding: track how far the view swept and preview the region
        this.boxMoved += this.lookMag;
        const hit = this.raycastCenter();
        if (hit) this.boxEnd.copy(hit.point);
        if (this.boxMoved >= BOX_DRAG_THRESHOLD) {
          this.hoverBox.visible = false;
          this.showBoxPreview();
        } else {
          this.hideBoxPreview();
        }
      } else if (this.boxing && !m0) {
        // release: a sweep box-selects the region, a tap selects one block
        if (this.boxMoved >= BOX_DRAG_THRESHOLD) this.commitBox(shift);
        else if (this.hoverBlockId) this.clickSelect(this.hoverBlockId, shift);
        this.boxing = false;
        this.hideBoxPreview();
      }
      if (click2) {
        this.boxing = false;
        this.hideBoxPreview();
        this.deselect();
      }
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
    if (this.hoverBlockId && !this.sel.has(this.hoverBlockId) && block) {
      this.placeOutline(this.hoverBox, block);
    } else {
      this.hoverBox.visible = false;
    }
  }

  /** Click a block in select mode: select only it, or (Shift) toggle it in the set. */
  clickSelect(id: string, additive: boolean) {
    const block = this.world.getBlock(id);
    if (!block || block.locked) return;
    if (additive) {
      if (this.sel.has(id)) {
        this.sel.delete(id);
        if (this.primary === id) this.primary = this.lastOf(this.sel);
      } else {
        this.sel.add(id);
        this.primary = id;
      }
    } else {
      this.sel.clear();
      this.sel.add(id);
      this.primary = id;
    }
    this.refreshSelectionBox();
    this.onChange?.();
  }

  private pruneSelection() {
    for (const id of [...this.sel]) if (!this.world.getBlock(id)) this.sel.delete(id);
    if (this.primary && !this.world.getBlock(this.primary)) this.primary = this.lastOf(this.sel);
  }

  private lastOf(s: Set<string>): string | undefined {
    let r: string | undefined;
    for (const x of s) r = x;
    return r;
  }

  private refreshSelectionBox() {
    this.pruneSelection();
    let i = 0;
    for (const id of this.sel) {
      const block = this.world.getBlock(id);
      if (block) this.placeOutline(this.getSelBox(i++), block);
    }
    for (; i < this.selBoxes.length; i++) this.selBoxes[i]!.visible = false;
  }

  private getSelBox(i: number): THREE.LineSegments {
    let box = this.selBoxes[i];
    if (!box) {
      box = this.makeOutline(0x46e0ff, 1);
      this.selBoxes[i] = box;
      this.world.scene.add(box);
    }
    return box;
  }

  private hideSelBoxes() {
    for (const b of this.selBoxes) b.visible = false;
  }

  // --- box-select (drag a region in select mode) ---------------------------

  /** Select every block whose centre falls in an X/Z footprint (test core too). */
  selectRegion(x1: number, z1: number, x2: number, z2: number, additive: boolean) {
    this.boxStart.set(x1, 0, z1);
    this.boxEnd.set(x2, 0, z2);
    this.commitBox(additive);
  }

  private boxBounds() {
    return {
      minX: Math.min(this.boxStart.x, this.boxEnd.x),
      maxX: Math.max(this.boxStart.x, this.boxEnd.x),
      minZ: Math.min(this.boxStart.z, this.boxEnd.z),
      maxZ: Math.max(this.boxStart.z, this.boxEnd.z),
    };
  }

  private boxCandidates(): string[] {
    const { minX, maxX, minZ, maxZ } = this.boxBounds();
    const out: string[] = [];
    for (const b of this.world.getBlocks()) {
      if (b.locked) continue;
      if (b.x >= minX && b.x <= maxX && b.z >= minZ && b.z <= maxZ) out.push(b.id);
    }
    return out;
  }

  private showBoxPreview() {
    const { minX, maxX, minZ, maxZ } = this.boxBounds();
    this.regionBox.position.set((minX + maxX) / 2, this.boxStart.y + 0.05, (minZ + maxZ) / 2);
    this.regionBox.scale.set(Math.max(0.1, maxX - minX), 0.1, Math.max(0.1, maxZ - minZ));
    this.regionBox.visible = true;
    let i = 0;
    for (const id of this.boxCandidates()) {
      const b = this.world.getBlock(id);
      if (b) this.placeOutline(this.getPreviewBox(i++), b);
    }
    for (; i < this.previewBoxes.length; i++) this.previewBoxes[i]!.visible = false;
  }

  private hideBoxPreview() {
    this.regionBox.visible = false;
    for (const b of this.previewBoxes) b.visible = false;
  }

  private getPreviewBox(i: number): THREE.LineSegments {
    let box = this.previewBoxes[i];
    if (!box) {
      box = this.makeOutline(0xffd24a, 0.9);
      this.previewBoxes[i] = box;
      this.world.scene.add(box);
    }
    return box;
  }

  private commitBox(additive: boolean) {
    const ids = this.boxCandidates();
    if (!additive) {
      this.sel.clear();
      this.primary = undefined;
    }
    for (const id of ids) {
      this.sel.add(id);
      this.primary = id;
    }
    this.refreshSelectionBox();
    this.onChange?.();
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
    const anchor = this.selectedBlock;
    if (!anchor || !(this.ghost.visible || this.rampGhost.visible)) return;
    // the anchor lands at the ghost; the rest of the selection shifts by the same delta
    const dx = this.ghostCenter.x - anchor.x;
    const dy = this.ghostCenter.y - anchor.y;
    const dz = this.ghostCenter.z - anchor.z;
    this.editSelection((b) => ({ ...b, x: b.x + dx, y: b.y + dy, z: b.z + dz }));
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
    saveCurrent(this.world.toMap());
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

/** A deep-ish copy of a block (clones the rotation array so copies stay independent). */
function cloneBlock(b: MapBlock): MapBlock {
  const c: MapBlock = { ...b };
  if (b.rotation) c.rotation = [b.rotation[0]!, b.rotation[1]!, b.rotation[2]!];
  return c;
}
