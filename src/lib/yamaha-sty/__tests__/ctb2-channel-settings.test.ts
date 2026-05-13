/**
 * Ctb2ChannelSettings tests — verify byte→enum mapping and SFF1→SFF2 remap.
 */
import {
  ntrFromByte, nttFromByte, rtrFromByte,
  NTR_BY_INDEX, NTT_BY_INDEX, RTR_BY_INDEX,
} from '../ctb2-channel-settings';

let pass = 0, fail = 0;
const fails: string[] = [];
function assert(c: boolean, msg: string) {
  if (c) pass++;
  else { fail++; fails.push('  ✗ ' + msg); }
}

// NTR enum
assert(NTR_BY_INDEX.length === 3, '3 NTR values');
assert(ntrFromByte(0) === 'ROOT_TRANSPOSITION', 'NTR 0');
assert(ntrFromByte(1) === 'ROOT_FIXED', 'NTR 1');
assert(ntrFromByte(2) === 'GUITAR', 'NTR 2');
try { ntrFromByte(3); fail++; fails.push('  ✗ NTR=3 should throw'); } catch { pass++; }

// NTT enum cardinality
assert(NTT_BY_INDEX.length === 14, '14 NTT values');

// SFF2 happy path (bassOn=0, index = raw)
{
  const { ntt, bassOn } = nttFromByte(0, 'ROOT_FIXED', 'SFF2');
  assert(ntt === 'BYPASS' && !bassOn, 'SFF2 byte=0 → BYPASS');
}
{
  const { ntt, bassOn } = nttFromByte(1, 'ROOT_TRANSPOSITION', 'SFF2');
  assert(ntt === 'MELODY' && !bassOn, 'SFF2 byte=1 → MELODY');
}
{
  const { ntt, bassOn } = nttFromByte(0x80 | 1, 'ROOT_TRANSPOSITION', 'SFF2');
  assert(ntt === 'MELODY' && bassOn, 'SFF2 byte=0x81 → MELODY + bassOn');
}
{
  const { ntt } = nttFromByte(10, 'ROOT_TRANSPOSITION', 'SFF2');
  assert(ntt === 'DORIAN_5', 'SFF2 byte=10 → DORIAN_5');
}

// SFF1 → SFF2 remap: BASS (index 3) → bassOn + MELODY
{
  const { ntt, bassOn } = nttFromByte(3, 'ROOT_TRANSPOSITION', 'SFF1');
  assert(ntt === 'MELODY' && bassOn, 'SFF1 BASS → MELODY + bassOn');
}

// SFF1 → SFF2 remap: MELODIC_MINOR shift from 4 to 3
{
  const { ntt, bassOn } = nttFromByte(4, 'ROOT_TRANSPOSITION', 'SFF1');
  assert(ntt === 'MELODIC_MINOR' && !bassOn, 'SFF1 idx 4 → MELODIC_MINOR');
}

// SFF1 indices 0,1,2 stay identical
{
  const { ntt } = nttFromByte(0, 'ROOT_FIXED', 'SFF1');
  assert(ntt === 'BYPASS', 'SFF1 idx 0 → BYPASS');
}
{
  const { ntt } = nttFromByte(2, 'ROOT_FIXED', 'SFF1');
  assert(ntt === 'CHORD', 'SFF1 idx 2 → CHORD');
}

// GUITAR NTR — indices shift to 11..13
{
  const { ntt } = nttFromByte(0, 'GUITAR', 'SFF2');
  assert(ntt === 'ALL_PURPOSE', 'GUITAR idx 0 → ALL_PURPOSE');
}
{
  const { ntt } = nttFromByte(1, 'GUITAR', 'SFF2');
  assert(ntt === 'STROKE', 'GUITAR idx 1 → STROKE');
}
{
  const { ntt } = nttFromByte(2, 'GUITAR', 'SFF2');
  assert(ntt === 'ARPEGGIO', 'GUITAR idx 2 → ARPEGGIO');
}
try { nttFromByte(3, 'GUITAR', 'SFF2'); fail++; fails.push('  ✗ GUITAR idx 3 should throw'); }
catch { pass++; }

// Invalid non-GUITAR index >= 11
try { nttFromByte(11, 'ROOT_FIXED', 'SFF2'); fail++; fails.push('  ✗ idx 11 should throw'); }
catch { pass++; }

// RTR enum
assert(RTR_BY_INDEX.length === 6, '6 RTR values');
assert(rtrFromByte(0) === 'STOP', 'RTR 0 → STOP');
assert(rtrFromByte(5) === 'NOTE_GENERATOR', 'RTR 5 → NOTE_GENERATOR');
try { rtrFromByte(6); fail++; fails.push('  ✗ RTR=6 should throw'); } catch { pass++; }

// Real bytes from psBase.sst first Ctab (NTR=1, NTT byte=2, RTR=1)
{
  const ntr = ntrFromByte(1);
  assert(ntr === 'ROOT_FIXED', 'psBase Ctab #1: NTR=ROOT_FIXED');
  const { ntt, bassOn } = nttFromByte(2, ntr, 'SFF1');
  assert(ntt === 'CHORD' && !bassOn, 'psBase Ctab #1: NTT=CHORD, bassOn=false');
  const rtr = rtrFromByte(1);
  assert(rtr === 'PITCH_SHIFT', 'psBase Ctab #1: RTR=PITCH_SHIFT');
}

console.log(`\n=== Ctb2ChannelSettings test ===`);
console.log(`${pass} pass / ${fail} fail`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log('✓ All tests passed');
