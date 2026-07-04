/* §8 R8 — EditorPage/SoloGeneratorPage가 ~330줄씩 복붙해 쓰던 재생 루프를
 * 하나로 합친 훅. 두 사본 중 EditorPage 쪽이 버그 수정본이었고(리스너 누수 정리,
 * miOffset Math.max 가드, 빈-패스 break, checkPause 정리) SoloGen은 옛 버전이라
 * — 이 통합으로 SoloGen의 잠복 버그 4종이 함께 사라진다. 동작은 EditorPage 기준.
 *
 * 피아노 단독 재생(멜로디 + 2·4박 콤핑)을 setTimeout 타이밍으로 돌리는 기존
 * 방식을 그대로 보존한다(풀밴드/오디오클럭 위임은 별건 — 사운드가 바뀜).
 * 입력: allMeasures(전개 전 마디), bpm, 하이라이트용 noteElMapRef(페이지 소유). */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { MeasureInfo, NoteInfo } from '../data/sampleMelody';
import { getGlobalKeyboard } from '../lib/player/GlobalKeyboard';
import { useCountInIntro } from './useCountInIntro';
import { swungBeats } from '../lib/note/swing';
import { DUR_BEATS, vexToMidi, getBeats, chordToMidi } from '../lib/note/melodyTiming';
import { expandMeasures } from '../lib/note/expandMeasures';

export interface UseNoteSheetPlaybackArgs {
  /** 반복/볼타 전개 전의 표시 마디들. */
  allMeasures: MeasureInfo[];
  bpm: number;
  /** "mi-ni" → SVG 음표 엘리먼트. 렌더러가 채우고 재생 하이라이트가 읽는다. */
  noteElMapRef: RefObject<Map<string, SVGElement>>;
}

export interface NoteSheetPlayback {
  playing: boolean;
  paused: boolean;
  handlePlay: () => Promise<void>;
  handlePause: () => void;
  /** 카운트인 "1·2·3·4" 오버레이 — 페이지 JSX에 그대로 렌더. */
  countInOverlay: ReactNode;
}

export function useNoteSheetPlayback(
  { allMeasures, bpm, noteElMapRef }: UseNoteSheetPlaybackArgs,
): NoteSheetPlayback {
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const playAbortRef = useRef<AbortController | null>(null);
  const pauseResolveRef = useRef<(() => void) | null>(null);
  const pausedRef = useRef(false);
  /* playback */
  const handlePause = useCallback(() => {
    if (!playing) return;
    if (pausedRef.current) {
      // Resume
      pausedRef.current = false;
      setPaused(false);
      pauseResolveRef.current?.();
      pauseResolveRef.current = null;
    } else {
      // Pause
      pausedRef.current = true;
      setPaused(true);
    }
  }, [playing]);

  const countIn = useCountInIntro();

  /* Stop playback if the editor unmounts mid-play (save→navigate, sidebar
   * nav, etc.). Aborting trips the play loop's catch → kb.stopAll(),
   * so sound stops and we don't keep scheduling notes after leaving. */
  useEffect(() => () => { playAbortRef.current?.abort(); }, []);

  const handlePlay = useCallback(async () => {
    if (playing || countIn.active) {
      playAbortRef.current?.abort();
      pauseResolveRef.current?.();
      pauseResolveRef.current = null;
      pausedRef.current = false;
      countIn.cancel();
      setPaused(false);
      setPlaying(false);
      return;
    }
    if (allMeasures.length === 0) return;

    setPlaying(true);
    // 카운트인과 병렬로 piano soundfont 로드 — 첫 재생 지연 제거.
    const kb = getGlobalKeyboard();
    const kbReady = kb.ensureReady();
    const cin = await countIn.run({ bpm });
    if (!cin.ok) { setPlaying(false); return; }
    await kbReady;
    const abort = new AbortController();
    playAbortRef.current = abort;
    pausedRef.current = false;
    setPaused(false);

    // Align the first note with the count-in's downbeat. cin.downbeatInSec
    // measures setTimeout slop between cin resolve and here in any clock.
    if (cin.downbeatInSec > 0) {
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, cin.downbeatInSec * 1000);
          abort.signal.addEventListener(
            'abort',
            () => { clearTimeout(timer); reject('stop'); },
            { once: true },
          );
        });
      } catch {
        setPlaying(false);
        return;
      }
    }

    const beatDur = 60 / bpm;
    // Swung-time projection: distance between two straight-beat positions in
    // wall-clock seconds, after the swing-feel non-linear remap. Off-beat 8ths
    // sit ~24% later inside the beat. Quarter notes and downbeats land exactly
    // on integer-beat boundaries so chord comping fires in straight time even
    // while the melody breathes.
    const beatRange = (start: number, b: number) =>
      (swungBeats(start + b) - swungBeats(start)) * beatDur;

    // 도돌이/볼타/내비게이션 전개 — lib/note/expandMeasures로 추출된 공용 로직.

    // Highlight helpers — direct DOM manipulation, no React re-render
    const elMap = noteElMapRef.current;
    let prevKey: string | null = null;
    const BLUE = '#1565c0';
    const colorNote = (key: string, color: string) => {
      const svg = elMap.get(key);
      if (!svg) return;
      const apply = (el: Element) => { (el as SVGElement).style.fill = color; };
      apply(svg);
      svg.querySelectorAll('*').forEach(apply);
    };
    const highlight = (mi: number, ni: number) => {
      if (prevKey) colorNote(prevKey, '');
      const key = `${mi}-${ni}`;
      colorNote(key, BLUE);
      prevKey = key;
    };
    const clearHighlight = () => { if (prevKey) colorNote(prevKey, ''); prevKey = null; };
    /* abort-aware sleep. { once:true }는 abort가 '실제로 발생'해야 리스너를
     * 떼므로, 정상 resolve된 타이머의 리스너(+clearTimeout 클로저)는 재생이
     * 끝날 때까지 signal에 계속 쌓였다 — 무한 반복 재생에서 음표당 1개씩
     * 수천 개 누적. resolve 경로에서 명시적으로 제거한다. */
    const waitMs = (ms: number) => new Promise<void>((resolve, reject) => {
      const onAbort = () => { clearTimeout(timer); reject('stop'); };
      const timer = setTimeout(() => {
        abort.signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      abort.signal.addEventListener('abort', onAbort, { once: true });
    });
    const checkPause = async () => {
      if (abort.signal.aborted) throw 'stop';
      if (pausedRef.current) {
        await new Promise<void>((resolve, reject) => {
          const onAbort = () => { reject('stop'); };
          pauseResolveRef.current = () => {
            abort.signal.removeEventListener('abort', onAbort);
            resolve();
          };
          abort.signal.addEventListener('abort', onAbort, { once: true });
        });
      }
    };

    try {
      let loopCount = 0;
      while (!abort.signal.aborted) {
        // On first loop: use all measures. On subsequent loops: skip bracket measures
        // and start from the first measure with a chord.
        let srcMeasures: MeasureInfo[];
        if (loopCount === 0) {
          srcMeasures = allMeasures;
        } else {
          // Find first measure index with a chord
          const firstChordIdx = allMeasures.findIndex((m) => !!m.chord);
          const startIdx = firstChordIdx >= 0 ? firstChordIdx : 0;
          srcMeasures = allMeasures.slice(startIdx);
        }

        const expandedMeasures = expandMeasures(srcMeasures);
        // Remap origMi: when loopCount > 0, srcMeasures is a slice, so origMi is relative.
        // We need to offset it back to absolute index for highlight.
        // Math.max guards findIndex's -1 (no chord anywhere): `-1 || 0` evaluated
        // to -1 (truthy!) and shifted every highlight one bar off from pass 2 on.
        const miOffset = loopCount === 0 ? 0 : Math.max(0, allMeasures.findIndex((m) => !!m.chord));

        // Build flat note list with beat-position tracking for inline piano comping
        type FlatNote = { note: NoteInfo; mi: number; ni: number; emIdx: number; beatPos: number };
        const flat: FlatNote[] = [];
        for (let ei = 0; ei < expandedMeasures.length; ei++) {
          const em = expandedMeasures[ei];
          let bp = 0;
          for (let ni = 0; ni < em.m.notes.length; ni++) {
            flat.push({ note: em.m.notes[ni], mi: em.origMi + miOffset, ni, emIdx: ei, beatPos: bp });
            bp += getBeats(em.m.notes[ni].duration, em.m.notes[ni].dotted, em.m.notes[ni].tuplet);
          }
        }

        // No notes in this pass (e.g. melody lives only in the pre-chord bars
        // that later passes slice off) → the inner note loop would never await,
        // turning `while (!aborted)` into a SYNCHRONOUS infinite loop that
        // freezes the tab (Stop unclickable). Bail out instead of spinning.
        if (flat.length === 0) break;

        // Pre-compute piano chord voicings per expanded measure
        const compChords: { midi1: number[]; midi2: number[] }[] = expandedMeasures.map((em) => {
          const mChord = em.m.chord;
          if (!mChord) return { midi1: [], midi2: [] };
          const parts = mChord.split(/\s{2,}/);
          const c1 = parts[0]?.trim();
          const c2 = parts[1]?.trim() || c1;
          return { midi1: chordToMidi(c1 || ''), midi2: chordToMidi(c2 || '') };
        });
        const compDur = beatDur * 0.6;
        const compedBeats = new Set<string>();
        const fireComp = (emIdx: number, beatStart: number, beatEnd: number) => {
          if ((beatStart < 1 && beatEnd > 1) || beatStart === 1) {
            const key = `${emIdx}-2`;
            if (!compedBeats.has(key)) {
              compedBeats.add(key);
              const cc = compChords[emIdx];
              if (cc.midi1.length > 0) {
                for (const m of cc.midi1) kb.play(String(m), { duration: compDur, gain: 1.2 });
              }
            }
          }
          if ((beatStart < 3 && beatEnd > 3) || beatStart === 3) {
            const key = `${emIdx}-4`;
            if (!compedBeats.has(key)) {
              compedBeats.add(key);
              const cc = compChords[emIdx];
              if (cc.midi2.length > 0) {
                for (const m of cc.midi2) kb.play(String(m), { duration: compDur, gain: 1.2 });
              }
            }
          }
        };

        // Helper: wait for a duration, fire piano comping at exact beat 2 (pos 1) and beat 4 (pos 3)
        const waitWithComp = async (totalBeats: number, emIdx: number, startBeat: number) => {
          const boundaries: number[] = [];
          for (const b of [1, 3]) {
            if (b > startBeat && b < startBeat + totalBeats) boundaries.push(b);
          }
          if (startBeat === 1 || startBeat === 3) {
            fireComp(emIdx, startBeat, startBeat);
          }

          let elapsed = 0;
          for (const b of boundaries) {
            const waitBeats = (b - startBeat) - elapsed;
            if (waitBeats > 0.001) {
              // Swung wait — off-beat starts get a shorter wall-clock leg to the
              // next downbeat than straight 8ths would.
              const waitSec = beatRange(startBeat + elapsed, waitBeats);
              await waitMs(waitSec * 1000);
              elapsed += waitBeats;
            }
            fireComp(emIdx, b, b);
          }
          const leftBeats = totalBeats - elapsed;
          if (leftBeats > 0.001) {
            const waitSec = beatRange(startBeat + elapsed, leftBeats);
            await waitMs(waitSec * 1000);
          }
        };

        // Play all notes in this loop pass
        let i = 0;
        while (i < flat.length) {
          await checkPause();
          const { note: n, mi, ni, emIdx, beatPos } = flat[i];
          const isRest = n.duration.endsWith('r');
          const baseDur = n.duration.replace(/r$/, '');
          let beats = DUR_BEATS[baseDur] ?? 1;
          if (n.dotted) beats *= 1.5;
          if (n.tuplet && n.tuplet >= 2) {
            const denom = Math.pow(2, Math.floor(Math.log2(n.tuplet - 1)));
            beats *= denom / n.tuplet;
          }

          if (!isRest) highlight(mi, ni);

          if (!isRest && n.tie) {
            const tieSegs: { emIdx: number; beatPos: number; beats: number }[] = [
              { emIdx, beatPos, beats },
            ];
            let look = i + 1;
            while (look < flat.length) {
              const ln = flat[look].note;
              const lb = ln.duration.replace(/r$/, '');
              let lbeats = DUR_BEATS[lb] ?? 1;
              if (ln.dotted) lbeats *= 1.5;
              if (ln.tuplet && ln.tuplet >= 2) {
                const denom = Math.pow(2, Math.floor(Math.log2(ln.tuplet - 1)));
                lbeats *= denom / ln.tuplet;
              }
              tieSegs.push({ emIdx: flat[look].emIdx, beatPos: flat[look].beatPos, beats: lbeats });
              if (!ln.tie) { look++; break; }
              look++;
            }
            const totalBeats = tieSegs.reduce((s, seg) => s + seg.beats, 0);
            const sec = beatRange(beatPos, totalBeats);
            const acc = n.accidentals?.[0] as '#' | 'b' | 'n' | undefined;
            const midi = vexToMidi(n.keys[0], acc);
            kb.play(String(midi), { duration: sec * 0.9, gain: 3 });
            for (const seg of tieSegs) {
              await waitWithComp(seg.beats, seg.emIdx, seg.beatPos);
            }
            i = look;
            continue;
          }

          const sec = beatRange(beatPos, beats);
          if (!isRest) {
            const acc = n.accidentals?.[0] as '#' | 'b' | 'n' | undefined;
            const midi = vexToMidi(n.keys[0], acc);
            kb.play(String(midi), { duration: sec * 0.9, gain: 3 });
          }
          await waitWithComp(beats, emIdx, beatPos);
          i++;
        }

        loopCount++;
      }
    } catch {
      // stopped
    }

    clearHighlight();
    kb.stopAll();
    setPlaying(false);
  }, [playing, allMeasures, bpm]);

  return { playing, paused, handlePlay, handlePause, countInOverlay: countIn.overlay };
}
