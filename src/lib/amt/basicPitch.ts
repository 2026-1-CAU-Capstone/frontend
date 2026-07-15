import { buildBassNoteSheet, type TimedNote } from './notesToNoteSheet';
import type { NoteSheetData } from '../../data/sampleMelody';

/* ─────────────────────────────────────────────────────────────────────────
 * Browser AMT for bass, powered by Spotify Basic Pitch (@spotify/basic-pitch)
 * running on TensorFlow.js — no backend. Given an uploaded audio file and an
 * in/out trim, it decodes the region to 22050 Hz mono, runs the model, gates
 * the output to the bass register, reduces to a monophonic line, and returns
 * a NoteSheetData for the VexFlow NoteSheet.
 *
 * Basic Pitch is instrument-agnostic, not jazz-specialised; the bass-range
 * gating + monophonic reduction here are what tailor it to a bass part. A
 * jazz-specialised model (Abeßer BassUNet / CREPE Notes) would slot in behind
 * the same TimedNote[] → buildBassNoteSheet() boundary.
 * ──────────────────────────────────────────────────────────────────────── */

const MODEL_URL = `${import.meta.env.BASE_URL}models/basic-pitch/model.json`;

// Bass register gate (Hz) passed to the model, and the MIDI clamp after.
const MIN_FREQ = 40;   // ~E1
const MAX_FREQ = 350;  // ~F4 (headroom for bass solos)
const MIN_MIDI = 24;   // C1
const MAX_MIDI = 60;   // C4

// Basic Pitch's BasicPitch class is loaded lazily (pulls in tfjs) and reused.
let bpInstance: import('@spotify/basic-pitch').BasicPitch | null = null;
async function getBasicPitch() {
  if (!bpInstance) {
    const { BasicPitch } = await import('@spotify/basic-pitch');
    bpInstance = new BasicPitch(MODEL_URL);
  }
  return bpInstance;
}

/** Decode `file`, slice [startSec, endSec], resample to 22050 Hz mono.
 *  `bassFocus` inserts a gentle low-pass (≈500 Hz) so mid/high instruments in
 *  a full mix are attenuated before transcription; harmless on an already-
 *  isolated bass (whose energy sits below the cutoff). */
async function decodeTrimmedMono22k(
  file: File,
  startSec: number,
  endSec: number,
  bassFocus: boolean,
): Promise<AudioBuffer> {
  const arrayBuf = await file.arrayBuffer();
  const ac = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await ac.decodeAudioData(arrayBuf);
  } finally {
    void ac.close();
  }
  const SR = 22050;
  const dur = Math.max(0, endSec - startSec);
  const frameCount = Math.max(1, Math.ceil(dur * SR));
  const off = new OfflineAudioContext(1, frameCount, SR);
  const src = off.createBufferSource();
  src.buffer = decoded;
  if (bassFocus) {
    const lp = off.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    lp.Q.value = 0.7;
    src.connect(lp);
    lp.connect(off.destination);
  } else {
    src.connect(off.destination);
  }
  src.start(0, startSec, dur);
  return off.startRendering();
}

/** Run Basic Pitch and return bass-gated, monophonic note events. */
async function transcribeBuffer(
  buffer: AudioBuffer,
  opts: { onsetThreshold: number; minNoteLenFrames: number },
  onProgress?: (pct: number) => void,
): Promise<TimedNote[]> {
  const bp = await getBasicPitch();
  const { outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } = await import('@spotify/basic-pitch');

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];
  await bp.evaluateModel(
    buffer,
    (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); },
    (p) => onProgress?.(p),
  );

  // outputToNotesPoly(frames, onsets, onsetThresh, frameThresh, minNoteLen,
  //                   inferOnsets, maxFreq, minFreq, melodiaTrick)
  const poly = outputToNotesPoly(frames, onsets, opts.onsetThreshold, 0.3, opts.minNoteLenFrames, true, MAX_FREQ, MIN_FREQ, true);
  const timed = noteFramesToTime(addPitchBendsToNoteEvents(contours, poly));

  // Clamp to the bass MIDI range, then enforce a single voice: sort by onset
  // and truncate any note that overlaps the next one.
  const bass = timed
    .filter((n) => n.pitchMidi >= MIN_MIDI && n.pitchMidi <= MAX_MIDI)
    .map((n) => ({ startTimeSeconds: n.startTimeSeconds, durationSeconds: n.durationSeconds, pitchMidi: n.pitchMidi }))
    .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);
  for (let i = 0; i < bass.length - 1; i++) {
    const end = bass[i].startTimeSeconds + bass[i].durationSeconds;
    if (end > bass[i + 1].startTimeSeconds) {
      bass[i].durationSeconds = Math.max(0, bass[i + 1].startTimeSeconds - bass[i].startTimeSeconds);
    }
  }
  return bass.filter((n) => n.durationSeconds > 0.03);
}

export interface TranscribeResult {
  noteCount: number;
  sheet: NoteSheetData;
  notes: TimedNote[];
}

export interface TranscribeOptions {
  bpm: number;
  timeSignature: string;
  title: string;
  key: string;
  /** Low-pass the input to suppress non-bass instruments (default true). */
  bassFocus?: boolean;
  /** Onset sensitivity 0..1 (lower = more notes). Default 0.5. */
  onsetThreshold?: number;
  /** Minimum note length in model frames (higher = drop short blips). Default 11. */
  minNoteLenFrames?: number;
  /** Per-bar chord labels to overlay on the result. */
  barChords?: string[];
}

/** End-to-end: uploaded file + trim + metadata → transcription sheet. */
export async function transcribeFileToSheet(
  file: File,
  startSec: number,
  endSec: number,
  opts: TranscribeOptions,
  onProgress?: (pct: number) => void,
): Promise<TranscribeResult> {
  const buffer = await decodeTrimmedMono22k(file, startSec, endSec, opts.bassFocus ?? true);
  const notes = await transcribeBuffer(
    buffer,
    { onsetThreshold: opts.onsetThreshold ?? 0.5, minNoteLenFrames: opts.minNoteLenFrames ?? 11 },
    onProgress,
  );
  const sheet = buildBassNoteSheet(notes, {
    bpm: opts.bpm,
    timeSignature: opts.timeSignature,
    title: opts.title,
    key: opts.key,
    barChords: opts.barChords,
  });
  return { noteCount: notes.length, sheet, notes };
}
