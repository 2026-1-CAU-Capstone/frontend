/**
 * Editor 전용 재생 훅 — 입력한 솔로/릭 멜로디를 풀 백킹 밴드(베이스/드럼/피아노
 * 컴핑)와 함께 GlobalPlayer(kind:'sheet')로 재생한다. 기존 피아노 단독
 * useNoteSheetPlayback를 대체한다.
 *
 * NoteSheet.togglePlay의 검증된 흐름(preload → in-gesture unlock → 카운트인 →
 * play)을 그대로 따르되, 에디터는 픽업(anacrusis) 마디를 다루지 않으므로 그
 * 분기는 생략했다. 음표 하이라이트는 GlobalPlayer의 'note' 이벤트를 받아
 * 페이지가 채워둔 noteElMapRef(`${mi}-${ni}` → SVGElement)를 직접 칠한다.
 *
 * 피아노 컴핑을 1·3박으로 고정하는 `pianoComp1And3`는 여기(에디터)에서만 켜고,
 * 언마운트 시 끈다 — 같은 sheet 엔진을 공유하는 NotePage로 새지 않게.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useGlobalPlayer } from '../lib/player';
import { useCountInIntro } from './useCountInIntro';
import type { NoteSheetData } from '../data/sampleMelody';

interface UseEditorBackingPlaybackArgs {
  /** 재생 시점에 현재 마디로부터 NoteSheetData를 만든다. */
  buildSheet: () => NoteSheetData;
  bpm: number;
  /** 반복 횟수(상단 RepeatControl). */
  repeatCount: number;
  /** "mi-ni" → SVG 음표 엘리먼트. 렌더러가 채우고 하이라이트가 읽는다. */
  noteElMapRef: RefObject<Map<string, SVGElement>>;
}

export interface EditorBackingPlayback {
  playing: boolean;
  handlePlayPause: () => Promise<void>;
  handleStop: () => void;
  /** 카운트인 "1·2·3·4" 오버레이 — 페이지 JSX에 그대로 렌더. */
  countInOverlay: ReactNode;
}

export function useEditorBackingPlayback(
  { buildSheet, bpm, repeatCount, noteElMapRef }: UseEditorBackingPlaybackArgs,
): EditorBackingPlayback {
  const { player } = useGlobalPlayer();
  const countIn = useCountInIntro();
  const [playing, setPlaying] = useState(false);
  const prevNoteKeyRef = useRef<string | null>(null);

  /* ── 음표 하이라이트 (NoteSheet와 동일한 SVG fill 조작) ─────────────── */
  const colorNote = useCallback((key: string, color: string) => {
    const el = noteElMapRef.current?.get(key);
    if (!el) return;
    const apply = (e: Element) => { (e as SVGElement).style.fill = color; };
    apply(el);
    el.querySelectorAll('*').forEach(apply);
    let parent = el.parentElement;
    while (parent && parent.tagName !== 'svg') {
      const cls = parent.getAttribute('class') || '';
      if (cls.includes('vf-stavenote') || cls.includes('vf-stemmablenote')) {
        apply(parent); parent.querySelectorAll('*').forEach(apply); break;
      }
      parent = parent.parentElement;
    }
  }, [noteElMapRef]);

  const highlightNote = useCallback((mi: number, ni: number) => {
    const prev = prevNoteKeyRef.current;
    if (prev) colorNote(prev, '');
    if (mi < 0) { prevNoteKeyRef.current = null; return; }
    const key = `${mi}-${ni}`;
    colorNote(key, '#1565c0');
    prevNoteKeyRef.current = key;
  }, [colorNote]);

  // GlobalPlayer 이벤트 구독 — 음표 하이라이트 + 자연 종료.
  useEffect(() => {
    const unsubNote = player.on('note', (mi, ni) => highlightNote(mi, ni));
    const unsubDone = player.on('done', () => { highlightNote(-1, 0); setPlaying(false); });
    return () => { unsubNote(); unsubDone(); };
  }, [player, highlightNote]);

  // 언마운트: 재생 정지 + 1·3박 컴핑 플래그 해제(다른 sheet 페이지로 누수 방지).
  useEffect(() => () => {
    player.stop();
    player.setConfig({ pianoComp1And3: false });
  }, [player]);

  const handleStop = useCallback(() => {
    player.stop();
    countIn.cancel();
    highlightNote(-1, 0);
    setPlaying(false);
  }, [player, countIn, highlightNote]);

  const handlePlayPause = useCallback(async () => {
    const p = player;
    // 재생 중(또는 카운트인 중) 누르면 정지.
    if (playing || countIn.active) {
      p.pause();
      countIn.cancel();
      highlightNote(-1, 0);
      setPlaying(false);
      return;
    }
    const data = buildSheet();
    if (!data.measures.length) return;

    setPlaying(true);
    // preload 실패 .catch: 카운트인 대기 중의 rejection이 AudioLifecycleGuard의
    // stopAllAudio를 트리거하지 않게 한다(play()가 어차피 재로드).
    const preload = p.preload({ kind: 'sheet', data }).catch(() => {});
    // 클릭 제스처 안에서 동기로 ctx resume(콜드 첫 재생 무음 방지).
    p.unlock({ kind: 'sheet', data });

    const cin = await countIn.run({ bpm, prepare: preload });
    if (!cin.ok) { setPlaying(false); return; }
    // 에디터 전용: 1·3박 피아노 컴핑.
    p.setConfig({ bpm, repeatCount, pianoComp1And3: true });
    try {
      await p.play({ kind: 'sheet', data }, { downbeatInSec: cin.downbeatInSec });
    } catch {
      setPlaying(false); // play()는 'error' emit 후 rethrow — 버튼 고착 방지.
    }
  }, [player, playing, countIn, buildSheet, bpm, repeatCount, highlightNote]);

  return { playing, handlePlayPause, handleStop, countInOverlay: countIn.overlay };
}
