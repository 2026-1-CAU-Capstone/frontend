import type { NoteSheetData, MeasureInfo, NoteInfo } from './sampleMelody';
import { getCachedUser } from '../api/auth';

/* ─── Raw lick JSON shape (from extract_licks.py) ─────────────────── */

interface RawLick {
  id: number;
  melid: number;
  start_idx: number;
  end_idx: number;
  n_events: number;
  tag: string;
  base_tag: string;
  performer: string;
  title: string;
  instrument: string;
  style: string;
  tempo: number | null;
  key: string;
  rhythmfeel: string;
  chords: string[];
  chords_per_event: (string | null)[];
  pitch: number[];
  onset: number[];
  duration: number[];
  bar: number[];
  beat: number[];
  tatum: number[];
  interval: number[];
  parsons: number[];
  fuzzy_interval: number[];
  pitch_class: number[];
  chordal_pc: (number | null)[];
  chordal_diatonic_pc: (string | null)[];
  duration_class: number[];
  signature?: string;
}

export interface LickEntry {
  id: number | string;
  /** 1-based position in the backend list (createdAt desc). The real `id` is
   *  a UUID which is meaningless to show users — this is the human-facing
   *  number. Assigned in fetchAllLicks(); undefined for non-backend sources. */
  displayNumber?: number;
  /** 백엔드 소유자 uuid. "내 릭"은 이 값이 현재 로그인 사용자의 publicId 와
   *  같은 것만 골라 보여준다 (GET /v1/licks 에 owner 필터가 없어 클라에서 거른다). */
  userId?: string;
  /** 백엔드 출처 구분. 사용자가 직접 만든 릭만 'user'. */
  source?: 'user' | 'weimar' | 'curated' | 'unknown';
  performer: string;
  title: string;
  album?: string;
  instrument: string;
  style: string;
  tempo: number | null;
  key: string;
  rhythmfeel: string;
  tag: string;
  chords: string[];
  nEvents: number;
  label: string;           // display label
  sheetData: NoteSheetData;
  intervals: number[];     // signed semitone intervals between consecutive pitches
  parsons: number[];       // contour: 1=up, -1=down, 0=same
  fuzzyIntervals: number[];// categorised intervals (±1 step, ±2 small leap, etc.)
  durationClasses: number[];// quantised duration per note
  /** Backend-attached YouTube reference (PUT /v1/licks/{id}/video). */
  video?: {
    videoId: string;
    startSec: number;
    endSec?: number;
    url?: string;
  };
}

/* ─── Pitch helpers ───────────────────────────────────────────────── */

const SHARP_TABLE: { letter: string; acc?: '#' | 'b' }[] = [
  { letter: 'c' },           { letter: 'c', acc: '#' },
  { letter: 'd' },           { letter: 'd', acc: '#' },
  { letter: 'e' },           { letter: 'f' },
  { letter: 'f', acc: '#' }, { letter: 'g' },
  { letter: 'g', acc: '#' }, { letter: 'a' },
  { letter: 'a', acc: '#' }, { letter: 'b' },
];

const FLAT_TABLE: { letter: string; acc?: '#' | 'b' }[] = [
  { letter: 'c' },           { letter: 'd', acc: 'b' },
  { letter: 'd' },           { letter: 'e', acc: 'b' },
  { letter: 'e' },           { letter: 'f' },
  { letter: 'g', acc: 'b' }, { letter: 'g' },
  { letter: 'a', acc: 'b' }, { letter: 'a' },
  { letter: 'b', acc: 'b' }, { letter: 'b' },
];

function midiToVex(midi: number, useFlats: boolean): { key: string; acc?: '#' | 'b' } {
  const pc = midi % 12;
  const oct = Math.floor(midi / 12) - 1;
  const t = (useFlats ? FLAT_TABLE : SHARP_TABLE)[pc];
  return { key: `${t.letter}/${oct}`, acc: t.acc };
}

function normalizeKey(keyStr: string): string {
  // "Bb-maj" → "Bb", "F-min" → "Fm", "C-dor" → "C"
  const parts = keyStr.split('-');
  const root = parts[0] || 'C';
  const mode = parts[1] || '';
  if (mode === 'min' || mode === 'minor') return root + 'm';
  return root;
}

/* ─── Duration quantisation ───────────────────────────────────────── */

const DUR_GRID = [
  { beats: 4.0,  vf: 'w',  dot: false },
  { beats: 3.0,  vf: 'h',  dot: true  },
  { beats: 2.0,  vf: 'h',  dot: false },
  { beats: 1.5,  vf: 'q',  dot: true  },
  { beats: 1.0,  vf: 'q',  dot: false },
  { beats: 0.75, vf: '8',  dot: true  },
  { beats: 0.5,  vf: '8',  dot: false },
  { beats: 0.25, vf: '16', dot: false },
];

function quantise(beats: number): { vf: string; dot: boolean; beats: number } {
  let best = DUR_GRID[DUR_GRID.length - 1];
  let diff = Infinity;
  for (const d of DUR_GRID) {
    const dd = Math.abs(d.beats - beats);
    if (dd < diff) { diff = dd; best = d; }
  }
  return best;
}

/* ─── Convert raw lick → NoteSheetData ────────────────────────────── */

/* VexFlow duration → beat 길이 (dotted 는 호출부에서 곱함). */
const VF_BEATS: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, '32': 0.125 };
function niBeatLen(n: NoteInfo): number {
  const base = n.duration.replace(/[dr]/g, '');
  let b = VF_BEATS[base] ?? 1;
  if (n.dotted) b *= 1.5;
  return b;
}
/** beats 만큼의 쉼표 NoteInfo 배열 — 16분 격자로 스냅 후 h/q/8/16 그리디 분해. */
function beatsToRests(beats: number): NoteInfo[] {
  let b = Math.round(beats * 4) / 4;
  const out: NoteInfo[] = [];
  const units: [number, string][] = [[2, 'hr'], [1, 'qr'], [0.5, '8r'], [0.25, '16r']];
  for (const [val, vf] of units) {
    while (b >= val - 1e-6) { out.push({ keys: ['b/4'], duration: vf }); b -= val; }
  }
  return out;
}

function lickToSheet(lick: RawLick): NoteSheetData {
  const nKey = normalizeKey(lick.key);
  const useFlats = true; // always use flats for lick display

  // Group events by bar
  const barMap = new Map<number, number[]>();
  for (let i = 0; i < lick.pitch.length; i++) {
    const b = lick.bar[i];
    if (!barMap.has(b)) barMap.set(b, []);
    barMap.get(b)!.push(i);
  }

  const measures: MeasureInfo[] = [];

  // Estimate beat duration from onset gaps (fallback 0.375s ≈ 160bpm)
  let avgBeatDur = 0.375;
  if (lick.tempo && lick.tempo > 0) {
    avgBeatDur = 60 / lick.tempo;
  }

  let firstBar = 0;
  let firstNoteBeat = 1;
  let isFirst = true;
  for (const [barNo, indices] of [...barMap.entries()].sort((a, b) => a[0] - b[0])) {
    const notes: NoteInfo[] = [];

    // Chord for this measure (first event's chord)
    const chordStr = lick.chords_per_event[indices[0]] ?? undefined;

    if (isFirst) {
      firstBar = barNo;
      firstNoteBeat = lick.beat[indices[0]] ?? 1; // WJD beat 은 1-based (1 = 다운비트)
      isFirst = false;
    }

    for (const idx of indices) {
      const midi = lick.pitch[idx];
      const dur = lick.duration[idx];
      const beats = dur / avgBeatDur;
      const q = quantise(beats);
      const { key: vk, acc } = midiToVex(midi, useFlats);

      // letter+accidental 이 절대음정인 컨벤션 — midiToVex 가 반환한 acc 는
      // 키 시그니처와 무관하게 항상 저장한다. (조표와 겹치는 경우 LickCard
      // 가 표시상 중복 ♭/♯ 을 안 그릴 뿐, 데이터에는 들어있어야 player 가
      // 올바른 음높이를 낸다.)
      const ni: NoteInfo = { keys: [vk], duration: q.vf, dotted: q.dot || undefined };
      if (acc) {
        ni.accidentals = { 0: acc };
      }
      notes.push(ni);
    }

    if (notes.length === 0) {
      notes.push({ keys: ['b/4'], duration: 'wr' });
    }

    measures.push({ notes, chord: chordStr });
  }

  // 마디 중간에서 시작하는 릭(진짜 픽업이 아니라 솔로 중간 발췌)은 첫 마디를
  // 온전한 한 마디로 채운다: 앞에 (firstNoteBeat-1)beat 쉼표를 넣어 첫 음을 제
  // beat 에 놓고, 남는 만큼 뒤를 쉼표로 채운다. 이러면 ① 첫 음 위치가 리듬섹션과
  // 맞고 ② 첫 마디가 꽉 차 픽업(anacrusis) 오검출(hasLeadingAnacrusis)이 사라져
  // 첫 마디가 잘려나가지 않는다. bar<=0 은 곡 도입부 진짜 픽업이므로 손대지 않고
  // 기존 anacrusis 처리에 맡긴다.
  if (firstBar >= 1 && measures[0]) {
    const tsNum = parseInt((lick.signature || '4/4').split('/')[0], 10) || 4;
    const lead = Math.max(0, firstNoteBeat - 1);
    const existing = measures[0].notes.reduce((s, n) => s + niBeatLen(n), 0);
    const trailing = Math.max(0, tsNum - lead - existing);
    measures[0] = {
      ...measures[0],
      notes: [...beatsToRests(lead), ...measures[0].notes, ...beatsToRests(trailing)],
    };
  }

  return {
    title: `${lick.performer} — ${lick.title}`,
    composer: lick.performer,
    key: nKey,
    timeSignature: lick.signature || '4/4',
    tempo: lick.tempo ?? undefined,
    measures,
  };
}

/* ─── Load from local JSON (frontend / 8000 licks) ───────────────── */

let cachedFrontendLicks: LickEntry[] | null = null;

export async function loadFrontendLicks(): Promise<LickEntry[]> {
  if (cachedFrontendLicks) return cachedFrontendLicks;
  const res = await fetch('/data/licks/licks.json');
  if (!res.ok) throw new Error(`licks.json ${res.status}`); // SPA 404→index.html 오진 방지
  const raw: RawLick[] = await res.json();
  cachedFrontendLicks = raw
    .filter((l) => l.n_events >= 8)
    .map((l) => ({
      id: l.id,
      performer: l.performer,
      title: l.title,
      instrument: l.instrument,
      style: l.style,
      tempo: l.tempo,
      key: l.key,
      rhythmfeel: l.rhythmfeel,
      tag: l.tag,
      chords: l.chords,
      nEvents: l.n_events,
      label: `#${l.id} ${l.performer} — ${l.title} [${l.style}] (${l.chords.join(' → ')})`,
      sheetData: lickToSheet(l),
      intervals: l.interval,
      parsons: l.parsons,
      fuzzyIntervals: l.fuzzy_interval,
      durationClasses: l.duration_class,
    }));
  return cachedFrontendLicks;
}

/* ─── Special 검수 후보: Charlie Parker (licks.json 기반) ───────────
 *
 * 195개 파커 릭을 '검수 후보군'으로 로드한다. LicksPage 의 'Special 후보'
 * 소스에서 사람이 하나씩 확인하고, 마음에 들면 승인(→ createLick)으로 실 DB
 * 에 저장한다. 백엔드는 (title, performer) 중복을 거부하는데 한 곡에 릭이
 * 여러 개라 제목이 겹치므로, 제목에 마디 접미사 "(m.13–14)"를 붙여 유일하게
 * 만든다(동일 마디범위가 또 겹치면 "·2, ·3" 을 덧붙임). */
let cachedParkerCandidates: LickEntry[] | null = null;

export async function loadParkerCandidates(): Promise<LickEntry[]> {
  if (cachedParkerCandidates) return cachedParkerCandidates;
  const res = await fetch('/data/licks/licks.json');
  if (!res.ok) throw new Error(`licks.json ${res.status}`); // SPA 404→index.html 오진 방지
  const raw: RawLick[] = await res.json();
  const seen = new Map<string, number>();
  cachedParkerCandidates = raw
    .filter((l) => l.performer === 'Charlie Parker')
    .map((l) => {
      const bars = l.bar.length ? l.bar : [0];
      const bmin = Math.min(...bars);
      const bmax = Math.max(...bars);
      const barLabel = bmin === bmax ? `${bmin}` : `${bmin}–${bmax}`;
      let title = `${l.title} (m.${barLabel})`;
      const n = (seen.get(title) ?? 0) + 1;
      seen.set(title, n);
      if (n > 1) title = `${title} ·${n}`;
      return {
        id: l.id,
        performer: l.performer,
        title,
        instrument: l.instrument,
        style: l.style,
        tempo: l.tempo,
        key: l.key,
        rhythmfeel: l.rhythmfeel,
        tag: l.tag,
        chords: l.chords,
        nEvents: l.n_events,
        label: `#${l.id} ${l.performer} — ${title}`,
        sheetData: lickToSheet(l),
        intervals: l.interval,
        parsons: l.parsons,
        fuzzyIntervals: l.fuzzy_interval,
        durationClasses: l.duration_class,
      };
    });
  return cachedParkerCandidates;
}

/* ─── Load from backup snapshot (145 licks, frozen 2026-05-18) ─────
 *
 * 백엔드 lick DB가 비워진 사고에 대응해 직전 운영 데이터의 정적 스냅샷을
 * public/data/licks/backend_backup_licks.json 으로 둠. 백엔드와 동일한
 * LickResponse 스키마라 toLickEntry 로 변환만 하면 그대로 카드에 렌더된다.
 * 백엔드가 복구되면 이 로더는 비활성/제거 후보. */

let cachedBackupLicks: LickEntry[] | null = null;

export async function loadBackupLicks(): Promise<LickEntry[]> {
  if (cachedBackupLicks) return cachedBackupLicks;
  const res = await fetch('/data/licks/backend_backup_licks.json');
  if (!res.ok) throw new Error(`backend_backup_licks.json ${res.status}`); // SPA 404→index.html 오진 방지
  const raw = await res.json();
  const { toLickEntry } = await import('../api/licks');
  cachedBackupLicks = raw.map(toLickEntry);
  return cachedBackupLicks!;
}

/* ─── Load from backend API (verified / 54 licks) ────────────────── */

let cachedLicks: LickEntry[] | null = null;

export async function loadLicks(): Promise<LickEntry[]> {
  if (cachedLicks) return cachedLicks;
  const { fetchAllLicks } = await import('../api/licks');
  cachedLicks = await fetchAllLicks();
  return cachedLicks;
}

/** Force refresh of the cached backend licks (e.g. after delete/create). */
export function invalidateLicksCache(): void {
  cachedLicks = null;
}

/* ─── Feature computation for custom licks ───────────────────────── */

const SEMI_MAP: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const DUR_BEATS_MAP: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };

function noteToMidi(key: string, acc?: '#' | 'b' | 'n'): number {
  const [n, o] = key.split('/');
  let s = SEMI_MAP[n] ?? 0;
  if (acc === '#') s += 1;
  if (acc === 'b') s -= 1;
  return (parseInt(o) + 1) * 12 + s;
}

function toFuzzy(iv: number): number {
  const abs = Math.abs(iv);
  const sign = iv > 0 ? 1 : iv < 0 ? -1 : 0;
  if (abs === 0) return 0;
  if (abs <= 2) return sign;
  if (abs <= 4) return 2 * sign;
  if (abs <= 7) return 3 * sign;
  return 4 * sign;
}

function durClass(dur: string, dotted?: boolean): number {
  const base = dur.replace(/r$/, '');
  let beats = DUR_BEATS_MAP[base] ?? 1;
  if (dotted) beats *= 1.5;
  if (beats >= 2) return 2;
  if (beats >= 1) return 1;
  if (beats >= 0.5) return 0;
  if (beats >= 0.25) return -1;
  return -2;
}

export function computeLickFeatures(measures: MeasureInfo[]): {
  intervals: number[]; parsons: number[]; fuzzyIntervals: number[]; durationClasses: number[];
} {
  const pitches: number[] = [];
  const durations: { dur: string; dotted?: boolean }[] = [];
  for (const m of measures) {
    for (const n of m.notes) {
      if (n.duration.endsWith('r')) continue;
      const acc = n.accidentals?.[0] as '#' | 'b' | 'n' | undefined;
      pitches.push(noteToMidi(n.keys[0], acc === 'n' ? undefined : acc));
      durations.push({ dur: n.duration, dotted: n.dotted });
    }
  }
  const intervals: number[] = [];
  for (let i = 1; i < pitches.length; i++) intervals.push(pitches[i] - pitches[i - 1]);
  const parsons = intervals.map((iv) => (iv > 0 ? 1 : iv < 0 ? -1 : 0));
  const fuzzyIntervals = intervals.map(toFuzzy);
  const durationClasses = durations.map((d) => durClass(d.dur, d.dotted));
  return { intervals, parsons, fuzzyIntervals, durationClasses };
}

/* ─── User-created lick persistence (localStorage + seed file) ──── */

/* 로컬 릭 저장소 — 로그인 사용자별로 네임스페이스를 나눈다. 같은 기기에서
 * 계정을 바꿔도 이전 사용자의 릭이 보이지 않는다. 레거시 전역 키
 * ('jazzify_user_licks')는 마이그레이션하지 않는다 — "내 릭은 처음엔 비어
 * 있고 직접 만든 것만" 이 원칙이라, 옛 공용 데이터를 새 계정에 끌어오지 않는다. */
const STORAGE_KEY = 'jazzify_user_licks';

function userLicksKey(): string {
  const me = getCachedUser();
  return me?.publicId ? `${STORAGE_KEY}:${me.publicId}` : `${STORAGE_KEY}:guest`;
}

let seedLicks: LickEntry[] | null = null;

async function loadSeedLicks(): Promise<LickEntry[]> {
  // The module cache was written but never READ — every loadUserLicks() call
  // re-fetched the JSON. Guard first, like cachedFrontendLicks/cachedBackupLicks.
  if (seedLicks) return seedLicks;
  try {
    const res = await fetch('/data/licks/user_licks.json');
    // SPA static hosts return index.html (200) for missing files — res.json()
    // would then die with a cryptic "Unexpected token <". Fail explicitly.
    if (!res.ok) throw new Error(`user_licks.json ${res.status}`);
    seedLicks = await res.json();
    return seedLicks!;
  } catch {
    seedLicks = [];
    return [];
  }
}

function loadLocalLicks(): LickEntry[] {
  try {
    const raw = localStorage.getItem(userLicksKey());
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Corrupt/foreign value under our key (non-array) → treat as empty
    // instead of letting callers .filter()/.map() crash. (soloData has the
    // same Array.isArray guard.)
    return Array.isArray(parsed) ? (parsed as LickEntry[]) : [];
  } catch {
    return [];
  }
}

export async function loadUserLicks(): Promise<LickEntry[]> {
  const [seed, local] = await Promise.all([loadSeedLicks(), Promise.resolve(loadLocalLicks())]);
  const seedIds = new Set(seed.map((l) => l.id));
  const merged = [...seed, ...local.filter((l) => !seedIds.has(l.id))];

  // AI 생성 릭 제외: 음수 ID(_genId--) 또는 performer === 'AI 생성'
  const filtered = merged.filter((l) => {
    const idNum = typeof l.id === 'number' ? l.id : Number(l.id);
    if (Number.isFinite(idNum) && idNum < 0) return false;
    if (l.performer === 'AI 생성') return false;
    return true;
  });

  // 정렬: ID 내림차순 (= 최근 → 옛날, 맨 옛날 = 1번)
  filtered.sort((a, b) => {
    const an = typeof a.id === 'number' ? a.id : Number(a.id);
    const bn = typeof b.id === 'number' ? b.id : Number(b.id);
    return bn - an;
  });

  return filtered;
}

/* ─── "내 릭" (로그인 사용자 전용) ───────────────────────────────
 *
 * 릭 데이터베이스(관리자 화면)와 달리 여기엔 백엔드 전체 릭이 들어오면 안 된다.
 * 처음엔 비어 있고, 사용자가 직접 만든 릭(에디터 저장 / OMR 생성 / 채팅 카드
 * 저장)만 쌓인다. 구성:
 *   1) 백엔드에 저장된 릭 중 `source==='user'` 이고 `userId === 내 publicId` 인 것
 *   2) 로컬에만 있는 릭(사용자별 localStorage 네임스페이스)
 * seed 파일(user_licks.json)은 의도적으로 병합하지 않는다 — 그게 "처음부터
 * 남의 릭이 들어차 있던" 원인이었다.
 *
 * GET /v1/licks 에 owner 필터가 없어(BR-10) 전체를 받아 클라에서 거른다.
 * 백엔드에 필터가 생기면 fetchAllLicks 대신 그 쿼리로 바꾸면 된다. */
export async function loadMyLicks(): Promise<LickEntry[]> {
  const me = getCachedUser();
  const local = loadLocalLicks();

  let mine: LickEntry[] = [];
  if (me?.publicId) {
    try {
      const all = await loadLicks();
      mine = all.filter((l) => l.source === 'user' && l.userId === me.publicId);
    } catch (e) {
      // 백엔드 실패는 치명적이지 않다 — 로컬 릭만으로 화면을 채운다.
      console.warn('[lickData] loadMyLicks: backend fetch failed, local only', e);
    }
  }

  // 백엔드가 진실원천 — 같은 id 는 백엔드 판을 남기고 로컬 중복을 버린다.
  const backendIds = new Set(mine.map((l) => String(l.id)));
  const merged = [...mine, ...local.filter((l) => !backendIds.has(String(l.id)))];

  // AI 생성 릭 제외 (음수 id 또는 performer === 'AI 생성')
  return merged.filter((l) => {
    const idNum = typeof l.id === 'number' ? l.id : Number(l.id);
    if (Number.isFinite(idNum) && idNum < 0) return false;
    return l.performer !== 'AI 생성';
  });
}

export function loadUserLicksSync(): LickEntry[] {
  const filtered = loadLocalLicks().filter((l) => {
    const idNum = typeof l.id === 'number' ? l.id : Number(l.id);
    if (Number.isFinite(idNum) && idNum < 0) return false;
    if (l.performer === 'AI 생성') return false;
    return true;
  });
  filtered.sort((a, b) => {
    const an = typeof a.id === 'number' ? a.id : Number(a.id);
    const bn = typeof b.id === 'number' ? b.id : Number(b.id);
    return bn - an;
  });
  return filtered;
}

export function saveUserLick(lick: LickEntry): void {
  const existing = loadLocalLicks().filter((l) => String(l.id) !== String(lick.id));
  existing.unshift(lick);
  // setItem can throw (QuotaExceeded — sheetData-heavy entries add up).
  // Swallow with a warn like every other localStorage write in the codebase:
  // a failed local mirror must not surface as "save failed" after the
  // backend save already succeeded (EditorPage flow).
  try {
    localStorage.setItem(userLicksKey(), JSON.stringify(existing));
  } catch (e) {
    console.warn('[lickData] saveUserLick: localStorage write failed', e);
  }
}

export function deleteUserLick(id: number | string): void {
  const existing = loadLocalLicks().filter((l) => String(l.id) !== String(id));
  try {
    localStorage.setItem(userLicksKey(), JSON.stringify(existing));
  } catch (e) {
    console.warn('[lickData] deleteUserLick: localStorage write failed', e);
  }
}
