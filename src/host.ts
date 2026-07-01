/**
 * The game authority — runs in the HOST player's browser.
 *
 * This is the logic that used to live on the Node server (LobbyRoom). It owns
 * health, death, respawn and the kill tally for every player in the match, and
 * it broadcasts everyone's state ~20×/second. The host's own inputs feed in
 * directly; peers' inputs arrive over WebRTC (see peerlink.ts / net.ts).
 *
 * Still trust-the-client for positions and hits — fine for a friends' lobby
 * where you trust your host. A future server-authoritative mode can reuse this
 * same class on a dedicated Node host.
 */

import type { GameConfig } from './config';

/** 0 = the Good Guys, 1 = the Bad Guys. */
export type Team = 0 | 1;

export interface HostPlayerState {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  hp: number;
  alive: boolean;
  kills: number;
  deaths: number;
  team: Team;
}

export interface NetPlayerWire extends HostPlayerState {
  id: string;
}

const MAX_HEALTH = 100;
const RESPAWN_SECONDS = 3;
const MAX_HIT_DAMAGE = 1000; // sanity clamp only
const BROADCAST_HZ = 20;

// the two teams spawn on opposite sides of the arena
const GOOD_SPAWNS = [
  { x: -17, y: 2, z: 7, yaw: 1.6, pitch: 0 },
  { x: -11, y: 2, z: -16, yaw: 2.4, pitch: 0 },
  { x: -14, y: 2, z: 18, yaw: 2.0, pitch: 0 },
];
const BAD_SPAWNS = [
  { x: 17, y: 2, z: 3, yaw: -1.6, pitch: 0 },
  { x: 9, y: 2, z: -22, yaw: 3.1, pitch: 0 },
  { x: 14, y: 2, z: 18, yaw: -2.0, pitch: 0 },
];

export class GameHost {
  onBroadcast: ((list: NetPlayerWire[]) => void) | null = null;
  onKill: ((killerId: string, victimId: string) => void) | null = null;
  onRespawn: ((id: string, x: number, y: number, z: number) => void) | null = null;
  onTeamWin: ((team: Team) => void) | null = null;

  private players = new Map<string, HostPlayerState>();
  private interval: ReturnType<typeof setInterval> | undefined;
  private teamKills: [number, number] = [0, 0]; // the round score (resets on a win)

  constructor(private config: GameConfig) {}

  start() {
    if (this.interval !== undefined) return;
    this.interval = setInterval(() => this.onBroadcast?.(this.list()), 1000 / BROADCAST_HZ);
  }

  stop() {
    if (this.interval !== undefined) clearInterval(this.interval);
    this.interval = undefined;
  }

  list(): NetPlayerWire[] {
    return Array.from(this.players.entries()).map(([id, p]) => ({ id, ...p }));
  }

  addPlayer(id: string) {
    if (!this.players.has(id)) this.players.set(id, this.freshPlayer(this.balanceTeam()));
  }

  removePlayer(id: string) {
    this.players.delete(id);
  }

  /** Put a new player on whichever team is smaller (ties go to the Good Guys). */
  private balanceTeam(): Team {
    let good = 0;
    let bad = 0;
    for (const p of this.players.values()) p.team === 0 ? good++ : bad++;
    return good <= bad ? 0 : 1;
  }

  /** The round score and whether team mode is on — sent to everyone. */
  teamState(): { kills: [number, number]; enabled: boolean } {
    return { kills: [this.teamKills[0], this.teamKills[1]], enabled: this.config.teams.enabled };
  }

  applyMove(id: string, data: unknown) {
    const player = this.players.get(id);
    if (!player || !player.alive) return; // dead players don't move
    const m = sanitizeMove(data);
    if (!m) return;
    player.x = m.x;
    player.y = m.y;
    player.z = m.z;
    player.yaw = m.yaw;
    player.pitch = m.pitch;
  }

  applyHit(shooterId: string, data: unknown) {
    const shooter = this.players.get(shooterId);
    if (!shooter || !shooter.alive) return; // the dead can't shoot

    const parsed = sanitizeHit(data);
    if (!parsed || parsed.target === shooterId) return; // no self-damage

    const victim = this.players.get(parsed.target);
    if (!victim || !victim.alive) return;

    const teams = this.config.teams;
    // in team mode, you can't hurt your own team (unless the host allows it)
    if (teams.enabled && !teams.friendlyFire && shooter.team === victim.team) return;

    const damage = Math.min(MAX_HIT_DAMAGE, Math.max(0, parsed.damage));
    victim.hp -= damage;

    if (victim.hp <= 0) {
      victim.hp = 0;
      victim.alive = false;
      victim.deaths++;
      shooter.kills++;
      this.onKill?.(shooterId, parsed.target);
      if (teams.enabled) {
        this.teamKills[shooter.team]++;
        if (teams.scoreToWin > 0 && this.teamKills[shooter.team] >= teams.scoreToWin) {
          const winner = shooter.team;
          this.teamKills = [0, 0]; // start the next round fresh
          this.onTeamWin?.(winner);
        }
      }
      setTimeout(() => this.respawn(parsed.target), RESPAWN_SECONDS * 1000);
    }
  }

  private respawn(id: string) {
    const player = this.players.get(id);
    if (!player) return; // they left while waiting to respawn
    const spawn = spawnFor(player.team);
    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    player.yaw = spawn.yaw;
    player.pitch = spawn.pitch;
    player.hp = MAX_HEALTH;
    player.alive = true;
    this.onRespawn?.(id, spawn.x, spawn.y, spawn.z);
  }

  private freshPlayer(team: Team): HostPlayerState {
    const spawn = spawnFor(team);
    return { ...spawn, hp: MAX_HEALTH, alive: true, kills: 0, deaths: 0, team };
  }
}

function spawnFor(team: Team) {
  const pool = team === 0 ? GOOD_SPAWNS : BAD_SPAWNS;
  return pool[Math.floor(Math.random() * pool.length)]!;
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
