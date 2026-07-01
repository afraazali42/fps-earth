import type { GameConfig } from './config';

/**
 * The custom-game rules panel — the Halo-custom-games soul made clickable.
 *
 * The host edits these and they apply live (and propagate to everyone who
 * joined). Peers see the same panel read-only so they know the rules. Everything
 * here just reads/writes the live GameConfig object the rest of the game already
 * uses, so changes take effect immediately.
 */

interface Knob {
  label: string;
  min: number;
  max: number;
  step: number;
  get: (c: GameConfig) => number;
  set: (c: GameConfig, v: number) => void;
  fmt: (v: number) => string;
}

const KNOBS: Knob[] = [
  { label: 'Gravity', min: -40, max: -2, step: 1, get: (c) => c.gravity, set: (c, v) => (c.gravity = v), fmt: (v) => v.toFixed(0) },
  { label: 'Move speed', min: 2, max: 12, step: 0.5, get: (c) => c.walkSpeed, set: (c, v) => (c.walkSpeed = v), fmt: (v) => `${v.toFixed(1)} m/s` },
  { label: 'Sprint speed', min: 4, max: 18, step: 0.5, get: (c) => c.sprintSpeed, set: (c, v) => (c.sprintSpeed = v), fmt: (v) => `${v.toFixed(1)} m/s` },
  { label: 'Jump height', min: 4, max: 16, step: 0.5, get: (c) => c.jumpVelocity, set: (c, v) => (c.jumpVelocity = v), fmt: (v) => v.toFixed(1) },
  { label: 'Damage', min: 5, max: 100, step: 5, get: (c) => c.weapon.damage, set: (c, v) => (c.weapon.damage = v), fmt: (v) => v.toFixed(0) },
  { label: 'Fire rate', min: 1, max: 20, step: 0.5, get: (c) => c.weapon.fireRate, set: (c, v) => (c.weapon.fireRate = v), fmt: (v) => `${v.toFixed(1)}/s` },
  { label: 'Score to win', min: 5, max: 50, step: 5, get: (c) => c.teams.scoreToWin, set: (c, v) => (c.teams.scoreToWin = v), fmt: (v) => `${v.toFixed(0)} kills` },
];

interface Preset {
  name: string;
  rules: Partial<{
    gravity: number;
    walkSpeed: number;
    sprintSpeed: number;
    jumpVelocity: number;
    damage: number;
    fireRate: number;
  }>;
  /** if set, also turns team deathmatch on/off */
  teamsEnabled?: boolean;
}

// each preset is a complete, coherent ruleset across the six knobs above
const PRESETS: Preset[] = [
  { name: 'Normal', rules: { gravity: -24, walkSpeed: 5.5, sprintSpeed: 8.5, jumpVelocity: 8.5, damage: 25, fireRate: 8 }, teamsEnabled: false },
  { name: 'Good vs Bad', rules: { gravity: -24, walkSpeed: 5.5, sprintSpeed: 8.5, jumpVelocity: 8.5, damage: 25, fireRate: 8 }, teamsEnabled: true },
  { name: 'Moon', rules: { gravity: -5, walkSpeed: 5.5, sprintSpeed: 8.5, jumpVelocity: 8, damage: 25, fireRate: 8 } },
  { name: 'Snipers', rules: { gravity: -24, walkSpeed: 4.5, sprintSpeed: 7, jumpVelocity: 7, damage: 100, fireRate: 1.5 } },
  { name: 'Rapid Fire', rules: { gravity: -24, walkSpeed: 6, sprintSpeed: 9, jumpVelocity: 8.5, damage: 8, fireRate: 18 } },
  { name: 'Floaty Brawl', rules: { gravity: -8, walkSpeed: 7, sprintSpeed: 11, jumpVelocity: 13, damage: 25, fireRate: 8 } },
  { name: 'Speed Demons', rules: { gravity: -24, walkSpeed: 9, sprintSpeed: 15, jumpVelocity: 9, damage: 30, fireRate: 10 } },
];

export class SettingsPanel {
  private rows: { knob: Knob; input: HTMLInputElement; value: HTMLSpanElement }[] = [];
  private presetButtons: HTMLButtonElement[] = [];
  private teamsToggle!: HTMLInputElement;
  private note: HTMLDivElement;

  constructor(
    container: HTMLElement,
    private config: GameConfig,
    private onChange: () => void,
  ) {
    // clicks/drags inside the panel must not bubble to the overlay (which would
    // start the game)
    container.addEventListener('click', (e) => e.stopPropagation());

    const title = document.createElement('div');
    title.className = 'settings-title';
    title.textContent = 'Game rules';
    container.appendChild(title);

    const presetRow = document.createElement('div');
    presetRow.className = 'preset-row';
    for (const preset of PRESETS) {
      const btn = document.createElement('button');
      btn.className = 'preset';
      btn.textContent = preset.name;
      btn.addEventListener('click', () => this.applyPreset(preset));
      presetRow.appendChild(btn);
      this.presetButtons.push(btn);
    }
    container.appendChild(presetRow);

    for (const knob of KNOBS) {
      const row = document.createElement('label');
      row.className = 'knob';

      const name = document.createElement('span');
      name.className = 'knob-name';
      name.textContent = knob.label;

      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(knob.min);
      input.max = String(knob.max);
      input.step = String(knob.step);

      const value = document.createElement('span');
      value.className = 'knob-value';

      input.addEventListener('input', () => {
        knob.set(this.config, Number(input.value));
        value.textContent = knob.fmt(knob.get(this.config));
        this.onChange();
      });

      row.append(name, input, value);
      container.appendChild(row);
      this.rows.push({ knob, input, value });
    }

    // team deathmatch toggle — the on-the-nose Good Guys vs Bad Guys mode
    const teamRow = document.createElement('label');
    teamRow.className = 'knob';
    const teamName = document.createElement('span');
    teamName.className = 'knob-name';
    teamName.textContent = 'Team deathmatch';
    this.teamsToggle = document.createElement('input');
    this.teamsToggle.type = 'checkbox';
    this.teamsToggle.className = 'team-toggle';
    const teamHint = document.createElement('span');
    teamHint.className = 'knob-value';
    teamHint.textContent = 'Good vs Bad';
    this.teamsToggle.addEventListener('change', () => {
      this.config.teams.enabled = this.teamsToggle.checked;
      this.onChange();
    });
    teamRow.append(teamName, this.teamsToggle, teamHint);
    container.appendChild(teamRow);

    this.note = document.createElement('div');
    this.note.className = 'settings-note';
    container.appendChild(this.note);

    this.refresh();
  }

  /** Re-read every control from the live config (after a preset or a network update). */
  refresh() {
    for (const { knob, input, value } of this.rows) {
      const v = knob.get(this.config);
      input.value = String(v);
      value.textContent = knob.fmt(v);
    }
    this.teamsToggle.checked = this.config.teams.enabled;
  }

  /** Host can edit; peers see the rules but can't change them. */
  setEditable(editable: boolean) {
    for (const { input } of this.rows) input.disabled = !editable;
    for (const btn of this.presetButtons) btn.disabled = !editable;
    this.teamsToggle.disabled = !editable;
    this.note.textContent = editable
      ? 'You set the rules — changes apply to everyone instantly.'
      : 'The host controls the rules for this game.';
  }

  private applyPreset(preset: Preset) {
    const c = this.config;
    const r = preset.rules;
    if (r.gravity !== undefined) c.gravity = r.gravity;
    if (r.walkSpeed !== undefined) c.walkSpeed = r.walkSpeed;
    if (r.sprintSpeed !== undefined) c.sprintSpeed = r.sprintSpeed;
    if (r.jumpVelocity !== undefined) c.jumpVelocity = r.jumpVelocity;
    if (r.damage !== undefined) c.weapon.damage = r.damage;
    if (r.fireRate !== undefined) c.weapon.fireRate = r.fireRate;
    if (preset.teamsEnabled !== undefined) c.teams.enabled = preset.teamsEnabled;
    this.refresh();
    this.onChange();
  }
}
