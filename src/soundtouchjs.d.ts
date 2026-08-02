/**
 * Minimal ambient declaration for soundtouchjs — the package ships no types.
 * We only use the offline-processing API (SoundTouch + SimpleFilter +
 * WebAudioBufferSource) from src/lib/backing/timeStretch.ts.
 */
declare module 'soundtouchjs' {
  export class SoundTouch {
    tempo: number;
    rate: number;
    pitch: number;
    inputBuffer: { putSamples(samples: Float32Array, position: number, numFrames: number): void; clear(): void };
    process(): void;
  }

  export class WebAudioBufferSource {
    constructor(buffer: AudioBuffer);
    buffer: AudioBuffer;
    position: number;
    readonly dualChannel: boolean;
    extract(target: Float32Array, numFrames?: number, position?: number): number;
  }

  export class SimpleFilter {
    constructor(sourceSound: WebAudioBufferSource, pipe: SoundTouch, callback?: () => void);
    position: number;
    sourcePosition: number;
    extract(target: Float32Array, numFrames: number): number;
    clear(): void;
  }

  export interface PitchShifterPlayDetail {
    timePlayed: number;
    formattedTimePlayed: string;
    /** 0~100 (getter 스케일) */
    percentagePlayed: number;
  }

  export class PitchShifter {
    constructor(context: AudioContext, buffer: AudioBuffer, bufferSize: number, onEnd?: () => void);
    tempo: number;
    rate: number;
    pitch: number;
    /** 소수 허용(0.5 = 50센트). setter 전용. */
    pitchSemitones: number;
    /** ⚠ getter 는 0~100, setter 는 0~1 스케일 (soundtouchjs 상류 비대칭). */
    percentagePlayed: number;
    timePlayed: number;
    duration: number;
    sampleRate: number;
    readonly node: AudioNode;
    connect(destination: AudioNode): void;
    disconnect(): void;
    on(event: 'play', cb: (detail: PitchShifterPlayDetail) => void): void;
    off(event?: string): void;
  }
}
