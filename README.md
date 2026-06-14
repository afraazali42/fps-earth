# fps-earth

A browser-based FPS where anyone can build custom maps and play them together —
no downloads. Think: Halo custom games + a Roblox-style map editor, in a browser tab.

The soul of the project is recreating the magic of Halo 3 custom games: lobbies
where communities invented wild game types by bending every rule. So here, game
rules are **data, not code** — gravity, speeds, and (eventually) classes, damage
and win conditions are all live-tunable config, and a custom game type will be a
shareable file, just like a map.

**Current state: Phase 1** — a first-person shooter you play with others: walk,
sprint, jump and shoot around a 3D playground, with networked deathmatch (health,
death, respawn, kill/death tally). Multiplayer is **peer-to-peer** — one player
hosts in their browser and friends join by link; there's no game server to pay
for. The host sets the **game rules** — gravity, speeds, jump, damage, fire rate,
with one-click presets — and they apply to everyone, live. Built in public;
follow the journey in [PROJECT_LOG.md](PROJECT_LOG.md).

## Run it

**Easiest — double-click [`play.command`](play.command)** (macOS). It installs
dependencies on first run, starts the matchmaker and the game, and opens your
browser. Keep the Terminal window open while you play; close it to stop.

**Manually:**

```bash
npm install                      # first time only
npm --prefix server install      # first time only
npm run dev:server               # the matchmaker / signaling server (terminal 1)
npm run dev                      # the game (terminal 2)
```

Then open the `http://localhost:...` address Vite prints. (In Claude Code, you
can also just press ▶ on the **dev** server in the preview panel.)

## Multiplayer (peer-to-peer)

- Open the game normally → **you're the host**. A shareable invite link appears
  (and a "Copy invite link" button).
- A friend opens that link (`?host=CODE`) → their browser connects **directly**
  to yours over WebRTC and the game plays peer-to-peer.
- The only shared infrastructure is a tiny **matchmaker** (`server/`) that helps
  browsers find each other — it carries no gameplay, so it's basically free to
  run. `?signal=host:port` points the game at a specific matchmaker.

**Game rules (custom games):** the host gets a "Game rules" panel (in the menu,
and any time via Esc) — gravity, move/sprint speed, jump height, damage, fire
rate, plus presets like Moon, Snipers, Rapid Fire, Floaty Brawl. Changes apply
instantly and propagate to everyone in the lobby; peers see the rules read-only.
This is the Halo-custom-games heart of the project, and it all rides on
[src/config.ts](src/config.ts) (rules as data).

The host's browser runs the game's authority (health/hits/scores). Trade-offs,
honest: the host has a latency advantage and could cheat, the game ends if the
host leaves, and a small fraction of restrictive home networks need a relay
(TURN) server to connect — all acceptable for friends'/community lobbies, like a
LAN host of old.

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look |
| Left click | Shoot |
| Space | Jump |
| Shift | Sprint |
| Esc | Release mouse / menu |

### Dev controls (only in `npm run dev`)

| Key | Action |
|---|---|
| ` (backtick) | Toggle debug readout (position, angles, grounded) |
| K | Respawn at spawn point (if you get stuck) |

There's also a `dev.*` API in the browser console for automated testing —
`dev.state()`, `dev.walk(seconds)`, `dev.teleport(x,y,z)` etc. See [src/dev.ts](src/dev.ts).

## Code map

| File | What it does |
|---|---|
| [src/config.ts](src/config.ts) | **The game rules as data** — gravity, speeds, jump, damage. Custom game types = copies of this |
| [src/settings.ts](src/settings.ts) | The host's "Game rules" panel — sliders + presets that edit the live config |
| [src/main.ts](src/main.ts) | Boots everything; runs the game loop (60 Hz physics, smooth rendering) |
| [src/world.ts](src/world.ts) | The 3D scene + physics world; `addBox()` builds the map |
| [src/player.ts](src/player.ts) | First-person movement: capsule physics, camera, jumping |
| [src/weapon.ts](src/weapon.ts) | Hitscan rifle: physics raycasts (cover blocks shots), tracers, recoil |
| [src/targets.ts](src/targets.ts) | Practice targets: health, hit flash, death + respawn, movers |
| [src/audio.ts](src/audio.ts) | Procedural sound effects (WebAudio, no asset files) |
| [src/net.ts](src/net.ts) | Networking: as host runs the authority locally, as peer talks to the host; same API either way |
| [src/host.ts](src/host.ts) | The game authority (health/hits/respawn/scores) — runs in the host player's browser |
| [src/peerlink.ts](src/peerlink.ts) | WebRTC peer-to-peer link (PeerJS): host accepts friends, friend connects to host |
| [src/remote.ts](src/remote.ts) | Renders other players as coloured capsules with hittable colliders, smoothed |
| [src/input.ts](src/input.ts) | Keyboard/mouse state, pointer lock |
| [server/](server/src) | The tiny matchmaker / signaling server (PeerServer) — handshake only, no gameplay |

Project history, decisions and next steps: see [PROJECT_LOG.md](PROJECT_LOG.md).

## License

**MIT** — free for anyone to use, modify, and build on, forever. See [LICENSE](LICENSE).

This project exists to unite people and bring back some of the old magic of
gaming. Gatekeeping would defeat the point: if you build something on top of
this work, that's the goal working.
