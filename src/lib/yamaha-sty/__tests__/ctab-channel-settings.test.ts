/**
 * CtabChannelSettings tests — bit-field decoders + full CTAB construction
 * cross-checked against the first Ctab record we hex-dumped from psBase.sst.
 *
 * Raw bytes from docs/sty-format.md (offset 0x846D → first Ctab):
 *   00 70 6e 6f 20 6e 6f 72 6d 0b 01 0f ff 03 f0 be df df 00 02 01 02 07 00 7f 01 00
 */
import {
  decodeMutedNotes, decodeMutedChords,
  createCtab, isSingleCtb2, isNoteMuted, isChordMuted,
} from '../ctab-channel-settings';
import { ntrFromByte, nttFromByte, rtrFromByte, type Ctb2ChannelSettings } from '../ctb2-channel-settings';

let pass = 0, fail = 0;
const fails: string[] = [];
function assert(c: boolean, msg: string) {
  if (c) pass++;
  else { fail++; fails.push('  ✗ ' + msg); }
}

/* ─── mutedNotes decoder ─────────────────────────────────────────────── */

// 0xFF 0xFF = all bits set = no notes muted
{
  const muted = decodeMutedNotes(0xFF, 0xFF);
  assert(muted.length === 0, '0xFF 0xFF → no muted notes');
}
// 0x00 0x00 = all bits clear = all 12 notes muted
{
  const muted = decodeMutedNotes(0x00, 0x00);
  assert(muted.length === 12, '0x00 0x00 → all 12 muted');
}
// psBase Ctab #1: b1=0x0F, b2=0xFF → bottom nibble of b1 = all on, b2 all on, top nibble of b1 = ignored
// b1=0x0F means low 4 bits set → 11,10,9,8 are NOT muted
{
  const muted = decodeMutedNotes(0x0F, 0xFF);
  assert(muted.length === 0, 'psBase Ctab #1 (0x0F 0xFF) → no muted notes');
}

/* ─── mutedChords decoder ────────────────────────────────────────────── */

// All 0xFF = no muted, no autoStart
{
  const { mutedChords, autoStart } = decodeMutedChords(0xFF, 0xFF, 0xFF, 0xFF, 0xFF);
  assert(mutedChords.length === 0, 'all 0xFF → no muted chords');
  assert(autoStart === true, 'b1 bit2 set → autoStart=true');
}
// All 0 = all 34 muted, no autoStart
{
  const { mutedChords, autoStart } = decodeMutedChords(0, 0, 0, 0, 0);
  assert(mutedChords.length === 34, 'all 0 → 34 muted (0..33)');
  assert(autoStart === false, 'b1 bit2 clear → autoStart=false');
}
// psBase Ctab #1: b1=0x03, b2=0xF0, b3=0xBE, b4=0xDF, b5=0xDF
// b1=0x03 = 0000_0011: bit2=0 (autoStart=false), bit1=1 (chord 0 not muted), bit0=1 (chord 1 not muted)
{
  const { mutedChords, autoStart } = decodeMutedChords(0x03, 0xF0, 0xBE, 0xDF, 0xDF);
  assert(autoStart === false, 'psBase #1 autoStart=false');
  assert(!mutedChords.includes(0) && !mutedChords.includes(1), 'psBase #1: chord 0/1 NOT muted');
  // 0xF0 = 11110000: bits 7-4 set (chords 2-5 not muted), bits 3-0 clear (chords 6-9 muted)
  assert(mutedChords.includes(6) && mutedChords.includes(7) && mutedChords.includes(8) && mutedChords.includes(9),
    'psBase #1: chords 6-9 muted');
  assert(!mutedChords.includes(2) && !mutedChords.includes(5), 'psBase #1: chords 2,5 NOT muted');
}

/* ─── full CTAB construction (psBase Ctab #1) ─────────────────────────── */

// Build the Ctb2 main subpart first
const ntrPb = ntrFromByte(0x01); // ROOT_FIXED
const { ntt: nttPb, bassOn: bassPb } = nttFromByte(0x02, ntrPb, 'SFF1'); // CHORD
const rtrPb = rtrFromByte(0x01); // PITCH_SHIFT
const ctb2MainPb: Ctb2ChannelSettings = {
  ntr: ntrPb,
  ntt: nttPb,
  bassOn: bassPb,
  chordRootUpperLimit: 0x07,
  noteLowLimit: 0x00,
  noteHighLimit: 0x7F,
  rtr: rtrPb,
};

const ctabPb = createCtab(
  {
    srcChannel: 0x00,
    name: 'pno norm',
    destChannel: 0x0B,
    editable: false, // editable flag = 0x01 = not editable (Java: editable = (b == 0))
    mutedNotesBytes: [0x0F, 0xFF],
    mutedChordsBytes: [0x03, 0xF0, 0xBE, 0xDF, 0xDF],
    sourceChordNote: 0x00, // C
    sourceChordTypeByte: 0x02, // → inverted = idx 31 = "Maj7"
  },
  ctb2MainPb,
  { sff: 'SFF1' },
);

assert(ctabPb.channel === 0, 'srcChannel = 0');
assert(ctabPb.name === 'pno norm', 'name = "pno norm"');
assert(ctabPb.accType === 'CHORD1', 'destCh 11 → CHORD1');
assert(ctabPb.sourceChordNote === 0, 'sourceChordNote = C(0)');
assert(ctabPb.sourceChordTypeIndex === 31, 'sourceChordTypeIndex = 31 (Maj7)');
assert(ctabPb.sourceChordType.name === 'M7', `sourceChordType.name = "M7" (got "${ctabPb.sourceChordType.name}")`);
assert(ctabPb.mutedNotes.length === 0, 'no muted notes');
assert(ctabPb.autoStart === false, 'autoStart false');
assert(isSingleCtb2(ctabPb), 'isSingleCtb2 (SFF1)');
assert(ctabPb.ctb2Main.ntr === 'ROOT_FIXED', 'ctb2Main NTR = ROOT_FIXED');
assert(ctabPb.ctb2Main.ntt === 'CHORD', 'ctb2Main NTT = CHORD');
assert(ctabPb.ctb2Main.rtr === 'PITCH_SHIFT', 'ctb2Main RTR = PITCH_SHIFT');

/* ─── helpers ────────────────────────────────────────────────────────── */
assert(!isNoteMuted(ctabPb, 0), 'C is not muted');
assert(!isChordMuted(ctabPb, 0), 'YamChord 0 not muted');
assert(isChordMuted(ctabPb, 6), 'YamChord 6 IS muted');

/* ─── range checks ───────────────────────────────────────────────────── */
try {
  createCtab({ ...ctabPb as never, srcChannel: 99, name: 'x',
    destChannel: 10, editable: true, mutedNotesBytes: [0, 0],
    mutedChordsBytes: [0, 0, 0, 0, 0], sourceChordNote: 0, sourceChordTypeByte: 0 },
    ctb2MainPb, { sff: 'SFF1' });
  fail++; fails.push('  ✗ srcChannel=99 should throw');
} catch { pass++; }

console.log(`\n=== CtabChannelSettings test ===`);
console.log(`${pass} pass / ${fail} fail`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log('✓ All tests passed');
