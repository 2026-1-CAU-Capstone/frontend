/**
 * 화성 분석용 코드 성질 정규화 회귀 테스트.
 *
 * 배경(실측 버그): `harmonyAnalyzer` 의 QUALITY_MAP 이 대시(`-`) 표기만 알아서
 * `m7`·`maj7`·`m7b5`·`dim7` 같은 표기가 어떤 패턴에도 안 걸리고 기본값 `'maj'`
 * 로 떨어졌다. OMR·사용자 입력이 m 표기인 곡은 **코드가 통째로 메이저로
 * 오분석**됐다 — Tea For Two(Ab조)에서 `Bbm7` 이 Bb장조 으뜸화음으로 인정돼
 * 조성 추천이 정답 Ab 를 제치고 Bb 를 1위로 올렸다.
 *
 * 여기서 잠그는 것: **표기가 달라도 같은 성질로 정규화되는가.**
 * 정규화는 private 이라 공개 경로(analyzeHarmony → analysis.normalizedQuality)로 잰다.
 *
 * 실행: npx tsx src/lib/__tests__/harmonyQuality.test.ts
 */
import { analyzeHarmony } from '../harmonyAnalyzer';
import type { LeadSheetData } from '../../data/leadSheetTypes';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(name: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else {
    fail++;
    failures.push(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(expected === actual ? actual : actual)}`);
  }
}

/** 코드 심볼 하나를 분석해 normalizedQuality 를 돌려준다. */
function qualityOf(root: string, quality: string, accidental?: 'b' | '#'): string | undefined {
  const data: LeadSheetData = {
    key: 'C',
    systems: [{ bars: [{ chords: [{ root, accidental, quality }] }] }],
  } as unknown as LeadSheetData;
  analyzeHarmony(data);
  return data.systems[0].bars[0].chords[0].analysis?.normalizedQuality;
}

/* ── 1. 같은 성질의 서로 다른 표기가 하나로 모이는가 ────────────────────── */

check('마이너7: m7 == -7 == min7',
  ['m7', '-7', 'min7'].map((q) => qualityOf('B', q, 'b')),
  ['min7', 'min7', 'min7']);

check('메이저7: maj7 == M7 == △7 == ^7',
  ['maj7', 'M7', '△7', '^7'].map((q) => qualityOf('A', q, 'b')),
  ['maj7', 'maj7', 'maj7', 'maj7']);

check('하프디미니시드: m7b5 == -7b5 == h7 == ø7',
  ['m7b5', '-7b5', 'h7', 'ø7'].map((q) => qualityOf('C', q)),
  ['min7b5', 'min7b5', 'min7b5', 'min7b5']);

check('디미니시드7: dim7 == o7 == °7',
  ['dim7', 'o7', '°7'].map((q) => qualityOf('C', q)),
  ['dim7', 'dim7', 'dim7']);

check('마이너 3화음: m == - == min',
  ['m', '-', 'min'].map((q) => qualityOf('C', q)),
  ['min', 'min', 'min']);

/* ── 2. 회귀의 핵심 — m 표기가 maj 로 새지 않는가 ──────────────────────── */

check('Bbm7 은 min7 (버그 때 maj 였음)', qualityOf('B', 'm7', 'b'), 'min7');
check('Cm 은 min (버그 때 maj)', qualityOf('C', 'm'), 'min');
check('Cm7b5 는 min7b5 (버그 때 maj)', qualityOf('C', 'm7b5'), 'min7b5');
check('Cdim7 은 dim7 (버그 때 maj)', qualityOf('C', 'dim7'), 'dim7');

/* `maj7` 은 m 으로 시작하지만 **메이저**다 — m 패턴이 앞서면 여기서 깨진다. */
check('Abmaj7 은 maj7 (m 으로 시작하지만 메이저)', qualityOf('A', 'maj7', 'b'), 'maj7');
/* `mMaj7`(마이너 메이저7)은 마이너 계열이다 — maj 패턴에 먼저 걸리면 안 된다. */
check('BbmMaj7 은 마이너 계열', qualityOf('B', 'mMaj7', 'b'), 'minMaj7');

/* ── 3. 기존에 동작하던 표기가 그대로인가(회귀 방지) ───────────────────── */

check('도미넌트7: 7', qualityOf('E', '7', 'b'), 'dom7');
check('도미넌트 텐션: 7b9 도 dom7', qualityOf('F', '7b9'), 'dom7');
check('메이저6: 6', qualityOf('A', '6', 'b'), 'maj6');
check('빈 quality 는 maj', qualityOf('C', ''), 'maj');

console.log('\n=== harmony quality normalization test ===');
console.log(`${pass} pass / ${fail} fail (${pass + fail} total)\n`);
if (fail > 0) {
  console.log('FAILURES:');
  failures.forEach((f) => console.log(f));
} else {
  console.log('✓ All tests passed');
}

process.exit(fail > 0 ? 1 : 0);
