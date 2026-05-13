/**
 * StylePartType tests — verify round-trip with Sdec strings + the
 * isXxx() / getFill() predicates match the Java original.
 */
import {
  STYLE_PART_TYPES,
  stylePartTypeToString,
  stylePartTypeFromString,
  isFillOrBreak, isIntro, isEnding, isMain, getFill,
  type StylePartType,
} from '../style-part-type';

let pass = 0, fail = 0;
const fails: string[] = [];
function assert(cond: boolean, msg: string) {
  if (cond) pass++;
  else { fail++; fails.push('  ✗ ' + msg); }
}

// Round-trip with Sdec strings (these are the literal strings we saw in psBase.sst)
const sdecStrings = [
  'Main A', 'Main B', 'Main C', 'Main D',
  'Intro A', 'Intro B', 'Intro C',
  'Ending A', 'Ending B', 'Ending C',
  'Fill In AA', 'Fill In BB', 'Fill In CC', 'Fill In DD', 'Fill In BA',
];
for (const s of sdecStrings) {
  const t = stylePartTypeFromString(s);
  assert(t !== null, `parse "${s}"`);
  if (t) assert(stylePartTypeToString(t) === s, `round-trip "${s}"`);
}

// Unknown strings should return null
assert(stylePartTypeFromString('Bogus Section') === null, 'unknown returns null');
assert(stylePartTypeFromString('main a') === null, 'case-sensitive');

// Predicates
assert(isMain('Main_A') && isMain('Main_D'), 'isMain(Main_*)');
assert(!isMain('Intro_A'), '!isMain(Intro_A)');
assert(isIntro('Intro_B'), 'isIntro');
assert(isEnding('Ending_C'), 'isEnding');
assert(isFillOrBreak('Fill_In_AA') && isFillOrBreak('Fill_In_BA'), 'isFillOrBreak');
assert(!isFillOrBreak('Main_A'), '!isFillOrBreak(Main_A)');

// getFill mapping
assert(getFill('Main_A') === 'Fill_In_AA', 'Main_A → Fill_In_AA');
assert(getFill('Main_B') === 'Fill_In_BB', 'Main_B → Fill_In_BB');
assert(getFill('Main_C') === 'Fill_In_CC', 'Main_C → Fill_In_CC');
assert(getFill('Main_D') === 'Fill_In_DD', 'Main_D → Fill_In_DD');
assert(getFill('Intro_A') === null, 'Intro_A has no fill');
assert(getFill('Ending_B') === null, 'Ending_B has no fill');

// Cardinality
assert(STYLE_PART_TYPES.length === 18, `18 types total (got ${STYLE_PART_TYPES.length})`);

console.log(`\n=== StylePartType test ===`);
console.log(`${pass} pass / ${fail} fail`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log('✓ All tests passed');

// Avoid unused-import warning in tsc
const _: StylePartType = 'Main_A';
void _;
