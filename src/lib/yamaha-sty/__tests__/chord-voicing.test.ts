/**
 * chord-voicing tests — heapPermutation, computeParallelChord, distance,
 * matching score. Verifies the building blocks of fitChordPhrase before we
 * wire them up.
 */
import { ChordSymbol } from '../../jazz-harmony';
import {
  heapPermutation, chordFromPitches, chordDistance,
  computeParallelChord, chordMatchingScore,
  upperPitch, lowerPitch,
} from '../chord-voicing';

let pass = 0, fail = 0;
const fails: string[] = [];
function assert(c: boolean, msg: string) {
  if (c) pass++;
  else { fail++; fails.push('  ✗ ' + msg); }
}

/* ─── heapPermutation ────────────────────────────────────────────────── */
{
  const perms = heapPermutation([1, 2, 3]);
  assert(perms.length === 6, `3! = 6 permutations (got ${perms.length})`);
  const unique = new Set(perms.map((p) => p.join(',')));
  assert(unique.size === 6, 'all 6 unique');
  for (const p of perms) {
    assert(p.length === 3 && p.includes(1) && p.includes(2) && p.includes(3),
      `permutation has all 3 elements: ${p}`);
  }
}
{
  const perms = heapPermutation([1, 2, 3, 4, 5]);
  assert(perms.length === 120, `5! = 120 (got ${perms.length})`);
}
{
  const perms = heapPermutation(['a']);
  assert(perms.length === 1 && perms[0][0] === 'a', '1! = 1');
}
try { heapPermutation([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]); fail++; fails.push('  ✗ size 10 should throw'); }
catch { pass++; }

/* ─── upperPitch / lowerPitch ────────────────────────────────────────── */
assert(upperPitch(60, 4) === 64, 'upperPitch(C4, E) = E4');
assert(upperPitch(60, 0) === 60, 'upperPitch(C4, C) = C4 (inclusive)');
assert(upperPitch(60, 0, false) === 72, 'upperPitch(C4, C, !inclusive) = C5');
assert(lowerPitch(60, 4) === 52, 'lowerPitch(C4, E) = E3');
assert(lowerPitch(60, 0) === 60, 'lowerPitch(C4, C) = C4 (inclusive)');
assert(lowerPitch(60, 0, false) === 48, 'lowerPitch(C4, C, !inclusive) = C3');

/* ─── chordFromPitches ───────────────────────────────────────────────── */
{
  const c = chordFromPitches([67, 60, 64, 60]); // duplicates
  assert(c.length === 3 && c[0] === 60 && c[1] === 64 && c[2] === 67, 'sorted+deduped');
}

/* ─── chordDistance ──────────────────────────────────────────────────── */
{
  const d = chordDistance([60, 64, 67], [60, 64, 67]);
  assert(d === 0, 'identical chords distance 0');
}
{
  const d = chordDistance([60, 64, 67], [62, 65, 69]);
  // |60-62|+|64-65|+|67-69| = 2+1+2 = 5
  assert(d === 5, `dm vs Cm distance = 5 (got ${d})`);
}

/* ─── computeParallelChord ───────────────────────────────────────────── */
// CMaj triad [C4=60, E4=64, G4=67] mapped onto Am triad (relPitches [9, 0, 4])
// startBelow=true → first note (C4) → lowerPitch(60, 9) = 57 (A3)
// Then E4 → next pc=0 after 57 = 60 (C4), G4 → next pc=4 after 60 = 64 (E4)
// Result: [57, 60, 64] = A3 C4 E4 — A minor in root position above 57
{
  const src = [60, 64, 67]; // C major
  // Am triad relPitches: A=9, C=0, E=4 — but our parallel chord needs to map
  // unique src pcs in order: C→9, E→0, G→4? No wait — we pass *one relPitch
  // per unique src pc* in src order. C is 1st, E 2nd, G 3rd. So if dest is
  // [Am.ROOT, Am.b3, Am.5] = [A, C, E] we pass relPitches [9, 0, 4].
  const out = computeParallelChord(src, [9, 0, 4], true);
  assert(out.length === 3, '3 notes out');
  assert(((out[0] % 12) + 12) % 12 === 9, `first note pc=A (got ${out[0]})`);
  assert(((out[1] % 12) + 12) % 12 === 0, `second note pc=C`);
  assert(((out[2] % 12) + 12) % 12 === 4, `third note pc=E`);
  // Ascending
  assert(out[0] < out[1] && out[1] < out[2], 'ascending order');
}

// startBelow=false starts above the first src note
{
  const src = [60, 64, 67];
  const out = computeParallelChord(src, [9, 0, 4], false);
  assert(out[0] >= 60, `first dest note ${out[0]} >= 60`);
}

/* ─── chordMatchingScore ─────────────────────────────────────────────── */
// Identity: same chord, same type → score 0 + bottom/top deltas 0
{
  const ct = ChordSymbol.parse('CM7').chordType;
  const c = [60, 64, 67, 71];
  const score = chordMatchingScore(c, c, ct, 0);
  assert(score === 0, `identity score 0 (got ${score})`);
}

// Different size → 10000
{
  const ct = ChordSymbol.parse('CM7').chordType;
  const score = chordMatchingScore([60, 64], [60, 64, 67], ct, 0);
  assert(score === 10000, 'size mismatch returns 10000');
}

// Top voice 3x weight + bottom 1x weight
{
  const ct = ChordSymbol.parse('CM7').chordType;
  const src = [60, 64, 67];
  const dest = [60, 64, 70]; // top moved up 3
  const score = chordMatchingScore(src, dest, ct, 0);
  // distance = |60-60|+|64-64|+|67-70| = 3
  // top delta = |67-70| = 3 → contributes 3*3 = 9
  // bottom delta = 0
  // No penalties (size=3, not 13 chord, etc.)
  assert(score === 3 + 9, `score = distance + 3*topDelta = 12 (got ${score})`);
}

// Penalty: top two contiguous (semitone apart)
{
  const ct = ChordSymbol.parse('CM7').chordType;
  const src = [60, 64, 67];
  const dest = [60, 65, 66]; // top two = 65 and 66 (contiguous)
  const score = chordMatchingScore(src, dest, ct, 0);
  // distance = 0 + 1 + 1 = 2
  // top delta = |67-66| = 1 → +3
  // bottom delta = 0
  // contiguous top penalty = 3 * size(3) = 9
  // 9♭? 66-60 = 6, not 13. No.
  // interval ≥6 between dest[1]-dest[0] = 65-60 = 5, not ≥6.
  assert(score === 2 + 3 + 9, `score = 14 (got ${score})`);
}

console.log(`\n=== chord-voicing test ===`);
console.log(`${pass} pass / ${fail} fail`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log('✓ All tests passed');
