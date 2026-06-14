import { Room, Client } from '@colyseus/core';

/**
 * Phase 1 — a shared world with combat.
 *
 * Clients stream their own position ("move"); when a client's shot connects it
 * reports the hit ("hit"). The server owns health, death, respawn and the
 * kill/death tally, and broadcasts everyone's state at 20 Hz.
 *
 * This is still CLIENT-AUTHORITATIVE for position AND hit detection — clients
 * are trusted about where they are and who they hit. Fine for playing with
 * friends; the planned server-authoritative rewrite (server runs physics and
 * validates shots) replaces this trust later in Phase 1. Damage is sent by the
 * client so live weapon tuning (GameConfig) still works in PvP.
 */

interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
}

const MAX_HEALTH = 100;
const RESPAWN_SECONDS = 3;
const MAX_HIT_DAMAGE = 1000; // sanity clamp only; real validation is the server-authoritative phase
const BROADCAST_HZ = 20;

// a handful of spread-out spawn points so players don't stack on one spot
const SPAWNS = [
  { x: 0, y: 2, z: 14, yaw: 0, pitch: 0 },
  { x: 17, y: 2, z: 3, yaw: -1.6, pitch: 0 },
  { x: -17, y: 2, z: 7, yaw: 1.6, pitch: 0 },
  { x: 9, y: 2, z: -22, yaw: 3.1, pitch: 0 },
  { x: -11, y: 2, z: -16, yaw: 2.4, pitch: 0 },
];

export class LobbyRoom extends Room {
  maxClients = 16;
  private players = new Map<string, PlayerState>();

  onCreate() {
    this.onMessage('move', (client: Client, data: unknown) => {
      const player = this.players.get(client.sessionId);
      if (!player || !player.alive) return; // dead players don't move
      const p = sanitizeMove(data);
      if (!p) return;
      player.x = p.x;
      player.y = p.y;
      player.z = p.z;
      player.yaw = p.yaw;
      player.pitch = p.pitch;
    });

    this.onMessage('hit', (client: Client, data: unknown) => {
      this.handleHit(client.sessionId, data);
    });

    this.setSimulationInterval(() => this.broadcastPlayers(), 1000 / BROADCAST_HZ);
    console.log(`[lobby ${this.roomId}] created`);
  }

  onJoin(client: Client) {
    this.players.set(client.sessionId, this.freshPlayer());
    console.log(`[lobby ${this.roomId}] ${client.sessionId} joined (${this.players.size} online)`);
  }

  onLeave(client: Client) {
    this.players.delete(client.sessionId);
    console.log(`[lobby ${this.roomId}] ${client.sessionId} left (${this.players.size} online)`);
  }

  private handleHit(shooterId: string, data: unknown) {
    const shooter = this.players.get(shooterId);
    if (!shooter || !shooter.alive) return; // the dead can't shoot

    const parsed = sanitizeHit(data);
    if (!parsed || parsed.target === shooterId) return; // no self-damage

    const victim = this.players.get(parsed.target);
    if (!victim || !victim.alive) return;

    const damage = Math.min(MAX_HIT_DAMAGE, Math.max(0, parsed.damage));
    victim.hp -= damage;

    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.alive = false;
      victim.deaths++;
      shooter.kills++;
      this.broadcast('kill', { killer: shooterId, victim: parsed.target });
      console.log(`[lobby ${this.roomId}] ${shooterId} eliminated ${parsed.target}`);
      this.clock.setTimeout(() => this.respawn(parsed.target), RESPAWN_SECONDS * 1000);
    }
  }

  private respawn(id: string) {
    const player = this.players.get(id);
    if (!player) return; // they left while waiting to respawn
    const spawn = SPAWNS[Math.floor(Math.random() * SPAWNS.length)]!;
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    player.yaw = spawn.yaw;
    player.pitch = spawn.pitch;
    player.hp = MAX_HEALTH;
    player.alive = true;
    this.broadcast('respawn', { id, x: spawn.x, y: spawn.y, z: spawn.z });
  }

  private freshPlayer(): PlayerState {
    const spawn = SPAWNS[Math.floor(Math.random() * SPAWNS.length)]!;
    return { ...spawn, hp: MAX_HEALTH, alive: true, kills: 0, deaths: 0 };
  }

  private broadcastPlayers() {
    const list = Array.from(this.players.entries()).map(([id, p]) => ({ id, ...p }));
    this.broadcast('players', list);
  }
}

interface MoveData {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

/** Accept only well-formed finite numbers — never trust the network. */
function sanitizeMove(data: unknown): MoveData | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of ['x', 'y', 'z', 'yaw', 'pitch'] as const) {
    const v = d[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    out[key] = v;
  }
  return out as unknown as MoveData;
}

function sanitizeHit(data: unknown): { target: string; damage: number } | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.target !== 'string' || d.target.length === 0) return null;
  if (typeof d.damage !== 'number' || !Number.isFinite(d.damage)) return null;
  return { target: d.target, damage: d.damage };
}
