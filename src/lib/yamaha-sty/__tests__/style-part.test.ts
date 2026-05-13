import {
  createStylePart, setCtabFor, getCtabFor, addNoteEvent,
  setSizeInBeats, activeChannels, totalNoteCount,
  type SourceNoteEvent,
} from '../style-part';
import type { CtabChannelSettings } from '../ctab-channel-settings';

let pass = 0, fail = 0;
const fails: string[] = [];
function assert(c: boolean, msg: string) {
  if (c) pass++;
  else { fail++; fails.push('  ✗ ' + msg); }
}

// Construction
const sp = createStylePart('Main_A');
assert(sp.type === 'Main_A', 'type set');
assert(sp.sizeInBeats === 0, 'initial sizeInBeats 0');
assert(sp.ctabByChannel.size === 0, 'no ctab initially');
assert(sp.phraseByChannel.size === 0, 'no phrases initially');

// CTAB attach
const fakeCtab = { channel: 5, name: 'fake' } as unknown as CtabChannelSettings;
setCtabFor(sp, 5, fakeCtab);
assert(getCtabFor(sp, 5) === fakeCtab, 'CTAB stored at ch 5');
assert(getCtabFor(sp, 6) === undefined, 'CTAB absent at ch 6');

// Range check
try { setCtabFor(sp, 16, fakeCtab); fail++; fails.push('  ✗ ch 16 should throw'); }
catch { pass++; }
try { setCtabFor(sp, -1, fakeCtab); fail++; fails.push('  ✗ ch -1 should throw'); }
catch { pass++; }

// Add note events — auto-create phrase
const ev1: SourceNoteEvent = { channel: 0, pitch: 60, velocity: 80, tick: 0, durationTicks: 480 };
const ev2: SourceNoteEvent = { channel: 0, pitch: 64, velocity: 80, tick: 480, durationTicks: 480 };
const ev3: SourceNoteEvent = { channel: 5, pitch: 36, velocity: 100, tick: 0, durationTicks: 960 };
addNoteEvent(sp, ev1);
addNoteEvent(sp, ev2);
addNoteEvent(sp, ev3);
assert(sp.phraseByChannel.size === 2, '2 phrases created');
assert(sp.phraseByChannel.get(0)!.notes.length === 2, 'ch 0 has 2 notes');
assert(sp.phraseByChannel.get(5)!.notes.length === 1, 'ch 5 has 1 note');
assert(totalNoteCount(sp) === 3, 'totalNoteCount = 3');

// Active channels (CTAB ch 5 + phrase ch 0,5)
const ac = activeChannels(sp);
assert(ac.length === 2 && ac[0] === 0 && ac[1] === 5, 'activeChannels = [0, 5]');

// sizeInBeats
setSizeInBeats(sp, 16);
assert(sp.sizeInBeats === 16, 'sizeInBeats 16');
try { setSizeInBeats(sp, 1.5); fail++; fails.push('  ✗ fractional beats should throw'); }
catch { pass++; }
try { setSizeInBeats(sp, -1); fail++; fails.push('  ✗ negative beats should throw'); }
catch { pass++; }

console.log(`\n=== StylePart test ===`);
console.log(`${pass} pass / ${fail} fail`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log('✓ All tests passed');
