import type { Input } from './input';
import type { Player } from './player';
import type { GameConfig } from './config';
import type { TargetManager } from './targets';
import type { Weapon } from './weapon';
import type { Net, NetPlayerState } from './net';
import type { RemotePlayers } from './remote';
import type { World } from './world';
import type { Editor } from './editor';
import type { Globe } from './globe';
import { nextBlockId, type MapBlock } from './gamemap';
import * as mapstore from './mapstore';
import * as mapdir from './mapdir';

type Mode = 'play' | 'edit';

/**
 * Dev/testing tools — only installed when running `npm run dev`, never in a
 * production build. Two audiences:
 *
 * Humans (keyboard):
 *   `  (backtick)  toggle the debug readout (position, angles, grounded, rules)
 *   K              respawn at the spawn point if you get stuck
 *
 * Automation (browser console / Claude):
 *   dev.state()                     position, view angles, grounded, fall speed
 *   dev.config()                    current game rules (GameConfig)
 *   dev.tune({ gravity: -4 })       change game rules LIVE (nested keys merge:
 *                                   dev.tune({ weapon: { damage: 100 } }) keeps
 *                                   the other weapon fields)
 *   dev.look(yawDeg, pitchDeg?)     aim the view
 *   dev.aimAt(x, y, z)              aim the view at a world position
 *   dev.hold('KeyW', 'ShiftLeft')   press keys down until released
 *   dev.release()                   release all (or listed) virtual keys
 *   dev.step(seconds)               advance the simulation instantly (works even
 *                                   in throttled background tabs) + render once
 *   dev.walk(seconds, ...keys)      hold keys for N seconds (async, real time)
 *   dev.fire(seconds?)              hold the trigger for N seconds (default 0.15)
 *   dev.jump()
 *   dev.teleport(x, y, z)
 *   dev.respawn()
 *   dev.targets()                   positions/health of all practice targets
 *   dev.kills()                     current kill count
 */

export interface DevState {
  pos: { x: number; y: number; z: number };
  yawDeg: number;
  pitchDeg: number;
  grounded: boolean;
  verticalVelocity: number;
}

export interface DevTools {
  state(): DevState;
  config(): GameConfig;
  tune(patch: Partial<GameConfig>): GameConfig;
  look(yawDeg: number, pitchDeg?: number): DevState;
  aimAt(x: number, y: number, z: number): DevState;
  hold(...codes: string[]): DevState;
  release(...codes: string[]): DevState;
  step(seconds: number): DevState;
  walk(seconds: number, ...codes: string[]): Promise<DevState>;
  fire(seconds?: number): DevState;
  jump(): DevState;
  teleport(x: number, y: number, z: number): DevState;
  respawn(): DevState;
  targets(): ReturnType<TargetManager['snapshot']>;
  kills(): number;
  weaponInfo(): { shotsFired: number; lastShot: Weapon['lastShot'] };
  net(): {
    connected: boolean;
    role: Net['role'];
    shareCode: string;
    status: string;
    sessionId: string;
    playerCount: number;
    renderedRemotes: number;
    players: Net['players'];
  };
  self(): NetPlayerState | undefined;
  hitPlayer(targetId: string, damage?: number): void;
  broadcastRules(patch: Partial<GameConfig>): GameConfig;
  // team deathmatch (drive the authority to test PvP/teams solo)
  addBot(id: string): void;
  hitBetween(shooterId: string, targetId: string, damage: number): void;
  teamState(): { kills: [number, number]; enabled: boolean };
  teamOf(id: string): 0 | 1 | undefined;
  flags(): Net['flags'];
  movePlayer(id: string, x: number, y: number, z: number): void;
  tickCtf(): void;
  // map editor
  mode(): Mode;
  setMode(m: Mode): void;
  blockCount(): number;
  mapSpawn(): { x: number; y: number; z: number };
  placeBlock(x: number, y: number, z: number, color?: number): number;
  editorView(yawDeg: number, pitchDeg: number, pos?: [number, number, number]): void;
  editorStep(seconds: number): void;
  reloadMap(): number;
  syncMap(): void;
  setShape(i: number): void;
  rotate(): number;
  undo(): number;
  clearMap(): number;
  setSelecting(on: boolean): void;
  selectedId(): string | undefined;
  selectionCount(): number;
  selectionIds(): string[];
  selectMany(ids: string[]): void;
  pick(id: string, additive: boolean): void;
  boxSelect(x1: number, z1: number, x2: number, z2: number, additive: boolean): void;
  copySel(): void;
  pasteAt(x: number, y: number, z: number): void;
  clipboardCount(): number;
  recolorSel(i: number): void;
  blocks(): MapBlock[];
  duplicateSel(): void;
  deleteSel(): void;
  // map library
  mapList(): { id: string; name: string }[];
  newMap(name: string): string;
  loadMapId(id: string): number;
  currentMapId(): string;
  exportCurrentCode(): string;
  importMap(code: string): number;
  setMapLocation(id: string, lat: number, lng: number): void;
  // online map directory + globe
  dirReachable(): Promise<boolean>;
  dirPublishCurrent(): Promise<string>;
  dirList(): Promise<mapdir.DirEntry[]>;
  dirFetch(code: string): Promise<mapdir.FetchedMap | null>;
  globePins(): { mine: number; shared: number; names: string[] };
}

declare global {
  interface Window {
    dev?: DevTools;
  }
}

export function installDevTools(
  player: Player,
  input: Input,
  config: GameConfig,
  targetManager: TargetManager,
  weapon: Weapon,
  netClient: Net,
  remotes: RemotePlayers,
  world: World,
  editor: Editor,
  globe: Globe,
  modeCtl: { get(): Mode; set(m: Mode): void },
  sim: { step(dt: number): void; render(): void; draw(): void },
): DevTools {
  const held = new Set<string>();

  const state = (): DevState => ({
    pos: player.position,
    yawDeg: Math.round((player.yaw * 180) / Math.PI),
    pitchDeg: Math.round((player.pitch * 180) / Math.PI),
    grounded: player.isGrounded,
    verticalVelocity: Math.round(player.verticalVelocity * 100) / 100,
  });

  const hold = (...codes: string[]): DevState => {
    for (const c of codes) {
      held.add(c);
      input.setVirtualKey(c, true);
    }
    return state();
  };

  const release = (...codes: string[]): DevState => {
    const list = codes.length > 0 ? codes : [...held];
    for (const c of list) {
      held.delete(c);
      input.setVirtualKey(c, false);
    }
    return state();
  };

  const tools: DevTools = {
    state,
    hold,
    release,

    config(): GameConfig {
      return JSON.parse(JSON.stringify(config)) as GameConfig;
    },

    /** Mutates the live game rules — the prototype of Halo-style custom game types. */
    tune(patch: Partial<GameConfig>): GameConfig {
      const cfg = config as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(patch)) {
        const current = cfg[key];
        if (
          value !== null &&
          typeof value === 'object' &&
          current !== null &&
          typeof current === 'object'
        ) {
          Object.assign(current, value);
        } else {
          cfg[key] = value;
        }
      }
      return tools.config();
    },

    look(yawDeg: number, pitchDeg = 0): DevState {
      player.yaw = (yawDeg * Math.PI) / 180;
      const limit = 89;
      player.pitch = (Math.max(-limit, Math.min(limit, pitchDeg)) * Math.PI) / 180;
      return state();
    },

    /** Point the camera at a world position (from the current eye position). */
    aimAt(x: number, y: number, z: number): DevState {
      const eye = player.position;
      const dx = x - eye.x;
      const dy = y - (eye.y + 0.75);
      const dz = z - eye.z;
      const horizontal = Math.hypot(dx, dz);
      player.yaw = Math.atan2(-dx, -dz);
      player.pitch = Math.atan2(dy, horizontal);
      return state();
    },

    /** Advance the simulation deterministically, then render one frame. */
    step(seconds: number): DevState {
      const ticks = Math.min(1200, Math.max(1, Math.round(seconds * 60)));
      for (let i = 0; i < ticks; i++) sim.step(1 / 60);
      sim.render();
      return state();
    },

    walk(seconds: number, ...codes: string[]): Promise<DevState> {
      const keys = codes.length > 0 ? codes : ['KeyW'];
      hold(...keys);
      return new Promise((resolve) =>
        setTimeout(() => {
          release(...keys);
          resolve(state());
        }, seconds * 1000),
      );
    },

    /** Hold the trigger (virtual left mouse) for a duration. */
    fire(seconds = 0.15): DevState {
      hold('Mouse0');
      setTimeout(() => release('Mouse0'), seconds * 1000);
      return state();
    },

    jump(): DevState {
      hold('Space');
      setTimeout(() => release('Space'), 150);
      return state();
    },

    teleport(x: number, y: number, z: number): DevState {
      player.teleport(x, y, z);
      return state();
    },

    respawn(): DevState {
      player.respawn();
      return state();
    },

    targets() {
      return targetManager.snapshot();
    },

    kills(): number {
      return targetManager.kills;
    },

    weaponInfo() {
      return { shotsFired: weapon.shotsFired, lastShot: weapon.lastShot };
    },

    net() {
      return {
        connected: netClient.connected,
        role: netClient.role,
        shareCode: netClient.shareCode,
        status: netClient.status,
        sessionId: netClient.sessionId,
        playerCount: netClient.players.length,
        renderedRemotes: remotes.count,
        players: netClient.players,
      };
    },

    self() {
      return netClient.self();
    },

    /** Report a hit on another player straight to the server (test helper). */
    hitPlayer(targetId: string, damage?: number) {
      netClient.reportHit(targetId, damage ?? config.weapon.damage);
    },

    /** Change the rules locally and (if host) push them to all peers. */
    broadcastRules(patch: Partial<GameConfig>) {
      const updated = tools.tune(patch);
      netClient.broadcastConfig();
      return updated;
    },

    addBot(id: string) {
      netClient.debugAddPlayer(id);
    },
    hitBetween(shooterId: string, targetId: string, damage: number) {
      netClient.debugHit(shooterId, targetId, damage);
    },
    teamState() {
      return netClient.debugTeams();
    },
    teamOf(id: string) {
      return netClient.players.find((p) => p.id === id)?.team;
    },
    flags() {
      return netClient.debugFlags();
    },
    movePlayer(id: string, x: number, y: number, z: number) {
      netClient.debugMove(id, x, y, z);
    },
    tickCtf() {
      netClient.debugTickCtf();
    },

    // --- map editor -------------------------------------------------------

    mode() {
      return modeCtl.get();
    },
    setMode(m: Mode) {
      modeCtl.set(m);
    },
    blockCount() {
      return world.getBlocks().length;
    },
    mapSpawn() {
      return { ...world.spawn };
    },
    /** Place a block (current size + shape type) directly at a point and save. */
    placeBlock(x: number, y: number, z: number, color?: number) {
      const block = {
        id: nextBlockId(),
        x,
        y,
        z,
        w: editor.size.w,
        h: editor.size.h,
        d: editor.size.d,
        color: color ?? editor.currentColor,
        ...(editor.currentType ? { type: editor.currentType } : {}),
      };
      world.addBlock(block);
      mapstore.saveCurrent(world.toMap());
      return world.getBlocks().length;
    },
    editorView(yawDeg: number, pitchDeg: number, pos?: [number, number, number]) {
      editor.setView(yawDeg, pitchDeg, pos);
    },
    /** Advance the editor (free-fly + raycast placement) deterministically. */
    editorStep(seconds: number) {
      const ticks = Math.min(600, Math.max(1, Math.round(seconds * 60)));
      for (let i = 0; i < ticks; i++) editor.update(1 / 60);
      sim.draw();
    },
    /** Reload the current map from browser storage (test persistence). */
    reloadMap() {
      world.loadMap(mapstore.currentMap());
      return world.getBlocks().length;
    },
    /** Host: push the current map to all peers. */
    syncMap() {
      netClient.broadcastMap();
    },
    setShape(i: number) {
      editor.setShapeIndex(i);
    },
    rotate() {
      editor.applyRotate();
      return editor.rotationDeg;
    },
    setSelecting(on: boolean) {
      editor.setSelecting(on);
    },
    selectedId() {
      return editor.selectedId;
    },
    selectionCount() {
      return editor.selectionCount;
    },
    selectionIds() {
      return editor.selectionIds();
    },
    /** Select many blocks by id (test helper for multi-select). */
    selectMany(ids: string[]) {
      editor.deselect();
      for (const id of ids) editor.clickSelect(id, true);
    },
    /** Mirror a real click: additive=false replaces, true Shift-toggles. */
    pick(id: string, additive: boolean) {
      editor.clickSelect(id, additive);
    },
    /** Box-select an X/Z footprint (what a drag does). */
    boxSelect(x1: number, z1: number, x2: number, z2: number, additive: boolean) {
      editor.selectRegion(x1, z1, x2, z2, additive);
    },
    copySel() {
      editor.copySelection();
    },
    pasteAt(x: number, y: number, z: number) {
      editor.pasteAt(x, y, z);
    },
    clipboardCount() {
      return editor.clipboardCount;
    },
    /** Recolour the whole selection (exercises the batched-edit path). */
    recolorSel(i: number) {
      editor.applyColor(i);
    },
    blocks() {
      return world.getBlocks();
    },
    duplicateSel() {
      editor.duplicateSelection();
    },
    deleteSel() {
      editor.deleteSelection();
    },
    undo() {
      editor.undo();
      return world.getBlocks().length;
    },
    clearMap() {
      editor.clear();
      return world.getBlocks().length;
    },

    // --- map library ------------------------------------------------------

    mapList() {
      return mapstore.listMaps();
    },
    newMap(name: string) {
      return mapstore.createMap(name);
    },
    loadMapId(id: string) {
      const m = mapstore.getMap(id);
      if (m) {
        mapstore.setCurrent(id);
        world.loadMap(m);
      }
      return world.getBlocks().length;
    },
    currentMapId() {
      return mapstore.currentId();
    },
    exportCurrentCode() {
      return mapstore.exportCode(world.toMap());
    },
    importMap(code: string) {
      const m = mapstore.importCode(code);
      if (!m) return -1;
      mapstore.createMap('Imported', m);
      return mapstore.listMaps().length;
    },
    setMapLocation(id: string, lat: number, lng: number) {
      mapstore.setLocation(id, { lat, lng });
    },

    // --- online map directory + globe ------------------------------------

    dirReachable() {
      return mapdir.reachable();
    },
    /** Publish the current map (with its pin location, if any) → short code. */
    dirPublishCurrent() {
      const id = mapstore.currentId();
      const info = mapstore.listMaps().find((m) => m.id === id);
      return mapdir.publish({
        name: info?.name ?? 'Map',
        map: world.toMap(),
        mapKey: id,
        location: info?.location,
      });
    },
    dirList() {
      return mapdir.listPublic();
    },
    dirFetch(code: string) {
      return mapdir.fetchMap(code);
    },
    globePins() {
      return globe.debugPins();
    },
  };

  // --- human-facing dev keys + debug readout -------------------------------

  const readout = document.createElement('div');
  readout.style.cssText =
    'position:fixed;top:10px;right:12px;z-index:20;display:none;' +
    'color:#9fe8a0;background:rgba(0,0,0,0.55);padding:8px 10px;border-radius:6px;' +
    'font:12px ui-monospace,monospace;white-space:pre;text-align:right;pointer-events:none';
  document.body.appendChild(readout);
  let readoutOn = false;

  setInterval(() => {
    if (!readoutOn) return;
    const s = state();
    readout.textContent =
      `pos  ${s.pos.x.toFixed(1)}  ${s.pos.y.toFixed(1)}  ${s.pos.z.toFixed(1)}\n` +
      `yaw ${s.yawDeg}°  pitch ${s.pitchDeg}°\n` +
      `${s.grounded ? 'grounded' : 'airborne'}  vy ${s.verticalVelocity.toFixed(1)}\n` +
      `grav ${config.gravity}  walk ${config.walkSpeed}  sprint ${config.sprintSpeed}  jump ${config.jumpVelocity}\n` +
      `dmg ${config.weapon.damage}  rof ${config.weapon.fireRate}/s  kills ${targetManager.kills}`;
  }, 100);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') {
      readoutOn = !readoutOn;
      readout.style.display = readoutOn ? 'block' : 'none';
    }
    if (e.code === 'KeyK') player.respawn();
  });

  return tools;
}
