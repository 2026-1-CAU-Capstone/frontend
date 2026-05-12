import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getCountInTime,
  scheduleCountInClick,
  type ScheduledClick,
} from '../lib/note/countInClick';
import {
  flatCells,
  selectPattern,
  PATTERN_SIMPLE,
  type Pattern,
} from '../lib/note/countInPatterns';
import { CountInOverlay } from '../components/common/CountInOverlay';

interface HookOptions {
  /** scoped=true → overlay 를 부모 컨테이너 안에서만 표시 (LickCard 등). */
  scoped?: boolean;
}

interface RunOptions {
  bpm: number;
  /** 명시하면 그 패턴 강제. 미지정 시 bpm 에 따라 자동 선택 (simple/medium/fast). */
  pattern?: Pattern;
}

export interface CountInResult {
  /** False if the user cancelled the count-in before it finished. */
  ok: boolean;
  /** Audio-context time (seconds) when the downbeat AFTER the count-in lands,
   *  measured on the count-in's shared AudioContext clock. Only valid if the
   *  caller's player happens to share that same clock (rare). Prefer
   *  `downbeatInSec` for cross-ctx scheduling. */
  startAt: number;
  /** Seconds from `run()` resolve to the downbeat, in ANY clock. Convert to a
   *  target ctx's audio time via `targetCtx.currentTime + downbeatInSec`. This
   *  avoids the count-in-ctx vs player-ctx clock drift that occurs when the
   *  two AudioContexts were created at different wall-clock moments. */
  downbeatInSec: number;
}

/**
 * Swing-feel count-in intro.
 *
 * 패턴 (countInPatterns.ts):
 *   - bpm < 100:  SIMPLE  (1 2 3 4)
 *   - 100~249:    MEDIUM  (1 2 / 1 2 3 4)
 *   - bpm >= 250: FAST    (1 _ 2 _ / 1 2 / 1 2 3 4)
 *
 * 각 cell 은 음악 한 박씩 차지. 짝 (label='') cell 은 audio silent + 비활성화.
 * 활성 하이라이트는 "마지막 numbered/쿵 cell" 에서 유지 (짝 박을 지나는 동안
 * 이전 cell 이 계속 강조 — 스윙의 sustained feel).
 */
export function useCountInIntro(options: HookOptions = {}) {
  const { scoped = false } = options;
  const [active, setActive] = useState(false);
  const [currentBeat, setCurrentBeat] = useState(0);
  const [pattern, setPattern] = useState<Pattern>(PATTERN_SIMPLE);
  const cancelRef = useRef(false);
  const scheduledRef = useRef<ScheduledClick[]>([]);
  const timeoutsRef = useRef<number[]>([]);
  const resolveWaitRef = useRef<(() => void) | null>(null);

  const clearAll = useCallback(() => {
    for (const t of timeoutsRef.current) clearTimeout(t);
    timeoutsRef.current = [];
    for (const c of scheduledRef.current) c.stop();
    scheduledRef.current = [];
  }, []);

  const cancel = useCallback(() => {
    cancelRef.current = true;
    clearAll();
    setActive(false);
    setCurrentBeat(0);
    if (resolveWaitRef.current) {
      const r = resolveWaitRef.current;
      resolveWaitRef.current = null;
      r();
    }
  }, [clearAll]);

  const run = useCallback(
    async ({ bpm, pattern: patternOverride }: RunOptions): Promise<CountInResult> => {
      if (!Number.isFinite(bpm) || bpm <= 0) {
        return { ok: true, startAt: getCountInTime(), downbeatInSec: 0 };
      }
      const chosenPattern = patternOverride ?? selectPattern(bpm);
      const cells = flatCells(chosenPattern);
      const totalCells = cells.length;

      cancelRef.current = false;
      clearAll();
      setPattern(chosenPattern);
      setActive(true);
      setCurrentBeat(0);

      const bs = 60 / bpm;
      const startAudioTime = getCountInTime() + 0.06;
      // The first downbeat AFTER the count-in. This is the precise audio time
      // when the caller's playback should begin so that "1 2 3 4 |1" lands
      // exactly on beat. Returned to the caller so NotePlayer.play({ startAt })
      // can anchor its origin to it instead of "ctx.currentTime now", which
      // drifts by ~30-80ms due to setTimeout slop and microtask scheduling.
      const downbeatAudioTime = startAudioTime + totalCells * bs;

      for (let i = 0; i < totalCells; i++) {
        const cell = cells[i];
        const when = startAudioTime + i * bs;

        if (cell.audio !== 'silent') {
          scheduledRef.current.push(scheduleCountInClick(when, cell.audio));
        }

        const delayMs = (when - getCountInTime()) * 1000;
        const t = window.setTimeout(
          () => {
            if (cancelRef.current) return;
            // 짝 (silent) cell 일 땐 currentBeat 안 바꾸고 이전 numbered cell 의
            // 하이라이트가 자연스럽게 유지되도록 함.
            if (cell.audio !== 'silent') {
              setCurrentBeat(i + 1);
            }
          },
          Math.max(0, delayMs),
        );
        timeoutsRef.current.push(t);
      }

      // Wait until the downbeat lands (in wall-clock terms), then resolve.
      // Callers anchor their playback to the AUDIO-clock `startAt` we return,
      // so even small setTimeout drift here is corrected by NotePlayer using
      // `startAt` rather than `ctx.currentTime` to position the first event.
      const totalMs = totalCells * bs * 1000;
      await new Promise<void>((resolve) => {
        resolveWaitRef.current = resolve;
        const t = window.setTimeout(() => {
          if (resolveWaitRef.current === resolve) {
            resolveWaitRef.current = null;
            resolve();
          }
        }, totalMs);
        timeoutsRef.current.push(t);
      });

      const cancelled = cancelRef.current;
      setActive(false);
      setCurrentBeat(0);
      scheduledRef.current = [];
      timeoutsRef.current = [];
      // Clock-agnostic delta: how many seconds from "now" until the downbeat.
      // setTimeout slop at this point is typically a few ms past the downbeat,
      // so this clamps to >= 0.
      const downbeatInSec = Math.max(0, downbeatAudioTime - getCountInTime());
      return { ok: !cancelled, startAt: downbeatAudioTime, downbeatInSec };
    },
    [clearAll],
  );

  useEffect(() => () => cancel(), [cancel]);

  const overlay = (
    <CountInOverlay
      active={active}
      pattern={pattern}
      currentBeat={currentBeat}
      scoped={scoped}
      onCancel={cancel}
    />
  );

  return { run, cancel, overlay, active };
}
