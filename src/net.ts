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
}

const SEND_HZ = 20;
const RETRY_SECONDS = 5;

/**
 * Connection to the game server (Phase 1 v0): streams our position up at
 * 20 Hz, receives everyone's positions back. If the server is unreachable
 * the game keeps working in single-player mode and retries quietly.
 */
export class Net {
  connected = false;
  sessionId = '';
  /** latest player list from the server (includes ourselves) */
  players: NetPlayerState[] = [];

  private client: Client;
  private room?: Room;
  private sendAccumulator = 0;

  constructor(serverUrl: string, private player: Player) {
    this.client = new Client(serverUrl);
  }

  start() {
    void this.connect();
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
