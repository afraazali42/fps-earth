/**
 * Game rules as DATA, not code — the heart of this project.
 *
 * The long-term goal is Halo-3-custom-games-style depth: lobbies where the
 * host changes gravity, speeds, damage, per-class traits, win conditions.
 * That only works if every gameplay system reads its knobs from here instead
 * of hard-coding them. A "custom game type" will eventually just be a saved
 * copy of this object that players share.
 *
 * Rule for all future systems: if a player could plausibly want to customize
 * it in a lobby, it belongs in GameConfig.
 */
export interface GameConfig {
  /** m/s², negative is down. Applies to players (and later, physics props). */
  gravity: number;
  /** m/s */
  walkSpeed: number;
  /** m/s */
  sprintSpeed: number;
  /** upward velocity in m/s applied at jump */
  jumpVelocity: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  gravity: -24, // stronger than real gravity — snappier jumps feel better
  walkSpeed: 5.5,
  sprintSpeed: 8.5,
  jumpVelocity: 8.5,
};
