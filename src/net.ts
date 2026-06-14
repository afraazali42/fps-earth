import { Client, Room } from '@colyseus/sdk';
import type { Player } from './player';

/** One player's state as the server reports it. */
export interface NetPlayerState {
  id: string;
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

const SEND_HZ = 20;
const RETRY_SECONDS = 5;

/**
 * Connection to the game server (Phase 1): streams our position up at 20 Hz,
 * reports our hits, and receives everyone's state back. The server owns health,
 * death, respawn and the kill tally. If the server is unreachable the game keeps
 * working in single-player mode and retries quietly.
 */
export class Net {
  connected = false;
  sessionId = '';
  /** latest player list from the server (includes ourselves) */
  players: NetPlayerState[] = [];

  /** event hooks wired up by main.ts */
  onKill: ((killerId: string, victimId: string) => void) | null = null;
  onRespawn: ((id: string, x: number, y: number, z: number) => void) | null = null;

  private client: Client;
  private room?: Room;
  private sendAccumulator = 0;

  constructor(serverUrl: string, private player: Player) {
    this.client = new Client(serverUrl);
  }

  start() {
    void this.connect();
  }

  /** Our own state from the latest server snapshot, if present. */
  self(): NetPlayerState | undefined {
    return this.players.find((p) => p.id === this.sessionId);
  }

  /** Tell the server our shot connected with another player. */
  reportHit(targetId: string, damage: number) {
    this.room?.send('hit', { target: targetId, damage });
  }

  private async connect() {
    try {
      const room = await this.client.joinOrCreate('lobby');
      this.room = room;
      this.connected = true;
      this.sessionId = room.sessionId;
      console.log(`[fps-earth] online as ${room.sessionId}`);

      room.onMessage('players', (list: NetPlayerState[]) => {
        this.players = list;
      });
      room.onMessage('kill', (m: { killer: string; victim: string }) => {
        this.onKill?.(m.killer, m.victim);
      });
      room.onMessage('respawn', (m: { id: string; x: number; y: number; z: number }) => {
        this.onRespawn?.(m.id, m.x, m.y, m.z);
      });
      room.onError((code, message) => {
        console.warn('[fps-earth] room error:', code, message);
      });
      room.onLeave(() => {
        this.connected = false;
        this.players = [];
        console.info('[fps-earth] disconnected from server — retrying');
        this.scheduleRetry();
      });
    } catch {
      console.info('[fps-earth] game server unreachable — single-player mode (will retry)');
      this.scheduleRetry();
    }
  }

  private scheduleRetry() {
    setTimeout(() => void this.connect(), RETRY_SECONDS * 1000);
  }

  /** Called every fixed tick: stream our position to the server at 20 Hz. */
  fixedUpdate(dt: number) {
    if (!this.connected || !this.room) return;

    // don't stream position while dead — this also avoids a stale-position
    // update racing the server's respawn placement
    const me = this.self();
    if (me && !me.alive) return;

    this.sendAccumulator += dt;
    if (this.sendAccumulator < 1 / SEND_HZ) return;
    this.sendAccumulator = 0;

    const p = this.player.position;
    this.room.send('move', {
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
    });
  }
}
