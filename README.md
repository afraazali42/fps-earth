# fps-earth

A browser-based FPS where anyone can build custom maps and play them together —
no downloads. Think: Halo custom games + a Roblox-style map editor, in a browser tab.

The soul of the project is recreating the magic of Halo 3 custom games: lobbies
where communities invented wild game types by bending every rule. So here, game
rules are **data, not code** — gravity, speeds, and (eventually) classes, damage
and win conditions are all live-tunable config, and a custom game type will be a
shareable file, just like a map.

**Current state: Phase 0** — a first-person character you can walk, sprint and
jump around a 3D test playground. Built in public; follow the journey in
[PROJECT_LOG.md](PROJECT_LOG.md).

## Run it

```bash
npm install   # first time only
npm run dev
```

Then open the `http://localhost:...` address it prints. (In Claude Code, you can
also just press ▶ on the **dev** server in the preview panel.)

## Controls

| Key | Action |
|---|---|
| WASD | Move |
| Mouse | Look |
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
| [src/config.ts](src/config.ts) | **The game rules as data** — gravity, speeds, jump. Future custom game types = saved copies of this |
| [src/main.ts](src/main.ts) | Boots everything; runs the game loop (60 Hz physics, smooth rendering) |
| [src/world.ts](src/world.ts) | The 3D scene + physics world; `addBox()` builds the map |
| [src/player.ts](src/player.ts) | First-person movement: capsule physics, camera, jumping |
| [src/input.ts](src/input.ts) | Keyboard/mouse state, pointer lock |

Project history, decisions and next steps: see [PROJECT_LOG.md](PROJECT_LOG.md).

## License

**MIT** — free for anyone to use, modify, and build on, forever. See [LICENSE](LICENSE).

This project exists to unite people and bring back some of the old magic of
gaming. Gatekeeping would defeat the point: if you build something on top of
this work, that's the goal working.
