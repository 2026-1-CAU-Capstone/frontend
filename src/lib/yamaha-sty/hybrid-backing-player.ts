/**
 * Hybrid backing player: rule-engine bass + drums (proven, tight) under
 * a .sty engine layer for piano / guitar / strings / horns (richer
 * voicings, real samples).
 *
 * Why: pure .sty often loses or muddies the rhythm section — psBase has
 * no drum track, and its bass parts are written assuming a Yamaha
 * keyboard's interpolation. Hybrid lets the legacy createBackingPlayer
 * own bass + drums (where Jazzify's existing rule engine is already
 * well-tuned) and uses .sty exclusively for the chordal / melodic
 * layer where the YamJJazz port adds the most value.
 *
 * Both inner players are constructed with the same Chart and share a
 * play / pause / stop / dispose lifecycle. The `.sty` player owns the
 * onBar callback (it ticks per bar through the chart).
 */

import type {
  BackingConfig, BackingPlayer, BackingPlayerCallbacks, Chart,
} from '../backing/types';
import { createBackingPlayer } from '../backing';
import { createStyBackingPlayer, type StyBackingOptions } from './sty-backing-player';

export function createHybridBackingPlayer(
  chart: Chart,
  initialConfig: BackingConfig = {},
  options: StyBackingOptions = {},
): BackingPlayer {
  const callbacks: BackingPlayerCallbacks = {};

  // Rule engine: only bass + drums. Disable piano so it doesn't fight
  // the .sty engine's comping.
  const ruleEngine = createBackingPlayer(chart, {
    ...initialConfig,
    enabled: { piano: false, bass: true, drums: true, ...(initialConfig.enabled ?? {}) },
  });

  // .sty engine: piano / guitar / strings / etc. — skip BASS + RHYTHM.
  const styEngine = createStyBackingPlayer(chart, initialConfig, {
    ...options,
    skipBassAndDrums: true,
  });

  // .sty owns onBar callbacks (it ticks through the chart's structure).
  styEngine.on('onBar', (bar) => callbacks.onBar?.(bar));
  styEngine.on('onDone', () => callbacks.onDone?.());
  // Rule engine drives drums in the hybrid mix, so forward its drum-kit
  // load-failure signal up to whoever owns this player.
  ruleEngine.on('onDrumKitError', (msg) => callbacks.onDrumKitError?.(msg));

  return {
    get playing() { return styEngine.playing || ruleEngine.playing; },
    async preload() {
      await Promise.all([ruleEngine.preload(), styEngine.preload()]);
    },
    async play(opts) {
      // Both players start from the same absolute AudioContext time, so
      // their schedulers line up. They use separate AudioContexts under
      // the hood, but smplr / Web Audio both run on the same wall clock
      // so the offset is < 1ms in practice.
      await Promise.all([
        ruleEngine.play(opts),
        styEngine.play(opts),
      ]);
    },
    pause() {
      ruleEngine.pause();
      styEngine.pause();
    },
    stop() {
      ruleEngine.stop();
      styEngine.stop();
    },
    setConfig(next) {
      ruleEngine.setConfig(next);
      styEngine.setConfig(next);
    },
    dispose() {
      ruleEngine.dispose();
      styEngine.dispose();
    },
    ctxNow() { return styEngine.ctxNow(); },
    on(ev, cb) { callbacks[ev] = cb as never; },
  };
}
