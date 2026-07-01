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

export interface WeaponConfig {
  /** damage per shot */
  damage: number;
  /** shots per second */
  fireRate: number;
  /** maximum hit distance in metres */
  range: number;
  /** true = hold to keep firing, false = one shot per click */
  automatic: boolean;
}

export interface TargetsConfig {
  /** hit points per practice target */
  health: number;
  /** seconds before a destroyed target comes back */
  respawnSeconds: number;
}

export interface TeamConfig {
  /** team deathmatch on/off — the Good Guys vs the Bad Guys */
  enabled: boolean;
  /** team kills to win a round (0 = play forever) */
  scoreToWin: number;
  /** can you damage your own team? (off makes teams mean something) */
  friendlyFire: boolean;
}

export interface GameConfig {
  /** m/s², negative is down. Applies to players (and later, physics props). */
  gravity: number;
  /** m/s */
  walkSpeed: number;
  /** m/s */
  sprintSpeed: number;
  /** upward velocity in m/s applied at jump */
  jumpVelocity: number;
  weapon: WeaponConfig;
  targets: TargetsConfig;
  teams: TeamConfig;
}

/**
 * Copy rule values from an untrusted source (e.g. the host, over the network)
 * into our live config IN PLACE — so every system holding a reference to the
 * config object picks up the new rules immediately. Only well-typed fields are
 * copied; anything malformed is ignored.
 */
export function applyConfig(target: GameConfig, src: unknown): void {
  if (typeof src !== 'object' || src === null) return;
  const s = src as Record<string, unknown>;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

  if (num(s.gravity)) target.gravity = s.gravity;
  if (num(s.walkSpeed)) target.walkSpeed = s.walkSpeed;
  if (num(s.sprintSpeed)) target.sprintSpeed = s.sprintSpeed;
  if (num(s.jumpVelocity)) target.jumpVelocity = s.jumpVelocity;

  if (typeof s.weapon === 'object' && s.weapon !== null) {
    const w = s.weapon as Record<string, unknown>;
    if (num(w.damage)) target.weapon.damage = w.damage;
    if (num(w.fireRate)) target.weapon.fireRate = w.fireRate;
    if (num(w.range)) target.weapon.range = w.range;
    if (typeof w.automatic === 'boolean') target.weapon.automatic = w.automatic;
  }

  if (typeof s.targets === 'object' && s.targets !== null) {
    const t = s.targets as Record<string, unknown>;
    if (num(t.health)) target.targets.health = t.health;
    if (num(t.respawnSeconds)) target.targets.respawnSeconds = t.respawnSeconds;
  }

  if (typeof s.teams === 'object' && s.teams !== null) {
    const tm = s.teams as Record<string, unknown>;
    if (typeof tm.enabled === 'boolean') target.teams.enabled = tm.enabled;
    if (num(tm.scoreToWin)) target.teams.scoreToWin = tm.scoreToWin;
    if (typeof tm.friendlyFire === 'boolean') target.teams.friendlyFire = tm.friendlyFire;
  }
}

export const DEFAULT_CONFIG: GameConfig = {
  gravity: -24, // stronger than real gravity — snappier jumps feel better
  walkSpeed: 5.5,
  sprintSpeed: 8.5,
  jumpVelocity: 8.5,
  weapon: {
    damage: 25,
    fireRate: 8,
    range: 120,
    automatic: true,
  },
  targets: {
    health: 100,
    respawnSeconds: 2,
  },
  teams: {
    enabled: false,
    scoreToWin: 25,
    friendlyFire: false,
  },
};
