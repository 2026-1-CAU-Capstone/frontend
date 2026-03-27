declare module 'soundfont-player' {
  interface Player {
    play(note: string | number, when?: number, opts?: PlayOptions): AudioNode;
    stop(): void;
    schedule(when: number, events: Array<{ note: string | number; time?: number; duration?: number; gain?: number }>): void;
  }

  interface PlayOptions {
    duration?: number;
    gain?: number;
    attack?: number;
    decay?: number;
    sustain?: number;
    release?: number;
  }

  type InstrumentName = string;

  interface InstrumentOptions {
    gain?: number;
    attack?: number;
    decay?: number;
    sustain?: number;
    release?: number;
    soundfont?: string;
  }

  function instrument(
    ac: AudioContext,
    name: InstrumentName,
    opts?: InstrumentOptions,
  ): Promise<Player>;

  export { Player, InstrumentName, InstrumentOptions, PlayOptions };
  export default { instrument };
}
