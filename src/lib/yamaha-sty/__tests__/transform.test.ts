/**
 * transformPhrase end-to-end test: parse psBase.sst, take Main_A's CTAB +
 * source phrase for the piano channel (ch 0), transform it to Am7, verify
 * the output looks musically reasonable.
 */
import { readFileSync } from 'node:fs';
import { ChordSymbol } from '../../jazz-harmony';
import { parseStyleFile } from '../parser';
import { transformPhrase } from '../transform';

const STY_PATH = '/Users/benzity/Documents/DEV/JJazzLab/plugins/JJSwing/src/main/resources/org/jjazz/jjswing/api/psBase.sst';

let pass = 0, fail = 0;
const fails: string[] = [];
function assert(c: boolean, msg: string) {
  if (c) pass++;
  else { fail++; fails.push('  ✗ ' + msg); }
}

const buf = readFileSync(STY_PATH);
const style = parseStyleFile(buf, { name: 'psBase' });
const mainA = style.parts.get('Main_A')!;
const ch0 = mainA.phraseByChannel.get(0)!;
const ctab0 = mainA.ctabByChannel.get(0)!;

assert(ch0.notes.length > 0, `Main_A ch0 has notes (got ${ch0.notes.length})`);
assert(ctab0.sourceChordType.name === 'M7', 'ch0 sourceChord is M7 (Maj7)');

// Transform to Am7
const am7 = ChordSymbol.parse('Am7').chordType;
const out = transformPhrase(ch0, ctab0, {
  rootRelPitch: 9, // A
  chordType: am7,
  bassRelPitch: 9, // no slash
});

assert(out.length > 0, `Transformed phrase non-empty (got ${out.length})`);
assert(out.length <= ch0.notes.length, 'Output ≤ input length (some may be filtered by note-limit)');

// All output pitches should be in the chord's chord tones (Am7 = A, C, E, G)
// since ch0 uses NTT=CHORD which restricts to chord tones.
const chordPcs = new Set([9, 0, 4, 7]); // A, C, E, G
const inChord = out.filter((n) => chordPcs.has(((n.pitch % 12) + 12) % 12));
const inChordRatio = inChord.length / out.length;
assert(inChordRatio > 0.8, `>80% of notes are Am7 chord tones (got ${(inChordRatio * 100).toFixed(0)}%)`);

// Velocity + tick + duration preserved
assert(out[0].velocity >= 1 && out[0].velocity <= 127, 'velocity in range');
assert(out[0].tick >= 0, 'tick non-negative');
assert(out[0].channel === 0, 'channel preserved');

// Test on Cm7 — should now have b3 (Eb)
const cm7 = ChordSymbol.parse('Cm7').chordType;
const outCm7 = transformPhrase(ch0, ctab0, {
  rootRelPitch: 0,
  chordType: cm7,
  bassRelPitch: 0,
});
const cm7Pcs = new Set([0, 3, 7, 10]); // C, Eb, G, Bb
const inCm7 = outCm7.filter((n) => cm7Pcs.has(((n.pitch % 12) + 12) % 12));
const inCm7Ratio = inCm7.length / outCm7.length;
assert(inCm7Ratio > 0.8, `>80% notes are Cm7 chord tones for Cm7 dest (got ${(inCm7Ratio * 100).toFixed(0)}%)`);

// Test bass channel (channel 9 in psBase has program=32 Acoustic Bass)
const ch9 = mainA.phraseByChannel.get(9);
const ctab9 = mainA.ctabByChannel.get(9);
if (ch9 && ctab9) {
  const outBass = transformPhrase(ch9, ctab9, {
    rootRelPitch: 9, // Am7 root
    chordType: am7,
    bassRelPitch: 9,
  });
  assert(outBass.length > 0, `bass ch9 transform non-empty`);
  // Bass notes should be in lower octaves
  const lowNoteCount = outBass.filter((n) => n.pitch < 60).length;
  assert(lowNoteCount > outBass.length * 0.5,
    `most bass notes below C4 (got ${lowNoteCount}/${outBass.length})`);
}

console.log(`\n=== transformPhrase test ===`);
console.log(`${pass} pass / ${fail} fail`);
console.log(`Main_A ch0 input notes: ${ch0.notes.length}, transformed: ${out.length}`);
console.log(`Sample input pitches: ${ch0.notes.slice(0, 5).map((n) => n.pitch).join(',')}`);
console.log(`Sample Am7 output pitches: ${out.slice(0, 5).map((n) => n.pitch).join(',')}`);

if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log('✓ All tests passed');
