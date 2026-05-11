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

  export class PitchShifter {
    constructor(context: AudioContext, buffer: AudioBuffer, bufferSize: number, onEnd?: () => void);
    tempo: number;
    rate: number;
    pitch: number;
    duration: number;
    sampleRate: number;
    connect(destination: AudioNode): void;
    disconnect(): void;
    on(event: string, cb: (e: unknown) => void): void;
    off(event: string, cb?: (e: unknown) => void): void;
  }
}
