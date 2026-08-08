/**
 * 조성 추천(keySuggest) 회귀 테스트.
 *
 * keySuggest.ts 주석이 "실측으로 확정했다"고 기록한 곡들을 실제 코드 진행으로
 * 고정한다. 채점 가중치는 이 곡들 사이의 균형으로 튜닝돼 있어서, 한 곡을 고치면
 * 다른 곡이 조용히 깨지기 쉽다 — 그걸 막는 것이 이 파일의 목적이다.
 *
 * 재즈에서 ii 는 반복 토닉화되어(리듬 체인지의 Cm, All of Me 의 Dm, F 블루스의
 * Gm, Tea For Two 의 Bbm) 진짜 으뜸조를 점수에서 앞지르는 일이 구조적으로 흔하다.
 * 각 곡은 "정답 키가 1위인가"를 묻는다.
 *
 * 실행: npx tsx src/components/leadsheet/__tests__/keySuggest.test.ts
 */
import { suggestKeys } from '../keySuggest';
import type { LeadSheetData } from '../../../data/leadSheetTypes';

let pass = 0;
let fail = 0;
const failures: string[] = [];

/** "Bbm7" 같은 심볼을 LeadSheetChord 로 쪼갠다. */
function sym(s: string) {
  const m = /^([A-G])([b#]?)(.*)$/.exec(s);
  if (!m) throw new Error(`bad symbol: ${s}`);
  return { root: m[1], accidental: (m[2] || undefined) as 'b' | '#' | undefined, quality: m[3] || '' };
}

/** 코드 심볼 배열 → LeadSheetData (마디당 2코드). */
function sheet(key: string, symbols: string[]): LeadSheetData {
  const bars = [];
  for (let i = 0; i < symbols.length; i += 2) {
    bars.push({ chords: symbols.slice(i, i + 2).map(sym) });
  }
  return { key, systems: [{ bars }] } as unknown as LeadSheetData;
}

function expectTopKey(song: string, data: LeadSheetData, expected: string): void {
  const r = suggestKeys(data);
  const rank = r.ranked.findIndex((x) => x.key === expected) + 1;
  if (r.best.key === expected) {
    pass++;
  } else {
    fail++;
    failures.push(
      `  ✗ ${song}: 1위가 "${r.best.key}"(${r.best.score.toFixed(1)}) — 정답 "${expected}"는 ${rank}위(${r.ranked[rank - 1]?.score.toFixed(1)})`,
    );
  }
}

/* ── 1. Tea For Two (Ab) ────────────────────────────────────────────────
 * ii(Bbm7)로 시작해 ii 가 토닉(Abmaj7)보다 자주 나오고, 곡이 `Ab6 Cm7b5 F7b9`
 * 턴어라운드로 끝난다 — 진짜 종지 Ab6 가 뒤에서 셋째라 종지 점수를 놓치기 쉽다. */
const teaForTwo = [
  'Bbm7', 'Eb7', 'Bbm7', 'Eb7', 'Abmaj7', 'D', 'Cm7', 'F7',
  'BbmMaj7', 'Eb7', 'BbmMaj7', 'Eb7', 'Abmaj7', 'Abmaj7', 'Dm7', 'G7',
  'Dm7', 'G7', 'Cbmaj7', 'F7', 'Em7', 'Ab7', 'Dm7', 'G7',
  'Dm7', 'G7', 'Cbmaj7', 'Eb7', 'Bbm7', 'Eb7', 'Bbm7', 'Eb7',
  'Abmaj7', 'D', 'Cm7', 'F7', 'Bbm7', 'Eb7', 'Bbm7', 'Eb7',
  'Cdim7', 'F7b9', 'BbmMaj7', 'Cdim7', 'Dbmaj7', 'Cdim7', 'BbmMaj7', 'Bbm7',
  'Gb7', 'Cm7', 'Bdim7', 'Bbm7', 'Eb7', 'Ab6', 'Cm7b5', 'F7b9',
];
expectTopKey('Tea For Two', sheet('C', teaForTwo), 'Ab');

/* ── 2. 리듬 체인지 (Bb) ─────────────────────────────────────────────────
 * 주석 실측: "Bb 113 vs Cm 168" — G7→Cm7 이 반복돼 ii 인 Cm 이 이기던 케이스.
 * 마지막 A 도 `Bb6 Cm7 F7` 턴어라운드로 끝난다. */
const rhythmChanges = [
  'Bb6', 'G7', 'Cm7', 'F7', 'Dm7', 'G7', 'Cm7', 'F7',
  'Bb6', 'Bb7', 'Eb6', 'Edim7', 'Bb6', 'G7', 'Cm7', 'F7',
  'Bb6', 'G7', 'Cm7', 'F7', 'Dm7', 'G7', 'Cm7', 'F7',
  'Bb6', 'Bb7', 'Eb6', 'Edim7', 'Bb6', 'F7', 'Bb6', 'Bb6',
  'D7', 'D7', 'D7', 'D7', 'G7', 'G7', 'G7', 'G7',
  'C7', 'C7', 'C7', 'C7', 'F7', 'F7', 'F7', 'F7',
  'Bb6', 'G7', 'Cm7', 'F7', 'Dm7', 'G7', 'Cm7', 'F7',
  'Bb6', 'Bb7', 'Eb6', 'Edim7', 'Bb6', 'Cm7', 'F7',
];
expectTopKey('리듬 체인지', sheet('C', rhythmChanges), 'Bb');

/* ── 3. All of Me (C) ───────────────────────────────────────────────────
 * 주석 실측: ii-V-i 가 여러 번 있어 Dm 이 C 를 이기던 케이스.
 * 턴어라운드 없이 C6 로 끝난다(대조군 — 종지 규칙을 건드려도 안 변해야 함). */
const allOfMe = [
  'C6', 'C6', 'E7', 'E7', 'A7', 'A7', 'Dm7', 'Dm7',
  'E7', 'E7', 'Am7', 'Am7', 'D7', 'D7', 'Dm7', 'G7',
  'C6', 'C6', 'E7', 'E7', 'A7', 'A7', 'Dm7', 'Dm7',
  'F6', 'Fm6', 'Em7', 'A7', 'Dm7', 'G7', 'C6', 'C6',
];
expectTopKey('All of Me', sheet('C', allOfMe), 'C');

/* ── 4. F 블루스 ────────────────────────────────────────────────────────
 * 주석 실측: "F 100.0 vs Gm 157.4" — D7→Gm7 이 두 번 나와 Gm 이 이기던 케이스.
 * 블루스는 으뜸화음이 I7(도미넌트)이고 마지막이 C7 턴어라운드다. */
const fBlues = [
  'F7', 'F7', 'Bb7', 'Bb7', 'F7', 'F7', 'F7', 'F7',
  'Bb7', 'Bb7', 'Bb7', 'Bb7', 'F7', 'F7', 'D7', 'D7',
  'Gm7', 'Gm7', 'C7', 'C7', 'F7', 'D7', 'Gm7', 'C7',
];
expectTopKey('F 블루스', sheet('C', fBlues), 'F');

/* ── 5. 현재 키가 이미 맞으면 침묵하는가 ───────────────────────────────── */
{
  const r = suggestKeys(sheet('Ab', teaForTwo));
  if (!r.shouldSuggest) pass++;
  else {
    fail++;
    failures.push(`  ✗ Tea For Two: 이미 Ab 인데도 "${r.best.key}" 로 바꾸라고 제안함`);
  }
}

console.log('\n=== keySuggest test ===');
console.log(`${pass} pass / ${fail} fail (${pass + fail} total)\n`);
if (fail > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
} else {
  console.log('✓ All tests passed');
}

process.exit(fail > 0 ? 1 : 0);
