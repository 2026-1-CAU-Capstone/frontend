import {
  ACC_TYPES,
  accTypeFromChannel,
  accTypeOrdinal,
  accTypeToString,
  getAccTypeInfo,
  isDrums,
  isAuthorisedNote,
  getAuthorisedDegree,
} from '../acc-type';

let pass = 0, fail = 0;
const fails: string[] = [];
function assert(c: boolean, msg: string) {
  if (c) pass++;
  else { fail++; fails.push('  ✗ ' + msg); }
}

// Cardinality
assert(ACC_TYPES.length === 8, '8 AccTypes');

// Channel ↔ AccType bijection (8-15)
assert(accTypeFromChannel(8) === 'SUBRHYTHM', 'ch8 → SUBRHYTHM');
assert(accTypeFromChannel(9) === 'RHYTHM', 'ch9 → RHYTHM');
assert(accTypeFromChannel(10) === 'BASS', 'ch10 → BASS');
assert(accTypeFromChannel(11) === 'CHORD1', 'ch11 → CHORD1');
assert(accTypeFromChannel(15) === 'PHRASE2', 'ch15 → PHRASE2');
assert(accTypeFromChannel(7) === null, 'ch7 out of range');
assert(accTypeFromChannel(16) === null, 'ch16 out of range');

// Ordinal
assert(accTypeOrdinal('SUBRHYTHM') === 0, 'SUBRHYTHM ordinal 0');
assert(accTypeOrdinal('PHRASE2') === 7, 'PHRASE2 ordinal 7');

// Display name
assert(accTypeToString('SUBRHYTHM') === 'SubRhythm', 'SUBRHYTHM → "SubRhythm"');
assert(accTypeToString('BASS') === 'Bass', 'BASS → "Bass"');
assert(accTypeToString('CHORD1') === 'Chord1', 'CHORD1 → "Chord1"');

// Drums predicate
assert(isDrums('RHYTHM'), 'isDrums(RHYTHM)');
assert(isDrums('SUBRHYTHM'), 'isDrums(SUBRHYTHM)');
assert(!isDrums('BASS'), '!isDrums(BASS)');
assert(!isDrums('PHRASE1'), '!isDrums(PHRASE1)');

// getAccTypeInfo
assert(getAccTypeInfo('SUBRHYTHM').defaultGM1Program === null, 'SUBRHYTHM no GM1');
assert(getAccTypeInfo('BASS').defaultGM1Program === 35, 'BASS GM1=35');
assert(getAccTypeInfo('CHORD1').defaultGM1Program === 26, 'CHORD1 GM1=26');
assert(getAccTypeInfo('BASS').channel === 10, 'BASS ch10');

// isAuthorisedNote for BASS (ROOT, 9, 3, 5, 13, 7 = 0,2,4,7,9,11)
assert(isAuthorisedNote('BASS', 0), 'BASS allows ROOT(0)');
assert(isAuthorisedNote('BASS', 2), 'BASS allows 9(2)');
assert(isAuthorisedNote('BASS', 7), 'BASS allows 5(7)');
assert(isAuthorisedNote('BASS', 11), 'BASS allows 7(11)');
assert(!isAuthorisedNote('BASS', 1), 'BASS denies b9(1)');
assert(!isAuthorisedNote('BASS', 3), 'BASS denies b3(3)');
assert(!isAuthorisedNote('BASS', 6), 'BASS denies #11(6)');

// isAuthorisedNote for CHORD1 (ROOT, 3, 5, 7 only)
assert(isAuthorisedNote('CHORD1', 0), 'CHORD1 allows ROOT');
assert(isAuthorisedNote('CHORD1', 4), 'CHORD1 allows THIRD(4)');
assert(!isAuthorisedNote('CHORD1', 2), 'CHORD1 denies 9th');
assert(!isAuthorisedNote('CHORD1', 9), 'CHORD1 denies 13th');

// SubRhythm/Rhythm allow all (null authorisedDegrees)
assert(isAuthorisedNote('RHYTHM', 0), 'RHYTHM allows 0');
assert(isAuthorisedNote('RHYTHM', 6), 'RHYTHM allows 6');

// getAuthorisedDegree
const d = getAuthorisedDegree('BASS', 0);
assert(d !== null && d.pitch === 0 && d.name === 'ROOT', 'BASS pitch 0 → ROOT');
const d3 = getAuthorisedDegree('CHORD1', 4);
assert(d3 !== null && d3.name === 'THIRD', 'CHORD1 pitch 4 → THIRD');
assert(getAuthorisedDegree('BASS', 1) === null, 'BASS pitch 1 → null');

// Out-of-range
try { isAuthorisedNote('BASS', 12); fail++; fails.push('  ✗ expected throw on pitch 12'); }
catch { pass++; }

console.log(`\n=== AccType test ===`);
console.log(`${pass} pass / ${fail} fail`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log('✓ All tests passed');
