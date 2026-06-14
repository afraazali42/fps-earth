# fps-earth — Project Log

Plain-English record of where this project stands, so any work session can start
cold with "where were we?" — newest entries first.

**The vision:** a browser FPS/third-person shooter where anyone can build custom
maps (as easily as Roblox, as fun as Halo Forge) and play them with friends via a
link — eventually with players worldwide. The map editor is the differentiator;
the combat is the hook. **The soul of it is Halo 3 custom games:** lobbies where
the community invents wild game types by changing everything — gravity, speeds,
per-class traits, lighting, spawn points, win rules. Those one-night-only games
are gone forever; this project exists to let people make those memories again.
Architecturally that means: **every gameplay rule is data (GameConfig), never
hard-code a knob a lobby host might want to turn.**

## How to run the game

1. Open Terminal, `cd ~/Developer/fps-earth`
2. `npm run dev` (first time ever: run `npm install` once before)
3. Open the `localhost` address it prints, click, play. Esc to get the mouse back.

## Where things stand

**Phase 0 complete (2026-06-09):** a first-person character walking around a 3D
playground in the browser. Walk/sprint/jump, climbs stairs automatically, walks up
ramps, slides along walls, falls off edges and respawns. Fixed 60 Hz physics with
smooth interpolated rendering. ~965 KB over the wire (mostly the physics engine —
fine for now).

**Shooting range added (2026-06-10):** a hitscan rifle (damage/fire-rate/range/
auto all in GameConfig, live-tunable) firing physics raycasts — cover genuinely
blocks bullets, the same query a future server will run. Six practice targets
(three static on posts, two side-to-side movers, one high floater): hit flash,
health-darkening, death + timed respawn, kill counter HUD. Tracers, impact
sparks, hitmarker (red on kill), simple viewmodel with recoil, procedural
WebAudio sounds (shot/hit/kill — no asset files).

**Multiplayer (2026-06-10 → 14):** networked presence, then a PvP deathmatch —
shoot each other, health (100), death, 3 s respawn at spread-out spawns, and a
kill/death tally. Remote players are coloured capsules with hittable physics
colliders (cover still blocks); HUD has a health bar, damage flash, kill feed,
ELIMINATED/respawn overlay, and a ☠ kills / ⊗ deaths counter. Damage is sent by
the shooter so live weapon tuning works in PvP too.

**Peer-to-peer hosting (2026-06-14) — no game servers:** the networking was
re-architected from a paid Colyseus game server to **browser-hosted P2P**. One
player is the host: their browser runs the game authority (`src/host.ts`);
friends open the host's invite link and connect **directly over WebRTC**
(`src/peerlink.ts`, PeerJS). The Node server (`server/`) is now just a tiny
**signaling/matchmaker** (PeerServer) that helps browsers find each other and
carries zero gameplay — free to run. `src/net.ts` hides the host/peer split
behind one API. Verified end-to-end with two browsers: peer joined by link over
WebRTC, peer's hit was resolved by the host's authority (host died, peer's kill
counted), result broadcast back — all with no game server. **Honest caveats:**
host has a latency edge and is trusted (could cheat); host leaving ends the game;
~10–20% of strict home networks will need a TURN relay (not yet provided).

**Custom-game rules (2026-06-14):** the host gets a "Game rules" panel (`src/settings.ts`)
in the menu — sliders for gravity, move/sprint speed, jump height, damage, fire
rate, plus one-click presets (Normal, Moon, Snipers, Rapid Fire, Floaty Brawl,
Speed Demons). The host's rules apply live and propagate to everyone: peers
receive the config on join and on every change (over the P2P link), apply it into
their live GameConfig (so all systems pick it up immediately), and see the panel
read-only. This is the Halo-custom-games soul, riding entirely on the rules-as-data
foundation. Verified end-to-end: peer inherited host's rules on join (gravity -6,
move 9, damage 100, fire rate 2) and a mid-game change (gravity -2, damage 7)
propagated live.

**Map editor — Phase 2 begun (2026-06-14):** a block-based editor (`src/editor.ts`).
Maps are now DATA (`src/gamemap.ts`): a list of blocks + a spawn, with a default
arena, saved to the browser (localStorage). The world builds from a map
(`World.loadMap`, blocks tracked by id, add/remove). Build mode = a free-fly
camera, raycast placement with a live ghost preview (left-click place on the face
you're looking at, right-click remove), an 8-colour palette (number keys), F to
set spawn, Enter to play, Esc to menu — host only (the 🔨 Build button shows for
hosts). Edits auto-save; play mode drops you into your map at its spawn. Verified
the full loop: raycast placement, palette, set-spawn, save→reload persistence,
and playing (shooting, HUD) inside a built 22-block map. **Bug found & fixed:** the
raycaster read a stale camera matrix (Three.js only refreshes it at render time) —
now `camera.updateMatrixWorld()` before each placement raycast.

**Honest v1 limits:** uniform 2 m cubes only (no slabs/ramps/sizes yet); the
editor is host/solo — your custom map does NOT yet sync to peers (they play the
default arena), the clear next step (sync the map like we sync the rules); practice
targets still appear in custom maps.

**Not built yet:** map sync to peers, a deployed public matchmaker (works locally
now), a TURN relay for strict networks, accounts, more block shapes.

## The plan (agreed 2026-06-09)

- **Phase 0** ✅ — walkable world in the browser
- **Phase 1** — shooting + 2–8 player lobbies joined via a shared link
- **Phase 2** — block-based map editor: build a map, press play, share it
- **Phase 3** — accounts, map browser, public servers (the "is this becoming real?" point)
- Progress is measured in sessions, not months. Every session ends with something playable.

## Decisions so far (and why)

| Decision | Why |
|---|---|
| **Game rules are data — `src/config.ts` (GameConfig)** | The Halo-custom-games magic requires every knob (gravity, speeds, jump, later: damage, classes, win rules) to be changeable per-lobby. A custom game type = a saved config. Verified live: changed gravity mid-game, moon-jumped 5.4 m. All future systems read their numbers from config. |
| **Three.js r184** (classic WebGL renderer) for 3D | Biggest community/examples by far; WebGL2 works for ~everyone. Its newer WebGPU mode is still churning — can migrate later, no urgency. |
| **Rapier 0.19** (`rapier3d-compat`) for physics | Runs identically in browser AND Node.js — the future anti-cheat server needs that. Built-in character controller (stairs/slopes/walls solved for us). Just shipped a voxel collider — purpose-built for block maps. Healthy funding. |
| **Vite + TypeScript** tooling | Boring, reliable, instant reload. |
| Maps = lists of boxes → now **`GameMap` data** (`src/gamemap.ts`) | The day-one "maps are lists of boxes" bet paid off: the editor produces a GameMap, the world builds from one, and a shared/custom map will be one too — same pattern as rules-as-data. Block editor places uniform 2 m cubes on a grid (simplest for non-coders; richer shapes later). |
| ~~**Colyseus 0.17** game server~~ → **superseded 2026-06-14** | Was the Phase-1 networking (built & worked). Replaced by peer-to-peer to avoid paid game servers (below). Colyseus removed from the codebase. |
| **Peer-to-peer hosting** (PeerJS/WebRTC), host-as-player; `server/` = signaling only | User wants community-maintained with no paid game servers. Host's browser is the authority; friends connect direct over WebRTC. Only shared infra is a tiny free matchmaker. Trade-offs accepted: host advantage/trust, host-leave ends game, ~10–20% need TURN. |
| ⚠️ **Hathora is dead** (shut down 2026-05-05) | Was an old hosting idea — do not use. Now moot under P2P; Edgegap/Railway/Hetzner only relevant for hosting the tiny matchmaker (or an optional dedicated host) later. |
| Worth knowing: **Hytopia** (hytopia.com) | "Browser Roblox" with voxel maps, launched 2025, MIT SDK, funds Rapier. Validates the architecture; our differentiator is the Halo-style FPS angle. |

## Session log

### 2026-06-09 — Session 1: research + Phase 0
- Researched the mid-2026 state of browser game tech (3 parallel research agents,
  verified against npm/caniuse/release notes). Chose the stack above.
- Built Phase 0: project scaffold, first-person controller on Rapier's character
  controller, test playground (crates, cover wall, auto-climbable stairs, ramp,
  jump pads, landmark tower), menu overlay + pointer lock, fps counter HUD.
- Verified in a headless preview: boots clean, renders correctly, no console errors.
  (Two harmless deprecation warnings: one inside Rapier's init — upstream, cosmetic;
  one Three.js shadow type — fixed.)
- Movement feel (speeds, gravity, jump height) is first-guess values in
  `src/player.ts` constants — tune by feel next time.
- Added dev tools (`src/dev.ts`, dev builds only): backtick = debug readout,
  K = respawn, plus a `window.dev` console API (state/look/hold/walk/jump/teleport)
  so Claude can playtest via the browser remotely. **Full physics playtest passed:**
  walk speed exactly 5.5 m/s, sprint exactly 8.5 m/s, jump apex ~1.55 m,
  stairs auto-climb to platform (y within millimetres of predicted), ramp walkable
  (slightly slower uphill — normal), wall stops at exactly capsule radius and
  slides along, falling off the world respawns at spawn. Shadows render correctly.
- Set up a Claude-controlled Chrome tab group as the shared playtest loop:
  user plays there, Claude edits, Vite hot-reloads in ~1 s.
- **GameConfig refactor** after user shared the Halo-3-custom-games vision:
  movement constants moved to `src/config.ts`, player/world read it live,
  `dev.tune({gravity: -4})` changes rules mid-game. Verified: moon jump apex
  within 2 cm of physics prediction; defaults unchanged (regression-tested);
  debug readout now shows live config values.

### 2026-06-10 — Session 2: project decisions
- User granted full git autonomy (commit/push at Claude's judgment, no asking).
- Monetization direction chosen: free game, never pay-to-win; the main long-term
  model is the **creator economy** — marketplace cut on creator maps/game types +
  persistent custom lobby subscriptions ("your server, your rules, always on").
  Nothing gets built for this until the game has real players.
- **Repo went public** (user's call — indie game, building in public).
- **Licensed MIT** (user's call, values-driven): the project's goal is to unite
  people and put labor into gaming in a way that benefits everyone — no
  gatekeeping, no restrictions on building from this work. Conscious trade-off:
  anyone may legally reuse or re-host the code; the moat is community and
  execution, not secrecy.

### 2026-06-10 — Session 2 (continued): shooting range
- Built the rifle + targets (see "Where things stand"). Everything config-first.
- Added `dev.step(seconds)` — deterministic simulation advance that works even in
  throttled background tabs, plus `dev.aimAt/fire/targets/kills/weaponInfo`.
  Full automated test suite passed: kill pipeline, 2 s respawn, cover blocking
  (verified twice — the playground's own crates blocked a test shot, exactly as
  designed), moving-target hits, live damage tuning (100 dmg = one-shot kill).
  Zero console errors.
- Cute bug-hunt note: shots "did no damage" at first — the weapon was fine; the
  test was firing through the crate pile. Cover works.

### 2026-06-10 — Session 2 (continued): Phase 1 begins — multiplayer presence
- Built `server/` (Colyseus 0.17 on Node) with a `lobby` room: receives "move",
  sanitizes every number (never trust the network), broadcasts all players at
  20 Hz. Client (`src/net.ts`) auto-joins, streams position at 20 Hz, falls back
  to single-player if no server. `src/remote.ts` renders others as colour-hashed
  capsules with shortest-arc yaw smoothing.
- Gotchas recorded for future sessions: the modern Colyseus client package is
  **@colyseus/sdk** (colyseus.js is legacy, stuck at 0.16); @colyseus/ws-transport
  0.17 needs **express** installed as a peer dependency.
- Verified with three live clients (two Claude-driven tabs + the user's preview
  panel, which auto-joined the lobby mid-test — surprise third player): late
  join, leave cleanup, and cross-client movement sync exact to the decimal.
  Screenshot taken of one player seeing another — the milestone shot.
- Server runs locally only so far: `npm run dev:server`.

### 2026-06-14 — Session 3: PvP deathmatch
- Built combat networking: remote players got Rapier colliders (`src/remote.ts`),
  the weapon raycast checks them and reports hits (`src/weapon.ts`), the server
  tracks health/death/respawn/kills (`server/src/LobbyRoom.ts`), and the HUD
  gained a health bar, damage flash, kill feed and death overlay (`index.html`,
  `src/main.ts`). New dev helpers: `dev.self()`, `dev.hitPlayer()`.
- Verified the kill pipeline at the server level with two driven tabs: A's ray
  hit B's capsule (impact on B's surface), server applied 4×25 dmg, B died,
  A.kills=1 / B.deaths=1. Screenshot confirms a second player rendered in-world
  plus the full combat HUD (health 100, K/D counter, gun).
- **Test-harness gotcha (not a game bug):** two tabs in one Chrome window means
  one is always backgrounded; backgrounded tabs throttle timers and Colyseus
  drops them after ~10 s, so respawn/victim-overlay timing couldn't be observed
  live (the kill+death themselves verified fine). Real players each have a
  foreground window, so this won't bite them. Chrome screenshot tool was also
  throwing transient `clip.scale` errors; the preview-panel screenshot worked.
- Not yet eyeballed (logic is in & simple): the 3 s respawn and the victim's
  death overlay — worth a look during your next real two-window playtest.

### 2026-06-14 — Session 4: peer-to-peer hosting (no game servers)
- User's directive: community-maintained, no paid game servers — each game has a
  host who is a player; others connect peer-to-peer.
- Re-architected networking: removed Colyseus; game authority now runs in the
  host's browser (`src/host.ts`, ported from the old LobbyRoom); friends connect
  directly over WebRTC via PeerJS (`src/peerlink.ts`); `server/` became a tiny
  PeerServer **signaling/matchmaker** (port 9000). `src/net.ts` rewritten with a
  host/peer role behind the same public API; `index.html`/`main.ts` gained the
  host invite-link UI + "Copy invite link" chip. `play.command` (+ Desktop copy)
  updated for the matchmaker. Client deps: removed @colyseus/sdk, added peerjs;
  server: removed @colyseus/* + express, added peer.
- **Verified end-to-end, two real browsers, NO game server:** host got a share
  code from the matchmaker; peer joined via `?host=CODE` and connected over
  WebRTC (status "connected to host", saw [HOST, self]); peer reported a hit →
  host's browser authority resolved it (HOST hp 0, dead, deaths 1; peer kills 1)
  → broadcast back to the peer. Screenshot of the host menu with live invite link.
- Library notes for future: client `peerjs` 1.5.5 (`import { Peer }`), server
  `peer` 1.0.2 (`PeerServer({port,path})`). Dev: `dev.net()` now reports
  role/shareCode/status; `dev.hitPlayer(id,dmg)` reports a hit over the wire.
- Same two-tab throttle gotcha as before — drove tests via `dev.step`/`dev.hitPlayer`
  and asserted on the foreground host; the raycast-hit path was already verified
  locally in Session 3, so this session proved the P2P transport + authority.

### 2026-06-14 — Session 5: custom-game rules (the soul)
- Built `src/settings.ts` (SettingsPanel): host-editable "Game rules" panel with
  6 sliders (gravity/move/sprint/jump/damage/fire-rate) + 6 presets. Lives in the
  menu overlay (so it's reachable any time via Esc).
- Rule propagation over P2P: `applyConfig()` in config.ts merges an incoming
  ruleset into the live GameConfig in place; net.ts sends config to each peer on
  join and via `broadcastConfig()` on change; peers apply + refresh the panel
  read-only. `world.setGravity()` keeps world gravity in sync. New dev helper
  `dev.broadcastRules(patch)`.
- Verified end-to-end (host + peer, P2P, no game server): host changed rules →
  peer joining inherited them (gravity -6, move 9, dmg 100, rof 2); a live change
  (gravity -2, dmg 7) propagated to the peer; peer panel correctly read-only.
  Screenshot of the host rules panel (Floaty Brawl preset) taken.

### 2026-06-14 — Session 6: map editor (Phase 2 begins)
- Maps became data (`src/gamemap.ts`): blocks + spawn, default arena, localStorage
  save/load with defensive validation. Refactored `World` to build from a map and
  track blocks by id (add/remove); retired the hardcoded playground for a cleaner
  starter arena. `Player` spawns from the map (`setSpawn`).
- Built the editor (`src/editor.ts`): free-fly camera, raycast ghost preview,
  place (LMB) / remove (RMB), 8-colour palette (Digit1-8), F set spawn. `main.ts`
  gained a play/edit mode machine; `index.html` the 🔨 Build button + edit HUD;
  Input now tracks right-click (Mouse2). New dev hooks: setMode/mode/placeBlock/
  blockCount/mapSpawn/editorView/editorStep/reloadMap.
- Verified the whole loop via the preview client (solo, reliable): default 8-block
  arena → build mode → raycast placement (after fixing a stale-camera-matrix bug)
  → palette + active highlight → set spawn → save→reload keeps all 22 blocks →
  play mode FPS inside the built map. Two milestone screenshots (edit + play).

### Next session — pick one
- **A. Sync custom maps to peers** — so friends play YOUR map, not the default
  (send the map over P2P on join, like we already sync the rules). Makes the
  editor multiplayer; natural follow-on to this session.
- **B. Editor depth** — variable block sizes / slabs / ramps, undo, a way to start
  from blank ("build my house"), maybe simple textures.
- **C. Deploy the matchmaker** — a friend joins from their house over the internet.
- **D. More rules + game modes** — score-to-win, teams, more weapons.
- **E. Polish:** third-person toggle, name tags, footsteps, nicer player models.
