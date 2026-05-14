/**
 * 3-tier lick matching with automatic transposition:
 *   Tier 1: Same song title
 *   Tier 2: Same tonal key
 *   Tier 3: Any key matching the chord pattern → transposed to target key
 */

import type { LickEntry } from '../data/lickData';
import type { MeasureInfo, NoteInfo } from '../data/sampleMelody';
import type { ChordOverlay } from '../data/types';

/* ── pitch constants ─────────────────────────────────────────────────────── */

const NOTE_TO_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
  c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11,
};

const PC_TO_FLAT  = ['c', 'db', 'd', 'eb', 'e', 'f', 'gb', 'g', 'ab', 'a', 'bb', 'b'];
const PC_TO_SHARP = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];

// Keys that prefer flats (pitch class of tonic)
const FLAT_TONIC_PCS = new Set([0, 5, 10, 3, 8, 1, 6]); // C F Bb Eb Ab Db Gb

function useFlatsForPc(pc: number): boolean {
  return FLAT_TONIC_PCS.has(pc);
}

/* ── root PC extraction ──────────────────────────────────────────────────── */

/** "Eb-maj" | "F-min" | "Bb7" | "G-7" | "F♭△7" → pitch class 0-11 */
function rootPc(s: string): number {
  const m = s.match(/^([A-G])[♭b]?/i);
  if (!m) return 0;
  const base = NOTE_TO_PC[m[0][0].toUpperCase()] ?? 0;
  const acc = s[1];
  if (acc === 'b' || acc === '♭') return (base - 1 + 12) % 12;
  if (acc === '#' || acc === '♯') return (base + 1) % 12;
  return base;
}

/** "Eb-maj" → "Eb" */
function extractKeyRoot(key: string): string {
  return key.split('-')[0].split(' ')[0];
}

/* ── chord transposition ─────────────────────────────────────────────────── */

/** Transpose a chord label string like "G-7", "Dh7", "C-7" by N semitones */
function transposeChordLabel(chord: string, semitones: number, useFlats: boolean): string {
  if (!chord || semitones === 0) return chord;
  const m = chord.match(/^([A-G])([b#]?)(.*)$/);
  if (!m) return chord;
  const [, letter, acc, quality] = m;
  const pc = NOTE_TO_PC[letter] ?? 0;
  const midiPc = ((pc + (acc === '#' ? 1 : acc === 'b' ? -1 : 0)) + 12) % 12;
  const newPc = (midiPc + semitones + 12) % 12;
  const name = useFlats ? PC_TO_FLAT[newPc] : PC_TO_SHARP[newPc];
  return name[0].toUpperCase() + (name.length > 1 ? name[1] : '') + quality;
}

/* ── sheetData transposition ─────────────────────────────────────────────── */

function transposeMeasures(measures: MeasureInfo[], semitones: number, useFlats: boolean): MeasureInfo[] {
  return measures.map((measure) => ({
    ...measure,
    chord: measure.chord ? transposeChordLabel(measure.chord, semitones, useFlats) : measure.chord,
    notes: measure.notes.map((note) => {
      if (note.duration.endsWith('r')) return note; // rest: no change

      const newKeys: string[] = [];
      const accMap: Record<string, 'b' | '#'> = {};

      for (let ki = 0; ki < note.keys.length; ki++) {
        const parts = note.keys[ki].split('/');
        const letter = parts[0][0].toLowerCase();
        const octave = parseInt(parts[1] ?? '4', 10);
        const acc = note.accidentals?.[ki] as 'b' | '#' | undefined;

        const pc = NOTE_TO_PC[letter] ?? 0;
        const adjPc = ((pc + (acc === '#' ? 1 : acc === 'b' ? -1 : 0)) + 12) % 12;
        const midi = (octave + 1) * 12 + adjPc;
        const newMidi = midi + semitones;
        const newOctave = Math.floor(newMidi / 12) - 1;
        const newPc = ((newMidi % 12) + 12) % 12;

        const name = useFlats ? PC_TO_FLAT[newPc] : PC_TO_SHARP[newPc];
        if (name.length === 1) {
          newKeys.push(`${name}/${newOctave}`);
        } else {
          newKeys.push(`${name[0]}/${newOctave}`);
          accMap[ki] = name[1] as 'b' | '#';
        }
      }

      return {
        ...note,
        keys: newKeys,
        accidentals: Object.keys(accMap).length > 0 ? accMap : undefined,
      };
    }),
  }));
}

/* ── octave range adjustment ─────────────────────────────────────────────── */

// Treble-staff readability bounds (MIDI). Anything above HIGH gets dropped an
// octave; anything below LOW gets raised. Values picked to keep notes within
// ~1 ledger above (A5) and ~2 ledger below (G3) the staff in typical cases.
const OCTAVE_HIGH = 81; // A5
const OCTAVE_LOW = 55;  // G3

function noteMidis(note: NoteInfo): number[] {
  if (note.duration.endsWith('r')) return [];
  return note.keys.map((key, ki) => {
    const [letterPart, octStr] = key.split('/');
    const letter = letterPart[0].toLowerCase();
    const pc = NOTE_TO_PC[letter] ?? 0;
    const acc = note.accidentals?.[ki] as 'b' | '#' | undefined;
    const adjPc = ((pc + (acc === '#' ? 1 : acc === 'b' ? -1 : 0)) + 12) % 12;
    return (parseInt(octStr ?? '4', 10) + 1) * 12 + adjPc;
  });
}

function shiftMeasuresOctave(measures: MeasureInfo[], octaves: number): MeasureInfo[] {
  if (octaves === 0) return measures;
  return measures.map((m) => ({
    ...m,
    notes: m.notes.map((n) => {
      if (n.duration.endsWith('r')) return n;
      return {
        ...n,
        keys: n.keys.map((k) => {
          const [letter, octStr] = k.split('/');
          return `${letter}/${parseInt(octStr ?? '4', 10) + octaves}`;
        }),
      };
    }),
  }));
}

/**
 * 이조로 음표가 너무 높거나 낮아진 경우 한 옥타브 단위로 보정.
 * - 최고음이 OCTAVE_HIGH(A5) 초과 → 한 옥타브 낮춤
 * - 최저음이 OCTAVE_LOW(G3) 미만 → 한 옥타브 높임
 * 양쪽 모두 위반하면(릭의 음역이 보정 가능 범위보다 넓음) 보정 생략.
 */
function fitOctaveRange(measures: MeasureInfo[]): MeasureInfo[] {
  const all: number[] = [];
  for (const m of measures) for (const n of m.notes) all.push(...noteMidis(n));
  if (all.length === 0) return measures;

  let max = Math.max(...all);
  let min = Math.min(...all);
  let shift = 0;

  while (max > OCTAVE_HIGH && (min - 12) >= OCTAVE_LOW) {
    max -= 12; min -= 12; shift -= 1;
  }
  while (min < OCTAVE_LOW && (max + 12) <= OCTAVE_HIGH) {
    max += 12; min += 12; shift += 1;
  }

  return shiftMeasuresOctave(measures, shift);
}

/** Return a new LickEntry transposed by `semitones`. If 0, returns original. */
function transposeLick(lick: LickEntry, semitones: number): LickEntry {
  if (semitones === 0) return lick;

  const targetPc = (rootPc(lick.key) + semitones + 12) % 12;
  const uf = useFlatsForPc(targetPc);

  const newRootName = uf ? PC_TO_FLAT[targetPc] : PC_TO_SHARP[targetPc];
  const newKeyRoot = newRootName[0].toUpperCase() + (newRootName.length > 1 ? newRootName[1] : '');
  const isMinor = lick.key.toLowerCase().includes('min') || lick.key.includes('-min');
  const newKey = `${newKeyRoot}-${isMinor ? 'min' : 'maj'}`;

  const transposed = transposeMeasures(lick.sheetData.measures, semitones, uf);
  const fitted = fitOctaveRange(transposed);

  return {
    ...lick,
    key: newKey,
    chords: lick.chords.map((c) => transposeChordLabel(c, semitones, uf)),
    sheetData: {
      ...lick.sheetData,
      measures: fitted,
    },
  };
}

/* ── chord quality normalization ─────────────────────────────────────────── */

type ChordType = 'maj7' | 'm7' | 'dom7' | 'm7b5' | 'dim7' | 'dim' | 'aug' | 'maj' | 'm' | 'other';

function classifyChordSymbol(sym: string): ChordType {
  const q = sym.trim().replace(/^[A-G][♭♯b#]?/, '').toLowerCase();
  if (/^(maj7|△7|Δ7|\^7|M7|-?△7)/.test(q)) return 'maj7';
  if (/^(-7b5|m7b5|ø7|h7|min7b5)/.test(q)) return 'm7b5';
  if (/^(dim7|°7|o7)/.test(q)) return 'dim7';
  if (/^(dim|°|o)(?!7)/.test(q)) return 'dim';
  if (/^(-7|m7|min7)/.test(q)) return 'm7';
  if (/^7/.test(q)) return 'dom7';
  if (/^(-|m|min)(?!a)/.test(q)) return 'm';
  if (q === '' || /^(maj|△|Δ|\^)(?!7)/.test(q)) return 'maj';
  return 'other';
}

function classifyLickChord(raw: string): ChordType {
  if (!raw) return 'other';
  const s = raw.replace(/^[A-G][b#]?/, '').toLowerCase();
  if (/^j7/.test(s) || /^maj7/.test(s)) return 'maj7';
  if (/^-7b5|^h7|^m7b5/.test(s)) return 'm7b5';
  if (/^dim7|^o7/.test(s)) return 'dim7';
  if (/^(dim|°|o)(?!7)/.test(s)) return 'dim';
  if (/^-7|^m7|^min7/.test(s)) return 'm7';
  if (/^7/.test(s)) return 'dom7';
  if (/^-|^m/.test(s)) return 'm';
  return 'other';
}

function selectionPattern(chords: ChordOverlay[]): ChordType[] {
  return chords.map((c) => classifyChordSymbol(c.symbol));
}

function lickPattern(lick: LickEntry): ChordType[] {
  return lick.chords.filter(Boolean).map(classifyLickChord);
}

function patternMatches(selPat: ChordType[], lickPat: ChordType[]): boolean {
  if (selPat.length === 0 || lickPat.length === 0) return false;
  for (let i = 0; i <= lickPat.length - selPat.length; i++) {
    if (selPat.every((t, j) => lickPat[i + j] === t)) return true;
  }
  for (let i = 0; i <= selPat.length - lickPat.length; i++) {
    if (lickPat.every((t, j) => selPat[i + j] === t)) return true;
  }
  return false;
}

/* ── target tonic detection ──────────────────────────────────────────────── */

/**
 * 선택된 코드 진행에서 토닉 루트 PC 추출.
 * ii-V-I: 마지막 코드가 I → 그 루트
 * ii-V (미완): V 코드의 P5 아래 = 가상의 I
 */
function targetTonicPc(selected: ChordOverlay[]): number {
  if (selected.length === 0) return 0;
  const last = selected[selected.length - 1];
  const lastType = classifyChordSymbol(last.symbol);

  // 마지막이 토닉(maj7 or m7/m)이면 그 루트가 토닉
  if (lastType === 'maj7' || lastType === 'm7' || lastType === 'm' || lastType === 'maj') {
    return rootPc(last.symbol);
  }
  // 마지막이 V7이면 P5 아래(완전4도 위)가 가상 토닉
  if (lastType === 'dom7') {
    return (rootPc(last.symbol) + 5) % 12;
  }
  // 기본: 마지막 코드 루트
  return rootPc(last.symbol);
}

/* ── public types & API ──────────────────────────────────────────────────── */

export interface LickMatch {
  lick: LickEntry;          // 이미 이조 완료된 LickEntry
  tier: 1 | 2 | 3;
  originalKey?: string;     // 이조 전 원래 키 (tier 3일 때 표시용)
}

/* ── progression keyword → ChordType pattern ─────────────────────────────── */

type ProgressionKey = 'ii-V-I' | 'ii-V' | 'minor-ii-V' | 'V-I' | 'turnaround' | 'iii-VI-ii-V';

const PROGRESSION_PATTERNS: Record<ProgressionKey, ChordType[]> = {
  'ii-V-I':       ['m7', 'dom7', 'maj7'],
  'ii-V':         ['m7', 'dom7'],
  'minor-ii-V':   ['m7b5', 'dom7'],
  'V-I':          ['dom7', 'maj7'],
  'turnaround':   ['maj7', 'dom7', 'm7', 'dom7'],
  'iii-VI-ii-V':  ['m7', 'dom7', 'm7', 'dom7'],
};

/**
 * 사용자가 코드 구간을 선택하지 않았을 때 — 진행 키워드(예: "2-5-1")만으로
 * 릭을 찾아오는 폴백. 릭의 chord 진행에서 해당 패턴이 부분-매치되는 것을
 * 모두 모아 임의로 N 개 샘플링.
 */
export function findLicksByProgression(
  progression: ProgressionKey,
  allLicks: LickEntry[],
  maxResults = 5,
): LickMatch[] {
  const targetPat = PROGRESSION_PATTERNS[progression];
  if (!targetPat) return [];
  const matches: LickEntry[] = [];
  for (const lick of allLicks) {
    const lickPat = lickPattern(lick);
    // sub-string match: 릭 진행 어딘가에 패턴이 그대로 등장하는지
    for (let i = 0; i <= lickPat.length - targetPat.length; i++) {
      if (targetPat.every((t, j) => lickPat[i + j] === t)) {
        matches.push(lick);
        break;
      }
    }
  }
  // Fisher-Yates partial shuffle — 같은 곡만 계속 추천되지 않도록
  for (let i = matches.length - 1; i > 0 && i > matches.length - maxResults - 1; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [matches[i], matches[j]] = [matches[j], matches[i]];
  }
  return matches.slice(0, maxResults).map((lick) => ({ lick, tier: 3 as const }));
}

/** Map common Korean / English progression keywords → canonical key. */
export function detectProgressionKeyword(text: string): ProgressionKey | null {
  const lower = text.toLowerCase();
  if (/2[-\s]*5[-\s]*1|ii[-\s]*v[-\s]*i|ⅱ[-\s]*ⅴ[-\s]*ⅰ/.test(lower)) {
    if (/마이너|minor|단조|m7b5|마7b5/.test(lower)) return 'minor-ii-V';
    return 'ii-V-I';
  }
  if (/2[-\s]*5|ii[-\s]*v(?![- ]*i)/.test(lower)) {
    if (/마이너|minor|단조/.test(lower)) return 'minor-ii-V';
    return 'ii-V';
  }
  if (/턴어라운드|turnaround|순환/.test(lower)) return 'turnaround';
  if (/3[-\s]*6[-\s]*2[-\s]*5|iii[-\s]*vi[-\s]*ii[-\s]*v/.test(lower)) return 'iii-VI-ii-V';
  if (/v[-\s]*i\b|5[-\s]*1/.test(lower)) return 'V-I';
  return null;
}

export function findMatchingLicks(
  selected: ChordOverlay[],
  songTitle: string,
  songKey: string,
  allLicks: LickEntry[],
  maxResults = 4,
): LickMatch[] {
  const selPat = selectionPattern(selected);
  if (selPat.length === 0) return [];

  const tonicPc = targetTonicPc(selected);
  const normalizedTitle = songTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  const songKeyRoot = extractKeyRoot(songKey);

  const results: LickMatch[] = [];

  const addIfNew = (lick: LickEntry, tier: 1 | 2 | 3) => {
    if (results.some((r) => r.lick.id === lick.id)) return;

    const lickKeyRootStr = extractKeyRoot(lick.key);
    const lickTonicPc = rootPc(lickKeyRootStr);
    const semitones = (tonicPc - lickTonicPc + 12) % 12;
    const originalKey = semitones !== 0 ? lickKeyRootStr : undefined;
    const transposed = transposeLick(lick, semitones);

    results.push({ lick: transposed, tier, originalKey });
  };

  // Tier 1: Same song
  for (const lick of allLicks) {
    if (results.length >= maxResults) break;
    const lickTitle = lick.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (lickTitle === normalizedTitle && patternMatches(selPat, lickPattern(lick))) {
      addIfNew(lick, 1);
    }
  }

  // Tier 2: Same key, any song
  for (const lick of allLicks) {
    if (results.length >= maxResults) break;
    if (results.some((r) => r.originalKey === undefined && r.lick.id !== lick.id)) {
      // already added (non-transposed)
    }
    const lickKeyRoot = extractKeyRoot(lick.key);
    if (lickKeyRoot === songKeyRoot && patternMatches(selPat, lickPattern(lick))) {
      addIfNew(lick, 2);
    }
  }

  // Tier 3: Any key
  for (const lick of allLicks) {
    if (results.length >= maxResults) break;
    if (results.some(() => {
      // compare original lick id (before transposition) — use title+chords as proxy
      const orig = allLicks.find(l => l.id === lick.id);
      return orig && results.some(res => res.lick.chords.join() === transposeLick(orig, 0).chords.join());
    })) continue;
    if (patternMatches(selPat, lickPattern(lick))) {
      addIfNew(lick, 3);
    }
  }

  return results.slice(0, maxResults);
}

export function selectionProgressionLabel(chords: ChordOverlay[]): string {
  if (chords.length === 0) return '';
  const syms = chords.map((c) => c.symbol).join(' → ');
  const types = selectionPattern(chords);
  if (types.length >= 3 && types[0] === 'm7b5' && types[1] === 'dom7' && types[2] === 'm7') {
    return `마이너 ii-V-i (${syms})`;
  }
  if (types.length >= 3 && types[0] === 'm7' && types[1] === 'dom7' && (types[2] === 'maj7' || types[2] === 'm7')) {
    return `ii-V-I (${syms})`;
  }
  if (types.length >= 2 && types[0] === 'm7b5' && types[1] === 'dom7') {
    return `마이너 ii-V (${syms})`;
  }
  if (types.length >= 2 && types[0] === 'm7' && types[1] === 'dom7') {
    return `ii-V (${syms})`;
  }
  return syms;
}
