import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The map directory's storage: a flat JSON file of shared maps, keyed by a short
 * code. This is what turns the globe from a personal map into a shared one —
 * maps people publish here get a 6-character code AND (if they're pinned to a
 * place) show up as pins other people can see and drop into.
 *
 * It's deliberately tiny: one file, no database, low traffic. A map "belongs" to
 * the device that first published it (a random `owner` id the browser keeps), so
 * re-publishing the same map updates it in place instead of making duplicates,
 * and only that device can delete it. Not fortress-grade, but right for a hobby
 * community directory — like a pastebin for maps.
 */

const here = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(here, '..', 'data');
const FILE = join(DATA_DIR, 'maps.json');

export interface MapEntry {
  code: string;
  name: string;
  location?: { lat: number; lng: number };
  map: unknown;
  owner: string;
  mapKey: string;
  createdAt: number;
  updatedAt: number;
}

// no 0/O/1/I — codes are read aloud and typed by hand, so avoid look-alikes
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

let entries = new Map<string, MapEntry>();

function load() {
  try {
    if (existsSync(FILE)) {
      const arr = JSON.parse(readFileSync(FILE, 'utf8')) as MapEntry[];
      entries = new Map(arr.map((e) => [e.code, e]));
    }
  } catch {
    entries = new Map();
  }
}

function persist() {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify([...entries.values()]));
  } catch (e) {
    console.error('[mapdir] could not save', e);
  }
}

load();

function makeCode(): string {
  for (let tries = 0; tries < 50; tries++) {
    let s = '';
    for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!entries.has(s)) return s;
  }
  // pathological fallback (directory is enormous) — still unique
  return `${ALPHABET[0]}${entries.size.toString(36).toUpperCase()}`;
}

export interface UpsertInput {
  name: string;
  map: unknown;
  location?: { lat: number; lng: number };
  owner: string;
  mapKey: string;
}

/** Publish a map, or update it in place if this owner already shared this map. */
export function upsert(input: UpsertInput): MapEntry {
  const now = Date.now();
  let found: MapEntry | undefined;
  for (const e of entries.values()) {
    if (e.owner === input.owner && e.mapKey === input.mapKey) {
      found = e;
      break;
    }
  }
  if (found) {
    found.name = input.name;
    found.map = input.map;
    found.location = input.location;
    found.updatedAt = now;
  } else {
    found = {
      code: makeCode(),
      name: input.name,
      map: input.map,
      location: input.location,
      owner: input.owner,
      mapKey: input.mapKey,
      createdAt: now,
      updatedAt: now,
    };
    entries.set(found.code, found);
  }
  persist();
  return found;
}

export function get(code: string): MapEntry | undefined {
  return entries.get(code.toUpperCase());
}

/** Most-recently-updated shared maps (capped — this is a hobby directory). */
export function list(): MapEntry[] {
  return [...entries.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 500);
}

export function remove(code: string, owner: string): 'ok' | 'forbidden' | 'missing' {
  const e = entries.get(code.toUpperCase());
  if (!e) return 'missing';
  if (e.owner !== owner) return 'forbidden';
  entries.delete(e.code);
  persist();
  return 'ok';
}
