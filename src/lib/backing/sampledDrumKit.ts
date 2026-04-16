import type { DrumPiece } from "./types";
import type { TriggerableInstrument } from "./soundfont";

/* ─────────────────────────────────────────────────────────────────────────
 * Gretsch jazz drum kit — sample-based.
 *
 * Samples come from the gretsch/ folder in tidalcycles/Dirt-Samples, which
 * is a real acoustic jazz drum kit recording (Gretsch kit, brushes for
 * toms, long cymbal decays). Each piece has multiple velocity articulations
 * so the kit reacts to dynamics the way a real drummer does.
 *
 * Bundled locally under /public/samples/drums/jazz/. Files:
 *   kick, snare, snare-ghost, snare-hard,
 *   hihat-closed, hihat-closed-hard, hihat-foot, hihat-open,
 *   ride, ride-bell, crash, tom-low, tom-high
 *
 * Phase 1.5 upgrade over the previous Dirt jazz/cr kit:
 *   - Dedicated foothat sample (pedal chick)
 *   - Snare ghost vs normal vs hard accent articulations
 *   - Long-decay ride cymbal + dedicated ride bell
 * ──────────────────────────────────────────────────────────────────────── */

type SampleSlot =
  | "kick"
  | "snare"
  | "snare-ghost"
  | "snare-hard"
  | "hihat-closed"
  | "hihat-closed-hard"
  | "hihat-foot"
  | "hihat-open"
  | "ride"
  | "ride-bell"
  | "crash"
  | "tom-low"
  | "tom-high";

const SAMPLE_URLS: Record<SampleSlot, string> = {
  kick:               "/samples/drums/jazz/kick.wav",
  snare:              "/samples/drums/jazz/snare.wav",
  "snare-ghost":      "/samples/drums/jazz/snare-ghost.wav",
  "snare-hard":       "/samples/drums/jazz/snare-hard.wav",
  "hihat-closed":     "/samples/drums/jazz/hihat-closed.wav",
  "hihat-closed-hard":"/samples/drums/jazz/hihat-closed-hard.wav",
  "hihat-foot":       "/samples/drums/jazz/hihat-foot.wav",
  "hihat-open":       "/samples/drums/jazz/hihat-open.wav",
  ride:               "/samples/drums/jazz/ride.wav",
  "ride-bell":        "/samples/drums/jazz/ride-bell.wav",
  crash:              "/samples/drums/jazz/crash.wav",
  "tom-low":          "/samples/drums/jazz/tom-low.wav",
  "tom-high":         "/samples/drums/jazz/tom-high.wav",
};

/**
 * Musical mix balance per piece. All samples are now peak-normalized to the
 * same level (~-1.4 dBFS), so these values express the MUSICAL role of each
 * piece rather than compensating for different recording levels.
 */
const VELOCITY_SCALE: Partial<Record<DrumPiece, number>> = {
  kick: 0.75,            // feathered kick — felt not heard, stay subtle
  snare: 1.0,            // clear comping presence
  "hihat-foot": 0.85,    // audible 2&4 chick but not as loud as snare
  "hihat-closed": 0.8,
  "hihat-open": 0.7,
  ride: 0.9,             // dominant pattern voice
  "ride-bell": 1.0,      // accent
  "tom-low": 0.7,
  "tom-high": 0.7,
  crash: 0.65,
  splash: 0.55,
  rim: 0.6,
};

/**
 * Resolve a drum piece + velocity to a specific sample slot.
 *
 * For snare: velocity buckets map to ghost / normal / hard articulations,
 * so ghost-note comping sounds different from a real accent.
 * For ride: just the main ride cymbal — its tone varies naturally with gain.
 */
function resolveSlot(piece: DrumPiece, velocity: number): SampleSlot | null {
  switch (piece) {
    case "snare":
      if (velocity < 0.3) return "snare-ghost";
      if (velocity > 0.8) return "snare-hard";
      return "snare";
    case "rim":
      return "snare-ghost";
    case "hihat-closed":
      return velocity > 0.7 ? "hihat-closed-hard" : "hihat-closed";
    case "hihat-open":
      return "hihat-open";
    case "hihat-foot":
      return "hihat-foot";
    case "ride":
      return "ride";
    case "ride-bell":
      return "ride-bell";
    case "kick":
      return "kick";
    case "crash":
      return "crash";
    case "splash":
      return "crash";
    case "tom-low":
      return "tom-low";
    case "tom-mid":
      return "tom-low";
    case "tom-high":
      return "tom-high";
    default:
      return null;
  }
}

export async function loadSampledDrumKit(
  ctx: AudioContext,
  destination?: AudioNode,
): Promise<TriggerableInstrument> {
  const bus = ctx.createGain();
  bus.gain.value = 1.0;
  bus.connect(destination ?? ctx.destination);

  const buffers = new Map<SampleSlot, AudioBuffer>();
  const entries = Object.entries(SAMPLE_URLS) as Array<[SampleSlot, string]>;

  await Promise.all(
    entries.map(async ([slot, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = await res.arrayBuffer();
        const buf = await ctx.decodeAudioData(arr);
        buffers.set(slot, buf);
      } catch (err) {
        console.warn(`[backing] drum sample load failed for ${slot}:`, err);
      }
    }),
  );

  return {
    trigger({ note, time, velocity }) {
      if (typeof note !== "string") return;
      const piece = note as DrumPiece;
      const slot = resolveSlot(piece, velocity);
      if (!slot) return;
      const buf = buffers.get(slot);
      if (!buf) return;

      const src = ctx.createBufferSource();
      src.buffer = buf;

      // Tiny random pitch variation to keep repeated hits from sounding
      // identical — real drums never hit the exact same spot twice
      src.playbackRate.value = 0.985 + Math.random() * 0.03;

      const gain = ctx.createGain();
      const scaled = velocity * (VELOCITY_SCALE[piece] ?? 1.0);
      gain.gain.value = Math.max(0, Math.min(1.6, scaled));

      src.connect(gain).connect(bus);
      src.start(time);
    },
    stopAll() {
      // AudioBufferSourceNodes clean themselves up automatically.
    },
  };
}
