/**
 * Tracks raw keyboard/mouse state. The rest of the game asks this class
 * "is W held? how far did the mouse move?" instead of listening to browser
 * events directly — later, multiplayer input recording plugs in here.
 */
export class Input {
  private keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;
  pointerLocked = false;

  constructor(private lockTarget: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === this.lockTarget;
      if (!this.pointerLocked) this.keys.clear();
    });
    // if the tab loses focus, forget held keys so the player doesn't run off
    window.addEventListener('blur', () => this.keys.clear());
  }

  requestLock() {
    // requestPointerLock returns a Promise in modern Chrome and rejects when
    // lock isn't available (unfocused window, automation, some devices).
    // The game keeps running without lock, so swallow the rejection.
    try {
      const result = this.lockTarget.requestPointerLock() as unknown;
      (result as Promise<void> | undefined)?.catch?.(() => {
        console.info('[fps-earth] pointer lock unavailable — click the game to retry');
      });
    } catch {
      // older browsers throw synchronously instead; same story
    }
  }

  /** Mouse motion accumulated since the last call; resets on read. */
  consumeMouse(): { dx: number; dy: number } {
    const out = { dx: this.mouseDX, dy: this.mouseDY };
    this.mouseDX = 0;
    this.mouseDY = 0;
    return out;
  }

  down(code: string): boolean {
    return this.keys.has(code);
  }

  /** Dev tools: press/release a key programmatically, as if held on the keyboard. */
  setVirtualKey(code: string, down: boolean) {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }
}
