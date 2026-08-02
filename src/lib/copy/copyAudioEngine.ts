/* ─────────────────────────────────────────────────────────────────────────
 * CopyAudioEngine — 카피하기(느린 재생 연습)용 실시간 오디오 엔진.
 *
 * Amazing Slow Downer 의 파일 재생 기능을 그대로 목표로 한다:
 *   · 속도 25~200% (피치 유지, 재생 중 즉시 반영)  — SoundTouchJS PitchShifter
 *   · 피치 ±12반음 + 센트 미세조정 (속도와 독립)
 *   · A-B 루프 (재생 중 심리스 점프, 반복 횟수 카운트)
 *   · 루프 반복마다 속도 자동 증감 (반복 연습용)
 *   · EQ 저음/고음 셸프, 채널 믹스(스테레오/왼쪽/오른쪽/가운데 제거), 밸런스, 볼륨
 *
 * 그래프:
 *   PitchShifter(ScriptProcessor) → input → splitter ─ gA(+)/gB(±) ─ merger
 *     → panner(밸런스) → lowshelf → highshelf → volume → destination
 *
 * PitchShifter 상류 주의점 (soundtouchjs 0.3):
 *   · percentagePlayed 는 getter 0~100 / setter 0~1 스케일 비대칭.
 *   · 'play' 이벤트는 오디오 프로세스 블록마다 발화(≈23ms@1024) — 루프 판정 해상도.
 * ──────────────────────────────────────────────────────────────────────── */

import { PitchShifter } from 'soundtouchjs';

export type MixMode = 'stereo' | 'left' | 'right' | 'karaoke';

export interface LoopRegion {
  on: boolean;
  a: number;
  b: number;
}

/** 루프가 한 바퀴 돌 때마다 속도를 바꾸는 옵션 (ASD "Speed Up or Down after each Loop"). */
export interface LoopAdvance {
  on: boolean;
  /** 반복당 속도 증감 (% 포인트, 음수 가능) */
  stepPct: number;
  /** 이 속도(%)에 도달하면 더 바꾸지 않음 */
  limitPct: number;
}

export interface EngineCallbacks {
  /** 재생 위치 갱신 (초) — 오디오 블록마다 */
  onTick?: (sec: number) => void;
  /** 곡 끝 도달로 정지했을 때 */
  onEnded?: () => void;
  /** A-B 루프가 한 바퀴 돌았을 때 (자동 증가 반영 후) */
  onLoopWrap?: (loopCount: number, tempoPct: number) => void;
}

export const TEMPO_MIN_PCT = 25;
export const TEMPO_MAX_PCT = 200;

const BUFFER_SIZE = 1024; // ≈23ms @44.1k — 루프 점프 정밀도와 CPU 의 균형

export class CopyAudioEngine {
  private ctx: AudioContext;
  private shifter: PitchShifter | null = null;
  private buffer: AudioBuffer | null = null;

  /* 고정 체인 노드 (파일 로드와 무관하게 재사용) */
  private input: GainNode;
  private splitter: ChannelSplitterNode;
  private gA: GainNode;
  private gB: GainNode;
  private merger: ChannelMergerNode;
  private panner: StereoPannerNode;
  private low: BiquadFilterNode;
  private high: BiquadFilterNode;
  private volumeNode: GainNode;

  private cb: EngineCallbacks;

  playing = false;
  duration = 0;
  loopCount = 0;

  private tempoPctValue = 100;
  private semitonesValue = 0;
  private centsValue = 0;
  private mixModeValue: MixMode = 'stereo';
  loop: LoopRegion = { on: false, a: 0, b: 0 };
  advance: LoopAdvance = { on: false, stepPct: 2, limitPct: 100 };

  constructor(callbacks: EngineCallbacks = {}) {
    this.cb = callbacks;
    this.ctx = new AudioContext();

    this.input = this.ctx.createGain();
    this.splitter = this.ctx.createChannelSplitter(2);
    this.gA = this.ctx.createGain();
    this.gB = this.ctx.createGain();
    this.merger = this.ctx.createChannelMerger(2);
    this.panner = this.ctx.createStereoPanner();
    this.low = this.ctx.createBiquadFilter();
    this.low.type = 'lowshelf';
    this.low.frequency.value = 250;
    this.high = this.ctx.createBiquadFilter();
    this.high.type = 'highshelf';
    this.high.frequency.value = 4000;
    this.volumeNode = this.ctx.createGain();

    this.input.connect(this.splitter);
    this.splitter.connect(this.gA, 0);
    this.splitter.connect(this.gB, 1);
    this.applyMixRouting();
    this.merger.connect(this.panner);
    this.panner.connect(this.low);
    this.low.connect(this.high);
    this.high.connect(this.volumeNode);
    this.volumeNode.connect(this.ctx.destination);
  }

  /* ── 로드 ─────────────────────────────────────────────────────────── */

  async load(data: ArrayBuffer): Promise<void> {
    this.stopShifter();
    const decoded = await this.ctx.decodeAudioData(data);
    // 모노 파일은 스테레오로 복제 — splitter 기반 믹스 라우팅이 2채널을 전제한다.
    this.buffer = decoded.numberOfChannels >= 2 ? decoded : this.monoToStereo(decoded);
    this.duration = this.buffer.duration;
    this.loopCount = 0;
    this.createShifter(0);
  }

  private monoToStereo(mono: AudioBuffer): AudioBuffer {
    const out = this.ctx.createBuffer(2, mono.length, mono.sampleRate);
    const ch = mono.getChannelData(0);
    out.getChannelData(0).set(ch);
    out.getChannelData(1).set(ch);
    return out;
  }

  /** PitchShifter 는 파괴/재생성이 안전한 유일한 리셋 수단 (곡 끝 onEnd 이후 등). */
  private createShifter(startSec: number) {
    if (!this.buffer) return;
    this.stopShifter();
    const shifter = new PitchShifter(this.ctx, this.buffer, BUFFER_SIZE, () => this.handleEnded());
    this.shifter = shifter;
    shifter.tempo = this.tempoPctValue / 100;
    shifter.pitchSemitones = this.semitonesValue + this.centsValue / 100;
    if (startSec > 0) shifter.percentagePlayed = startSec / this.duration;
    shifter.on('play', (detail) => this.handlePlayTick(detail.percentagePlayed));
  }

  private stopShifter() {
    if (this.shifter) {
      try { this.shifter.disconnect(); } catch { /* 연결 안 된 상태 */ }
      this.shifter.off();
      this.shifter = null;
    }
    this.playing = false;
  }

  /* ── 재생 제어 ────────────────────────────────────────────────────── */

  play() {
    if (!this.shifter || this.playing) return;
    void this.ctx.resume();
    // 곡 끝에서 재생을 누르면 처음(루프 중이면 A)부터.
    const pos = this.getPosition();
    if (pos >= this.duration - 0.05) {
      this.seek(this.loop.on ? this.loop.a : 0);
    }
    this.shifter.connect(this.input);
    this.playing = true;
  }

  pause() {
    if (!this.shifter || !this.playing) return;
    this.shifter.disconnect();
    this.playing = false;
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(sec: number) {
    if (!this.shifter || this.duration <= 0) return;
    const clamped = Math.min(Math.max(0, sec), this.duration);
    this.shifter.percentagePlayed = clamped / this.duration; // setter 는 0~1
    if (!this.playing) this.cb.onTick?.(clamped);
  }

  getPosition(): number {
    if (!this.shifter || this.duration <= 0) return 0;
    return (this.shifter.percentagePlayed / 100) * this.duration; // getter 는 0~100
  }

  private handleEnded() {
    // 루프가 곡 끝까지 걸려 있으면 끊김 없이 A 로 되감아 계속 재생.
    if (this.playing && this.loop.on && this.loop.b >= this.duration - 0.1) {
      this.wrapLoop();
      return;
    }
    const wasPlaying = this.playing;
    // onEnd 후 필터가 소진되므로 처음 위치로 새로 만들어 둔다.
    this.createShifter(0);
    this.cb.onTick?.(0);
    if (wasPlaying) this.cb.onEnded?.();
  }

  private handlePlayTick(percentage: number) {
    const sec = (percentage / 100) * this.duration;
    if (this.playing && this.loop.on && this.loop.b > this.loop.a + 0.05 && sec >= this.loop.b) {
      this.wrapLoop();
      return;
    }
    this.cb.onTick?.(sec);
  }

  private wrapLoop() {
    this.loopCount += 1;
    if (this.advance.on && this.advance.stepPct !== 0) {
      const target = this.advance.limitPct;
      const next = this.tempoPctValue + this.advance.stepPct;
      const clamped = this.advance.stepPct > 0 ? Math.min(next, target) : Math.max(next, target);
      this.setTempoPct(clamped);
    }
    this.seek(this.loop.a);
    this.cb.onLoopWrap?.(this.loopCount, this.tempoPctValue);
    this.cb.onTick?.(this.loop.a);
  }

  /* ── 파라미터 ─────────────────────────────────────────────────────── */

  setTempoPct(pct: number) {
    this.tempoPctValue = Math.min(Math.max(TEMPO_MIN_PCT, Math.round(pct)), TEMPO_MAX_PCT);
    if (this.shifter) this.shifter.tempo = this.tempoPctValue / 100;
  }

  get tempoPct() { return this.tempoPctValue; }

  setPitch(semitones: number, cents: number) {
    this.semitonesValue = Math.min(Math.max(-12, semitones), 12);
    this.centsValue = Math.min(Math.max(-50, cents), 50);
    if (this.shifter) this.shifter.pitchSemitones = this.semitonesValue + this.centsValue / 100;
  }

  setLoop(loop: LoopRegion) {
    this.loop = { ...loop };
    if (!loop.on) this.loopCount = 0;
  }

  setAdvance(adv: LoopAdvance) {
    this.advance = { ...adv };
  }

  setMixMode(mode: MixMode) {
    this.mixModeValue = mode;
    this.applyMixRouting();
  }

  private applyMixRouting() {
    this.gA.disconnect();
    this.gB.disconnect();
    this.gA.gain.value = 1;
    this.gB.gain.value = 1;
    switch (this.mixModeValue) {
      case 'stereo':
        this.gA.connect(this.merger, 0, 0);
        this.gB.connect(this.merger, 0, 1);
        break;
      case 'left':
        this.gA.connect(this.merger, 0, 0);
        this.gA.connect(this.merger, 0, 1);
        break;
      case 'right':
        this.gB.connect(this.merger, 0, 0);
        this.gB.connect(this.merger, 0, 1);
        break;
      case 'karaoke':
        // 가운데(보컬/멜로디) 상쇄: 각 채널 = 0.7·L − 0.7·R.
        // 베이스·드럼 같은 센터 악기도 함께 줄어드는 것은 원리상 한계 — EQ 로 보정.
        this.gA.gain.value = 0.7;
        this.gB.gain.value = -0.7;
        this.gA.connect(this.merger, 0, 0);
        this.gA.connect(this.merger, 0, 1);
        this.gB.connect(this.merger, 0, 0);
        this.gB.connect(this.merger, 0, 1);
        break;
    }
  }

  /** -1(왼쪽)~+1(오른쪽) */
  setBalance(v: number) {
    this.panner.pan.value = Math.min(Math.max(-1, v), 1);
  }

  /** dB, -15~+15 */
  setEq(lowDb: number, highDb: number) {
    this.low.gain.value = Math.min(Math.max(-15, lowDb), 15);
    this.high.gain.value = Math.min(Math.max(-15, highDb), 15);
  }

  /** 0~1 */
  setVolume(v: number) {
    this.volumeNode.gain.value = Math.min(Math.max(0, v), 1.5);
  }

  /** 파형 그리기용 원본 버퍼 */
  getBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  destroy() {
    this.stopShifter();
    this.buffer = null;
    void this.ctx.close().catch(() => undefined);
  }
}
