import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { LobbyRoom } from './LobbyRoom';

const PORT = Number(process.env.PORT ?? 2567);

const gameServer = new Server({
  transport: new WebSocketTransport(),
});

gameServer.define('lobby', LobbyRoom);

void gameServer.listen(PORT);
console.log(`[fps-earth server] listening on ws://localhost:${PORT}`);
