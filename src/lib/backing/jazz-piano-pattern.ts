/**
 * Jazz piano comping pattern lifted from JJazzLab's LGPL-bundled
 * JJSwing/psBase.sst (Main_A channel 0).
 *
 * Recorded against: pc=0 (C) M7
 * Pattern length: 32 beats = 8 bars (ppq 1920 )
 * Notes: 52
 */
export interface PianoPatternNote {
  /** Tick from pattern start. Pattern resolution = ticksPerQuarter. */
  tick: number;
  pitch: number;
  velocity: number;
  durationTicks: number;
}

export const PSBASE_CH0_PATTERN = {
  sourceChordRootRelPitch: 0,
  sourceChordTypeName: 'M7' as const,
  sizeInBeats: 32,
  ticksPerQuarter: 1920,
  notes: [
    { tick: 0, pitch: 55, velocity: 75, durationTicks: 3780 },
    { tick: 0, pitch: 59, velocity: 69, durationTicks: 3704 },
    { tick: 0, pitch: 64, velocity: 75, durationTicks: 3712 },
    { tick: 5200, pitch: 55, velocity: 75, durationTicks: 320 },
    { tick: 5200, pitch: 59, velocity: 67, durationTicks: 320 },
    { tick: 5200, pitch: 64, velocity: 65, durationTicks: 320 },
    { tick: 7700, pitch: 55, velocity: 60, durationTicks: 540 },
    { tick: 7700, pitch: 59, velocity: 60, durationTicks: 492 },
    { tick: 7700, pitch: 64, velocity: 70, durationTicks: 540 },
    { tick: 12884, pitch: 64, velocity: 82, durationTicks: 348 },
    { tick: 12888, pitch: 55, velocity: 68, durationTicks: 320 },
    { tick: 12900, pitch: 59, velocity: 64, durationTicks: 320 },
    { tick: 15380, pitch: 55, velocity: 62, durationTicks: 2772 },
    { tick: 15380, pitch: 59, velocity: 70, durationTicks: 2820 },
    { tick: 15380, pitch: 64, velocity: 64, durationTicks: 2824 },
    { tick: 18640, pitch: 59, velocity: 85, durationTicks: 372 },
    { tick: 18644, pitch: 55, velocity: 66, durationTicks: 320 },
    { tick: 18644, pitch: 64, velocity: 74, durationTicks: 320 },
    { tick: 18660, pitch: 67, velocity: 66, durationTicks: 320 },
    { tick: 28228, pitch: 55, velocity: 70, durationTicks: 320 },
    { tick: 28228, pitch: 59, velocity: 85, durationTicks: 320 },
    { tick: 28228, pitch: 67, velocity: 78, durationTicks: 320 },
    { tick: 28240, pitch: 64, velocity: 74, durationTicks: 320 },
    { tick: 30720, pitch: 55, velocity: 60, durationTicks: 6600 },
    { tick: 30720, pitch: 64, velocity: 72, durationTicks: 6588 },
    { tick: 30724, pitch: 59, velocity: 60, durationTicks: 6580 },
    { tick: 38400, pitch: 55, velocity: 60, durationTicks: 2644 },
    { tick: 38400, pitch: 59, velocity: 72, durationTicks: 2720 },
    { tick: 38400, pitch: 64, velocity: 74, durationTicks: 2688 },
    { tick: 38404, pitch: 67, velocity: 60, durationTicks: 2592 },
    { tick: 41660, pitch: 55, velocity: 74, durationTicks: 320 },
    { tick: 41660, pitch: 64, velocity: 84, durationTicks: 404 },
    { tick: 41668, pitch: 59, velocity: 74, durationTicks: 320 },
    { tick: 41680, pitch: 67, velocity: 60, durationTicks: 320 },
    { tick: 46100, pitch: 71, velocity: 78, durationTicks: 2744 },
    { tick: 46104, pitch: 67, velocity: 74, durationTicks: 2744 },
    { tick: 46108, pitch: 59, velocity: 64, durationTicks: 2744 },
    { tick: 46108, pitch: 64, velocity: 60, durationTicks: 2744 },
    { tick: 49360, pitch: 59, velocity: 82, durationTicks: 320 },
    { tick: 49364, pitch: 67, velocity: 72, durationTicks: 320 },
    { tick: 49368, pitch: 64, velocity: 60, durationTicks: 320 },
    { tick: 55104, pitch: 59, velocity: 80, durationTicks: 320 },
    { tick: 55104, pitch: 64, velocity: 82, durationTicks: 320 },
    { tick: 55108, pitch: 55, velocity: 64, durationTicks: 320 },
    { tick: 57600, pitch: 59, velocity: 82, durationTicks: 908 },
    { tick: 57604, pitch: 64, velocity: 70, durationTicks: 1024 },
    { tick: 57604, pitch: 67, velocity: 72, durationTicks: 844 },
    { tick: 57608, pitch: 55, velocity: 60, durationTicks: 844 },
    { tick: 58944, pitch: 59, velocity: 74, durationTicks: 380 },
    { tick: 58944, pitch: 67, velocity: 66, durationTicks: 320 },
    { tick: 58960, pitch: 55, velocity: 68, durationTicks: 320 },
    { tick: 58960, pitch: 64, velocity: 74, durationTicks: 320 },
  ] as readonly PianoPatternNote[],
} as const;
