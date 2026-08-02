/**
 * 드럼 보표 표기 — GM 퍼커션 키(데이터의 진실) ↔ 오선 위치·노트헤드 매핑.
 *
 * 드럼 파트의 NoteInfo.keys 는 **소리 나는 GM 퍼커션 MIDI 그대로**의 vex key 다
 * (예: 킥 36 = 'c/2'). 재생 스택(noteSheetToChart → gmPercToDrumPiece)이 이미
 * 이 규약을 소비하므로 재생은 공짜다. 화면에서는 이 모듈로 표준 드럼 표기
 * 위치(percussion clef 5선)와 노트헤드(✕/◆)로 바꿔 그린다.
 *
 * 표기 규칙은 통용 드럼 표기(Norman Weinberg 표준안 계열):
 *   킥 f/4 · 스네어 c/5 · 플로어탐 a/4 · 미드탐 d/5 · 하이탐 e/5
 *   하이햇 g/5(✕) · 라이드 f/5(✕) · 크래시 a/5(✕) · 라이드벨 f/5(◆)
 */
import { gmPercToDrumPiece } from './gmInstruments';

export interface DrumPaletteItem {
  /** 엔진 DrumPiece id (재생 음색) — gmInstruments 매핑과 일치. */
  piece: string;
  /** 데이터에 저장되는 GM 퍼커션 MIDI. */
  gm: number;
  /** 저장 keys 값 (gm 을 vex key 로 그대로 적은 것). */
  dataKey: string;
  label: string;
  /** 팔레트 버튼의 짧은 표기. */
  short: string;
  /** 화면 표기 위치 (percussion clef). */
  displayKey: string;
  /** VexFlow StaveNoteStruct.type — 'x' 등. 없으면 일반 타원 머리. */
  head?: string;
}

/** GM MIDI → vex key ('c/2' 식). 데이터 저장용. */
export function gmToVexKey(gm: number): string {
  const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
  return `${NAMES[gm % 12]}/${Math.floor(gm / 12) - 1}`;
}

/** 입력 팔레트 — 표기 위치가 아래(발)에서 위(심벌)로. */
export const DRUM_PALETTE: DrumPaletteItem[] = [
  { piece: 'kick',         gm: 36, dataKey: gmToVexKey(36), label: '킥',            short: 'K',  displayKey: 'f/4' },
  { piece: 'snare',        gm: 38, dataKey: gmToVexKey(38), label: '스네어',        short: 'S',  displayKey: 'c/5' },
  { piece: 'rim',          gm: 37, dataKey: gmToVexKey(37), label: '림샷',          short: 'Rm', displayKey: 'c/5', head: 'x' },
  { piece: 'tom-low',      gm: 43, dataKey: gmToVexKey(43), label: '플로어 탐',     short: 'T3', displayKey: 'a/4' },
  { piece: 'tom-mid',      gm: 47, dataKey: gmToVexKey(47), label: '미드 탐',       short: 'T2', displayKey: 'd/5' },
  { piece: 'tom-high',     gm: 50, dataKey: gmToVexKey(50), label: '하이 탐',       short: 'T1', displayKey: 'e/5' },
  { piece: 'hihat-closed', gm: 42, dataKey: gmToVexKey(42), label: '하이햇(닫힘)',  short: 'HH', displayKey: 'g/5', head: 'x' },
  { piece: 'hihat-open',   gm: 46, dataKey: gmToVexKey(46), label: '하이햇(열림)',  short: 'HO', displayKey: 'g/5', head: 'x' },
  { piece: 'ride',         gm: 51, dataKey: gmToVexKey(51), label: '라이드',        short: 'Rd', displayKey: 'f/5', head: 'x' },
  { piece: 'ride-bell',    gm: 53, dataKey: gmToVexKey(53), label: '라이드 벨',     short: 'RB', displayKey: 'f/5', head: 'd' },
  { piece: 'crash',        gm: 49, dataKey: gmToVexKey(49), label: '크래시',        short: 'Cr', displayKey: 'a/5', head: 'x' },
];

const BY_GM = new Map(DRUM_PALETTE.map((p) => [p.gm, p]));

/** 팔레트 밖 GM 키의 표준 표기 — MusicXML/외부 악보 수입분까지 사람 악보처럼.
 *  (piece 폴백은 소리 기준이라 표기 위치가 뭉개진다 — 예: 페달 하이햇이 g/5 로.) */
const EXTRA_GM_DISPLAY: Record<number, { displayKey: string; head?: string }> = {
  35: { displayKey: 'f/4' },                 // 어쿠스틱 베이스드럼
  39: { displayKey: 'c/5', head: 'x' },      // 핸드클랩 — 스네어 자리 ✕
  40: { displayKey: 'c/5' },                 // 일렉 스네어
  41: { displayKey: 'a/4' },                 // 로우 플로어탐
  44: { displayKey: 'd/4', head: 'x' },      // 페달 하이햇 — 보표 아래 ✕ (발)
  45: { displayKey: 'd/5' },                 // 로우탐
  48: { displayKey: 'e/5' },                 // 하이미드탐
  52: { displayKey: 'b/5', head: 'x' },      // 차이나
  55: { displayKey: 'b/5', head: 'x' },      // 스플래시
  57: { displayKey: 'b/5', head: 'x' },      // 크래시 2
  59: { displayKey: 'f/5', head: 'x' },      // 라이드 2
};

/** 발로 치는 조각의 GM 퍼커션 MIDI — 베이스드럼 35·36, 하이햇 페달 44.
 *  통용 드럼 표기에서 이들만 기둥이 아래로 간다(나머지는 손 = 위). */
export const DRUM_FOOT_GM = new Set([35, 36, 44]);

/** 열린 하이햇 — 표기에서 음표 위에 ○ 를 얹는다(통용 기호). */
export function isOpenHihatGm(gm: number): boolean {
  return gm === 46;
}

/** GM MIDI → 표기. 팔레트 밖 GM 키(가져온 악보 등)는 gmPercToDrumPiece 로
 *  가장 가까운 킷 보이스를 찾아 그 표기를 빌린다. 그래도 없으면 스네어 자리. */
export function drumDisplayForGm(gm: number): { displayKey: string; head?: string } {
  const hit = BY_GM.get(gm);
  if (hit) return { displayKey: hit.displayKey, head: hit.head };
  const extra = EXTRA_GM_DISPLAY[gm];
  if (extra) return extra;
  const piece = gmPercToDrumPiece(gm);
  const byPiece = piece ? DRUM_PALETTE.find((p) => p.piece === piece) : null;
  if (byPiece) return { displayKey: byPiece.displayKey, head: byPiece.head };
  return { displayKey: 'c/5' };
}

/** vex key('c/2') → MIDI. 드럼 keys 해석용(임시표·조표 없음 — 데이터가 절대값). */
export function vexKeyToMidi(key: string): number {
  const [note, octStr] = key.split('/');
  const SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  let s = SEMI[note[0].toLowerCase()] ?? 0;
  for (const ch of note.slice(1)) {
    if (ch === '#') s += 1;
    else if (ch === 'b') s -= 1;
  }
  return (parseInt(octStr, 10) + 1) * 12 + s;
}
