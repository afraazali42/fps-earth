import { Room, Client } from '@colyseus/core';

/**
 * Phase 1 v0: the simplest possible shared world.
 *
 * Clients send their own position ("move"); the room broadcasts everyone's
 * positions to everyone at 20 Hz. This is CLIENT-AUTHORITATIVE — clients are
 * trusted about where they are. Fine for playing with friends; the planned
 * server-authoritative rewrite (server runs physics, validates movement)
 * replaces this later in Phase 1.
 */

interface PlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

const SPAWN: PlayerState = { x: 0, y: 2, z: 14, yaw: 0, pitch: 0 };
const BROADCAST_HZ = 20;

export class LobbyRoom extends Room {
  maxClients = 16;
  private players = new Map<string, PlayerState>();

  onCreate() {
    this.onMessage('move', (client: Client, data: unknown) => {
      const p = sanitize(data);
      if (p) this.players.set(client.sessionId, p);
    });

    this.setSimulationInterval(() => this.broadcastPlayers(), 1000 / BROADCAST_HZ);
    console.log(`[lobby ${this.roomId}] created`);
  }

  onJoin(client: Client) {
    this.players.set(client.sessionId, { ...SPAWN });
    console.log(`[lobby ${this.roomId}] ${client.sessionId} joined (${this.players.size} online)`);
  }

  onLeave(client: Client) {
    this.players.delete(client.sessionId);
    console.log(`[lobby ${this.roomId}] ${client.sessionId} left (${this.players.size} online)`);
  }

  private broadcastPlayers() {
    const list = Array.from(this.players.entries()).map(([id, p]) => ({ id, ...p }));
    this.broadcast('players', list);
  }
}

/** Accept only well-formed finite numbers — never trust the network. */
function sanitize(data: unknown): PlayerState | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  const nums: number[] = [];
  for (const key of ['x', 'y', 'z', 'yaw', 'pitch'] as const) {
    const v = d[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    nums.push(v);
  }
  const [x, y, z, yaw, pitch] = nums as [number, number, number, number, number];
  return { x, y, z, yaw, pitch };
}
