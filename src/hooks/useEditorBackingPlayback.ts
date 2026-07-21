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
import { useGlobalPlayer, warmupPlayerOnce } from '../lib/player';
import { useCountInIntro } from './useCountInIntro';
import { expandMeasures } from '../lib/note/expandMeasures';
import type { NoteSheetData } from '../data/sampleMelody';

interface UseEditorBackingPlaybackArgs {
  /** 재생 시점에 현재 마디로부터 NoteSheetData를 만든다. */
  buildSheet: () => NoteSheetData;
  /** 함께 소리 낼 추가 파트(양손 에디터의 왼손 등). 마디는 buildSheet의
   *  measures와 인덱스 1:1 정렬 — 도돌이 전개를 여기서 동일하게 적용한다. */
  buildExtraParts?: () => NoteSheetData[];
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
  { buildSheet, buildExtraParts, bpm, repeatCount, noteElMapRef }: UseEditorBackingPlaybackArgs,
): EditorBackingPlayback {
  const { player } = useGlobalPlayer();
  const countIn = useCountInIntro();
  const [playing, setPlaying] = useState(false);
  const prevNoteKeyRef = useRef<string | null>(null);
  /* 일시정지 상태 추적 — 재개 시 카운트인을 생략하고 멈춘 위치에서 바로 이어
   * 재생한다(엔진이 elapsed를 보존). 정지/자연 종료 시 해제. */
  const pausedRef = useRef(false);
  /* 도돌이/볼타 전개 후 마디 인덱스 → 원본(allMeasures) 인덱스. 'note' 이벤트의
   * mi는 전개된 시트 기준이므로 하이라이트 전에 원본으로 되돌린다. */
  const origMiRef = useRef<number[]>([]);

  /* 마운트 즉시 실제 플레이어를 구체화(dynamic import) + 악기 디코드 시작.
   * 이게 없으면 앱 진입 직후의 빠른 첫 ▶ 클릭이 lazy 프록시의 unlock 무효화
   * 레이스에 걸려 콜드 스타트 무음이 될 수 있다. (LickCard와 동일 패턴) */
  const buildSheetRef = useRef(buildSheet);
  buildSheetRef.current = buildSheet;
  useEffect(() => {
    warmupPlayerOnce(player, { kind: 'sheet', data: buildSheetRef.current() });
  }, [player]);

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

  // GlobalPlayer 이벤트 구독 — 음표 하이라이트 + 자연 종료. mi는 전개된 시트
  // 기준이므로 origMi 매핑으로 원본 마디 인덱스로 환원해 칠한다.
  useEffect(() => {
    const unsubNote = player.on('note', (mi, ni) => highlightNote(origMiRef.current[mi] ?? mi, ni));
    const unsubDone = player.on('done', () => { pausedRef.current = false; highlightNote(-1, 0); setPlaying(false); });
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
    pausedRef.current = false;
    highlightNote(-1, 0);
    setPlaying(false);
  }, [player, countIn, highlightNote]);

  const handlePlayPause = useCallback(async () => {
    const p = player;
    // 재생 중(또는 카운트인 중) 누르면 일시정지.
    if (playing || countIn.active) {
      p.pause();
      countIn.cancel();
      pausedRef.current = playing; // 실제 재생 중이었을 때만 '재개' 대상
      highlightNote(-1, 0);
      setPlaying(false);
      return;
    }
    const src = buildSheet();
    if (!src.measures.length) return;

    // 도돌이표/볼타/내비게이션 전개 — 에디터에 그린 |: :| 가 실제 재생에
    // 반영되게 한다. origMi 매핑은 하이라이트 환원용으로 보관.
    const expanded = expandMeasures(src.measures);
    origMiRef.current = expanded.map((e) => e.origMi);
    const data: NoteSheetData = { ...src, measures: expanded.map((e) => e.m) };
    // 추가 파트(왼손 등)도 같은 도돌이 전개를 인덱스 매핑으로 적용.
    const extras = (buildExtraParts?.() ?? []).map((part) => ({
      ...part,
      measures: expanded.map((e) => part.measures[e.origMi] ?? { notes: [] }),
    }));
    const extraParts = extras.length > 0 ? extras : undefined;

    const resuming = pausedRef.current;
    pausedRef.current = false;
    setPlaying(true);
    // preload 실패 .catch: 카운트인 대기 중의 rejection이 AudioLifecycleGuard의
    // stopAllAudio를 트리거하지 않게 한다(play()가 어차피 재로드).
    const preload = p.preload({ kind: 'sheet', data, extraParts }).catch(() => {});
    // 클릭 제스처 안에서 동기로 ctx resume(콜드 첫 재생 무음 방지).
    p.unlock({ kind: 'sheet', data, extraParts });

    // 재개(pause 후)면 카운트인 생략 — 멈춘 자리에서 바로 이어감. 새 시작이면
    // 카운트인 "1 2 3 4" 후 다운비트에 정렬.
    let downbeatInSec: number | undefined;
    if (!resuming) {
      const cin = await countIn.run({ bpm, prepare: preload });
      if (!cin.ok) { setPlaying(false); return; }
      downbeatInSec = cin.downbeatInSec;
    }
    // 에디터 전용: 1·3박 피아노 컴핑.
    p.setConfig({ bpm, repeatCount, pianoComp1And3: true });
    try {
      await p.play({ kind: 'sheet', data, extraParts }, downbeatInSec !== undefined ? { downbeatInSec } : {});
    } catch {
      setPlaying(false); // play()는 'error' emit 후 rethrow — 버튼 고착 방지.
    }
  }, [player, playing, countIn, buildSheet, buildExtraParts, bpm, repeatCount, highlightNote]);

  return { playing, handlePlayPause, handleStop, countInOverlay: countIn.overlay };
}
