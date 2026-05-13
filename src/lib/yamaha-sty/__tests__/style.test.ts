import {
  createStyle, addStylePart, getStylePart,
  setChannelInstrument, getChannelInstrument, presentPartTypes,
  type ChannelInstrument,
} from '../style';
import { createStylePart } from '../style-part';

let pass = 0, fail = 0;
const fails: string[] = [];
function assert(c: boolean, msg: string) {
  if (c) pass++;
  else { fail++; fails.push('  ✗ ' + msg); }
}

const s = createStyle('psBase');
assert(s.name === 'psBase', 'name stored');
assert(s.ticksPerQuarter === 0, 'ppq default 0');
assert(s.sff === 'SFF1', 'sff default SFF1');
assert(s.parts.size === 0, 'no parts initially');

s.ticksPerQuarter = 1920;
s.tempo = 142;
s.timeSignature = { numerator: 4, denominator: 4 };

const mainA = createStylePart('Main_A');
const intro = createStylePart('Intro_A');
addStylePart(s, mainA);
addStylePart(s, intro);

assert(s.parts.size === 2, '2 parts added');
assert(getStylePart(s, 'Main_A') === mainA, 'getStylePart Main_A');
assert(getStylePart(s, 'Intro_A') === intro, 'getStylePart Intro_A');
assert(getStylePart(s, 'Ending_A') === undefined, 'absent Ending_A returns undefined');

// Replace test (Map semantics)
const mainA2 = createStylePart('Main_A');
addStylePart(s, mainA2);
assert(getStylePart(s, 'Main_A') === mainA2, 'Main_A replaced');
assert(s.parts.size === 2, 'size unchanged after replace');

// presentPartTypes
const types = presentPartTypes(s);
assert(types.includes('Main_A') && types.includes('Intro_A') && types.length === 2,
  'presentPartTypes lists both');

// Channel instruments
const inst: ChannelInstrument = { program: 0, bankMSB: 0, bankLSB: 0, volume: 100, pan: 64 };
setChannelInstrument(s, 0, inst);
assert(getChannelInstrument(s, 0) === inst, 'channelInstrument 0 stored');
assert(getChannelInstrument(s, 1) === undefined, 'channel 1 not set');

try { setChannelInstrument(s, 16, inst); fail++; fails.push('  ✗ ch 16 should throw'); }
catch { pass++; }
try { setChannelInstrument(s, -1, inst); fail++; fails.push('  ✗ ch -1 should throw'); }
catch { pass++; }

console.log(`\n=== Style test ===`);
console.log(`${pass} pass / ${fail} fail`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log('✓ All tests passed');
