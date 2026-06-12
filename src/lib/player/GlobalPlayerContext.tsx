/* ─────────────────────────────────────────────────────────────────────────
 * GlobalPlayerContext — React glue for the unified player.
 *
 * Provides:
 *  • `<GlobalPlayerProvider>`  — mount once at the app root (see App.tsx).
 *  • `useGlobalPlayer()`       — hook that returns the player handle plus
 *                                reactive state derived from its event
 *                                bus (playing, currentBar, currentNote,
 *                                currentChord, currentInput).
 *
 * Design notes for next agents:
 *  • The player itself is a process-wide singleton (see
 *    `getGlobalPlayerSingleton()`). The provider just wires React state
 *    to its event bus — that way, re-mounting `<GlobalPlayerProvider>`
 *    (e.g., during HMR) doesn't tear down the AudioContext or lose
 *    queued subscriptions.
 *  • Pages should consume `player.playing` for transport state and
 *    treat `currentBar` / `currentNote` / `currentChord` as derived
 *    reactive convenience. If a page needs higher-frequency callbacks
 *    (RAF-level), it should call `player.on('bar', cb)` directly and
 *    skip the React state.
 * ──────────────────────────────────────────────────────────────────── */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

// NOTE: We deliberately import only the LAZY proxy here, not
// `./GlobalPlayer` directly. `./GlobalPlayer` transitively pulls in
// `smplr` via the soundfont loaders; importing it at the React provider
// (which mounts at app boot) forces smplr into the eager startup chunk.
// The lazy proxy delays that dynamic `import('./GlobalPlayer')` until
// the first method call that actually needs audio (preload/play/...).
import {
  getLazyGlobalPlayerSingleton,
  disposeLazyGlobalPlayerSingleton,
} from "./GlobalPlayerLazy";
import type {
  ChordSymbol,
  GlobalPlayer,
  PlayerInput,
} from "./types";
import type { NoteSheetData } from "../../data/sampleMelody";

/* Minimal 1-note sheet used only to warm the audio engine at app entry — see
 * the warm-up effect below. preload() never schedules it, it just triggers
 * AudioContext creation + instrument-bank fetch/decode. */
const WARMUP_SHEET: NoteSheetData = {
  title: "",
  composer: "",
  key: "C",
  timeSignature: "4/4",
  tempo: 120,
  measures: [{ notes: [{ keys: ["c/4"], duration: "w" }] }],
};

interface GlobalPlayerContextValue {
  player: GlobalPlayer;
  playing: boolean;
  currentBar: number;
  currentNote: { mi: number; ni: number } | null;
  currentChord: ChordSymbol | null;
  currentInput: PlayerInput | null;
}

const GlobalPlayerContext = createContext<GlobalPlayerContextValue | null>(
  null,
);

interface ProviderProps {
  children: ReactNode;
  /**
   * Test escape hatch. Defaults to the process-wide singleton. Pass an
   * explicit player to inject a mocked engine in tests.
   */
  player?: GlobalPlayer;
  /**
   * When true, the provider disposes the singleton on unmount. Defaults
   * to false because the singleton is meant to live for the app's
   * lifetime — flipping this on is only useful for jsdom-style tests
   * that want a clean slate.
   */
  disposeOnUnmount?: boolean;
}

export function GlobalPlayerProvider({
  children,
  player: injected,
  disposeOnUnmount = false,
}: ProviderProps) {
  const player = useMemo(
    () => injected ?? getLazyGlobalPlayerSingleton(),
    [injected],
  );

  const [playing, setPlaying] = useState<boolean>(player.playing);
  const [currentBar, setCurrentBar] = useState<number>(-1);
  const [currentNote, setCurrentNote] = useState<{
    mi: number;
    ni: number;
  } | null>(null);
  const [currentChord, setCurrentChord] = useState<ChordSymbol | null>(null);
  const [currentInput, setCurrentInput] = useState<PlayerInput | null>(
    player.currentInput,
  );

  // Wire engine events → React state. We re-poll `player.playing` on
  // every bar/done event because neither inner engine exposes a
  // dedicated "playing changed" callback — the heuristic is good enough
  // for transport-button UI and avoids forcing the engines to grow a
  // new event.
  useEffect(() => {
    const unsubs = [
      player.on("bar", (b) => {
        setCurrentBar(b);
        setPlaying(player.playing);
        // currentInput reference may have changed if play() was called
        // with a new input — keep it in sync.
        setCurrentInput(player.currentInput);
      }),
      player.on("chord", (c) => {
        setCurrentChord(c);
      }),
      player.on("note", (mi, ni) => {
        setCurrentNote({ mi, ni });
      }),
      player.on("done", () => {
        setPlaying(false);
        setCurrentBar(-1);
        setCurrentNote(null);
        setCurrentChord(null);
      }),
      player.on("error", (err) => {
        // Surface engine errors so the console at least sees them in
        // dev. Pages that want to render an error banner should
        // subscribe to `player.on('error', …)` directly.
        console.error("[GlobalPlayer] error:", err);
      }),
    ];
    return () => {
      for (const u of unsubs) u();
      if (disposeOnUnmount) disposeLazyGlobalPlayerSingleton();
    };
  }, [player, disposeOnUnmount]);

  // ── App-entry audio warm-up (every page) ──────────────────────────────
  // The first play on ANY music surface (Note Analysis, Chord Analysis, Lick
  // DB, …) otherwise pays a cold cost: fetch + decode the instrument sample
  // banks + create the AudioContext. We pre-pay it once, here at the app root,
  // so by the time the user presses play the banks are already decoded and the
  // count-in resolves straight into the downbeat.
  //
  // Runs through the LAZY proxy's preload() with a throwaway 1-note sheet — it
  // never schedules audio, just triggers the load. Deferred via
  // requestIdleCallback (fallback setTimeout) so it never competes with first
  // paint or route loading, and skipped for an injected (test) player.
  useEffect(() => {
    if (injected) return;
    let cancelled = false;
    const warm = () => {
      if (cancelled) return;
      player.preload({ kind: "sheet", data: WARMUP_SHEET }).catch(() => {
        /* best-effort — the real play path retries the load */
      });
    };
    const ric = (window as unknown as {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    }).requestIdleCallback;
    let id: number;
    if (typeof ric === "function") {
      id = ric(warm, { timeout: 3000 });
    } else {
      id = window.setTimeout(warm, 1500);
    }
    return () => {
      cancelled = true;
      const cic = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
      if (typeof ric === "function" && typeof cic === "function") cic(id);
      else clearTimeout(id);
    };
  }, [player, injected]);

  const value = useMemo<GlobalPlayerContextValue>(
    () => ({
      player,
      playing,
      currentBar,
      currentNote,
      currentChord,
      currentInput,
    }),
    [player, playing, currentBar, currentNote, currentChord, currentInput],
  );

  return (
    <GlobalPlayerContext.Provider value={value}>
      {children}
    </GlobalPlayerContext.Provider>
  );
}

/**
 * Read the unified player from React context.
 *
 * Throws if called outside `<GlobalPlayerProvider>` — surfacing the
 * mistake at the call site is more useful than silently returning a
 * fresh singleton, which would create two parallel engine pools.
 */
export function useGlobalPlayer(): GlobalPlayerContextValue {
  const ctx = useContext(GlobalPlayerContext);
  if (!ctx) {
    throw new Error(
      "useGlobalPlayer() called outside <GlobalPlayerProvider>. " +
        "Mount the provider at the app root (see src/App.tsx).",
    );
  }
  return ctx;
}

/**
 * Read the unified player from React context without throwing if the
 * provider is missing. Returns `null` outside the provider — use this
 * for components that may render in test fixtures or storybook stories
 * that haven't been migrated to mount the provider yet.
 */
export function useOptionalGlobalPlayer(): GlobalPlayerContextValue | null {
  return useContext(GlobalPlayerContext);
}
