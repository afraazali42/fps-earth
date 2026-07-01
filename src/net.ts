import type { Player } from './player';
import { GameHost, type NetPlayerWire, type FlagWire } from './host';
import { PeerHost, PeerClient, type SignalConfig } from './peerlink';
import { applyConfig, type GameConfig } from './config';
import { parseMap, type GameMap } from './gamemap';

/** One player's state, as the host's authority reports it. */
export type NetPlayerState = NetPlayerWire;

export type Role = 'host' | 'peer';

const SEND_HZ = 20;
const HOST_ID = 'HOST';

export interface NetOptions {
  role: Role;
  hostCode?: string;
  signal: SignalConfig;
  /** the live game rules — host sends these to peers; peers receive into them */
  config: GameConfig;
  /** current map, fetched fresh when the host needs to send it */
  getMap: () => GameMap;
}

/**
 * The game's view of the network, regardless of who's hosting.
 *
 * - As HOST: runs the game authority (GameHost) locally and relays it to peers.
 *   Our own inputs feed straight in; no round-trip.
 * - As PEER: connects to a host over WebRTC, sends our inputs, renders the
 *   state the host sends back.
 *
 * The rest of the game uses the same small API either way (players, self(),
 * reportHit, fixedUpdate, onKill, onRespawn).
 */
export class Net {
  connected = false;
  sessionId = '';
  players: NetPlayerState[] = [];
  /** team deathmatch round score, kept in sync with the host */
  teams: { kills: [number, number]; enabled: boolean } = { kills: [0, 0], enabled: false };
  /** capture-the-flag flag state, kept in sync with the host */
  flags: FlagWire[] = [];

  readonly role: Role;
  /** host: our peer id to share; peer: the host code we're joining */
  shareCode = '';
  status = 'starting';

  onKill: ((killerId: string, victimId: string) => void) | null = null;
  onRespawn: ((id: string, x: number, y: number, z: number) => void) | null = null;
  onTeamWin: ((team: 0 | 1) => void) | null = null;
  onCapture: ((team: 0 | 1, byId: string) => void) | null = null;
  onStatus: ((status: string) => void) | null = null;
  /** peer: fired when the host's rules arrive and have been applied to config */
  onConfig: (() => void) | null = null;
  /** peer: fired with the host's map (already parsed) — rebuild the world from it */
  onMap: ((map: GameMap) => void) | null = null;

  private sendAccumulator = 0;
  private game?: GameHost;
  private peerHost?: PeerHost;
  private peerClient?: PeerClient;

  constructor(
    private player: Player,
    private opts: NetOptions,
  ) {
    this.role = opts.role;
  }

  start() {
    if (this.role === 'host') this.startHost();
    else this.startPeer();
  }

  self(): NetPlayerState | undefined {
    return this.players.find((p) => p.id === this.sessionId);
  }

  /** Which team we're on (0 = Good Guys, 1 = Bad Guys), if assigned yet. */
  myTeam(): 0 | 1 | undefined {
    return this.self()?.team;
  }

  // dev/test helpers (drive the authority directly to exercise PvP + teams)
  debugAddPlayer(id: string) {
    if (this.role === 'host') this.game?.addPlayer(id);
  }
  debugHit(shooterId: string, targetId: string, damage: number) {
    if (this.role === 'host') this.game?.applyHit(shooterId, { target: targetId, damage });
  }
  debugMove(id: string, x: number, y: number, z: number) {
    if (this.role === 'host') this.game?.applyMove(id, { x, y, z, yaw: 0, pitch: 0 });
  }
  debugTickCtf() {
    if (this.role === 'host') this.game?.tickCtf();
  }
  /** Authoritative reads (host truth, no waiting for a broadcast tick). */
  debugFlags(): FlagWire[] {
    return this.role === 'host' ? (this.game?.flagsWire() ?? []) : this.flags;
  }
  debugTeams(): { kills: [number, number]; enabled: boolean } {
    return this.role === 'host' ? (this.game?.teamState() ?? this.teams) : this.teams;
  }

  /** Host: push the current rules to everyone (call after changing settings). */
  broadcastConfig() {
    this.peerHost?.sendToAll('config', this.opts.config);
  }

  /** Host: push the current map to everyone (call after editing). */
  broadcastMap() {
    this.peerHost?.sendToAll('map', this.opts.getMap());
  }

  /** Tell the authority our shot connected with another player. */
  reportHit(targetId: string, damage: number) {
    if (this.role === 'host') {
      this.game?.applyHit(this.sessionId, { target: targetId, damage });
    } else {
      this.peerClient?.send('hit', { target: targetId, damage });
    }
  }

  /** Called every fixed tick: stream our position to the authority at 20 Hz. */
  fixedUpdate(dt: number) {
    const me = this.self();
    if (me && !me.alive) return; // don't stream while dead (avoids racing respawn)

    this.sendAccumulator += dt;
    if (this.sendAccumulator < 1 / SEND_HZ) return;
    this.sendAccumulator = 0;

    const p = this.player.position;
    const move = { x: p.x, y: p.y, z: p.z, yaw: this.player.yaw, pitch: this.player.pitch };
    if (this.role === 'host') this.game?.applyMove(this.sessionId, move);
    else this.peerClient?.send('move', move);
  }

  private startHost() {
    this.sessionId = HOST_ID;
    const game = new GameHost(this.opts.config);
    this.game = game;
    game.addPlayer(HOST_ID);
    game.onBroadcast = (list) => {
      this.players = list;
      this.teams = game.teamState();
      this.peerHost?.sendToAll('players', list);
      this.peerHost?.sendToAll('teams', this.teams);
      if (this.opts.config.teams.mode === 'ctf') {
        this.flags = game.flagsWire();
        this.peerHost?.sendToAll('flags', this.flags);
      }
    };
    game.onKill = (killer, victim) => {
      this.onKill?.(killer, victim);
      this.peerHost?.sendToAll('kill', { killer, victim });
    };
    game.onTeamWin = (team) => {
      this.onTeamWin?.(team);
      this.peerHost?.sendToAll('teamwin', { team });
    };
    game.onCapture = (team, byId) => {
      this.onCapture?.(team, byId);
      this.peerHost?.sendToAll('capture', { team });
    };
    game.onRespawn = (id, x, y, z) => {
      this.onRespawn?.(id, x, y, z);
      this.peerHost?.sendToAll('respawn', { id, x, y, z });
    };
    game.start();
    this.connected = true;
    this.setStatus('starting host…');

    const host = new PeerHost(this.opts.signal);
    this.peerHost = host;
    host.onReady = (id) => {
      this.shareCode = id;
      this.setStatus('hosting');
    };
    host.onPeerJoin = (id) => {
      game.addPlayer(id);
      // bring the new player onto our rules AND our map
      host.sendTo(id, 'config', this.opts.config);
      host.sendTo(id, 'map', this.opts.getMap());
    };
    host.onPeerLeave = (id) => game.removePlayer(id);
    host.onMessage = (from, type, data) => {
      if (type === 'move') game.applyMove(from, data);
      else if (type === 'hit') game.applyHit(from, data);
    };
    host.onError = (err) => this.setStatus(`signaling unavailable (${err}) — solo for now`);
  }

  private startPeer() {
    this.setStatus('connecting to host…');
    const client = new PeerClient(this.opts.hostCode ?? '', this.opts.signal);
    this.peerClient = client;
    this.shareCode = this.opts.hostCode ?? '';
    client.onOpen = () => {
      this.sessionId = client.id;
      this.connected = true;
      this.setStatus('connected to host');
    };
    client.onMessage = (type, data) => {
      if (type === 'players') this.players = data as NetPlayerState[];
      else if (type === 'kill') {
        const m = data as { killer: string; victim: string };
        this.onKill?.(m.killer, m.victim);
      } else if (type === 'respawn') {
        const m = data as { id: string; x: number; y: number; z: number };
        this.onRespawn?.(m.id, m.x, m.y, m.z);
      } else if (type === 'teams') {
        const m = data as { kills?: unknown; enabled?: unknown };
        if (Array.isArray(m.kills) && m.kills.length === 2) {
          this.teams = {
            kills: [Number(m.kills[0]) || 0, Number(m.kills[1]) || 0],
            enabled: !!m.enabled,
          };
        }
      } else if (type === 'teamwin') {
        const m = data as { team?: unknown };
        if (m.team === 0 || m.team === 1) this.onTeamWin?.(m.team);
      } else if (type === 'flags') {
        if (Array.isArray(data)) this.flags = data as FlagWire[];
      } else if (type === 'capture') {
        const m = data as { team?: unknown };
        if (m.team === 0 || m.team === 1) this.onCapture?.(m.team, '');
      } else if (type === 'config') {
        applyConfig(this.opts.config, data);
        this.onConfig?.();
      } else if (type === 'map') {
        const map = parseMap(data);
        if (map) this.onMap?.(map);
      }
    };
    client.onClose = () => {
      this.connected = false;
      this.players = [];
      this.setStatus('disconnected from host');
    };
    client.onError = (err) => this.setStatus(`could not reach host (${err})`);
  }

  private setStatus(status: string) {
    this.status = status;
    this.onStatus?.(status);
  }
}
