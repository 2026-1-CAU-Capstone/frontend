/* Leading-pickup (anacrusis) handling for engine-path playback.
 *
 * When a lick/sheet opens with a pickup measure (fewer beats than the time
 * signature), the pickup notes should sound during the count-in's tail and the
 * main melody should land on the very next downbeat — no mid-phrase rest. The
 * engine otherwise pins every measure to a fixed bar grid (`mi * beatsPerBar`),
 * so a short pickup leaves a silent hole before the first real bar.
 *
 * This mirrors NoteSheet's proven sheet-playback handling, extracted so lick
 * playback (LickCard / LickRecommendMessage / LickInputPage / LickCreator) can
 * reuse it. Pitches come from extractMelody so they match the engine body
 * exactly (key signature, accidentals, ottava). */

import type { NoteSheetData, MeasureInfo } from '../../data/sampleMelody';
import type { AnacrusisNote } from '../player';
import { getBeats } from './melodyTiming';
import { PATTERN_SIMPLE, type Pattern } from './countInPatterns';
import { extractMelody } from '../backing/adapters/noteSheetToChart';

/** Playable beat-length of a measure (sum of note durations, rests included). */
function measureBeats(m: MeasureInfo): number {
  let beats = 0;
  for (const n of m.notes) {
    beats += getBeats(n.duration, n.dotted, n.tuplet, n.tupletNormal);
  }
  return beats;
}

/** True when the first measure is a leading pickup — fewer beats than the bar. */
export function hasLeadingAnacrusis(data: NoteSheetData): boolean {
  const m = data.measures[0];
  if (!m) return false;
  const tsNum = parseInt((data.timeSignature || '4/4').split('/')[0], 10) || 4;
  const fb = measureBeats(m);
  return !!(m.anacrusis || (fb > 0 && fb < tsNum - 0.001));
}

export interface AnacrusisPlan {
  /** Pickup notes to hand to player.scheduleAnacrusis(). */
  notes: AnacrusisNote[];
  /** Absolute player-ctx time of the downbeat after the count-in (play startAt). */
  songStart: number;
  /** Data with the pickup measure removed (play with measureOffset:1). */
  strippedData: NoteSheetData;
}

/** Build the schedule for sounding a leading pickup during the count-in tail.
 *  Assumes a ONE-BAR (tsNum-beat) count-in — lick playback forces bars:1.
 *  `ctxNow` is read from the player right before the count-in begins. */
export function planAnacrusis(data: NoteSheetData, tempo: number, ctxNow: number): AnacrusisPlan {
  const tsNum = parseInt((data.timeSignature || '4/4').split('/')[0], 10) || 4;
  const firstBeats = data.measures[0] ? measureBeats(data.measures[0]) : 0;
  const beatDur = 60 / tempo;
  const cinStart = ctxNow + 0.06; // mirrors useCountInIntro's internal click lead
  const pickupStart = cinStart + (tsNum - firstBeats) * beatDur;
  const songStart = cinStart + tsNum * beatDur; // downbeat after the 1-bar count-in
  // 이 플래너는 릭 재생 전용(prepareLickIntro) — explicit 임시표 의미론.
  const notes: AnacrusisNote[] = extractMelody(data, { accidentalStyle: 'explicit' })
    .filter((n) => n.srcMi === 0)
    .map((n) => ({
      pitch: n.midi,
      startAt: pickupStart + n.beatOffset * beatDur,
      durationSec: Math.max(n.durationBeats * beatDur * 0.9, 0.04),
    }));
  return { notes, songStart, strippedData: { ...data, measures: data.measures.slice(1) } };
}

/* ── lick intro orchestration ─────────────────────────────────────────── */

interface IntroPlayer {
  ctxNow(): number;
  scheduleAnacrusis(notes: AnacrusisNote[]): void;
  cancelAnacrusis(): void;
}
interface IntroCountIn {
  run(opts: {
    bpm: number; pattern?: Pattern; bars?: number; forceEnabled?: boolean; prepare?: Promise<unknown>;
  }): Promise<{ ok: boolean; downbeatInSec: number }>;
}

export interface LickIntroResult {
  ok: boolean;
  /** Data to play — pickup measure stripped when there's a leading anacrusis. */
  data: NoteSheetData;
  /** Options for player.play(). */
  opts: { startAt?: number; measureOffset?: number; downbeatInSec?: number };
}

/**
 * Run the lick count-in (always one bar of "1 2 3 4") and, when the lick opens
 * with a leading pickup, sound those notes during the count-in tail and strip
 * the pickup measure so the main melody starts right on the downbeat — no
 * mid-phrase rest. Returns the data + options to hand to player.play().
 * Wire playback subscriptions AFTER this resolves (ok), BEFORE play().
 */
export async function prepareLickIntro(
  player: IntroPlayer,
  countIn: IntroCountIn,
  data: NoteSheetData,
  bpm: number,
  preload?: Promise<unknown>,
): Promise<LickIntroResult> {
  if (hasLeadingAnacrusis(data)) {
    // Pickup notes sound during the count-in, so instruments must be loaded first.
    if (preload) { try { await preload; } catch { /* play() reloads on demand */ } }
    const plan = planAnacrusis(data, bpm, player.ctxNow());
    player.scheduleAnacrusis(plan.notes);
    const cin = await countIn.run({ bpm, pattern: PATTERN_SIMPLE, bars: 1, forceEnabled: true });
    if (!cin.ok) { player.cancelAnacrusis(); return { ok: false, data, opts: {} }; }
    return { ok: true, data: plan.strippedData, opts: { startAt: plan.songStart, measureOffset: 1 } };
  }
  const cin = await countIn.run({ bpm, pattern: PATTERN_SIMPLE, bars: 1, forceEnabled: true, prepare: preload });
  if (!cin.ok) return { ok: false, data, opts: {} };
  return { ok: true, data, opts: { downbeatInSec: cin.downbeatInSec } };
}
