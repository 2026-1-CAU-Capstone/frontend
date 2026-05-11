/* ─────────────────────────────────────────────────────────────────────────
 * Drum kit presets — wire up the in-app drum source switcher.
 *
 *  - "synth":   per-hit sequenced kit (sampledDrumKit.ts) — always available
 *  - "brushes": continuous loop of Vincent Sermonne's "brush-loop.wav"
 *               (Freesound 107846, CC-BY 4.0 — attribution required)
 *  - "sticks":  continuous loop of jimrsbjorklund's "Jazz-Drum-Beat-120-BPM"
 *               (Freesound 353081, CC0 — no attribution)
 *
 * The loop files are NOT bundled — drop them at the URLs below before
 * selecting the matching kit. See public/samples/drums/jazz/loops/README.md
 * for download instructions.
 * ──────────────────────────────────────────────────────────────────────── */

import type { BackingConfig } from "./types";

export type DrumKitId = "synth" | "brushes" | "sticks";

export interface DrumKitPreset {
  id: DrumKitId;
  label: string;
  /**
   * If set, picking this kit must show an attribution line in the UI.
   * Required for CC-BY content.
   */
  attribution?: string;
  /** Resolves to a partial BackingConfig that the player can merge. */
  toConfig(): Partial<BackingConfig>;
}

export const DRUM_KIT_PRESETS: Record<DrumKitId, DrumKitPreset> = {
  synth: {
    id: "synth",
    label: "Synth Kit",
    toConfig: () => ({ drumMode: "hit", drumLoop: undefined }),
  },
  brushes: {
    id: "brushes",
    label: "Brushes (live)",
    attribution: "Drums: Vincent Sermonne — Freesound #107846 (CC-BY 4.0)",
    toConfig: () => ({
      drumMode: "loop",
      drumLoop: {
        url: "/samples/drums/jazz/loops/brushes-145bpm.mp3",
        recordedBpm: 145,
        gain: 1.0,
        // No maxRateDeviation — loop scales freely with playback BPM
      },
    }),
  },
  sticks: {
    id: "sticks",
    label: "Sticks (live)",
    toConfig: () => ({
      drumMode: "loop",
      drumLoop: {
        url: "/samples/drums/jazz/loops/sticks-120bpm.mp3",
        recordedBpm: 120,
        gain: 1.0,
      },
    }),
  },
};

const LS_KEY = "jazzify.drumKit";

export function loadDrumKitPref(): DrumKitId {
  try {
    const v = localStorage.getItem(LS_KEY) as DrumKitId | null;
    if (v && v in DRUM_KIT_PRESETS) return v;
  } catch { /* ignore */ }
  return "synth";
}

export function saveDrumKitPref(id: DrumKitId): void {
  try { localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
}
