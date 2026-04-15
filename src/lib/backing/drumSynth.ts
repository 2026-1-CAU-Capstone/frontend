import type { DrumPiece } from "./types";

/* ─────────────────────────────────────────────────────────────────────────
 * Simple synthesized drum kit using Web Audio primitives.
 *
 * Rationale for Phase 0: soundfont-player's default instrument catalog does
 * not expose a proper GM drum kit. Rather than bundle an additional sample
 * pack, we synthesize just enough percussion (kick / snare / ride / hi-hat)
 * from oscillators and noise buffers. Quality is obviously cheap — Phase 2+
 * should swap this out for a sampled kit.
 * ──────────────────────────────────────────────────────────────────────── */

export class SimpleDrumSynth {
  private bus: GainNode;
  private noiseBuffer: AudioBuffer;

  constructor(private ctx: AudioContext, masterGain = 0.9) {
    this.bus = ctx.createGain();
    this.bus.gain.value = masterGain;
    this.bus.connect(ctx.destination);

    // Pre-allocate a 1s white-noise buffer for drums that need noise.
    const len = Math.floor(ctx.sampleRate * 1.0);
    this.noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }

  setMasterGain(v: number) {
    this.bus.gain.value = v;
  }

  play(piece: DrumPiece, when: number, velocity: number): void {
    const v = Math.max(0, Math.min(1, velocity));
    switch (piece) {
      case "kick":          return this.kick(when, v);
      case "snare":         return this.snare(when, v);
      case "rim":           return this.rim(when, v);
      case "hihat-closed":  return this.hihatClosed(when, v);
      case "hihat-open":    return this.hihatOpen(when, v);
      case "hihat-foot":    return this.hihatFoot(when, v);
      case "ride":          return this.ride(when, v);
      case "ride-bell":     return this.rideBell(when, v);
      case "crash":         return this.crash(when, v);
      case "splash":        return this.splash(when, v);
      case "tom-low":       return this.tom(when, v, 110);
      case "tom-mid":       return this.tom(when, v, 160);
      case "tom-high":      return this.tom(when, v, 220);
    }
  }

  /* ── individual pieces ─────────────────────────────────────────────── */

  private kick(when: number, v: number) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(130, when);
    osc.frequency.exponentialRampToValueAtTime(42, when + 0.14);
    g.gain.setValueAtTime(v * 0.9, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.32);
    osc.connect(g).connect(this.bus);
    osc.start(when);
    osc.stop(when + 0.4);
  }

  private snare(when: number, v: number) {
    // Tone
    const osc = this.ctx.createOscillator();
    const og = this.ctx.createGain();
    osc.frequency.value = 200;
    og.gain.setValueAtTime(v * 0.35, when);
    og.gain.exponentialRampToValueAtTime(0.001, when + 0.1);
    osc.connect(og).connect(this.bus);
    osc.start(when);
    osc.stop(when + 0.12);

    // Noise
    const src = this.noiseSource();
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1200;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(v * 0.55, when);
    ng.gain.exponentialRampToValueAtTime(0.001, when + 0.18);
    src.connect(hp).connect(ng).connect(this.bus);
    src.start(when);
    src.stop(when + 0.22);
  }

  private rim(when: number, v: number) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    g.gain.setValueAtTime(v * 0.25, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.04);
    osc.connect(g).connect(this.bus);
    osc.start(when);
    osc.stop(when + 0.05);
  }

  private hihatBase(when: number, v: number, duration: number, gain: number) {
    const src = this.noiseSource();
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 7000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(v * gain, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + duration);
    src.connect(hp).connect(g).connect(this.bus);
    src.start(when);
    src.stop(when + duration + 0.02);
  }

  private hihatClosed(when: number, v: number) { this.hihatBase(when, v, 0.05, 0.2); }
  private hihatOpen(when: number, v: number)   { this.hihatBase(when, v, 0.2,  0.25); }
  private hihatFoot(when: number, v: number)   { this.hihatBase(when, v, 0.07, 0.18); }

  private ride(when: number, v: number) {
    // Metallic shimmer: filtered noise + bell partial
    const src = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 5500;
    bp.Q.value = 3;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(v * 0.18, when);
    ng.gain.exponentialRampToValueAtTime(0.001, when + 0.35);
    src.connect(bp).connect(ng).connect(this.bus);
    src.start(when);
    src.stop(when + 0.4);

    const bell = this.ctx.createOscillator();
    const bg = this.ctx.createGain();
    bell.type = "triangle";
    bell.frequency.value = 5200;
    bg.gain.setValueAtTime(v * 0.08, when);
    bg.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
    bell.connect(bg).connect(this.bus);
    bell.start(when);
    bell.stop(when + 0.22);
  }

  private rideBell(when: number, v: number) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 4400;
    g.gain.setValueAtTime(v * 0.2, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.3);
    osc.connect(g).connect(this.bus);
    osc.start(when);
    osc.stop(when + 0.35);
  }

  private crash(when: number, v: number) {
    const src = this.noiseSource();
    const hp = this.ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 3000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(v * 0.4, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 1.4);
    src.connect(hp).connect(g).connect(this.bus);
    src.start(when);
    src.stop(when + 1.5);
  }

  private splash(when: number, v: number) { this.crash(when, v * 0.7); }

  private tom(when: number, v: number, freq: number) {
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(freq * 1.5, when);
    osc.frequency.exponentialRampToValueAtTime(freq, when + 0.12);
    g.gain.setValueAtTime(v * 0.6, when);
    g.gain.exponentialRampToValueAtTime(0.001, when + 0.35);
    osc.connect(g).connect(this.bus);
    osc.start(when);
    osc.stop(when + 0.4);
  }

  /* ── utilities ─────────────────────────────────────────────────────── */

  private noiseSource(): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    return src;
  }
}
