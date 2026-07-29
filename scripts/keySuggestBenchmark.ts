/**
 * 조성 추천 정확도 벤치마크 — iReal Pro 1460곡 전수.
 *
 * `public/jazz1460.json` 은 곡마다 iReal Pro 가 명시한 `key`(정답)와 코드
 * 진행(`systems`)을 함께 갖고 있다. 각 곡의 코드만 보고 `suggestKeys` 가
 * 1순위로 고른 키가 그 정답과 맞는지, 틀리면 정답이 몇 순위인지 집계한다.
 *
 * 실행:
 *   npx tsx scripts/keySuggestBenchmark.ts            # 요약
 *   npx tsx scripts/keySuggestBenchmark.ts --misses   # 오답 목록까지
 *   npx tsx scripts/keySuggestBenchmark.ts --limit 200
 */
import { readFileSync } from 'node:fs';
import { suggestKeys, canonicalKey } from '../src/components/leadsheet/keySuggest';
import type { LeadSheetData } from '../src/data/leadSheetTypes';

interface Song {
  title: string;
  composer?: string;
  key: string;
  timeSignature?: string;
  style?: string;
  systems: LeadSheetData['systems'];
}

const args = process.argv.slice(2);
const showMisses = args.includes('--misses');
const limitArg = args.indexOf('--limit');
const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

const songs: Song[] = JSON.parse(
  readFileSync(new URL('../public/jazz1460.json', import.meta.url), 'utf8'),
);

interface Row {
  title: string;
  truth: string;
  top: string;
  rank: number;          // 정답의 순위 (1 = 정답)
  gap: number;           // 1위 점수 − 정답 점수
  relative: string;      // 정답 대비 1위가 무슨 관계인가 (ii, vi, 나란한조 …)
}

/** 정답 키 대비 오답 키의 음악적 관계 — 오답 패턴을 읽기 위한 라벨. */
const NOTE_TO_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function keyPc(k: string): number {
  const base = NOTE_TO_PC[k[0]] ?? 0;
  const acc = k[1] === '#' ? 1 : k[1] === 'b' ? -1 : 0;
  return (base + acc + 12) % 12;
}
function isMinorKey(k: string): boolean { return k.endsWith('m'); }

function relation(truth: string, guess: string): string {
  if (truth === guess) return '-';
  const dt = ((keyPc(guess) - keyPc(truth)) + 12) % 12;
  const tm = isMinorKey(truth);
  const gm = isMinorKey(guess);
  if (dt === 0) return gm === tm ? '동일근음' : (gm ? '동주단조' : '동주장조');
  if (!tm && gm && dt === 2) return 'ii(단조)';
  if (!tm && gm && dt === 9) return 'vi(나란한단조)';
  if (!tm && gm && dt === 4) return 'iii(단조)';
  if (tm && !gm && dt === 3) return 'III(나란한장조)';
  if (!tm && !gm && dt === 7) return 'V';
  if (!tm && !gm && dt === 5) return 'IV';
  if (!tm && !gm && dt === 2) return 'II';
  if (gm && dt === 7) return 'v';
  return `${dt}반음${gm ? '단조' : '장조'}`;
}

const rows: Row[] = [];
let skipped = 0;

const t0 = Date.now();
for (const song of songs.slice(0, limit)) {
  if (!song.systems?.length || !song.key) { skipped++; continue; }
  const truth = canonicalKey(song.key);
  let r;
  try {
    r = suggestKeys({ key: truth, systems: song.systems } as LeadSheetData);
  } catch {
    skipped++;
    continue;
  }
  const rank = r.ranked.findIndex((x) => x.key === truth) + 1;
  if (rank === 0) { skipped++; continue; }
  rows.push({
    title: song.title,
    truth,
    top: r.best.key,
    rank,
    gap: r.best.score - r.ranked[rank - 1].score,
    relative: relation(truth, r.best.key),
  });
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

/* ── 집계 ─────────────────────────────────────────────────────────────── */
const n = rows.length;
const top1 = rows.filter((x) => x.rank === 1).length;
const top2 = rows.filter((x) => x.rank <= 2).length;
const top3 = rows.filter((x) => x.rank <= 3).length;
const top5 = rows.filter((x) => x.rank <= 5).length;
const pct = (v: number) => `${((v / n) * 100).toFixed(1)}%`;

console.log(`\n=== 조성 추천 정확도 — iReal Pro ${n}곡 (${elapsed}s, 제외 ${skipped}곡) ===\n`);
console.log(`  1순위 적중   ${String(top1).padStart(5)} / ${n}   ${pct(top1)}`);
console.log(`  2순위 이내   ${String(top2).padStart(5)} / ${n}   ${pct(top2)}`);
console.log(`  3순위 이내   ${String(top3).padStart(5)} / ${n}   ${pct(top3)}`);
console.log(`  5순위 이내   ${String(top5).padStart(5)} / ${n}   ${pct(top5)}`);

const misses = rows.filter((x) => x.rank > 1);
const avgRank = misses.length
  ? (misses.reduce((s, x) => s + x.rank, 0) / misses.length).toFixed(2) : '-';
console.log(`\n  오답 ${misses.length}곡의 정답 평균 순위: ${avgRank}`);

/* 오답 패턴 — 어떤 관계의 키로 잘못 가는가 */
const byRel = new Map<string, number>();
for (const m of misses) byRel.set(m.relative, (byRel.get(m.relative) ?? 0) + 1);
console.log('\n  ── 오답 패턴 (1위가 정답 대비 무엇인가) ──');
for (const [rel, cnt] of [...byRel.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
  console.log(`     ${rel.padEnd(14)} ${String(cnt).padStart(4)}곡  ${pct(cnt)}`);
}

/* 장/단조별 */
const major = rows.filter((x) => !isMinorKey(x.truth));
const minor = rows.filter((x) => isMinorKey(x.truth));
const acc = (a: Row[]) => (a.length ? `${((a.filter((x) => x.rank === 1).length / a.length) * 100).toFixed(1)}%` : '-');
console.log(`\n  ── 정답 키 성격별 1순위 적중률 ──`);
console.log(`     장조 ${String(major.length).padStart(4)}곡  ${acc(major)}`);
console.log(`     단조 ${String(minor.length).padStart(4)}곡  ${acc(minor)}`);

if (showMisses) {
  console.log(`\n  ── 오답 전체 (${misses.length}곡) ──`);
  console.log('     정답  1위   순위  점수차  관계          곡명');
  for (const m of misses.sort((a, b) => b.gap - a.gap)) {
    console.log(
      `     ${m.truth.padEnd(5)} ${m.top.padEnd(5)} ${String(m.rank).padStart(4)} ${m.gap.toFixed(1).padStart(7)}  ${m.relative.padEnd(13)} ${m.title}`,
    );
  }
}
console.log('');
