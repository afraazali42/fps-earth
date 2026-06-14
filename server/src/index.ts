import { PeerServer } from 'peer';

const PORT = Number(process.env.PORT ?? 9000);

/**
 * Signaling ("matchmaker") server — the ONLY shared infrastructure fps-earth
 * needs, and it's tiny and free to run.
 *
 * It does one job: help two browsers find each other and exchange the WebRTC
 * connection details needed to open a direct peer-to-peer link. Once that link
 * is up, ALL gameplay flows directly between the host player and their friends —
 * none of it passes through here. So this never sees game traffic and costs
 * almost nothing; a free tier handles many lobbies.
 */
const server = PeerServer({ port: PORT, path: '/' }, () => {
  console.log(`[fps-earth signaling] listening on :${PORT}`);
});

server.on('connection', (client) => {
  console.log(`[signaling] peer available: ${client.getId()}`);
});
server.on('disconnect', (client) => {
  console.log(`[signaling] peer gone: ${client.getId()}`);
});
