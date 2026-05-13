/**
 * End-to-end parser test against the real psBase.sst file from JJazzLab.
 * Cross-checks against the hex-dump findings in docs/sty-format.md.
 */
import { readFileSync } from 'node:fs';
import { parseStyleFile } from '../parser';
import { presentPartTypes, getChannelInstrument } from '../style';
import { activeChannels } from '../style-part';

const STY_PATH = '/Users/benzity/Documents/DEV/JJazzLab/plugins/JJSwing/src/main/resources/org/jjazz/jjswing/api/psBase.sst';

let pass = 0, fail = 0;
const fails: string[] = [];
function assert(c: boolean, msg: string) {
  if (c) pass++;
  else { fail++; fails.push('  ✗ ' + msg); }
}

const buf = readFileSync(STY_PATH);
const style = parseStyleFile(buf, { name: 'psBase' });

// Header round-trip
assert(style.name === 'psBase', 'name = psBase');
assert(style.ticksPerQuarter === 1920, `ppq = 1920 (got ${style.ticksPerQuarter})`);
assert(style.tempo === 142, `tempo = 142 (got ${style.tempo})`);
assert(style.timeSignature.numerator === 4 && style.timeSignature.denominator === 4,
  `time signature 4/4 (got ${style.timeSignature.numerator}/${style.timeSignature.denominator})`);

// SFF version (psBase.sst is SFF1 — has Ctab, not Ctb2)
assert(style.sff === 'SFF1', `SFF version (got ${style.sff})`);

// Program changes per channel (from hex-dump analysis)
const expectedPrograms: Record<number, number> = {
  0: 0,   // Acoustic Grand Piano
  1: 0, 2: 0, 3: 0,
  4: 26, 5: 26, 6: 26, 7: 26, 8: 26, // Electric Guitar (jazz)
  9: 32, 10: 32, 11: 32, 12: 32,     // Acoustic Bass
  13: 73, 14: 73,                    // Flute
  15: 40,                            // Violin
};
for (const [ch, expected] of Object.entries(expectedPrograms)) {
  const inst = getChannelInstrument(style, Number(ch));
  assert(inst?.program === expected, `ch ${ch} program = ${expected} (got ${inst?.program})`);
}

// Section types — exactly the 15 we saw in the Sdec strings
const types = presentPartTypes(style).sort();
const expectedTypes = [
  'Ending_A', 'Ending_B', 'Ending_C',
  'Fill_In_AA', 'Fill_In_BA', 'Fill_In_BB', 'Fill_In_CC', 'Fill_In_DD',
  'Intro_A', 'Intro_B', 'Intro_C',
  'Main_A', 'Main_B', 'Main_C', 'Main_D',
].sort();
assert(types.length === 15, `15 section types (got ${types.length}: ${types.join(', ')})`);
for (const t of expectedTypes) {
  assert(types.includes(t as never), `section ${t} present`);
}

// First Ctab record from CSEG#1 (which contains Main A, Main B, Fill_In_AA, Fill_In_BB, Ending_A)
// Should be the "pno norm" entry on ch 0 with sourceChord = C Maj7
const mainA = style.parts.get('Main_A');
assert(mainA !== undefined, 'Main_A part exists');

const ctab0 = mainA?.ctabByChannel.get(0);
assert(ctab0 !== undefined, 'Main_A has CTAB for channel 0');
if (ctab0) {
  assert(ctab0.name === 'pno norm', `ch0 name = "pno norm" (got "${ctab0.name}")`);
  assert(ctab0.accType === 'CHORD1', `ch0 accType CHORD1 (destCh 11)`);
  assert(ctab0.sourceChordNote === 0, 'ch0 sourceChord C');
  assert(ctab0.sourceChordTypeIndex === 31, `ch0 sourceChord Maj7 (idx 31)`);
  assert(ctab0.sourceChordType.name === 'M7', `ch0 sourceChord.name = M7`);
  assert(ctab0.ctb2Main.ntr === 'ROOT_FIXED', 'ch0 NTR = ROOT_FIXED');
  assert(ctab0.ctb2Main.ntt === 'CHORD', 'ch0 NTT = CHORD');
  assert(ctab0.ctb2Main.rtr === 'PITCH_SHIFT', 'ch0 RTR = PITCH_SHIFT');
}

// Sanity: count how many CTABs are populated across all sections
let totalCtabs = 0;
for (const sp of style.parts.values()) totalCtabs += sp.ctabByChannel.size;
assert(totalCtabs >= 15, `at least 15 CTABs parsed (got ${totalCtabs})`);

// Note events now extracted across all sections — confirm cross-section
// totals match the Python pre-parse (which counted note-ons in the whole MTrk).
// Expected totals from Python:
//   ch 0:  443, ch 1:  336, ch 2: 114, ch 3: 114, ch 4: 88, ch 5: 498,
//   ch 6:  373, ch 7:  185, ch 8: 185, ch 9: 239, ch10: 242, ch11: 101,
//   ch12: 101, ch13: 86,  ch14: 92,  ch15: 711
const expectedPerChannel: Record<number, number> = {
  0: 443, 1: 336, 2: 114, 3: 114, 4: 88, 5: 498, 6: 373, 7: 185,
  8: 185, 9: 239, 10: 242, 11: 101, 12: 101, 13: 86, 14: 92, 15: 711,
};
const actualPerChannel: Record<number, number> = {};
for (const sp of style.parts.values()) {
  for (const phrase of sp.phraseByChannel.values()) {
    actualPerChannel[phrase.channel] = (actualPerChannel[phrase.channel] ?? 0) + phrase.notes.length;
  }
}
for (const [ch, expected] of Object.entries(expectedPerChannel)) {
  assert(
    actualPerChannel[Number(ch)] === expected,
    `ch ${ch} note count = ${expected} (got ${actualPerChannel[Number(ch)] ?? 0})`,
  );
}

// Section sizes (sizeInBeats) populated for each Main section
for (const sectionName of ['Main_A', 'Main_B', 'Main_C', 'Main_D'] as const) {
  const sp = style.parts.get(sectionName);
  assert(sp !== undefined && sp.sizeInBeats > 0,
    `${sectionName} has sizeInBeats > 0 (got ${sp?.sizeInBeats})`);
}

console.log(`\n=== Parser test (psBase.sst) ===`);
console.log(`${pass} pass / ${fail} fail`);
console.log(`Section types parsed: ${types.length}`);
console.log(`Total CTAB records: ${totalCtabs}`);
console.log(`Channel instruments: ${style.channelInstruments.size}`);
console.log(`First section channels: ${activeChannels(mainA!).join(', ')}`);

if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log('✓ All tests passed');
