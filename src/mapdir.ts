import { type GameMap, parseMap } from './gamemap';
import type { LatLng } from './mapstore';

/**
 * Client for the online map directory (the `/api` routes on the matchmaker).
 * This is what makes the globe shared: publishing a map gives it a short code
 * and, if it's pinned to a place, puts it on everyone's globe. Fetching pulls
 * other people's maps so you can drop into them.
 *
 * If the directory is unreachable (e.g. you only ran the game, not the server),
 * every call fails softly — sharing falls back to the old self-contained code
 * and the globe just shows your own local pins.
 */

export interface DirEntry {
  code: string;
  name: string;
  location?: LatLng;
  owner: string;
  updatedAt: number;
}

let base = '/api';

/** Point the client at the same host:port as the signaling server. */
export function configure(signal: { host: string; port: number; secure: boolean }) {
  const proto = signal.secure ? 'https' : 'http';
  base = `${proto}://${signal.host}:${signal.port}/api`;
}

const DEVICE_KEY = 'fps-earth-device';

/** A stable, random id for THIS browser — used to own/update your own shares. */
export function deviceId(): string {
  let id = '';
  try {
    id = localStorage.getItem(DEVICE_KEY) ?? '';
  } catch {
    id = '';
  }
  if (!id) {
    id = `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    try {
      localStorage.setItem(DEVICE_KEY, id);
    } catch {
      // private mode / no storage — id stays per-session, still works
    }
  }
  return id;
}

/** A 6-character directory code (vs. the long self-contained `FE1:` blob). */
export function looksLikeCode(s: string): boolean {
  return /^[A-Za-z2-9]{6}$/.test(s.trim());
}

async function req(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(base + path, init);
  if (!res.ok) throw new Error(`directory ${res.status}`);
  return res.json();
}

export async function reachable(): Promise<boolean> {
  try {
    await req('/health');
    return true;
  } catch {
    return false;
  }
}

export interface PublishInput {
  name: string;
  map: GameMap;
  mapKey: string;
  location?: LatLng;
}

/** Publish (or update) a map → its short code. Throws if the directory is down. */
export async function publish(input: PublishInput): Promise<string> {
  const body = {
    name: input.name,
    map: { blocks: input.map.blocks, spawn: input.map.spawn },
    location: input.location,
    owner: deviceId(),
    mapKey: input.mapKey,
  };
  const out = (await req('/maps', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })) as { code?: string };
  if (!out.code) throw new Error('no code');
  return out.code;
}

/** All shared maps (lightweight — name + pin location, no geometry). */
export async function listPublic(): Promise<DirEntry[]> {
  try {
    const out = (await req('/maps')) as { maps?: DirEntry[] };
    return Array.isArray(out.maps) ? out.maps : [];
  } catch {
    return [];
  }
}

export interface FetchedMap {
  code: string;
  name: string;
  location?: LatLng;
  owner: string;
  map: GameMap;
}

/** Fetch one full map by code. Returns null if missing or the code is bad. */
export async function fetchMap(code: string): Promise<FetchedMap | null> {
  try {
    const out = (await req(`/maps/${encodeURIComponent(code.trim())}`)) as {
      code: string;
      name: string;
      location?: LatLng;
      owner: string;
      map: unknown;
    };
    const map = parseMap(out.map);
    if (!map) return null;
    return { code: out.code, name: out.name, location: out.location, owner: out.owner, map };
  } catch {
    return null;
  }
}

export async function unpublish(code: string): Promise<boolean> {
  try {
    await req(`/maps/${encodeURIComponent(code)}?owner=${encodeURIComponent(deviceId())}`, {
      method: 'DELETE',
    });
    return true;
  } catch {
    return false;
  }
}
