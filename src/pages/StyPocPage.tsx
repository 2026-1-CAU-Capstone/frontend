import { useState, useRef } from 'react';
import { Soundfont } from 'smplr';

/* Multi-channel SoundFont PoC for the JJazzLab .sty integration plan.
 *
 * Validates whether smplr + gleitz GM samples can sustain the load profile
 * of a 16-MIDI-channel Yamaha style file. The realistic worst case is
 * psBase.sst: 16 channels but only 5 unique GM programs
 * (Piano / Jazz Guitar / Acoustic Bass / Flute / Violin), so this PoC
 * loads exactly those five and measures:
 *
 *   1. parallel load wall-clock time (GitHub Pages throttle hazard)
 *   2. JS heap delta (memory budget on mobile)
 *   3. simultaneous trigger latency at t=now (audio glitch hazard)
 *
 * Results are dumped to the page + console so they can be screenshotted
 * and attached to the Phase-4 go/no-go decision in docs/sty-format.md.
 */

const GM_PROGRAMS = [
  { key: 'piano', instrument: 'acoustic_grand_piano', testNote: 60 },
  { key: 'guitar', instrument: 'electric_guitar_jazz', testNote: 52 },
  { key: 'bass', instrument: 'acoustic_bass', testNote: 36 },
  { key: 'flute', instrument: 'flute', testNote: 67 },
  { key: 'violin', instrument: 'violin', testNote: 64 },
];

interface PerfResult {
  loadWallMs: number;
  perInstrumentMs: Record<string, number>;
  heapDeltaMB: number | null;
  triggerDispatchMs: number;
}

export default function StyPocPage() {
  const [status, setStatus] = useState<string>('idle');
  const [result, setResult] = useState<PerfResult | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const instrumentsRef = useRef<Soundfont[]>([]);

  async function runPoc() {
    setStatus('loading...');
    setResult(null);

    if (!ctxRef.current) ctxRef.current = new AudioContext();
    const ctx = ctxRef.current;
    await ctx.resume();

    // memoryRef start
    const heapStart = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;

    // Parallel load of all 5 GM instruments
    const tStart = performance.now();
    const perInstrumentMs: Record<string, number> = {};

    const loaded = await Promise.all(
      GM_PROGRAMS.map(async (p) => {
        const tInst = performance.now();
        const inst = new Soundfont(ctx, {
          instrument: p.instrument,
          kit: 'FluidR3_GM',
        });
        await inst.load;
        perInstrumentMs[p.key] = +(performance.now() - tInst).toFixed(0);
        console.log(`[${p.key}] loaded in ${perInstrumentMs[p.key]}ms`);
        return inst;
      }),
    );
    const loadWallMs = +(performance.now() - tStart).toFixed(0);
    instrumentsRef.current = loaded;

    const heapEnd = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null;
    const heapDeltaMB = heapStart && heapEnd ? +((heapEnd - heapStart) / 1024 / 1024).toFixed(1) : null;

    // Schedule a 5-channel simultaneous trigger at now + 100ms
    const triggerAt = ctx.currentTime + 0.1;
    const tDispatchStart = performance.now();
    loaded.forEach((inst, i) => {
      inst.start({
        note: GM_PROGRAMS[i].testNote,
        time: triggerAt,
        duration: 1.5,
        velocity: 80,
      });
    });
    const triggerDispatchMs = +(performance.now() - tDispatchStart).toFixed(2);

    const r: PerfResult = { loadWallMs, perInstrumentMs, heapDeltaMB, triggerDispatchMs };
    setResult(r);
    setStatus(`done — ${loadWallMs}ms total load, ${triggerDispatchMs}ms dispatch`);
    console.log('PoC result:', r);
  }

  function stopAll() {
    instrumentsRef.current.forEach((inst) => inst.stop());
    setStatus('stopped');
  }

  return (
    <div style={{ padding: 24, fontFamily: 'system-ui', color: '#eee', background: '#1a1a1a', minHeight: '100vh' }}>
      <h1>.sty Multi-Channel SoundFont PoC</h1>
      <p style={{ color: '#aaa' }}>
        Loads 5 unique GM instruments in parallel and triggers them simultaneously.
        This is the realistic load profile for a 16-channel Yamaha style file
        (psBase.sst uses these 5 programs across 16 MIDI channels).
      </p>

      <div style={{ marginTop: 16 }}>
        <button onClick={runPoc} style={btnStyle}>Load + trigger</button>
        <button onClick={stopAll} style={{ ...btnStyle, marginLeft: 8 }}>Stop</button>
      </div>

      <p style={{ marginTop: 16 }}>Status: <code>{status}</code></p>

      {result && (
        <div style={{ marginTop: 16, padding: 16, background: '#2a2a2a', borderRadius: 8 }}>
          <h2>Result</h2>
          <ul>
            <li>Parallel load wall-clock: <strong>{result.loadWallMs} ms</strong></li>
            <li>Per-instrument load time:
              <ul>
                {Object.entries(result.perInstrumentMs).map(([k, v]) => (
                  <li key={k}><code>{k}</code>: {v} ms</li>
                ))}
              </ul>
            </li>
            <li>JS heap delta: <strong>{result.heapDeltaMB ?? '(unavailable — Chrome only)'} MB</strong></li>
            <li>Trigger dispatch (5 notes): <strong>{result.triggerDispatchMs} ms</strong></li>
          </ul>

          <h3>Verdict criteria</h3>
          <ul style={{ fontSize: 14 }}>
            <li>Load &lt; 5000 ms: smplr OK for on-demand load</li>
            <li>Load 5000-15000 ms: needs splash screen / progress bar</li>
            <li>Load &gt; 15000 ms OR any 503 errors in console: <strong>need alternative (tone.js, bundled SF2, or self-host samples)</strong></li>
            <li>Dispatch &gt; 5 ms: consider Web Worker for sequencing</li>
          </ul>
        </div>
      )}
    </div>
  );
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
