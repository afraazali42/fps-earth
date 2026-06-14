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

**Multiplayer v0 (2026-06-10) — Phase 1 has begun:** a Colyseus game server
(`server/`, runs with `npm run dev:server`) and the game auto-joining its lobby.
Every player streams their position at 20 Hz; the server broadcasts everyone to
everyone; other players appear as coloured capsules (visor shows facing) with
smoothing between updates. Offline fallback: no server → single-player, quiet
retry every 5 s. Verified with three simultaneous clients — movement propagated
across clients exact to the decimal.

**PvP deathmatch (2026-06-14):** you can shoot each other. Remote players now
carry physics colliders, so the rifle's raycast hits them (and cover still
blocks). The server owns health (100), death, a 3 s respawn at spread-out spawn
points, and the kill/death tally; the shooter reports the hit and the server
applies damage (client sends the amount so live weapon tuning still works in
PvP). HUD: health bar, red damage flash, kill feed, "ELIMINATED" + respawn
overlay, and a ☠ kills / ⊗ deaths counter. **Honest caveat:** still
client-authoritative for both position AND hit detection — fine for friends,
replaced by the server-authoritative rewrite later in Phase 1.

**Not built yet:** public servers, rooms via shareable link, map editor, accounts.

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
| Maps = lists of boxes via `world.addBox()` | Every solid object creates its visual mesh + physics collider together. This IS the seed of the map format the editor will output. |
| *(Phase 1, decided not built)* **Colyseus 0.17 over plain WebSockets**; host on Railway or Hetzner (~$5/mo) | WebSockets are what Krunker shipped on; fine for casual FPS. Colyseus's room model = "shareable link = room id". Upgrade path: WebTransport via `@colyseus/h3-transport` (Safari supports it since 26.4, Mar 2026). |
| ⚠️ **Hathora is dead** (shut down 2026-05-05) | Was the old plan for game hosting — do not use. Edgegap is the scale-up alternative. |
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

### Next session — pick one
- **A. Go public:** deploy the server (Railway/Hetzner), rooms joinable via a
  shareable link — the real "friend joins from their house" moment.
- **B. Server-authoritative movement + hits** — the anti-cheat foundation;
  replaces client-trusted positions/hits with server-run physics.
- **C. Game modes / custom rules UI** — a lobby screen to set gravity, speed,
  damage, score-to-win (the Halo-custom-games soul, made clickable).
- **D. Polish:** third-person toggle, name tags, better player models, footsteps.
