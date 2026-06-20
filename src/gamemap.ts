/**
 * A map is DATA — a list of blocks plus a spawn point. This is the payoff of
 * building everything box-first since day one: the editor produces one of these,
 * the world is built from one of these, and (later) a custom map is just one of
 * these shared between players, exactly like a custom game type is a saved
 * GameConfig.
 */

export interface MapBlock {
  id: string;
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
  color: number;
  /** euler rotation in radians (default map can hold angled pieces) */
  rotation?: [number, number, number];
  /** 'ramp' = a solid walkable wedge; default (undefined) = a box */
  type?: 'ramp';
  /** locked blocks (e.g. the ground) can't be deleted in the editor */
  locked?: boolean;
}

export interface GameMap {
  blocks: MapBlock[];
  spawn: { x: number; y: number; z: number };
}

/** Editor places GRID-sized cubes snapped to a GRID lattice. */
export const GRID = 2;

let idCounter = 0;
export function nextBlockId(): string {
  idCounter += 1;
  return `b${idCounter.toString(36)}`;
}

/** Snap a world coordinate to the nearest grid cell centre. */
export function snap(coord: number): number {
  return Math.round(coord / GRID) * GRID;
}

/** Key for an occupied grid cell. */
export function cellKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

/** A modest starter arena — flat ground, a little cover, two platforms. */
export function defaultMap(): GameMap {
  const blocks: MapBlock[] = [];
  const add = (
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    extra?: Partial<MapBlock>,
  ) => blocks.push({ id: nextBlockId(), x, y, z, w, h, d, color, ...extra });

  // ground (locked so you can't delete the floor by accident)
  add(0, -0.5, 0, 80, 1, 80, 0x49845c, { locked: true });

  // a few cover blocks near spawn
  add(-6, 1, -4, 2, 2, 2, 0xc9803a);
  add(-4, 1, -5, 2, 2, 2, 0xb3552e);
  add(6, 1.5, -8, 6, 3, 1, 0x77879a); // low wall
  add(-14, 1.5, 4, 3, 3, 3, 0xa05c6b);

  // two raised platforms to fight over
  add(12, 1, -16, 6, 1, 6, 0x5c6bc0);
  add(-12, 2, -16, 6, 1, 6, 0x5c6bc0);

  // a tall landmark so you can always orient
  add(-34, 8, -34, 3, 16, 3, 0x4a5866);

  return { blocks, spawn: { x: 0, y: 2, z: 14 } };
}

const STORAGE_KEY = 'fps-earth-map-v1';

export function saveMap(map: GameMap): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ blocks: map.blocks, spawn: map.spawn }),
    );
  } catch {
    // storage full or unavailable — non-fatal, the map just won't persist
  }
}

/** Load a saved map, validated. Returns null if none / malformed. */
export function loadSavedMap(): GameMap | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as unknown;
    return parseMap(data);
  } catch {
    return null;
  }
}

export function clearSavedMap(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Defensive parse: rebuild a clean GameMap from untrusted data, fresh ids. */
export function parseMap(data: unknown): GameMap | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.blocks)) return null;

  const blocks: MapBlock[] = [];
  for (const raw of d.blocks) {
    if (typeof raw !== 'object' || raw === null) continue;
    const b = raw as Record<string, unknown>;
    if (![b.x, b.y, b.z, b.w, b.h, b.d, b.color].every(num)) continue;
    const block: MapBlock = {
      id: nextBlockId(),
      x: b.x as number,
      y: b.y as number,
      z: b.z as number,
      w: b.w as number,
      h: b.h as number,
      d: b.d as number,
      color: b.color as number,
    };
    if (Array.isArray(b.rotation) && b.rotation.length === 3 && b.rotation.every(num)) {
      block.rotation = [b.rotation[0], b.rotation[1], b.rotation[2]] as [number, number, number];
    }
    if (b.type === 'ramp') block.type = 'ramp';
    if (b.locked === true) block.locked = true;
    blocks.push(block);
  }

  const s = d.spawn as Record<string, unknown> | undefined;
  const spawn =
    s && num(s.x) && num(s.y) && num(s.z)
      ? { x: s.x as number, y: s.y as number, z: s.z as number }
      : { x: 0, y: 2, z: 14 };

  return { blocks, spawn };
}
