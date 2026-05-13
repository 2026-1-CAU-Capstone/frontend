import { useState, useRef } from 'react';
import { Soundfont } from 'smplr';
import { ChordSymbol } from '../lib/jazz-harmony';
import {
  parseStyleFile, transformPhrase, type Style, type SourceNoteEvent,
} from '../lib/yamaha-sty';

/* End-to-end demo for the yamaha-sty pipeline.
 *
 * Loads JJazzLab's LGPL-bundled psBase.sst, loops Main_A over the chord
 * progression Am7 → D7 → GM7 → CM7, transforms every channel's source
 * phrase to fit the current chord, then schedules each note onto a smplr
 * Soundfont voice for the channel's GM program.
 *
 * What this proves end-to-end:
 *   1. .sty parser produces a usable Style object from a real file
 *   2. transformPhrase yields chord-fitted MIDI notes per channel
 *   3. smplr can render those notes simultaneously on multiple GM voices
 *   4. The result actually sounds like jazz comping
 */

const GM_NAME_BY_PROGRAM: Record<number, string> = {
  0: 'acoustic_grand_piano',
  26: 'electric_guitar_jazz',
  32: 'acoustic_bass',
  40: 'violin',
  73: 'flute',
};

interface ChordSpec { label: string; root: number; type: string }
const PROGRESSION: ChordSpec[] = [
  { label: 'Am7',  root: 9, type: 'm7' },
  { label: 'D7',   root: 2, type: '7' },
  { label: 'Gmaj7', root: 7, type: 'M7' },
  { label: 'Cmaj7', root: 0, type: 'M7' },
];

export default function StyDemoPage() {
  const [status, setStatus] = useState('idle');
  const [log, setLog] = useState<string[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const styleRef = useRef<Style | null>(null);
  const instMapRef = useRef<Map<number, Soundfont>>(new Map());

  function appendLog(line: string) {
    setLog((l) => [...l, line]);
  }

  async function loadStyle() {
    setStatus('loading style…');
    setLog([]);
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    await ctx.resume();

    const resp = await fetch('/styles/psBase.sst');
    const buf = await resp.arrayBuffer();
    appendLog(`Fetched psBase.sst (${buf.byteLength} bytes)`);

    const style = parseStyleFile(buf, { name: 'psBase' });
    styleRef.current = style;
    appendLog(`Parsed: tempo=${style.tempo}bpm, ${style.parts.size} sections, ${style.channelInstruments.size} channels`);

    setStatus('loading instruments…');
    const programs = new Set<number>();
    for (const inst of style.channelInstruments.values()) programs.add(inst.program);
    appendLog(`Unique GM programs: ${Array.from(programs).join(', ')}`);

    const instByProgram = new Map<number, Soundfont>();
    const t0 = performance.now();
    await Promise.all(
      Array.from(programs).map(async (prog) => {
        const name = GM_NAME_BY_PROGRAM[prog] ?? null;
        if (name === null) {
          appendLog(`  prog ${prog}: no GM name mapping, skipping`);
          return;
        }
        const inst = new Soundfont(ctx, { instrument: name, kit: 'FluidR3_GM' });
        await inst.load;
        instByProgram.set(prog, inst);
        appendLog(`  prog ${prog} (${name}) loaded`);
      }),
    );
    appendLog(`All instruments ready in ${(performance.now() - t0).toFixed(0)}ms`);

    // Map channels to instruments via program-change
    instMapRef.current.clear();
    for (const [ch, instSpec] of style.channelInstruments) {
      const inst = instByProgram.get(instSpec.program);
      if (inst) instMapRef.current.set(ch, inst);
    }

    setStatus('ready — click Play');
  }

  async function play() {
    const ctx = ctxRef.current;
    const style = styleRef.current;
    if (!ctx || !style) return;
    setStatus('playing…');

    const mainA = style.parts.get('Main_A');
    if (!mainA) { setStatus('Main_A missing'); return; }

    const ppq = style.ticksPerQuarter;
    const tempo = style.tempo || 142;
    const secondsPerBeat = 60 / tempo;
    appendLog(`Playing: tempo=${tempo}bpm, ppq=${ppq}, sizeInBeats=${mainA.sizeInBeats}`);

    let startTime = ctx.currentTime + 0.2;
    for (const chord of PROGRESSION) {
      appendLog(`  → ${chord.label} @ ${startTime.toFixed(2)}s`);
      const chordType = ChordSymbol.parse('C' + chord.type).chordType;
      let totalNotesScheduled = 0;

      for (const [ch, phrase] of mainA.phraseByChannel) {
        const ctab = mainA.ctabByChannel.get(ch);
        if (!ctab) continue;
        const inst = instMapRef.current.get(ch);
        if (!inst) continue;

        // Drums (ch 9) — JJazzLab style files put bass on ch9 not drums,
        // but real Yamaha .sty drums need a drum-kit player. Skip ch9 here
        // (it's bass in psBase, with a melodic instrument loaded above).
        // We do play it.

        const transformed = transformPhrase(phrase, ctab, {
          rootRelPitch: chord.root,
          chordType,
          bassRelPitch: chord.root,
        });

        scheduleNotes(transformed, inst, startTime, ppq, secondsPerBeat);
        totalNotesScheduled += transformed.length;
      }
      appendLog(`     ${totalNotesScheduled} notes scheduled`);
      startTime += mainA.sizeInBeats * secondsPerBeat;
    }
    setStatus('playback queued — listen!');
  }

  function stop() {
    for (const inst of instMapRef.current.values()) inst.stop();
    setStatus('stopped');
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui', color: '#eee', background: '#1a1a1a', minHeight: '100vh' }}>
      <h1>.sty End-to-End Demo</h1>
      <p style={{ color: '#aaa' }}>
        Loads JJazzLab's psBase.sst, transforms Main A across a 4-chord progression,
        and plays it through smplr. This is the entire yamaha-sty pipeline.
      </p>

      <div style={{ marginTop: 16 }}>
        <button onClick={loadStyle} style={btnStyle}>1. Load + parse + load synths</button>
        <button onClick={play} style={{ ...btnStyle, marginLeft: 8 }}>2. Play Am7 → D7 → GM7 → CM7</button>
        <button onClick={stop} style={{ ...btnStyle, marginLeft: 8, background: '#a33' }}>Stop</button>
      </div>

      <p style={{ marginTop: 16 }}>Status: <code>{status}</code></p>

      <div style={{ marginTop: 16, padding: 16, background: '#2a2a2a', borderRadius: 8, fontFamily: 'monospace', fontSize: 13 }}>
        {log.length === 0
          ? <span style={{ color: '#666' }}>(no events yet)</span>
          : log.map((l, i) => <div key={i}>{l}</div>)}
      </div>
    </div>
  );
}

function scheduleNotes(
  notes: SourceNoteEvent[],
  inst: Soundfont,
  startTime: number,
  ppq: number,
  secondsPerBeat: number,
) {
  for (const n of notes) {
    const t = startTime + (n.tick / ppq) * secondsPerBeat;
    const dur = Math.max(0.05, (n.durationTicks / ppq) * secondsPerBeat);
    inst.start({
      note: n.pitch,
      time: t,
      duration: dur,
      velocity: n.velocity,
    });
  }
}

const btnStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: '#3a7',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 14,
};
