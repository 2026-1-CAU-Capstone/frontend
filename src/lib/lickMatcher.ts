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
 * 이조 후 음역이 표 위/아래로 멀리 벗어났을 때, 화면 표기를 stave 가까이로
 * 끌어내리되 SOUNDING PITCH는 **8va / 8vb 브래킷**으로 보존한다. 옛 동작은
 * 옥타브를 통째로 내려서 사운드 자체가 바뀌었지만, 이제는 표기만 옥타브
 * 안쪽으로 옮기고 ottava 마커가 sound 차이를 보전한다.
 *
 * Returns measures (representational octave shifted to fit) with the first
 * and last note inside the shifted span marked with `ottavaStart` /
 * `ottavaEnd`. The note player adds back +12 / -12 semitones for notes
 * inside an ottava bracket so playback stays at the original sounding pitch.
 */
function fitOctaveRange(measures: MeasureInfo[]): MeasureInfo[] {
  const all: number[] = [];
  for (const m of measures) for (const n of m.notes) all.push(...noteMidis(n));
  if (all.length === 0) return measures;

  const max = Math.max(...all);
  const min = Math.min(...all);

  // Decide a single global shift (one octave step) — same heuristic as before.
  let shift = 0;
  if (max > OCTAVE_HIGH && (min - 12) >= OCTAVE_LOW - 12) shift = -1;
  else if (min < OCTAVE_LOW && (max + 12) <= OCTAVE_HIGH + 12) shift = 1;
  if (shift === 0) return measures;

  const shifted = shiftMeasuresOctave(measures, shift);
  // `shift === -1` ⇒ notation moved DOWN one octave ⇒ play "as if up an
  // octave" ⇒ 8va. Symmetric for 8vb.
  const ottavaLabel: '8va' | '8vb' = shift === -1 ? '8va' : '8vb';

  // Find first & last non-rest note (the ones the bracket attaches to). We
  // wrap the entire span — the simplest, safest layout for transposed licks.
  let firstMi = -1, firstNi = -1, lastMi = -1, lastNi = -1;
  for (let mi = 0; mi < shifted.length; mi++) {
    const m = shifted[mi];
    for (let ni = 0; ni < m.notes.length; ni++) {
      if (m.notes[ni].duration.endsWith('r')) continue;
      if (firstMi < 0) { firstMi = mi; firstNi = ni; }
      lastMi = mi; lastNi = ni;
    }
  }
  if (firstMi < 0) return shifted;

  return shifted.map((m, mi) => {
    if (mi !== firstMi && mi !== lastMi) return m;
    const notes = m.notes.map((n, ni) => {
      if (mi === firstMi && ni === firstNi && mi === lastMi && ni === lastNi) {
        return { ...n, ottavaStart: ottavaLabel, ottavaEnd: true };
      }
      if (mi === firstMi && ni === firstNi) return { ...n, ottavaStart: ottavaLabel };
      if (mi === lastMi && ni === lastNi)   return { ...n, ottavaEnd: true };
      return n;
    });
    return { ...m, notes };
  });
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
  // `j7` = MuseJazz-font spelling of the major-7 triangle. Backend lick data
  // mixes `△7` and `j7`, so both must classify as maj7. (`M7` is already
  // lowercased to `m7` here — the original `M7` branch was dead code.)
  if (/^(maj7|△7|Δ7|\^7|j7|-?△7)/.test(q)) return 'maj7';
  if (/^(-7b5|m7b5|ø7|h7|min7b5)/.test(q)) return 'm7b5';
  if (/^(dim7|°7|o7)/.test(q)) return 'dim7';
  if (/^(dim|°|o)(?!7)/.test(q)) return 'dim';
  if (/^(-7|m7|min7)/.test(q)) return 'm7';
  if (/^7/.test(q)) return 'dom7';
  if (/^(-|m|min)(?!a)/.test(q)) return 'm';
  if (q === '' || /^(maj|△|Δ|\^|j)(?!7)/.test(q)) return 'maj';
  return 'other';
}

function selectionPattern(chords: ChordOverlay[]): ChordType[] {
  return chords.map((c) => classifyChordSymbol(c.symbol));
}

/* ── pattern scoring ─────────────────────────────────────────────────────────
 * 예전 patternMatches 는 boolean(부분 매치 = 완전 매치) 이라 "쿼리 전체를 담은
 * 릭" 과 "일부만 담은 릭" 을 구분 못 했다. 이제 0~1 점수로 매긴다:
 *   effCoverage = Σ(코드별 quality 유사도) / 쿼리 길이   ← 완전 포함 > 부분 포함
 *   rootAvg     = 루트 모션(반음 간격)이 일치한 비율      ← 트라이톤 섭 등 구분
 *   score       = effCoverage * (0.70 + 0.30 * rootAvg)
 * 완전·정확 매치 → 1.0, 2/3 부분 매치 → ~0.67 로 항상 완전 매치가 위로 온다. */

interface PatChord {
  type: ChordType;
  /** 코드 루트의 pitch-class. progression 키워드처럼 절대 루트가 없으면 null. */
  rootPc: number | null;
}

/** 근접 quality — maj7↔maj, m7↔m, dim 계열은 0.5 점 부분 인정. */
const QUALITY_NEAR: Partial<Record<ChordType, ChordType[]>> = {
  maj7: ['maj'], maj: ['maj7'],
  m7: ['m'], m: ['m7'],
  m7b5: ['dim'], dim: ['m7b5', 'dim7'], dim7: ['dim'],
};

function qualitySim(a: ChordType, b: ChordType): number {
  // 'other' 는 분류 불가 — 매칭 점수에 기여시키지 않는다.
  if (a === 'other' || b === 'other') return 0;
  if (a === b) return 1;
  if (QUALITY_NEAR[a]?.includes(b)) return 0.5;
  return 0;
}

function selToPat(chords: ChordOverlay[]): PatChord[] {
  return chords.map((c) => ({
    type: classifyChordSymbol(c.symbol),
    rootPc: rootPc(c.symbol),
  }));
}

/* 백엔드 릭의 chords 는 마디당 1 엔트리이고 한 마디 2코드는 "D-7  G7" 처럼
 * 2-space 로 합쳐져 온다. 각 코드를 개별 패턴 원소로 펼친다. */
function lickToPat(lick: LickEntry): PatChord[] {
  const out: PatChord[] = [];
  for (const cell of lick.chords) {
    if (!cell) continue;
    for (const sym of cell.split(/\s{2,}/)) {
      const s = sym.trim();
      if (s) out.push({ type: classifyChordSymbol(s), rootPc: rootPc(s) });
    }
  }
  return out;
}

/** progression 키워드(ii-V-I 등) → 절대 루트 없는 패턴. */
function progToPat(types: ChordType[]): PatChord[] {
  return types.map((t) => ({ type: t, rootPc: null }));
}

/**
 * 쿼리 패턴이 릭 패턴 안에 (연속 정렬로) 얼마나 잘 들어맞는지 0~1 점수.
 * 모든 정렬 오프셋을 슬라이드하며 최고 점수를 취한다.
 */
function patternScore(sel: PatChord[], lick: PatChord[]): number {
  if (sel.length === 0 || lick.length === 0) return 0;
  let best = 0;

  // off = sel[0] 이 들어가는 릭 인덱스. 양끝 부분 겹침까지 커버.
  for (let off = -(sel.length - 1); off <= lick.length - 1; off++) {
    let qualSum = 0;       // Σ qualitySim (커버된 위치)
    let rootHits = 0;
    let rootPairs = 0;
    let prevCovered = -1;  // 직전에 quality 매치된 sel 인덱스

    for (let j = 0; j < sel.length; j++) {
      const li = off + j;
      if (li < 0 || li >= lick.length) { prevCovered = -1; continue; }

      const q = qualitySim(sel[j].type, lick[li].type);
      qualSum += q;

      if (q > 0) {
        // 루트 모션 비교: 직전 매치 위치와의 반음 간격이 같은지
        const sPrev = sel[prevCovered]?.rootPc;
        const lPrev = lick[off + prevCovered]?.rootPc;
        if (prevCovered >= 0 && sel[j].rootPc != null && sPrev != null
            && lick[li].rootPc != null && lPrev != null) {
          rootPairs++;
          const selIv = ((sel[j].rootPc! - sPrev) % 12 + 12) % 12;
          const lickIv = ((lick[li].rootPc! - lPrev) % 12 + 12) % 12;
          if (selIv === lickIv) rootHits++;
        }
        prevCovered = j;
      } else {
        prevCovered = -1;  // hard miss → 루트 모션 연속성 끊김
      }
    }

    const effCoverage = qualSum / sel.length;
    if (effCoverage === 0) continue;
    // 루트 정보가 없으면(progression 키워드) 중립값 0.85.
    const rootAvg = rootPairs > 0 ? rootHits / rootPairs : 0.85;
    const score = effCoverage * (0.70 + 0.30 * rootAvg);
    if (score > best) best = score;
  }

  return best;
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
 * 릭을 찾아오는 폴백. patternScore 로 점수를 매겨 높은 순으로 정렬하고,
 * 동점은 셔플해서 122개 릭이 골고루 나오게 한다.
 */
export function findLicksByProgression(
  progression: ProgressionKey,
  allLicks: LickEntry[],
  maxResults = 5,
): LickMatch[] {
  const targetPat = PROGRESSION_PATTERNS[progression];
  if (!targetPat) return [];
  const selPat = progToPat(targetPat);

  const scored: { lick: LickEntry; score: number }[] = [];
  for (const lick of allLicks) {
    const score = patternScore(selPat, lickToPat(lick));
    // 진행 키워드 매칭은 "그 진행을 실제로 담은" 릭만 — 0.55 이상.
    if (score >= 0.55) scored.push({ lick, score });
  }

  scored.sort((a, b) => {
    const d = b.score - a.score;
    if (Math.abs(d) > 0.001) return d;
    return Math.random() - 0.5;  // 동점 → 다양성
  });

  return scored.slice(0, maxResults).map((s) => ({ lick: s.lick, tier: 3 as const }));
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

/**
 * 선택된 코드 구간에 어울리는 릭을 찾는다.
 *
 * 예전 구현은 Tier 1/2/3(같은 곡 / 같은 키 / 아무 키) 으로 나눠 각 티어를
 * 배열 순서대로 훑어 채우는 방식이라 (1) 부분 매치가 완전 매치를 이기고
 * (2) 결과가 결정론적 — 122개를 만들어도 늘 같은 릭만 나왔다.
 *
 * 이제 티어를 랭킹에서 제거하고 patternScore 로 전부 점수화 → 점수순 정렬.
 *   final = patternScore + keyBonus   (같은 곡 +0.15 / 같은 키 +0.05)
 * keyBonus 는 동점-수준에서만 영향을 주는 작은 가산점이라, "완전 매치 > 부분
 * 매치" 가 항상 우선한다. 동점은 셔플해 다양성 확보.
 * tier 필드는 표시용으로 유지(같은 곡=1 / 같은 키=2 / 그 외=3) — 랭킹과 무관.
 */
export function findMatchingLicks(
  selected: ChordOverlay[],
  songTitle: string,
  songKey: string,
  allLicks: LickEntry[],
  maxResults = 4,
): LickMatch[] {
  const selPat = selToPat(selected);
  if (selPat.length === 0) return [];

  const tonicPc = targetTonicPc(selected);
  const normalizedTitle = songTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
  const songKeyRoot = extractKeyRoot(songKey);

  interface Scored {
    lick: LickEntry;
    score: number;       // patternScore (0~1)
    final: number;       // score + keyBonus
    tier: 1 | 2 | 3;
  }

  const scored: Scored[] = [];
  for (const lick of allLicks) {
    const score = patternScore(selPat, lickToPat(lick));
    if (score < 0.25) continue;  // 노이즈 컷 — 의미 있는 겹침이 거의 없음

    const lickTitle = lick.title.toLowerCase().replace(/[^a-z0-9]/g, '');
    const lickKeyRoot = extractKeyRoot(lick.key);
    let tier: 1 | 2 | 3 = 3;
    let keyBonus = 0;
    if (normalizedTitle && lickTitle === normalizedTitle) { tier = 1; keyBonus = 0.15; }
    else if (lickKeyRoot === songKeyRoot) { tier = 2; keyBonus = 0.05; }

    scored.push({ lick, score, final: score + keyBonus, tier });
  }

  scored.sort((a, b) => {
    const d = b.final - a.final;
    if (Math.abs(d) > 0.001) return d;
    return Math.random() - 0.5;  // 동점 → 셔플로 다양성
  });

  const out: LickMatch[] = [];
  const seen = new Set<string | number>();
  for (const s of scored) {
    if (out.length >= maxResults) break;
    if (seen.has(s.lick.id)) continue;
    seen.add(s.lick.id);

    const lickKeyRootStr = extractKeyRoot(s.lick.key);
    const lickTonicPc = rootPc(lickKeyRootStr);
    const semitones = (tonicPc - lickTonicPc + 12) % 12;
    const originalKey = semitones !== 0 ? lickKeyRootStr : undefined;

    out.push({ lick: transposeLick(s.lick, semitones), tier: s.tier, originalKey });
  }
  return out;
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

/* ── performer-name lick lookup ──────────────────────────────────────────── */

/**
 * 한글(또는 로마자) 연주자명 → 영어 performer 이름 조각.
 * 매칭은 lick.performer 에 대한 부분 문자열 비교라, 성(姓) 조각("parker")만
 * 있어도 "Charlie Parker" 가 잡힌다. DB 에 실재하는 연주자 위주로 채우되,
 * 자주 묻는 거장(콜트레인·마일스 등 — 현재 DB 에 없을 수 있음)도 넣어둔다.
 * 없는 연주자는 매칭 0건 → 호출부에서 glick(AI 생성) 폴백으로 흘러간다.
 */
const PERFORMER_ALIASES: Record<string, string> = {
  '찰리 파커': 'charlie parker', '찰리파커': 'charlie parker', '파커': 'parker',
  '버드 파웰': 'bud powell', '버드파웰': 'bud powell', '파웰': 'powell',
  '레드 갈란드': 'red garland', '갈란드': 'garland', '갈랜드': 'garland',
  '소니 스팃': 'sonny stitt', '스팃': 'stitt', '스티트': 'stitt',
  '윈튼 켈리': 'wynton kelly', '켈리': 'kelly',
  '오스카 피터슨': 'oscar peterson', '피터슨': 'peterson',
  '클리포드 브라운': 'clifford brown',
  '배리 해리스': 'barry harris',
  '캐넌볼 애덜리': 'cannonball adderley', '캐논볼': 'adderley', '애덜리': 'adderley',
  '웨스 몽고메리': 'wes montgomery', '몽고메리': 'montgomery',
  '케니 가렛': 'kenny garrett', '가렛': 'garrett',
  '행크 모블리': 'hank mobley', '모블리': 'mobley',
  '조지 벤슨': 'george benson', '벤슨': 'benson',
  '팻 마티노': 'pat martino', '마티노': 'martino',
  '조 패스': 'joe pass',
  '덱스터 고든': 'dexter gordon',
  '필 우즈': 'phil woods',
  '크리스 포터': 'chris potter',
  '폴 데스몬드': 'paul desmond', '데스몬드': 'desmond',
  '재키 맥린': 'jackie mclean', '맥린': 'mclean',
  '토미 플래너건': 'tommy flanagan', '플래너건': 'flanagan',
  '러스티 브라이언트': 'rusty bryant', '브라이언트': 'bryant',
  '멀그루 밀러': 'mulgrew miller',
  '블루 미첼': 'blue mitchell',
  // 자주 묻지만 현재 DB 에 없을 수 있는 거장 (매칭 0 → glick 폴백)
  '마일스 데이비스': 'miles davis', '마일스': 'miles davis',
  '존 콜트레인': 'john coltrane', '콜트레인': 'coltrane', '콜트래인': 'coltrane',
  '디지 길레스피': 'dizzy gillespie', '길레스피': 'gillespie',
  '쳇 베이커': 'chet baker',
};

/**
 * 사용자가 연주자명을 언급했을 때 그 연주자의 릭을 찾는다.
 * (예: "마일스 데이비스 솔로 추천", "파커 라인 보여줘")
 * 코드 선택·진행 키워드가 없을 때의 또 다른 폴백. 이조하지 않고 원본 키로
 * 반환한다(tier 3). 언급한 연주자가 DB 에 없으면 빈 배열을 돌려주어,
 * 호출부가 glick(AI 생성) 폴백으로 자연스럽게 넘어가게 한다.
 */
export function findLicksByPerformer(
  text: string,
  allLicks: LickEntry[],
  maxResults = 5,
): LickMatch[] {
  const lower = text.toLowerCase();

  // 1) 사용자가 가리킨 영어 performer 이름 조각 모으기
  const targets = new Set<string>();
  // 1a) 한글/로마자 alias
  for (const [alias, en] of Object.entries(PERFORMER_ALIASES)) {
    if (lower.includes(alias.toLowerCase())) targets.add(en);
  }
  // 1b) 영어 직접 언급 — DB 의 실제 이름(풀네임) 또는 성(姓, 단어 경계)이 텍스트에
  for (const lick of allLicks) {
    const perf = lick.performer.toLowerCase().trim();
    if (!perf || perf === 'unknown' || perf === '?') continue;
    if (lower.includes(perf)) { targets.add(perf); continue; }
    const last = perf.split(/\s+/).pop() ?? '';
    if (last.length >= 4 && new RegExp(`\\b${last}\\b`).test(lower)) targets.add(last);
  }
  if (targets.size === 0) return [];

  // 2) performer 가 타깃 조각 중 하나를 포함하는 릭 수집 (AI 생성 릭 제외)
  const matched = allLicks.filter((l) => {
    const perf = l.performer.toLowerCase();
    if (!perf || perf === 'ai 생성') return false;
    return [...targets].some((t) => perf.includes(t));
  });
  if (matched.length === 0) return [];

  // 3) 같은 연주자 릭이 많으면 셔플로 다양성 확보 후 상위 N
  const shuffled = [...matched].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, maxResults).map((lick) => ({ lick, tier: 3 as const }));
}
