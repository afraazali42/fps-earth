import { Peer } from 'peerjs';
import type { DataConnection } from 'peerjs';

/** Where to reach the signaling ("matchmaker") server. */
export interface SignalConfig {
  host: string;
  port: number;
  path: string;
  secure: boolean;
}

interface Envelope {
  t: string;
  d: unknown;
}

function peerOptions(s: SignalConfig) {
  return { host: s.host, port: s.port, path: s.path, secure: s.secure };
}

function asEnvelope(raw: unknown): Envelope | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const e = raw as Record<string, unknown>;
  return typeof e.t === 'string' ? { t: e.t, d: e.d } : null;
}

/**
 * Host side of the peer-to-peer link: gets a share id from the signaling
 * server, then accepts direct WebRTC connections from friends. Each connection
 * is one player; their messages are routed up to the game authority.
 */
export class PeerHost {
  id = '';
  onReady: ((id: string) => void) | null = null;
  onPeerJoin: ((id: string) => void) | null = null;
  onPeerLeave: ((id: string) => void) | null = null;
  onMessage: ((fromId: string, type: string, data: unknown) => void) | null = null;
  onError: ((err: string) => void) | null = null;

  private peer: Peer;
  private conns = new Map<string, DataConnection>();

  constructor(signal: SignalConfig) {
    this.peer = new Peer(peerOptions(signal));
    this.peer.on('open', (id) => {
      this.id = id;
      this.onReady?.(id);
    });
    this.peer.on('connection', (conn) => this.accept(conn));
    this.peer.on('error', (err) => this.onError?.(err.type));
  }

  private accept(conn: DataConnection) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      this.onPeerJoin?.(conn.peer);
    });
    conn.on('data', (raw) => {
      const env = asEnvelope(raw);
      if (env) this.onMessage?.(conn.peer, env.t, env.d);
    });
    conn.on('close', () => {
      this.conns.delete(conn.peer);
      this.onPeerLeave?.(conn.peer);
    });
  }

  sendToAll(type: string, data: unknown) {
    const env: Envelope = { t: type, d: data };
    for (const conn of this.conns.values()) {
      if (conn.open) conn.send(env);
    }
  }

  destroy() {
    this.peer.destroy();
  }
}

/**
 * Friend side of the peer-to-peer link: connects directly to a host's share id.
 */
export class PeerClient {
  id = '';
  connected = false;
  onOpen: (() => void) | null = null;
  onMessage: ((type: string, data: unknown) => void) | null = null;
  onClose: (() => void) | null = null;
  onError: ((err: string) => void) | null = null;

  private peer: Peer;
  private conn?: DataConnection;

  constructor(hostId: string, signal: SignalConfig) {
    this.peer = new Peer(peerOptions(signal));
    this.peer.on('open', (id) => {
      this.id = id;
      const conn = this.peer.connect(hostId, { reliable: true });
      this.setup(conn);
    });
    this.peer.on('error', (err) => this.onError?.(err.type));
  }

  private setup(conn: DataConnection) {
    this.conn = conn;
    conn.on('open', () => {
      this.connected = true;
      this.onOpen?.();
    });
    conn.on('data', (raw) => {
      const env = asEnvelope(raw);
      if (env) this.onMessage?.(env.t, env.d);
    });
    conn.on('close', () => {
      this.connected = false;
      this.onClose?.();
    });
  }

  send(type: string, data: unknown) {
    if (this.conn && this.conn.open) this.conn.send({ t: type, d: data });
  }

  destroy() {
    this.peer.destroy();
  }
}
