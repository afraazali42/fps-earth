/**
 * Procedural sound effects via WebAudio — no audio files needed.
 * Browsers only allow audio after a user gesture, so unlock() is called from
 * click/keydown handlers; every effect silently no-ops until then.
 */
export class Sfx {
  private ctx?: AudioContext;

  unlock() {
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      // no audio available — game works fine without it
    }
  }

  /** gunshot: a short noise burst plus a low thump */
  shoot() {
    this.noise(0.06, 0.18, 900);
    this.tone(160, 70, 0.07, 'square', 0.1);
  }

  /** confirmed hit: short high tick */
  hit() {
    this.tone(950, 1300, 0.045, 'sine', 0.09);
  }

  /** target destroyed: descending pop */
  kill() {
    this.tone(620, 180, 0.18, 'sawtooth', 0.12);
    this.tone(900, 1500, 0.09, 'sine', 0.08);
  }

  private tone(
    freqFrom: number,
    freqTo: number,
    duration: number,
    type: OscillatorType,
    peak: number,
  ) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqFrom, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqTo, 1), t + duration);
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  private noise(duration: number, peak: number, lowpassHz: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const samples = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, samples, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpassHz;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t);
  }
}
