import { type GameMap, defaultMap, blankMap, parseMap } from './gamemap';

/**
 * A library of named maps in the browser. You can build many places, switch
 * between them, and share one as a self-contained code (the map IS the code —
 * no server needed). One map is "current": the editor auto-saves to it and the
 * game loads it. This is also the foundation for the globe vision, where each
 * named map becomes a pin.
 */

export interface MapInfo {
  id: string;
  name: string;
}

interface StoredMap {
  id: string;
  name: string;
  map: GameMap;
}

const KEY = 'fps-earth-maps';
const CURRENT_KEY = 'fps-earth-current-map';
const OLD_KEY = 'fps-earth-map-v1'; // the single-map format we used before
const CODE_PREFIX = 'FE1:';

function newId(): string {
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function read(): StoredMap[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: StoredMap[] = [];
    for (const e of arr) {
      if (e && typeof e.id === 'string' && typeof e.name === 'string') {
        const map = parseMap(e.map);
        if (map) out.push({ id: e.id, name: e.name, map });
      }
    }
    return out;
  } catch {
    return [];
  }
}

function write(maps: StoredMap[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(maps));
  } catch {
    // storage full / unavailable — non-fatal
  }
}

function setCurrentId(id: string) {
  try {
    localStorage.setItem(CURRENT_KEY, id);
  } catch {
    // ignore
  }
}

/** Always returns at least one map; migrates the old single-map format once. */
function ensure(): StoredMap[] {
  let maps = read();
  if (maps.length === 0) {
    let firstMap: GameMap | null = null;
    let name = 'My first map';
    try {
      const old = localStorage.getItem(OLD_KEY);
      if (old) {
        firstMap = parseMap(JSON.parse(old));
        name = 'My map';
      }
    } catch {
      // ignore a bad old value
    }
    const seed: StoredMap = { id: newId(), name, map: firstMap ?? defaultMap() };
    maps = [seed];
    write(maps);
    setCurrentId(seed.id);
  }
  return maps;
}

export function listMaps(): MapInfo[] {
  return ensure().map((m) => ({ id: m.id, name: m.name }));
}

export function currentId(): string {
  const maps = ensure();
  let id = '';
  try {
    id = localStorage.getItem(CURRENT_KEY) ?? '';
  } catch {
    id = '';
  }
  if (!maps.some((m) => m.id === id)) {
    id = maps[0]!.id;
    setCurrentId(id);
  }
  return id;
}

export function setCurrent(id: string) {
  if (ensure().some((m) => m.id === id)) setCurrentId(id);
}

export function getMap(id: string): GameMap | null {
  const m = ensure().find((x) => x.id === id);
  return m ? m.map : null;
}

export function currentMap(): GameMap {
  return getMap(currentId()) ?? defaultMap();
}

/** Save a map into whichever map is current (the editor calls this on edit). */
export function saveCurrent(map: GameMap) {
  const maps = ensure();
  const id = currentId();
  const m = maps.find((x) => x.id === id);
  if (m) {
    m.map = map;
    write(maps);
  }
}

/** Create a new map (blank unless one is supplied), make it current, return id. */
export function createMap(name: string, map?: GameMap): string {
  const maps = ensure();
  const id = newId();
  maps.push({ id, name: name.trim() || 'Untitled', map: map ?? blankMap() });
  write(maps);
  setCurrentId(id);
  return id;
}

export function renameMap(id: string, name: string) {
  const maps = ensure();
  const m = maps.find((x) => x.id === id);
  if (m && name.trim()) {
    m.name = name.trim();
    write(maps);
  }
}

export function deleteMap(id: string) {
  let maps = ensure().filter((m) => m.id !== id);
  if (maps.length === 0) maps = [{ id: newId(), name: 'My first map', map: defaultMap() }];
  write(maps);
  if (!maps.some((m) => m.id === currentId())) setCurrentId(maps[0]!.id);
}

export function duplicateMap(id: string): string {
  const src = ensure().find((m) => m.id === id);
  const copy = src ? parseMap(JSON.parse(JSON.stringify(src.map))) : null;
  return createMap(src ? `${src.name} copy` : 'Copy', copy ?? blankMap());
}

/** A self-contained, copy-pasteable code for a map (base64 of its JSON). */
export function exportCode(map: GameMap): string {
  const json = JSON.stringify({ blocks: map.blocks, spawn: map.spawn });
  return CODE_PREFIX + btoa(unescape(encodeURIComponent(json)));
}

export function importCode(code: string): GameMap | null {
  try {
    const trimmed = code.trim();
    const body = trimmed.startsWith(CODE_PREFIX) ? trimmed.slice(CODE_PREFIX.length) : trimmed;
    const json = decodeURIComponent(escape(atob(body)));
    return parseMap(JSON.parse(json));
  } catch {
    return null;
  }
}
