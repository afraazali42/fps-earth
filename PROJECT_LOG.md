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

**Not built yet:** shooting, other players, map editor, accounts. That's Phases 1–3.

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
- **Repo went public** (user's call — indie game, building in public). No license
  granted yet (all rights reserved) to keep business options open; README explains.

### Next session — pick one
- **A. Shooting range** (recommended): a raycast weapon, crosshair feedback, targets
  that react and respawn. Makes it feel like a *game*.
- **B. Movement feel pass:** acceleration curves, coyote time, sprint FOV kick,
  footstep/jump sounds.
- **C. Third-person toggle** (the "/TPS" part of the vision).
- **D. Start Phase 1 netcode:** Colyseus server skeleton, see your friend as a capsule.
