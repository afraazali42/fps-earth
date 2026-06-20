import express from 'express';
import { ExpressPeerServer } from 'peer';
import { createServer } from 'node:http';
import * as store from './store';

const PORT = Number(process.env.PORT ?? 9000);

/**
 * The shared infrastructure fps-earth needs — still tiny, still cheap to run.
 * It does two small jobs on ONE port:
 *
 *  1. Signaling ("matchmaker") — helps two browsers find each other and open a
 *     direct WebRTC link. Once that link is up, ALL gameplay flows directly
 *     between players; none of it passes through here.
 *  2. Map directory (/api) — a small store of shared maps, so a map gets a short
 *     6-character code instead of a giant blob, and maps pinned to a place show
 *     up on everyone's globe as pins they can drop into. Storage is one JSON file
 *     (see store.ts) — no database.
 *
 * Both live on one port so there's only one thing to deploy.
 */
const app = express();
app.use(express.json({ limit: '4mb' }));

// the game is served from a different origin in dev (Vite), so allow it through.
// a public map directory is meant to be read by anyone, so this is intentional.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// publish (or update) a map → returns its short code
app.post('/api/maps', (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const owner = typeof b.owner === 'string' ? b.owner : '';
  const mapKey = typeof b.mapKey === 'string' ? b.mapKey : '';
  const map = b.map as { blocks?: unknown } | undefined;
  if (!owner || !mapKey || !map || typeof map !== 'object' || !Array.isArray(map.blocks)) {
    res.status(400).json({ error: 'bad map' });
    return;
  }
  const name =
    typeof b.name === 'string' && b.name.trim() ? b.name.trim().slice(0, 60) : 'Untitled';
  let location: { lat: number; lng: number } | undefined;
  const loc = b.location as { lat?: unknown; lng?: unknown } | undefined;
  if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
    location = { lat: loc.lat, lng: loc.lng };
  }
  const e = store.upsert({ name, map, location, owner, mapKey });
  res.json({ code: e.code, name: e.name, location: e.location, updatedAt: e.updatedAt });
});

// list shared maps (lightweight — name + pin location, no geometry)
app.get('/api/maps', (_req, res) => {
  res.json({
    maps: store.list().map((e) => ({
      code: e.code,
      name: e.name,
      location: e.location,
      owner: e.owner,
      updatedAt: e.updatedAt,
    })),
  });
});

// fetch one full map by code (for import / dropping into a pin)
app.get('/api/maps/:code', (req, res) => {
  const e = store.get(req.params.code);
  if (!e) {
    res.status(404).json({ error: 'not found' });
    return;
  }
  res.json({
    code: e.code,
    name: e.name,
    location: e.location,
    owner: e.owner,
    map: e.map,
    updatedAt: e.updatedAt,
  });
});

// unpublish your own map (owner id must match)
app.delete('/api/maps/:code', (req, res) => {
  const owner = typeof req.query.owner === 'string' ? req.query.owner : '';
  const r = store.remove(req.params.code, owner);
  if (r === 'missing') {
    res.status(404).json({ error: 'not found' });
    return;
  }
  if (r === 'forbidden') {
    res.status(403).json({ error: 'not yours' });
    return;
  }
  res.json({ ok: true });
});

const server = createServer(app);

// PeerJS signaling, mounted at root so the game's existing client config (path
// '/') keeps working unchanged. The map directory above lives under /api.
const peer = ExpressPeerServer(server, { path: '/' });
peer.on('connection', (client) => console.log(`[signaling] peer available: ${client.getId()}`));
peer.on('disconnect', (client) => console.log(`[signaling] peer gone: ${client.getId()}`));
app.use('/', peer);

server.listen(PORT, () => {
  console.log(`[fps-earth] signaling + map directory listening on :${PORT}`);
});
