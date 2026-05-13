/**
 * ChordType.fitDegree() — verifies harmonic conversion of a source degree
 * onto the chord-tone vocabulary of a target ChordType. Cases mirror the
 * JJazzLab examples documented above the Java method.
 */
import { ChordSymbol, Degrees } from '../index';

let pass = 0, fail = 0;
const fails: string[] = [];
function assert(c: boolean, msg: string) {
  if (c) pass++;
  else { fail++; fails.push('  ✗ ' + msg); }
}

function ctFromName(name: string) {
  return ChordSymbol.parse('C' + name).chordType;
}

// 1) Direct natural match: 3 → THIRD on M7 → THIRD (no change)
{
  const ct = ctFromName('M7');
  const r = ct.fitDegree(Degrees.THIRD);
  assert(r?.name === 'THIRD', `M7.fit(3) = THIRD (got ${r?.name})`);
}

// 2) Same pitch class via different natural: #11 → m7b5 has b5 (same pitch 6) → FIFTH_FLAT
{
  const ct = ctFromName('m7b5');
  const r = ct.fitDegree(Degrees.ELEVENTH_SHARP);
  assert(r?.name === 'FIFTH_FLAT', `m7b5.fit(#11) = FIFTH_FLAT (got ${r?.name})`);
}

// 3) No fit: #11 on plain M7 (no #11, no b5) → null
{
  const ct = ctFromName('M7');
  const r = ct.fitDegree(Degrees.ELEVENTH_SHARP);
  assert(r === null, `M7.fit(#11) = null (got ${r?.name})`);
}

// 4) No fit when chord has neither matching natural nor matching pitch:
//    "6" chord has no SEVENTH natural and no pitch 11. The Java special branch
//    (extension.contains("6") + SEVENTH source) only triggers when destDegree
//    is already non-null (chord has both 7 and 6 — rare). So we return null.
{
  const ct = ctFromName('6');
  const r = ct.fitDegree(Degrees.SEVENTH);
  assert(r === null, `6.fit(7) = null (no fit, got ${r?.name})`);
}

// 5) Same for M7 receiving 6: M7 has no SIXTH natural, no pitch 9. → null.
{
  const ct = ctFromName('M7');
  const r = ct.fitDegree(Degrees.SIXTH_OR_THIRTEENTH);
  assert(r === null, `M7.fit(6) = null (no fit, got ${r?.name})`);
}

// 6) Minor chord receiving b3 → keep b3
{
  const ct = ctFromName('m7');
  const r = ct.fitDegree(Degrees.THIRD_FLAT);
  assert(r?.name === 'THIRD_FLAT', `m7.fit(b3) = THIRD_FLAT (got ${r?.name})`);
}

// 7) Major chord receiving b3 → fits to natural 3? No — b3 has no natural match in M chord.
//    Java's fitDegree returns null in this case (different natural, different pitch).
{
  const ct = ctFromName('M7');
  const r = ct.fitDegree(Degrees.THIRD_FLAT);
  // M7 has natural THIRD at pitch 4; b3 is pitch 3. Different natural family (both THIRD),
  // so getDegreeByNatural returns THIRD which matches d.natural. The special branches
  // don't apply. Java returns THIRD here (the same-natural match).
  assert(r?.name === 'THIRD', `M7.fit(b3) = THIRD (natural match, got ${r?.name})`);
}

// 8) ROOT always passes through
{
  const ct = ctFromName('m7');
  const r = ct.fitDegree(Degrees.ROOT);
  assert(r?.name === 'ROOT', `m7.fit(ROOT) = ROOT (got ${r?.name})`);
}

console.log(`\n=== ChordType.fitDegree test ===`);
console.log(`${pass} pass / ${fail} fail`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log('✓ All tests passed');
