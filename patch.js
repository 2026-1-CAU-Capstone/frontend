const fs = require('fs');
let text = fs.readFileSync('src/lib/note/notePlayer.ts', 'utf-8');

text = text.replace(/(private compInst:.*)/, '\\n    private bassInst: Soundfont.Player | null = null;\n    private pianoReverbSend: GainNode | null = null;');
text = text.replace(/(pianoVolume = 1\.0;)/, 'melodyVolume = 1.0;\n    \\n    bassVolume = 1.0;\n    pianoReverb = 0.18;');

text = text.replace(/Soundfont\.instrument\\(this\\.ctx!, 'acoustic_grand_piano' as Soundfont\\.InstrumentName, \\{ gain: 2\\.5 \\}\\)/,
  \Soundfont.instrument(this.ctx!, 'acoustic_grand_piano' as Soundfont.InstrumentName, { gain: 2.5 }),\n        Soundfont.instrument(this.ctx!, 'acoustic_bass' as Soundfont.InstrumentName, { gain: 2.5 })\
);

text = text.replace(/\\]\\)\\.then\\(\\(\\[melody, comp, drums\\]\\) => \\{/, ']).then(([melody, comp, bass, drums]) => {');
text = text.replace(/(this\\.compInst = comp;)/, '\\n        this.bassInst = bass;');

text = text.replace(/(const pianoSend = this\\.ctx\\.createGain\\(\\);\\s*)pianoSend\\.gain\\.value = 0\\.18;/, '\.pianoReverbSend = pianoSend;\n        pianoSend.gain.value = this.pianoReverb;');

text = text.replace(/(drumEnabled = true;)/, \setPianoReverb(vol: number) {\n      this.pianoReverb = vol;\n      if (this.pianoReverbSend && this.ctx) {\n        this.pianoReverbSend.gain.setTargetAtTime(vol, this.ctx.currentTime, 0.05);\n      }\n    }\n\n    \\);

const compRegex = /(const midiNotes = chordToMidi\\(chords\\[ci\\]\\);[\\s\\S]*?for \\(const midi of midiNotes\\) \\{[\\s\\S]*?this\\.sched\\.push\\(\\{ time: t, dur: compDur, midi, measure: origMi \\+ miOffset, noteIndex: -1, track: 'comp' \\}\\);\\n\\s*\\})/;
text = text.replace(compRegex, \\\n            const parsedForBass = parseChordSymbol(chords[ci]);\n            if (parsedForBass) {\n              const bassMidi = 12 * 3 + parsedForBass.root;\n              this.sched.push({ time: t, dur: (chords.length === 1 ? measSec : measSec / 2) * 0.95, midi: bassMidi, measure: origMi + miOffset, noteIndex: -1, track: 'bass' });\n            }\);

const tickRegex = /const inst = n\\.track === 'comp' \\? this\\.compInst : this\\.melodyInst;\\n\\s*if \\(inst\\) \\{\\n\\s*const node = inst\\.play\\(String\\(n\\.midi\\), this\\.origin \\+ n\\.time, \\{\\n\\s*duration: n\\.dur,\\n\\s*gain: n\\.track === 'comp' \\? 1\\.5 \\* this\\.pianoVolume : 2\\.5,\\n\\s*\\}\\);/;
const tickRepl = \let inst = this.melodyInst;\n          let vol = 2.5 * this.melodyVolume;\n          if (n.track === 'comp') { inst = this.compInst; vol = 1.5 * this.pianoVolume; }\n          else if (n.track === 'bass') { inst = this.bassInst; vol = 1.5 * this.bassVolume; }\n          if (inst) {\n            const node = inst.play(String(n.midi), this.origin + n.time, {\n              duration: n.dur,\n              gain: vol,\n            });\;
text = text.replace(tickRegex, tickRepl);

fs.writeFileSync('src/lib/note/notePlayer.ts', text, 'utf-8');

