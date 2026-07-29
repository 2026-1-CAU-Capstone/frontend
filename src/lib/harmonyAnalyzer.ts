/**
 * Full harmony analyzer for LeadSheetData.
 * Computes: degree, isDiatonic, functions (T/SD/D),
 * secondary dominants, ii-V-I patterns, modal interchange,
 * deceptive resolution, mode segments, and ambiguity scores.
 *
 * Works on any chord progression — no hardcoded data.
 */
import type { LeadSheetData, LeadSheetChord, LeadSheetChordAnalysis } from '../data/leadSheetTypes';
import { normalizeQuality } from '../components/leadsheet/leadSheetQuality';

/* ── pitch / scale constants ──────────────────────────────────────────── */

const NOTE_TO_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const NATURAL_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC_MINOR_SCALE = [0, 2, 3, 5, 7, 8, 11];
const MELODIC_MINOR_SCALE = [0, 2, 3, 5, 7, 9, 11];

/* ── quality normalization ────────────────────────────────────────────── */

/* 대시(-) 계열 표기만 다룬다. `m7`·`maj7`·`dim7` 같은 표기는 아래
 * `normalizeQualityForAnalysis` 가 먼저 `normalizeQuality`(표시용 정규화)로
 * 대시 표기(`-7`·`△7`·`°7`·`ø7`)로 바꿔 넘기므로 여기서 다시 나열하지 않는다.
 *
 * 예전엔 이 표만 보고 판정해서 `m7`·`maj7`·`m7b5`·`dim7` 이 전부 어느 패턴에도
 * 안 걸려 기본값 `'maj'` 로 떨어졌다 — OMR/사용자 입력이 m 표기인 곡은 코드가
 * 통째로 메이저로 오분석됐다(실측: Tea For Two 의 Bbm7 이 Bb장조 으뜸화음으로
 * 인정돼 조성 추천이 정답 Ab 대신 Bb 를 1위로 올림). */
const QUALITY_MAP: [RegExp, string][] = [
  [/^\^7/, 'maj7'], [/^7/, 'dom7'], [/^-7b5/, 'min7b5'], [/^h7?/, 'min7b5'],
  [/^ø7?/, 'min7b5'],
  [/^-(?:△|Δ|\^|[Mm]aj)7/, 'minMaj7'],   // -△7 (마이너 메이저7) — min7 보다 먼저
  [/^-7/, 'min7'], [/^°7/, 'dim7'], [/^°/, 'dim'], [/^o7/, 'dim7'], [/^o/, 'dim'],
  [/^7sus/, 'dom7sus4'],
  [/^\+7/, 'aug7'], [/^\+/, 'aug'], [/^-6/, 'min6'], [/^6/, 'maj6'],
  [/^(?:△|Δ)7/, 'maj7'], [/^(?:△|Δ)/, 'maj'],
  [/^\^/, 'maj'], [/^-/, 'min'], [/^sus/, 'sus4'],
];

const QUALITY_INTERVALS: Record<string, number[]> = {
  maj7: [0, 4, 7, 11], maj: [0, 4, 7], dom7: [0, 4, 7, 10],
  min7: [0, 3, 7, 10], min: [0, 3, 7], min7b5: [0, 3, 6, 10],
  dim7: [0, 3, 6, 9], dim: [0, 3, 6], aug: [0, 4, 8], aug7: [0, 4, 8, 10],
  sus4: [0, 5, 7], dom7sus4: [0, 5, 7, 10], min6: [0, 3, 7, 9], maj6: [0, 4, 7, 9],
};

function normalizeQualityForAnalysis(raw: string): string {
  if (!raw) return 'maj';
  /* 표시용 정규화를 먼저 태워 표기 흔들림(`m7`/`min7`/`-7`, `maj7`/`M7`/`Δ7`,
   * `dim7`/`o7`, `m7b5`/`h7`)을 한 가지 형태로 모은다. 그래야 아래 표가
   * 대시 표기 하나만 알면 된다. */
  const canonical = normalizeQuality(raw.trim());
  for (const [re, norm] of QUALITY_MAP) { if (re.test(canonical)) return norm; }
  return 'maj';
}

/* ── quality classification ───────────────────────────────────────────── */

const DOMINANT_QUALITIES = new Set(['dom7', 'dom7sus4']);
const MINOR_QUALITIES = new Set(['min7', 'min', 'min7b5', 'dim', 'dim7', 'min6']);
const UPPER_QUALITIES = new Set(['maj7', 'maj', 'dom7', 'dom7sus4', 'aug', 'aug7', 'maj6']);

/* ── key / pitch helpers ──────────────────────────────────────────────── */

function keyToPc(key: string): number {
  const root = key[0];
  const acc = key.length > 1 ? key[1] : '';
  return ((NOTE_TO_PC[root] ?? 0) + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
}

export function parseKey(key: string): { pc: number; isMinor: boolean } {
  const isMinor = key.endsWith('-') || key.endsWith('m');
  return { pc: keyToPc(key.replace(/[-m]$/, '')), isMinor };
}

function chordRootPc(chord: LeadSheetChord): number | null {
  if (!chord.root) return null;
  const base = NOTE_TO_PC[chord.root];
  if (base == null) return null;
  return (base + (chord.accidental === '#' ? 1 : chord.accidental === 'b' ? -1 : 0) + 12) % 12;
}

function checkDiatonic(rootPc: number, quality: string, keyRootPc: number, scale: number[]): boolean {
  const pcs = new Set(scale.map(iv => (keyRootPc + iv) % 12));
  return (QUALITY_INTERVALS[quality] ?? [0, 4, 7]).every(iv => pcs.has((rootPc + iv) % 12));
}

/* ── note name helpers ────────────────────────────────────────────────── */

const PC_TO_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const PC_TO_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_PCS = new Set([0, 1, 3, 5, 8, 10]);

function pcToName(pc: number): string {
  return FLAT_PCS.has(pc) ? PC_TO_FLAT[pc] : PC_TO_SHARP[pc];
}

function pcToKeyName(pc: number, isMinor: boolean): string {
  return pcToName(pc) + (isMinor ? 'm' : '');
}

/* ── degree naming ────────────────────────────────────────────────────── */

const DEG_MAJOR = ['I', 'bII', 'II', 'bIII', 'III', 'IV', '#IV', 'V', 'bVI', 'VI', 'bVII', 'VII'];
const DEG_MINOR = ['I', 'bII', 'II', 'III', '#III', 'IV', '#IV', 'V', 'VI', '#VI', 'VII', '#VII'];

function degreeName(interval: number, quality: string, isMinor: boolean): string {
  const base = (isMinor ? DEG_MINOR : DEG_MAJOR)[interval] ?? '?';
  if (UPPER_QUALITIES.has(quality)) return base;
  return base.replace(/[IV]+/g, m => m.toLowerCase());
}

/* ── function tables ──────────────────────────────────────────────────── */

type FnEntry = { function: string; confidence: number; note?: string };

const FN_MAJOR: Record<number, FnEntry[]> = {
  0:  [{ function: 'T', confidence: 1.0 }],
  2:  [{ function: 'SD', confidence: 1.0 }],
  4:  [{ function: 'T', confidence: 0.7, note: 'Tonic substitute (mediant)' }],
  5:  [{ function: 'SD', confidence: 1.0 }],
  7:  [{ function: 'D', confidence: 1.0 }],
  9:  [{ function: 'T', confidence: 0.7, note: 'Tonic substitute (relative minor)' },
       { function: 'SD', confidence: 0.3, note: 'Subdominant in some contexts' }],
  11: [{ function: 'D', confidence: 0.8, note: 'Dominant substitute (leading tone)' }],
};

const FN_MINOR: Record<number, FnEntry[]> = {
  0:  [{ function: 'T', confidence: 1.0 }],
  2:  [{ function: 'SD', confidence: 0.8 }],
  3:  [{ function: 'T', confidence: 0.7, note: 'Tonic substitute (relative major)' }],
  5:  [{ function: 'SD', confidence: 1.0 }],
  7:  [{ function: 'D', confidence: 1.0 }],
  8:  [{ function: 'SD', confidence: 0.7 }],
  10: [{ function: 'SD', confidence: 0.6, note: 'Subtonic' }],
  11: [{ function: 'D', confidence: 0.8, note: 'Leading tone (harmonic minor)' }],
};

/* ── modal interchange source modes ───────────────────────────────────── */

const PARALLEL_MODES_MAJOR = [
  { name: 'parallel minor', scale: NATURAL_MINOR_SCALE },
  { name: 'dorian', scale: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'mixolydian', scale: [0, 2, 4, 5, 7, 9, 10] },
  { name: 'phrygian', scale: [0, 1, 3, 5, 7, 8, 10] },
];

const PARALLEL_MODES_MINOR = [
  { name: 'parallel major', scale: MAJOR_SCALE },
  { name: 'dorian', scale: [0, 2, 3, 5, 7, 9, 10] },
  { name: 'lydian', scale: [0, 2, 4, 6, 7, 9, 11] },
];

/* ── mode segment tables ──────────────────────────────────────────────── */

const MODE_MAJOR: Record<number, string> = {
  0: 'ionian', 2: 'dorian', 4: 'phrygian', 5: 'lydian',
  7: 'mixolydian', 9: 'aeolian', 11: 'locrian',
};
const MODE_MINOR: Record<number, string> = {
  0: 'aeolian', 2: 'locrian', 3: 'ionian', 5: 'dorian',
  7: 'phrygian', 8: 'lydian', 10: 'mixolydian',
};

/* ── exported utilities ───────────────────────────────────────────────── */

export function formatKeyDisplay(key: string): string {
  return key.endsWith('-') ? key.slice(0, -1) + 'm' : key;
}

export function getRelativeKey(key: string): string {
  const { pc, isMinor } = parseKey(key);
  return isMinor ? pcToKeyName((pc + 3) % 12, false) : pcToKeyName((pc + 9) % 12, true);
}

/* ── flatten chords for sequential analysis ───────────────────────────── */

interface FC {
  chord: LeadSheetChord;
  bar: number;
  rootPc: number;
  quality: string;
  interval: number;
}

function flatten(data: LeadSheetData, keyPc: number): FC[] {
  const out: FC[] = [];
  let bar = 0;
  for (const sys of data.systems) {
    for (const b of sys.bars) {
      bar++;
      for (const c of b.chords) {
        if (c.isRepeat || !c.root) continue;
        const rpc = chordRootPc(c);
        if (rpc == null) continue;
        const q = normalizeQualityForAnalysis(c.quality ?? '');
        out.push({ chord: c, bar, rootPc: rpc, quality: q, interval: (rpc - keyPc + 12) % 12 });
      }
    }
  }
  return out;
}

/* ── Phase 2: secondary dominant detection ────────────────────────────── */

function detectSecDom(
  fc: FC, next: FC | undefined, isMinor: boolean,
): NonNullable<LeadSheetChordAnalysis['secondaryDominant']> | null {
  if (!DOMINANT_QUALITIES.has(fc.quality) || fc.interval === 7) return null;

  const targetInt = (fc.interval + 5) % 12;
  const scale = isMinor ? NATURAL_MINOR_SCALE : MAJOR_SCALE;
  let valid = scale.includes(targetInt);
  if (!valid && isMinor) {
    valid = HARMONIC_MINOR_SCALE.includes(targetInt) || MELODIC_MINOR_SCALE.includes(targetInt);
  }
  if (!valid) return null;

  const dqMaj: Record<number, string> = { 0: 'maj', 2: 'min', 4: 'min', 5: 'maj', 7: 'maj', 9: 'min', 11: 'min' };
  const dqMin: Record<number, string> = { 0: 'min', 2: 'min', 3: 'maj', 5: 'min', 7: 'min', 8: 'maj', 10: 'maj' };
  const tq = (isMinor ? dqMin : dqMaj)[targetInt] ?? 'maj';
  const targetDeg = degreeName(targetInt, tq, isMinor);
  const resolved = next !== undefined && next.interval === targetInt;
  const targetPc = (fc.rootPc + 5) % 12;

  return {
    label: `V/${targetDeg}`,
    targetDegree: targetDeg,
    targetRootPc: targetPc,
    targetKey: pcToName(targetPc),
    resolved,
  };
}

/* ── Phase 2b: SubV (tritone substitution) detection ─────────────────── */

function detectSubV(
  fc: FC, next: FC | undefined, isMinor: boolean, keyPc: number,
): NonNullable<import('../data/leadSheetTypes').LeadSheetChordAnalysis['subV']> | null {
  if (!DOMINANT_QUALITIES.has(fc.quality)) return null;
  if (fc.interval === 7) return null; // diatonic V — not a substitution
  if (fc.chord.analysis?.secondaryDominant) return null; // already a SecDom
  // If the next chord sits a P5 below (P4 above), this chord is resolving as a secondary dominant
  if (next && (fc.rootPc + 5) % 12 === next.rootPc) return null;

  // The "original V" partner sits a tritone away; its target is a P5 above partner
  const partnerPc = (fc.rootPc + 6) % 12;
  const targetPc  = (partnerPc + 5) % 12;
  const targetInt = (targetPc - keyPc + 12) % 12;

  const scale = isMinor ? NATURAL_MINOR_SCALE : MAJOR_SCALE;
  let valid = scale.includes(targetInt);
  if (!valid && isMinor) {
    valid = HARMONIC_MINOR_SCALE.includes(targetInt) || MELODIC_MINOR_SCALE.includes(targetInt);
  }
  if (!valid) return null;

  const dqMaj: Record<number, string> = { 0: 'maj', 2: 'min', 4: 'min', 5: 'maj', 7: 'maj', 9: 'min', 11: 'min' };
  const dqMin: Record<number, string> = { 0: 'min', 2: 'min', 3: 'maj', 5: 'min', 7: 'min', 8: 'maj', 10: 'maj' };
  const tq = (isMinor ? dqMin : dqMaj)[targetInt] ?? 'maj';
  const targetDeg = degreeName(targetInt, tq, isMinor);

  return {
    targetDegree: targetDeg,
    targetRootPc: targetPc,
    originalVLabel: `V/${targetDeg}`,
  };
}

/* ── Phase 3: ii-V-I pattern detection ────────────────────────────────── */

function detectGroups(flat: FC[]): void {
  let gid = 0;

  const add = (fc: FC, groupId: number, role: string, variant: string) => {
    const a = fc.chord.analysis!;
    if (!a.groupMemberships) a.groupMemberships = [];
    a.groupMemberships.push({ groupId, groupType: 'ii-V-I', role, variant });
  };

  const paired = (i: number, j: number, roleA: string, roleB: string) => {
    const ga = flat[i].chord.analysis!.groupMemberships ?? [];
    const gb = flat[j].chord.analysis!.groupMemberships ?? [];
    return ga.some(a => a.role === roleA && gb.some(b => b.groupId === a.groupId && b.role === roleB));
  };

  // Pass A: full ii-V-I triplets
  for (let i = 0; i < flat.length - 2; i++) {
    const [a, b, c] = [flat[i], flat[i + 1], flat[i + 2]];
    if ((b.rootPc - a.rootPc + 12) % 12 !== 5) continue;
    if ((c.rootPc - b.rootPc + 12) % 12 !== 5) continue;
    if (!MINOR_QUALITIES.has(a.quality) || !DOMINANT_QUALITIES.has(b.quality)) continue;
    if (DOMINANT_QUALITIES.has(c.quality)) continue;
    gid++;
    const v = MINOR_QUALITIES.has(c.quality) ? 'minor' : 'standard';
    add(a, gid, 'ii', v); add(b, gid, 'V', v); add(c, gid, 'I', v);
  }

  // Pass B: V-I pairs not already in a triplet
  for (let i = 0; i < flat.length - 1; i++) {
    const [a, b] = [flat[i], flat[i + 1]];
    if ((b.rootPc - a.rootPc + 12) % 12 !== 5) continue;
    if (!DOMINANT_QUALITIES.has(a.quality) || DOMINANT_QUALITIES.has(b.quality)) continue;
    if (paired(i, i + 1, 'V', 'I')) continue;
    gid++;
    const v = MINOR_QUALITIES.has(b.quality) ? 'minor' : 'standard';
    add(a, gid, 'V', v); add(b, gid, 'I', v);
  }

  // Pass C: ii-V pairs (incomplete, no I resolution)
  for (let i = 0; i < flat.length - 1; i++) {
    const [a, b] = [flat[i], flat[i + 1]];
    if ((b.rootPc - a.rootPc + 12) % 12 !== 5) continue;
    if (!MINOR_QUALITIES.has(a.quality) || !DOMINANT_QUALITIES.has(b.quality)) continue;
    if (paired(i, i + 1, 'ii', 'V')) continue;
    if ((flat[i + 1].chord.analysis!.groupMemberships ?? []).some(g => g.role === 'V' && g.variant !== 'incomplete')) continue;
    gid++;
    add(a, gid, 'ii', 'incomplete'); add(b, gid, 'V', 'incomplete');
  }
}

/* ── Phase 4: function assignment ─────────────────────────────────────── */

function assignFn(fc: FC, isMinor: boolean): FnEntry[] {
  const a = fc.chord.analysis!;

  if (a.secondaryDominant) {
    const r = a.secondaryDominant.resolved;
    return [{
      function: 'D', confidence: r ? 0.9 : 0.6,
      note: `Secondary dominant ${a.secondaryDominant.label} (${r ? 'resolved' : 'unresolved'})`,
    }];
  }

  if (fc.chord.isDiatonic) {
    const t = isMinor ? FN_MINOR : FN_MAJOR;
    if (t[fc.interval]) return t[fc.interval].map(f => ({ ...f }));
  }

  if (a.modalInterchange) {
    const sdSet = new Set([1, 2, 3, 5, 8, 10]);
    const dSet = new Set([6, 7, 11]);
    const fn = sdSet.has(fc.interval) ? 'SD' : dSet.has(fc.interval) ? 'D' : 'T';
    return [{ function: fn, confidence: 0.6, note: `Modal interchange from ${a.modalInterchange.sourceMode}` }];
  }

  return [];
}

/* ── Phase 5: modal interchange ───────────────────────────────────────── */

function detectMI(
  fc: FC, keyPc: number, isMinor: boolean,
): { sourceMode: string; borrowedDegree: string } | null {
  const modes = isMinor ? PARALLEL_MODES_MINOR : PARALLEL_MODES_MAJOR;
  for (const m of modes) {
    if (checkDiatonic(fc.rootPc, fc.quality, keyPc, m.scale)) {
      return { sourceMode: m.name, borrowedDegree: degreeName(fc.interval, fc.quality, isMinor) };
    }
  }
  return null;
}

/* ── chord symbol helper ──────────────────────────────────────────────── */

function chordSymbolShort(c: LeadSheetChord): string {
  return (c.root ?? '') + (c.accidental ?? '') + (c.quality ?? '');
}

/* ════════════════════════════════════════════════════════════════════════ */
/*  MAIN ENTRY POINT                                                      */
/* ════════════════════════════════════════════════════════════════════════ */

/**
 * Analyze all chords in a LeadSheetData:
 * degree, isDiatonic, functions, secondary dominants, ii-V-I groups,
 * modal interchange, deceptive resolution, mode segments, ambiguity.
 *
 * Mutates chord.analysis / chord.isDiatonic in place. Returns same ref.
 */
export function analyzeHarmony(data: LeadSheetData): LeadSheetData {
  const { pc: keyPc, isMinor } = parseKey(data.key ?? 'C');
  const scale = isMinor ? NATURAL_MINOR_SCALE : MAJOR_SCALE;
  const flat = flatten(data, keyPc);

  /* Phase 1 — basics: isDiatonic, degree, rootPc */
  for (const fc of flat) {
    let dia = checkDiatonic(fc.rootPc, fc.quality, keyPc, scale);
    if (!dia && isMinor) {
      dia = checkDiatonic(fc.rootPc, fc.quality, keyPc, HARMONIC_MINOR_SCALE)
        || checkDiatonic(fc.rootPc, fc.quality, keyPc, MELODIC_MINOR_SCALE);
    }
    fc.chord.isDiatonic = dia;
    fc.chord.analysis = {
      rootPc: fc.rootPc,
      normalizedQuality: fc.quality,
      isDiatonic: dia,
      degree: degreeName(fc.interval, fc.quality, isMinor),
    };
  }

  /* Phase 2 — secondary dominants */
  for (let i = 0; i < flat.length; i++) {
    const sd = detectSecDom(flat[i], flat[i + 1], isMinor);
    if (sd) flat[i].chord.analysis!.secondaryDominant = sd;
  }

  /* Phase 2b — SubV (tritone substitution) */
  for (let i = 0; i < flat.length; i++) {
    if (flat[i].chord.analysis?.secondaryDominant) continue;
    const sv = detectSubV(flat[i], flat[i + 1], isMinor, keyPc);
    if (sv) flat[i].chord.analysis!.subV = sv;
  }

  /* Phase 3 — ii-V-I groups */
  detectGroups(flat);

  /* Phase 4 — functions */
  for (const fc of flat) {
    fc.chord.analysis!.functions = assignFn(fc, isMinor);
  }

  /* Phase 5 — modal interchange (non-diatonic, non-secDom, not in ii-V-I group)
   * 관계적 ii-V-I의 ii/V/I로 이미 분류된 코드는 functional context가 우선.
   * 예: B♭ 메이저에서 F-7 → B♭7 → E♭△7 의 F-7는 'related ii-V-I'의 ii지
   *     'iv (parallel minor) 모달 인터체인지'가 아니다. */
  for (const fc of flat) {
    if (fc.chord.isDiatonic || fc.chord.analysis!.secondaryDominant) continue;
    const inIIVI = fc.chord.analysis!.groupMemberships?.some(g => g.groupType === 'ii-V-I');
    if (inIIVI) continue;
    const mi = detectMI(fc, keyPc, isMinor);
    if (mi) {
      fc.chord.analysis!.modalInterchange = mi;
      fc.chord.analysis!.functions = assignFn(fc, isMinor);
    }
  }

  /* Phase 6 — deceptive resolution (unresolved secondary dominants) */
  for (let i = 0; i < flat.length - 1; i++) {
    const sd = flat[i].chord.analysis!.secondaryDominant;
    if (!sd || sd.resolved) continue;
    flat[i].chord.analysis!.deceptiveResolution = {
      expected: sd.targetKey ?? '?',
      actual: chordSymbolShort(flat[i + 1].chord),
    };
  }

  /* Phase 7 — mode segments */
  for (const fc of flat) {
    const a = fc.chord.analysis!;
    if (a.secondaryDominant) { a.modeSegment = 'mixolydian'; }
    else if (a.modalInterchange) { a.modeSegment = a.modalInterchange.sourceMode; }
    else { a.modeSegment = (isMinor ? MODE_MINOR : MODE_MAJOR)[fc.interval]; }
  }

  /* Phase 8 — ambiguity score */
  for (const fc of flat) {
    const a = fc.chord.analysis!;
    if (fc.chord.isDiatonic) {
      a.ambiguityScore = (a.functions?.length ?? 0) > 1 ? 0.12 : 0.0;
    } else if (a.secondaryDominant) {
      a.ambiguityScore = a.secondaryDominant.resolved ? 0.14 : 0.31;
    } else if (a.modalInterchange) {
      a.ambiguityScore = 0.2;
    } else {
      a.ambiguityScore = 0.4;
    }
  }

  return data;
}
