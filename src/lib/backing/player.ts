import type {
  Chart,
  BackingConfig,
  BackingEvent,
  BackingPlayer,
  BackingPlayerCallbacks,
  StyleId,
} from "./types";
import { renderChart } from "./engine";
import { loadInstruments, loadMelodyInstrument, type TriggerableInstrument } from "./soundfont";
import { loadDrumLoopPlayer, type DrumLoopPlayer } from "./drumLoopPlayer";
import {
  getPlayerSettings,
  subscribePlayerSettings,
  type PlayerSettings,
} from "../note/playerSettings";
import { DRUM_KIT_PRESETS } from "./drumKitPresets";
import { DRUM_INSTRUMENT } from "../note/gmInstruments";

/* ─────────────────────────────────────────────────────────────────────────
 * Backing player.
 *
 * Owns the AudioContext, lazy-loads soundfont instruments, renders the chart
 * to an event stream via the engine, and schedules those events into the
 * AudioContext with a lookahead-based RAF tick loop.
 *
 * Transport pattern is ported from the legacy NotePlayer (removed).
 * ──────────────────────────────────────────────────────────────────────── */

const LOOKAHEAD_SEC = 0.2;
const TICK_TOLERANCE_SEC = 0.05;

/** Map the transport's genre label (PlayerSettings.genre, one of GENRES in
 *  BackingPlayerBar) to the engine's StyleId so the rhythm section routes to
 *  the matching per-genre drum/feel renderer. Falls back to the binary
 *  PlayStyle when the genre is unrecognized. Latin maps to 'samba' so it
 *  resolves to the engine's 'latin' feel. */
function genreToStyleId(genre: string, fallback: "swing" | "bossa"): StyleId {
  switch (genre) {
    case "Ballad":         return "ballad-swing";
    case "Medium Swing":   return "medium-swing";
    case "Up-Tempo Swing": return "up-swing";
    case "Bebop":          return "bebop";
    case "Bossa Nova":     return "bossa";
    case "Samba":          return "samba";
    case "Latin":          return "latin";
    case "Latin Swing":    return "latin-swing";
    case "Funk":           return "funk";
    case "Jazz Waltz":     return "waltz-jazz";
    case "New Orleans Swing": return "new-orleans";
    case "Straight 8ths":  return "rock";
    case "Shuffle":        return "shuffle";
    default:               return fallback === "bossa" ? "bossa" : "medium-swing";
  }
}

/** Merge the global PlayerSettings into a BackingConfig — explicit fields in
 *  the config take precedence so callers can override per-player if needed. */
function mixSettingsIntoConfig(
  s: PlayerSettings,
  base: BackingConfig,
): BackingConfig {
  const kitCfg = DRUM_KIT_PRESETS[s.drumKit].toConfig();
  // Genre label → StyleId so the engine plays the genre's own groove
  // (bossa/latin/ballad/up-tempo/funk/…), not just swing-vs-bossa.
  const mappedStyle = genreToStyleId(s.genre, s.style);
  return {
    ...kitCfg,                   // drumMode + drumLoop
    style: mappedStyle,
    loop: s.loop,
    melodyInstrument: s.melodyInstrument,
    ...base,                     // caller overrides win
    volume: {
      piano: s.pianoVolume,
      bass: s.bassVolume,
      drums: s.drumVolume,
      melody: s.melodyVolume,
      ...(base.volume ?? {}),
    },
    pianoReverb: base.pianoReverb ?? s.pianoReverb,
  };
}

export function createBackingPlayer(
  chart: Chart,
  initialConfig: BackingConfig = {},
): BackingPlayer {
  const callbacks: BackingPlayerCallbacks = {};
  // Seed config with the global mixer settings so volume / reverb / kit are
  // shared across every backing player and note-sheet player.
  const seeded = mixSettingsIntoConfig(getPlayerSettings(), initialConfig);
  let config: BackingConfig = seeded;
  /* Caller-level overrides = initialConfig + every explicit setConfig patch
   * (orchestrator/page). The global-settings broadcast below re-mixes the new
   * settings UNDER these (base wins in mixSettingsIntoConfig), so moving one
   * mixer slider can no longer clobber per-player seeds — e.g. the lick
   * engine's melodyInstrument:'piano' / loop:false / pianoReverb, or a style
   * the orchestrator set at runtime. */
  let callerOverrides: Partial<BackingConfig> = { ...initialConfig };
  let inSettingsBroadcast = false;

  let ctx: AudioContext | null = null;
  let piano: TriggerableInstrument | null = null;
  let bass: TriggerableInstrument | null = null;
  let drums: TriggerableInstrument | null = null;
  let melody: TriggerableInstrument | null = null;
  let melodyDestination: AudioNode | null = null;
  let melodyInstId: string | null = null;        // currently-loaded melody instrument
  let melodyLoading: Promise<void> | null = null; // in-flight melody (re)load
  // Multi-part scores: one loaded instrument per distinct GM timbre present in
  // the melody track (keyed by MusyngKite name). dispatch() routes each note
  // to its part's instrument; falls back to `melody`/piano while loading.
  const melodyInstMap = new Map<string, TriggerableInstrument>();
  let melodyMapLoading: Promise<void> | null = null;
  let pianoReverbSend: GainNode | null = null;
  let drumLoop: DrumLoopPlayer | null = null;
  let drumLoopUrl: string | null = null;       // currently-loaded loop URL
  let loading: Promise<void> | null = null;
  // In-flight drum loop fetch; second concurrent call awaits this instead of
  // racing a parallel fetch (whose late-arriving result would otherwise clobber
  // the newer selection).
  let drumLoopLoading: Promise<void> | null = null;
  let disposed = false;

  let events: BackingEvent[] = [];
  // Time-sorted melody notes for visual highlight sync, built in build().
  // Each entry carries the SOURCE (mi, ni) so the renderer maps it to the
  // exact StaveNote regardless of rests / ties / chords / grace notes.
  let melodyTimeline: { time: number; mi: number; ni: number }[] = [];
  let origin = 0;
  let elapsed = 0;
  let nextIdx = 0;
  let rafHandle = 0;
  let playing = false;
  // Synchronous re-entrancy guard: `playing` is only set true AFTER play()'s
  // awaits (ensureCtx/ensureInstruments/…), so two play() calls landing during
  // that window would both pass the `if (playing)` check and start duplicate
  // tick loops (double audio + a leaked RAF chain). `starting` closes the gap.
  let starting = false;
  /* Transport epoch — play()의 await 구간(콜드 스타트 수 초) 동안 stop()/
   * pause()/dispose()가 끼어들면 증가한다. play()는 await를 마친 뒤 자신의
   * epoch가 그대로일 때만 playing=true로 진입 — "정지를 눌렀는데 로드가 끝나자
   * 음악이 시작되는" 재진입 레이스를 막는다. */
  let transportEpoch = 0;
  let lastBarFired = -2;
  let lastNoteIdx = -1;  // index into melodyTimeline of the last highlighted note
  let loopCount = 0;  // completed song passes this play() session (for repeatCount)
  let secPerBar = 0;
  let beatsPerBar = 0;
  let totalBars = 0;
  // Break Editor: true while the playhead is inside a backing "rest" region.
  // Used to fire a single hard-cut (stopAll on piano/bass/drums) right when a
  // break begins, instead of every tick.
  let wasInBreak = false;
  // Pending teardown timer for the reverberant ending tail (see finishWithTail).
  let endingTimer: ReturnType<typeof setTimeout> | null = null;

  /* ── audio context / instruments ─────────────────────────────────── */

  /** Create (but DON'T resume) the AudioContext. A freshly-created context
   *  starts "suspended"; that's fine for warmup — `fetch` + `decodeAudioData`
   *  (and smplr's sample loading) all work on a suspended context, so we can
   *  preload every instrument/sample on mount WITHOUT a user gesture. Only
   *  actual playback needs the context running, so `resume()` is deferred to
   *  `ensureCtx()` (called from play(), which runs inside the click gesture).
   *  This is what makes the count-in start instantly instead of stalling ~2s
   *  on a cold first play. */
  /** Drop every instrument/node bound to the current ctx so a fresh ctx
   *  reloads them. Called when we recreate a dead/poisoned AudioContext. */
  function disposeCtxGraph(): void {
    try { piano?.stopAll(); bass?.stopAll(); drums?.stopAll(); melody?.stopAll(); } catch { /* noop */ }
    try { melodyInstMap.forEach((inst) => inst.stopAll()); } catch { /* noop */ }
    melodyInstMap.clear(); melodyMapLoading = null;
    piano = null; bass = null; drums = null; melody = null;
    pianoReverbSend = null; melodyDestination = null; melodyInstId = null;
    loading = null; melodyLoading = null;
    try { drumLoop?.dispose(); } catch { /* noop */ }
    drumLoop = null; drumLoopUrl = null; drumLoopLoading = null;
  }

  function newCtx(): void {
    ctx = new AudioContext();
    // Recover from transient audio-device / renderer errors. When the OS audio
    // device glitches (Bluetooth/output switch, sample-rate change, app
    // backgrounding) Chrome logs "The AudioContext encountered an error from
    // the audio device or the WebAudio renderer." and the context can drop to
    // 'interrupted'/'suspended'. Auto-resume so playback recovers.
    ctx.addEventListener("statechange", () => {
      const st = ctx?.state as string | undefined;
      if (playing && (st === "interrupted" || st === "suspended")) {
        ctx?.resume().catch(() => { /* will retry on next gesture/play */ });
      }
    });
  }

  function getCtx(): AudioContext {
    if (disposed) throw new Error("BackingPlayer has been disposed.");
    // Recreate if missing or the previous context was closed/poisoned.
    if (!ctx || ctx.state === "closed") {
      if (ctx) disposeCtxGraph();
      newCtx();
    }
    return ctx!;
  }

  async function ensureCtx(): Promise<AudioContext> {
    getCtx();
    try {
      if (ctx!.state === "suspended") await ctx!.resume();
    } catch {
      // resume() rejected — the context is poisoned (warmup created it before a
      // gesture, or the audio device errored). Recreate a fresh one and reload
      // instruments on it so playback ALWAYS starts (the whole point of the
      // count-in → play handoff).
      try { await ctx!.close(); } catch { /* noop */ }
      disposeCtxGraph();
      newCtx();
      try { await ctx!.resume(); } catch { /* last resort: leave suspended */ }
    }
    // If resume resolved but the context still isn't running (some browsers
    // leave it 'suspended' until a fresh gesture), one more attempt is cheap.
    if (ctx!.state === "suspended") {
      try { await ctx!.resume(); } catch { /* noop */ }
    }
    return ctx!;
  }

  function ensureInstruments(): Promise<void> {
    if (piano && bass && drums) return ensureMelodyInstrument().then(() => ensureMelodyInstruments());
    if (loading) return loading;
    // Load on the (possibly suspended) context — no resume needed, so this
    // can run during mount-time warmup before any user gesture.
    loading = loadInstruments(getCtx()).then((inst) => {
      if (disposed) {
        inst.piano.stopAll();
        inst.bass.stopAll();
        inst.drums.stopAll();
        return;
      }
      piano = inst.piano;
      bass = inst.bass;
      drums = inst.drums;
      pianoReverbSend = inst.pianoReverbSend;
      melodyDestination = inst.melodyDestination;
      // Apply any pianoReverb setting that was already in config when we loaded.
      applyPianoReverb();
    }).then(() => ensureMelodyInstrument()).then(() => ensureMelodyInstruments())
      .catch((err) => {
        // CRITICAL: clear the cached promise on failure so the NEXT call
        // retries the load. Without this, one transient CDN/network error
        // leaves a rejected promise cached here forever and every subsequent
        // play()/preload() fails instantly until a full page reload.
        // (melodyLoading / drumLoopLoading already reset in their finally.)
        loading = null;
        throw err; // this attempt still fails — callers handle/report it
      });
    return loading;
  }

  /** Lazily (re)load the melody lead instrument to match config.melodyInstrument.
   *  Idempotent — returns immediately when the wanted instrument is already
   *  loaded. Concurrent / rapid changes chain off the in-flight load and
   *  re-evaluate against the latest config when it resolves, so a stale load
   *  can't clobber the newer selection (same pattern as ensureDrumLoop). */
  function ensureMelodyInstrument(): Promise<void> {
    if (melodyLoading) return melodyLoading.then(() => ensureMelodyInstrument());
    const want = config.melodyInstrument ?? "piano";
    if (melody && melodyInstId === want) return Promise.resolve();
    if (!ctx || !melodyDestination) return Promise.resolve(); // loaded in ensureInstruments
    const dest = melodyDestination;
    melodyLoading = (async () => {
      try {
        const inst = await loadMelodyInstrument(ctx!, dest, want);
        if (disposed) {
          inst.stopAll();
          return;
        }
        // Config may have changed during the fetch — drop a stale result.
        if ((config.melodyInstrument ?? "piano") !== want) return;
        melody?.stopAll();
        melody = inst;
        melodyInstId = want;
      } catch (err) {
        console.warn("[backing] melody instrument load failed:", want, err);
      } finally {
        melodyLoading = null;
      }
    })();
    return melodyLoading;
  }

  /** Multi-part: load one instrument per distinct GM timbre present in the
   *  current melody track (config.melody[].instrument). Drum-routed notes
   *  (melodyInst === DRUM_INSTRUMENT / drumPiece set) use the drum sampler,
   *  not a pitched instrument, so they're skipped here. Idempotent. */
  /** Per-instrument in-flight loads. play()'s ensureInstruments chain and a
   *  rapid setConfig({melody}) used to race here: both saw `!melodyInstMap.has`,
   *  fetched the SAME soundfont twice, and the later result clobbered the
   *  earlier instance (orphaning its connected nodes, double download). */
  const melodyInstInflight = new Map<string, Promise<void>>();

  function ensureMelodyInstruments(): Promise<void> {
    if (!ctx || !melodyDestination) return Promise.resolve();
    const dest = melodyDestination;
    const jobs: Promise<void>[] = [];
    for (const m of config.melody ?? []) {
      const name = (m as { instrument?: string }).instrument;
      const isDrum = (m as { drumPiece?: unknown }).drumPiece !== undefined;
      if (!name || isDrum || name === DRUM_INSTRUMENT || melodyInstMap.has(name)) continue;
      const inflight = melodyInstInflight.get(name);
      if (inflight) { jobs.push(inflight); continue; }
      const job = (async () => {
        try {
          const inst = await loadMelodyInstrument(ctx!, dest, name);
          if (disposed) { inst.stopAll(); return; }
          melodyInstMap.set(name, inst);
        } catch (err) {
          console.warn('[backing] part instrument load failed:', name, err);
        } finally {
          melodyInstInflight.delete(name);
        }
      })();
      melodyInstInflight.set(name, job);
      jobs.push(job);
    }
    if (jobs.length === 0) return melodyMapLoading ?? Promise.resolve();
    const load = Promise.all(jobs).then(() => undefined);
    melodyMapLoading = load;
    return load;
  }

  function applyPianoReverb() {
    if (!ctx || !pianoReverbSend) return;
    if (config.pianoReverb === undefined) return;
    pianoReverbSend.gain.setTargetAtTime(
      config.pianoReverb,
      ctx.currentTime,
      0.05,
    );
  }

  /** Lazy-load drum loop player if config.drumLoop is set. Reloads when URL
   *  changes. Concurrent / rapid-fire calls (e.g. sticks→brushes→sticks) chain
   *  off the in-flight fetch and the chain re-evaluates against the latest
   *  config when it resolves — so a stale load can't clobber the newer one. */
  function ensureDrumLoop(): Promise<void> {
    if (drumLoopLoading) return drumLoopLoading.then(() => ensureDrumLoop());
    const cfg = config.drumLoop;
    if (config.drumMode !== "loop" || !cfg) {
      if (drumLoop) { drumLoop.dispose(); drumLoop = null; drumLoopUrl = null; }
      return Promise.resolve();
    }
    if (drumLoop && drumLoopUrl === cfg.url) return Promise.resolve();
    const targetUrl = cfg.url;
    drumLoop?.dispose();
    drumLoop = null;
    drumLoopUrl = null;
    drumLoopLoading = (async () => {
      try {
        const c = getCtx();   // fetch+decode the loop on a suspended ctx (warmup, no gesture)
        const player = await loadDrumLoopPlayer(c, c.destination, cfg);
        if (disposed) {
          player.dispose();
          return;
        }
        // Config may have flipped during the fetch — drop a stale result.
        if (config.drumLoop?.url !== targetUrl) {
          player.dispose();
          return;
        }
        drumLoop = player;
        drumLoopUrl = targetUrl;
        callbacks.onDrumKitError?.(null);
      } catch (err) {
        console.warn("[backing] drum loop load failed, falling back to hit mode:", err);
        callbacks.onDrumKitError?.(
          `드럼 루프 파일을 불러오지 못해 Synth로 재생합니다.`,
        );
      } finally {
        drumLoopLoading = null;
      }
    })();
    return drumLoopLoading;
  }

  /* ── event building ──────────────────────────────────────────────── */

  function build() {
    const bpm = config.bpm ?? chart.bpm;
    // Pass `config.feel` so a user-side feel override (e.g. switching from
    // medium-swing to ballad-swing on the same chart) actually changes the
    // engine's piano/drum routing. Previously this dropped `feel` silently.
    // `config.melody` (when set) threads the lead line into RenderOptions so
    // it's scheduled alongside the rhythm section on the same time grid.
    events = renderChart(chart, {
      bpm,
      style: config.style,
      feel: config.feel,
      melody: config.melody,
    });
    beatsPerBar = chart.timeSig[0];
    secPerBar = beatsPerBar * (60 / bpm);
    totalBars = chart.sections.reduce((s, sec) => s + sec.bars.length, 0);
    // Build a time-sorted melody timeline for highlight sync. Carries each
    // event's SOURCE note index (srcMi/srcNi) so the renderer maps it to the
    // exact StaveNote — counting by position drifts on rests/ties/chords/graces.
    melodyTimeline = [];
    for (const ev of events) {
      if (ev.kind === "note" && ev.instrument === "melody") {
        melodyTimeline.push({
          time: ev.time,
          mi: ev.srcMi ?? ev.bar,
          ni: ev.srcNi ?? 0,
        });
      }
    }
    melodyTimeline.sort((a, b) => a.time - b.time);
  }

  /* ── Break Editor gating ─────────────────────────────────────────── */

  /** Backing = everything the break silences: drums + all pitched parts
   *  EXCEPT the melody lead-line (which always plays through a break). */
  function isBackingEvent(ev: BackingEvent): boolean {
    return ev.kind === "drum" || ev.instrument !== "melody";
  }

  /** 1-based beat index of an event within its own bar (rounded to the grid
   *  so humanization offsets don't tip it into the wrong beat). */
  function beatOfTime(time: number, bar: number): number {
    if (secPerBar <= 0 || beatsPerBar <= 0) return 1;
    const secPerBeat = secPerBar / beatsPerBar;
    const within = time - bar * secPerBar;
    return Math.floor(within / secPerBeat + 0.5) + 1;
  }

  /** A backing event is gated (silenced) when its bar has a break and the
   *  event sits at/after the break's start beat. */
  function isGated(ev: BackingEvent): boolean {
    const breaks = config.breakBeats;
    if (!breaks || breaks.length === 0 || !isBackingEvent(ev)) return false;
    const bp = breaks.find((p) => p.bar === ev.bar);
    if (!bp) return false;
    return beatOfTime(ev.time, ev.bar) >= bp.beat;
  }

  /** Is the playhead (pass-relative seconds) currently inside a break rest? */
  function inBreakNow(now: number): boolean {
    const breaks = config.breakBeats;
    if (!breaks || breaks.length === 0 || secPerBar <= 0 || beatsPerBar <= 0) return false;
    const bar = Math.floor(now / secPerBar);
    const bp = breaks.find((p) => p.bar === bar);
    if (!bp) return false;
    const secPerBeat = secPerBar / beatsPerBar;
    const within = now - bar * secPerBar;
    const beat = Math.floor(within / secPerBeat) + 1;
    return beat >= bp.beat;
  }

  /* ── scheduler loop ──────────────────────────────────────────────── */

  const tick = () => {
    if (!playing || !ctx) return;
    const now = ctx.currentTime - origin;

    // Practice region loop bounds (0-based flat bar indices → seconds). When
    // active, playback is confined to [startBar, endBar] and wraps back to
    // startBar — this overrides whole-song loop / repeatCount below.
    const rgn = config.loopRegion;
    const regionActive = !!rgn && secPerBar > 0 && totalBars > 0
      && rgn.startBar >= 0 && rgn.endBar >= rgn.startBar;
    const regionStartSec = regionActive ? rgn!.startBar * secPerBar : 0;
    const regionEndSec = regionActive ? Math.min(rgn!.endBar + 1, totalBars) * secPerBar : 0;

    // Break Editor: hard-cut the backing the instant the playhead enters a
    // rest region (stop ringing piano/bass/drums voices). Melody is left
    // alone so the lead line plays straight through the break.
    const breakNow = inBreakNow(now);
    if (breakNow && !wasInBreak) {
      try { piano?.stopAll(); bass?.stopAll(); drums?.stopAll(); } catch { /* noop */ }
    }
    wasInBreak = breakNow;

    // Schedule upcoming events inside the lookahead window
    while (nextIdx < events.length) {
      const ev = events[nextIdx];
      if (regionActive && ev.time >= regionEndSec) break; // don't schedule past the region end
      if (ev.time > now + LOOKAHEAD_SEC) break;
      if (ev.time >= now - TICK_TOLERANCE_SEC && !isGated(ev)) {
        dispatch(ev);
      }
      nextIdx++;
    }

    // Compute current bar directly from elapsed time — this is perfectly
    // aligned with the audio because both use the same secPerBar grid.
    // No event-scanning needed, so humanization offsets on individual
    // events can't cause the highlight to jump early or late.
    let currentBar = secPerBar > 0
      ? Math.min(Math.floor(now / secPerBar), totalBars - 1)
      : -1;
    // Keep the highlight inside the loop region (avoids a brief out-of-region
    // flicker right after a wrap, when `now` momentarily sits just before start).
    if (regionActive) {
      currentBar = Math.min(Math.max(currentBar, rgn!.startBar), rgn!.endBar);
    }
    if (currentBar !== lastBarFired) {
      lastBarFired = currentBar;
      callbacks.onBar?.(currentBar);
    }

    // Highlight the current melody note off the SAME elapsed-time clock as the
    // bar highlight above — so note + measure highlights stay locked together
    // and land exactly when the note sounds, not LOOKAHEAD_SEC early (the old
    // schedule-time emission drifted ahead of the audio and the bar box).
    if (melodyTimeline.length > 0) {
      let idx = lastNoteIdx;
      // Monotonic forward scan; seek/stop reset lastNoteIdx to -1 so a backward
      // jump simply re-scans from the start on the next tick.
      while (idx + 1 < melodyTimeline.length
        && melodyTimeline[idx + 1].time <= now + TICK_TOLERANCE_SEC) {
        idx++;
      }
      if (idx !== lastNoteIdx) {
        lastNoteIdx = idx;
        if (idx >= 0) {
          const e = melodyTimeline[idx];
          callbacks.onNote?.(e.mi, e.ni);
        }
      }
    }

    // Practice region loop — overrides the whole-song done/stop logic. The
    // instant every event up to `endBar` has been scheduled (mirrors the
    // proactive whole-song wrap), rewind to `startBar` by advancing origin one
    // region length. The just-scheduled tail keeps sounding; the rewound
    // region-start events now sit in the future, so the seam is sample-accurate
    // and the loop runs forever (until stop) regardless of `loop`/`repeatCount`.
    if (regionActive) {
      const regionDone = nextIdx >= events.length || events[nextIdx].time >= regionEndSec;
      if (regionDone) {
        origin += regionEndSec - regionStartSec;
        nextIdx = 0;
        for (let i = 0; i < events.length; i++) {
          if (events[i].time >= regionStartSec - TICK_TOLERANCE_SEC) { nextIdx = i; break; }
        }
        lastBarFired = -2;
        lastNoteIdx = -1;
        wasInBreak = false;
      }
      rafHandle = requestAnimationFrame(tick);
      return;
    }

    // Done? — wrap if looping, otherwise stop.
    if (nextIdx >= events.length) {
      // repeatCount (>=1) wins over `loop`: play exactly N times. Otherwise
      // fall back to the boolean loop (infinite).
      const reps = config.repeatCount;
      const wantMore = reps != null && reps >= 1
        ? loopCount + 1 < reps
        : (config.loop ?? true);
      if (wantMore && totalBars > 0 && secPerBar > 0) {
        // Wrap PROACTIVELY — the instant the whole pass is scheduled (already
        // ~LOOKAHEAD_SEC before the last event even sounds), NOT after a
        // post-roll delay. The old `now > last.time + 0.5` gate waited until
        // real-time had crossed the song boundary, so the next chorus's
        // downbeat events (song-time ≈ 0) were already in the PAST and the
        // scheduler's `ev.time >= now - tol` guard silently dropped them —
        // killing the comp/bass/melody "1" of every looped chorus (the drum
        // buffer loops internally, which masked the gap). Advancing origin by
        // exactly one song length keeps absolute-time continuity (drum loop
        // stays phase-locked) while the rewound events now sit in the FUTURE
        // and fire on the grid, so the seam is sample-accurate.
        const songLength = totalBars * secPerBar;
        origin += songLength;
        nextIdx = 0;
        lastBarFired = -2;
        lastNoteIdx = -1;
        wasInBreak = false;
        loopCount += 1;
      } else {
        // Not looping (or final pass of a repeatCount): let the last note ring
        // a beat before teardown so the ending isn't hard-cut.
        const last = events[events.length - 1];
        if (last && now > last.time + 0.5) {
          if (config.endingTail === false) {
            // Short-phrase (lick) ending: no song-style reverb bloom. End the
            // transport immediately so the UI flips Stop→Play the moment the
            // phrase completes, and fire onDone now. We deliberately DON'T
            // killActiveNodes() — the last note keeps ringing on its own envelope.
            // The DRUM LOOP however is an infinite AudioBufferSource (loop=true)
            // that never ends on its own — without this stop it kept playing
            // forever after the lick finished (brushes/sticks kits).
            drumLoop?.stop();
            playing = false;
            cancelAnimationFrame(rafHandle);
            elapsed = 0;
            nextIdx = 0;
            lastBarFired = -2;
            lastNoteIdx = -1;
            callbacks.onBar?.(-1);
            callbacks.onDone?.();
            return;
          } else {
            // Final pass finished — don't hard-cut. Re-strike the closing chord
            // and let it bloom into the reverb tail before teardown.
            finishWithTail();
            return;
          }
        }
      }
    }

    rafHandle = requestAnimationFrame(tick);
  };

  function dispatch(ev: BackingEvent) {
    if (!ctx) return;
    const absTime = origin + ev.time;

    if (ev.kind === "drum") {
      // Loop mode owns the entire drum part — skip per-hit dispatch.
      if (config.drumMode === "loop" && drumLoop) return;
      const vol = config.volume?.drums ?? 1;
      if (vol <= 0) return;
      drums?.trigger({
        note: ev.piece,
        time: absTime,
        duration: 0,
        velocity: ev.velocity * vol,
      });
      return;
    }

    // Multi-part drum staff: a melody note flagged with a DrumPiece routes to
    // the drum sampler (GM percussion), not a pitched instrument.
    if (ev.instrument === "melody" && ev.drumPiece) {
      if (config.drumMode === "loop" && drumLoop) return;
      const dvol = config.volume?.drums ?? 1;
      if (dvol <= 0) return;
      drums?.trigger({ note: ev.drumPiece, time: absTime, duration: 0, velocity: ev.velocity * dvol });
      return;
    }

    // Melody plays on its own swappable lead instrument (piano / sax / flute /
    // …, loaded by ensureMelodyInstrument). For multi-part scores each note may
    // carry its own GM timbre (ev.melodyInst) → route to that loaded instrument
    // from melodyInstMap. Falls back to the single lead, then the comp piano,
    // while instruments are still loading so the first notes aren't dropped.
    const inst =
      ev.instrument === "piano" ? piano :
      ev.instrument === "bass"  ? bass  :
      ev.instrument === "melody"
        ? (ev.melodyInst ? (melodyInstMap.get(ev.melodyInst) ?? melody ?? piano) : (melody ?? piano))
        : null;
    if (!inst) return;

    const vol = config.volume?.[ev.instrument] ?? 1;
    if (vol <= 0) return;

    inst.trigger({
      note: ev.midi,
      time: absTime,
      duration: ev.duration,
      velocity: ev.velocity * vol,
    });
  }

  function killActiveNodes() {
    piano?.stopAll();
    bass?.stopAll();
    drums?.stopAll();
    melody?.stopAll();
    melodyInstMap.forEach((inst) => inst.stopAll());
    drumLoop?.stop();
  }

  /* ── reverberant ending ──────────────────────────────────────────────
   * Instead of cutting everything dead on the final pass, re-strike the
   * closing voicing as one long sustained chord, crank the piano reverb send
   * for a big bloom, and defer teardown until the tail has rung out. Gives a
   * "button" ending that hangs in the air rather than stopping abruptly. */
  const ENDING_TAIL_SEC = 4.5;
  const ENDING_REVERB_SEND = 0.85;

  /** Pull the last-struck comp voicing + last bass note from the event stream.
   *  Keyed on the latest onset time (not bar index) so it stays robust even if
   *  the final bar's comping slice happens to be sparse. */
  function collectFinalChord(): { piano: number[]; bass: number | null } {
    let maxPiano = -Infinity;
    let bassNote: number | null = null;
    let bassTime = -Infinity;
    for (const ev of events) {
      if (ev.kind !== "note") continue;
      if (ev.instrument === "piano" && ev.time > maxPiano) maxPiano = ev.time;
      if (ev.instrument === "bass" && ev.time >= bassTime) {
        bassTime = ev.time;
        bassNote = ev.midi;
      }
    }
    const pitches = new Set<number>();
    if (maxPiano > -Infinity) {
      for (const ev of events) {
        if (ev.kind !== "note" || ev.instrument !== "piano") continue;
        // 0.12s window captures the final onset cluster incl. roll-spread.
        if (Math.abs(ev.time - maxPiano) < 0.12) pitches.add(ev.midi);
      }
    }
    return { piano: [...pitches].slice(0, 6), bass: bassNote };
  }

  function finishWithTail(): void {
    if (!ctx) { stop(); callbacks.onDone?.(); return; }
    playing = false;
    cancelAnimationFrame(rafHandle);

    const t = ctx.currentTime + 0.02;
    const { piano: chord, bass: bassNote } = collectFinalChord();

    // Drums end — this is a held chord, not a groove.
    drums?.stopAll();
    drumLoop?.stop();

    // Bloom the piano reverb send for the tail.
    if (pianoReverbSend) {
      pianoReverbSend.gain.cancelScheduledValues(t);
      pianoReverbSend.gain.setTargetAtTime(ENDING_REVERB_SEND, t, 0.08);
    }

    // Re-strike the closing voicing, sustained into the reverb tail.
    const pVol = config.volume?.piano ?? 1;
    if (pVol > 0) {
      for (const midi of chord) {
        piano?.trigger({ note: midi, time: t, duration: ENDING_TAIL_SEC, velocity: 0.5 * pVol });
      }
    }
    const bVol = config.volume?.bass ?? 1;
    if (bassNote != null && bVol > 0) {
      bass?.trigger({ note: bassNote, time: t, duration: ENDING_TAIL_SEC, velocity: 0.6 * bVol });
    }

    // Defer teardown until the chord + reverb tail have decayed. setTimeout is
    // fine here — all audio is already scheduled; this just releases nodes and
    // notifies the UI.
    if (endingTimer) clearTimeout(endingTimer);
    endingTimer = setTimeout(() => {
      endingTimer = null;
      // Restore the configured reverb send for the next play().
      if (pianoReverbSend && ctx) {
        pianoReverbSend.gain.setTargetAtTime(config.pianoReverb ?? 0.22, ctx.currentTime, 0.1);
      }
      stop();
      callbacks.onDone?.();
    }, (ENDING_TAIL_SEC + 1.5) * 1000);
  }

  /* ── public API ──────────────────────────────────────────────────── */

  /** AudioContext + instruments + drum 자원을 미리 로드. play() 가 같은 ensure* 들을
   *  호출하지만 모두 idempotent (캐시) 라 카운트인과 병렬로 호출해두면 첫 재생
   *  지연이 사라진다. */
  async function preload(): Promise<void> {
    // Warmup must NOT resume the context (that needs a user gesture and would
    // stall on mount). Just create it suspended and load all samples on it —
    // play() resumes later inside the click gesture, by which point everything
    // is already decoded so the count-in starts instantly.
    getCtx();
    await ensureInstruments();
    await ensureDrumLoop();
  }

  async function play(playOpts: { startAt?: number } = {}): Promise<void> {
    if (playing || starting) return;
    starting = true;
    const epoch = ++transportEpoch;
    try {
    // A previous ending tail may still be ringing (playing===false but the
    // teardown timer pending). Cancel it so its stop()/onDone can't fire into
    // this fresh playback, and reset the reverb send.
    if (endingTimer) {
      clearTimeout(endingTimer);
      endingTimer = null;
      killActiveNodes();
      if (pianoReverbSend && ctx) {
        pianoReverbSend.gain.setTargetAtTime(config.pianoReverb ?? 0.22, ctx.currentTime, 0.05);
      }
    }
    await ensureCtx();
    await ensureInstruments();
    await ensureDrumLoop();
    // stop()/pause()/dispose()가 위 await들 사이에 끼어들었나? 그렇다면 사용자
    // 의도는 "시작하지 마라" — 조용히 빠진다 (UI는 이미 정지 상태).
    if (epoch !== transportEpoch) return;
    build();
    playing = true;
    lastBarFired = -2;
    lastNoteIdx = -1;
    loopCount = 0;
    // Region loop: a FRESH start (elapsed 0) or a resume that landed outside the
    // region snaps to the region's first bar so playback begins at startBar.
    {
      const rgn = config.loopRegion;
      if (rgn && secPerBar > 0 && rgn.endBar >= rgn.startBar) {
        const rStart = rgn.startBar * secPerBar;
        const rEnd = (rgn.endBar + 1) * secPerBar;
        if (elapsed < rStart - TICK_TOLERANCE_SEC || elapsed >= rEnd) elapsed = rStart;
      }
    }
    // Lead the origin slightly so the first event (time=0) is strictly in
    // the future. Two cases:
    //   - startAt is comfortably in the future → trust the count-in's audio
    //     clock and use a tight 5 ms margin so the first event lands on the
    //     beat.
    //   - startAt is missing OR already in the past (instrument load took
    //     longer than the count-in — common on FIRST play with smplr's
    //     SplendidGrandPiano) → fall back to a 50 ms margin so the first
    //     events get scheduled with enough lead-time to actually sound.
    //     Without this, the first play silently dropped notes that the synth
    //     received in the past.
    const TIGHT_LEAD = 0.005;
    const SAFE_LEAD = 0.05;
    const now = ctx!.currentTime;
    const desiredOrigin = playOpts.startAt != null && playOpts.startAt > now + TIGHT_LEAD
      ? playOpts.startAt
      : now + SAFE_LEAD;
    origin = desiredOrigin - elapsed;

    // Fast-forward nextIdx on resume
    nextIdx = 0;
    for (let i = 0; i < events.length; i++) {
      if (events[i].time >= elapsed - TICK_TOLERANCE_SEC) {
        nextIdx = i;
        break;
      }
    }

    // Start the drum loop in sync with the transport origin.
    if (config.drumMode === "loop" && drumLoop) {
      const drumVol = config.volume?.drums ?? 1;
      drumLoop.setGain((config.drumLoop?.gain ?? 1) * drumVol);
      // Resume from pause: seek into the loop buffer so it stays phase-aligned
      // with the comp/bass that were already mid-bar. AudioBufferSourceNode's
      // start(when, offset) is part of the standard API.
      drumLoop.start(origin + elapsed, opts().bpm, elapsed);
    }

    tick();
    } finally {
      starting = false;
    }
  }

  function opts() {
    return { bpm: config.bpm ?? chart.bpm };
  }

  function pause(): void {
    // starting(로드 중) 구간의 pause = "시작 보류" 요청 — epoch만 올려 play()의
    // 가드가 잡게 한다 (playing은 아직 false라 아래 early-return).
    if (starting) transportEpoch++;
    if (!playing || !ctx) return;
    playing = false;
    cancelAnimationFrame(rafHandle);
    elapsed = ctx.currentTime - origin;
    killActiveNodes();
  }

  /** Jump to the start of `bar`. While playing, re-aims the live scheduler
   *  (mirrors play()'s resume math); while paused/idle, just seeds `elapsed`
   *  so the next play() resumes there. Needs a timeline — no-op until the
   *  first play() has run build(). */
  function seekToBar(bar: number): void {
    if (secPerBar <= 0 || totalBars <= 0 || events.length === 0) return;
    const clamped = Math.min(Math.max(0, Math.floor(bar)), totalBars - 1);
    const target = clamped * secPerBar;
    elapsed = target;
    if (!playing || !ctx) return;  // paused/idle: elapsed seeded for next play()

    // Live jump: cut sounding notes, rebase the transport clock so song-time
    // `target` lands just ahead of now, and re-aim the scheduler.
    killActiveNodes();
    const SAFE_LEAD = 0.05;
    origin = ctx.currentTime + SAFE_LEAD - target;
    nextIdx = 0;
    for (let i = 0; i < events.length; i++) {
      if (events[i].time >= target - TICK_TOLERANCE_SEC) { nextIdx = i; break; }
    }
    lastBarFired = -2;
    lastNoteIdx = -1;
    wasInBreak = false;
    // Re-phase the drum loop to the new position (killActiveNodes stopped it).
    if (config.drumMode === "loop" && drumLoop) {
      drumLoop.start(origin + target, opts().bpm, target);
    }
  }

  function stop(): void {
    transportEpoch++; // cancels any play() still inside its load awaits
    playing = false;
    cancelAnimationFrame(rafHandle);
    // Cancel any pending ending tail and restore the reverb send so a manual
    // stop mid-bloom doesn't leave the next play() over-reverbed.
    if (endingTimer) {
      clearTimeout(endingTimer);
      endingTimer = null;
      if (pianoReverbSend && ctx) {
        pianoReverbSend.gain.setTargetAtTime(config.pianoReverb ?? 0.22, ctx.currentTime, 0.05);
      }
    }
    elapsed = 0;
    nextIdx = 0;
    lastBarFired = -2;
    lastNoteIdx = -1;
    wasInBreak = false;
    killActiveNodes();
    callbacks.onBar?.(-1);
  }

  /** Swap the chart WITHOUT tearing down the AudioContext / instruments. Lets
   *  the orchestrator reuse one warmed engine across many sheets/licks so the
   *  next play() rebuilds events instantly instead of reloading soundfonts.
   *  The new chart takes effect on the next build() (i.e. the next play()). */
  function setChart(next: Chart): void {
    chart = next;
  }

  function setConfig(next: Partial<BackingConfig>): void {
    if (!inSettingsBroadcast) callerOverrides = { ...callerOverrides, ...next };
    const prevMode = config.drumMode;
    const prevUrl = config.drumLoop?.url;
    const prevBpm = config.bpm;
    const prevStyle = config.style;
    const prevFeel = config.feel;
    const prevMelodyInst = config.melodyInstrument;
    config = { ...config, ...next };

    // Apply pianoReverb immediately whether playing or not.
    applyPianoReverb();

    const melodyInstChanged =
      "melodyInstrument" in next && prevMelodyInst !== config.melodyInstrument;
    const melodyChanged = "melody" in next;

    if (playing) {
      // Mid-playback drum-kit / loop-URL / BPM / style / feel / melody-instrument
      // changes all desync against events already scheduled under the old
      // settings (or need a new sample set loaded). Fully stop so the user
      // explicitly resumes.
      const modeChanged = prevMode !== config.drumMode;
      const urlChanged = prevUrl !== config.drumLoop?.url;
      const bpmChanged = "bpm" in next && prevBpm !== config.bpm;
      const styleChanged = "style" in next && prevStyle !== config.style;
      const feelChanged = "feel" in next && prevFeel !== config.feel;
      if (modeChanged || urlChanged || bpmChanged || styleChanged || feelChanged || melodyInstChanged) {
        stop();
        callbacks.onDone?.();
        // Pre-fetch the new loop / melody instrument so the next play() doesn't
        // wait on IO.
        if (config.drumMode === "loop") {
          ensureDrumLoop().catch(() => { /* logged in loader */ });
        }
        if (melodyInstChanged) {
          ensureMelodyInstrument().catch(() => { /* logged in loader */ });
        }
        return;
      }
      if (config.drumMode === "loop" && drumLoop) {
        const drumVol = config.volume?.drums ?? 1;
        drumLoop.setGain((config.drumLoop?.gain ?? 1) * drumVol);
      }
      // Melody-only change (e.g. an inline lick toggled over the chord chart):
      // re-render the event stream in place WITHOUT touching the transport
      // clock, so the new melody starts at its bars with no stop/restart.
      if (melodyChanged) {
        // Multi-part: load any new per-part timbres for the swapped melody.
        ensureMelodyInstruments().catch(() => { /* logged in loader */ });
        rebuildEventsInPlace();
      }
      return;
    }

    // Idle: pre-load a newly-selected melody instrument (and any multi-part
    // per-part timbres) so the next play() doesn't stall on the sample fetch.
    if (melodyInstChanged) {
      ensureMelodyInstrument().catch(() => { /* logged in loader */ });
    }
    if (melodyChanged) {
      ensureMelodyInstruments().catch(() => { /* logged in loader */ });
    }
  }

  /** Re-render `events` from the current config (e.g. after a mid-play melody
   *  change) and re-aim `nextIdx` at the live playhead so already-passed notes
   *  aren't replayed and the AudioContext clock/origin stay continuous. */
  function rebuildEventsInPlace(): void {
    if (!ctx || !playing) return;
    build();
    const now = ctx.currentTime - origin;
    nextIdx = events.length;
    for (let i = 0; i < events.length; i++) {
      if (events[i].time >= now - TICK_TOLERANCE_SEC) { nextIdx = i; break; }
    }
  }

  function dispose(): void {
    transportEpoch++; // a mid-load play() must not resurrect a disposed player
    if (disposed) return;
    disposed = true;
    stop();
    unsubSettings?.();
    unsubSettings = null;
    drumLoop?.dispose();
    drumLoop = null;
    drumLoopUrl = null;
    const closeCtx = ctx;
    const pendingLoads = [loading, melodyLoading, drumLoopLoading].filter(
      (p): p is Promise<void> => !!p,
    );
    ctx = null;
    piano = null;
    bass = null;
    drums = null;
    melody = null;
    melodyDestination = null;
    melodyInstId = null;
    pianoReverbSend = null;
    loading = null;
    melodyLoading = null;
    drumLoopLoading = null;
    if (closeCtx) {
      const close = () => {
        if (closeCtx.state !== "closed") closeCtx.close().catch(() => {});
      };
      if (pendingLoads.length > 0) {
        Promise.allSettled(pendingLoads).finally(close);
      } else {
        close();
      }
    }
  }

  // Subscribe to the global mixer store so every player instance picks up
  // changes from any UI without per-page glue code. The diff is funneled
  // through setConfig so kit-change-forces-stop semantics still apply.
  let unsubSettings: (() => void) | null = subscribePlayerSettings((next) => {
    inSettingsBroadcast = true;
    try {
      setConfig(mixSettingsIntoConfig(next, callerOverrides));
    } finally {
      inSettingsBroadcast = false;
    }
  });

  return {
    get playing() { return playing; },
    play,
    preload,
    pause,
    stop,
    seekToBar,
    setConfig,
    setChart,
    dispose,
    ctxNow() { return ctx?.currentTime ?? 0; },
    getCtx() { return ctx; },
    on(ev, cb) {
      callbacks[ev] = cb as never;
    },
  };
}
