import type { Input } from './input';
import type { Player } from './player';
import type { GameConfig } from './config';

/**
 * Dev/testing tools — only installed when running `npm run dev`, never in a
 * production build. Two audiences:
 *
 * Humans (keyboard):
 *   `  (backtick)  toggle the debug readout (position, angles, grounded)
 *   K              respawn at the spawn point if you get stuck
 *
 * Automation (browser console / Claude):
 *   dev.state()                     position, view angles, grounded, fall speed
 *   dev.config()                    current game rules (GameConfig)
 *   dev.tune({ gravity: -4 })       change game rules LIVE — custom-game-type preview
 *   dev.look(yawDeg, pitchDeg?)     aim the view
 *   dev.hold('KeyW', 'ShiftLeft')   press keys down until released
 *   dev.release()                   release all (or listed) virtual keys
 *   dev.walk(seconds, ...keys)      hold keys for N seconds (async)
 *   dev.jump()
 *   dev.teleport(x, y, z)
 *   dev.respawn()
 */

export interface DevState {
  pos: { x: number; y: number; z: number };
  yawDeg: number;
  pitchDeg: number;
  grounded: boolean;
  verticalVelocity: number;
}

export interface DevTools {
  state(): DevState;
  config(): GameConfig;
  tune(patch: Partial<GameConfig>): GameConfig;
  look(yawDeg: number, pitchDeg?: number): DevState;
  hold(...codes: string[]): DevState;
  release(...codes: string[]): DevState;
  walk(seconds: number, ...codes: string[]): Promise<DevState>;
  jump(): DevState;
  teleport(x: number, y: number, z: number): DevState;
  respawn(): DevState;
}

declare global {
  interface Window {
    dev?: DevTools;
  }
}

export function installDevTools(player: Player, input: Input, config: GameConfig): DevTools {
  const held = new Set<string>();

  const state = (): DevState => ({
    pos: player.position,
    yawDeg: Math.round((player.yaw * 180) / Math.PI),
    pitchDeg: Math.round((player.pitch * 180) / Math.PI),
    grounded: player.isGrounded,
    verticalVelocity: Math.round(player.verticalVelocity * 100) / 100,
  });

  const hold = (...codes: string[]): DevState => {
    for (const c of codes) {
      held.add(c);
      input.setVirtualKey(c, true);
    }
    return state();
  };

  const release = (...codes: string[]): DevState => {
    const list = codes.length > 0 ? codes : [...held];
    for (const c of list) {
      held.delete(c);
      input.setVirtualKey(c, false);
    }
    return state();
  };

  const tools: DevTools = {
    state,
    hold,
    release,

    config(): GameConfig {
      return { ...config };
    },

    /** Mutates the live game rules — the prototype of Halo-style custom game types. */
    tune(patch: Partial<GameConfig>): GameConfig {
      Object.assign(config, patch);
      return { ...config };
    },

    look(yawDeg: number, pitchDeg = 0): DevState {
      player.yaw = (yawDeg * Math.PI) / 180;
      const limit = 89;
      player.pitch = (Math.max(-limit, Math.min(limit, pitchDeg)) * Math.PI) / 180;
      return state();
    },

    walk(seconds: number, ...codes: string[]): Promise<DevState> {
      const keys = codes.length > 0 ? codes : ['KeyW'];
      hold(...keys);
      return new Promise((resolve) =>
        setTimeout(() => {
          release(...keys);
          resolve(state());
        }, seconds * 1000),
      );
    },

    jump(): DevState {
      hold('Space');
      setTimeout(() => release('Space'), 150);
      return state();
    },

    teleport(x: number, y: number, z: number): DevState {
      player.teleport(x, y, z);
      return state();
    },

    respawn(): DevState {
      player.respawn();
      return state();
    },
  };

  // --- human-facing dev keys + debug readout -------------------------------

  const readout = document.createElement('div');
  readout.style.cssText =
    'position:fixed;top:10px;right:12px;z-index:20;display:none;' +
    'color:#9fe8a0;background:rgba(0,0,0,0.55);padding:8px 10px;border-radius:6px;' +
    'font:12px ui-monospace,monospace;white-space:pre;text-align:right;pointer-events:none';
  document.body.appendChild(readout);
  let readoutOn = false;

  setInterval(() => {
    if (!readoutOn) return;
    const s = state();
    readout.textContent =
      `pos  ${s.pos.x.toFixed(1)}  ${s.pos.y.toFixed(1)}  ${s.pos.z.toFixed(1)}\n` +
      `yaw ${s.yawDeg}°  pitch ${s.pitchDeg}°\n` +
      `${s.grounded ? 'grounded' : 'airborne'}  vy ${s.verticalVelocity.toFixed(1)}\n` +
      `grav ${config.gravity}  walk ${config.walkSpeed}  sprint ${config.sprintSpeed}  jump ${config.jumpVelocity}`;
  }, 100);

  window.addEventListener('keydown', (e) => {
    if (e.code === 'Backquote') {
      readoutOn = !readoutOn;
      readout.style.display = readoutOn ? 'block' : 'none';
    }
    if (e.code === 'KeyK') player.respawn();
  });

  return tools;
}
