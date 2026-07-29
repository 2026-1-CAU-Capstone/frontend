import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { TopToolbar } from '../components/layout/TopToolbar';
import { RightChatPanel } from '../components/layout/RightChatPanel';
import { setActiveChat, getCachedChatList } from '../api/chat';
import { MobileChatFab } from '../components/layout/MobileChatFab';
import { LeadSheet, KeyControl, isMinorKey, shiftKey } from '../components/leadsheet/LeadSheet';
import { KeySuggestPrompt } from '../components/leadsheet/KeySuggestPrompt';
import { SessionPicker, type SessionInstrument } from '../components/chord/SessionPicker';
import { useAnalysisFilters } from '../hooks/useAnalysisFilters';
import { openPerformanceSettings } from '../lib/settingsBus';
import { allOfMe } from '../data/allOfMe';
import { getExampleChart } from '../data/exampleCharts';
import type { LeadSheetData } from '../data/leadSheetTypes';
import type { ChordOverlay } from '../data/types';
import { getSongIndex, getSong, type SongEntry } from '../lib/ireal/irealLoader';
import { buildChordContext } from '../api/chordContext';
import { addChordProjectChords, analyzeChordProject, createChordProject, getChordProject, getChordProjectAnalysis } from '../api/chordProjects';
import { analysisToLeadSheet } from '../lib/chordProjectToLeadSheet';
import { getCachedAnalysisEntry, setCachedAnalysis } from '../lib/analysisCache';
import { leadSheetToChart } from '../lib/backing';
import { extractMelody } from '../lib/backing/adapters/noteSheetToChart';
import { getSwingRatio, swingMelody } from '../lib/note/swing';
import { useGlobalPlayer, type ChartInput } from '../lib/player';
import { getPlayerSettings, inferGenre, inferPlayStyle, setPlayerSetting, subscribePlayerSettings, TRANSPOSING_INSTRUMENT_OFFSET } from '../lib/note/playerSettings';
import { GenreSelect, MixerButton, BpmControl, RepeatControl, TransportButtons, BackingMixer } from '../components/backing/BackingPlayerBar';
import { useIsNativeUi } from '../contexts/AppPreviewContext';
import { useCompactLayout } from '../hooks/useCompactLayout';
import { withLeadSheetSelectionIds } from '../lib/leadSheetSelection';
import type { LeadSheetChordSelection } from '../components/leadsheet/LeadSheet';
import { loadUserLicksSync, type LickEntry } from '../data/lickData';
import { findMatchingLicks, leadingPickupBars, type LickMatch } from '../lib/lickMatcher';
import { SavedLicksModal } from '../components/leadsheet/SavedLicksModal';
import { useCountInIntro } from '../hooks/useCountInIntro';
import { parseChordInput, loadChartEdit, saveChartEdit, displayKeyToProjectKey, leadSheetToProgression } from '../lib/leadSheetChordEdit';
import { buildShareUrl, tryNativeShare } from '../lib/share/chartShare';
import { ShareLinkModal } from '../components/common/ShareLinkModal';
import { loadBreakPoints, saveBreakPoints, toggleBreakPoint, type BreakPoint } from '../lib/breakPoints';
import { useTransitionState } from '../hooks/useTransitionState';

const ANALYZED_SONG_ID = '__analyzed_all-of-me__';

/* Sentinel song id used by `/mychord?empty=1` — the "직접 입력하기" entry
 * point from the chord-chart library. Renders a blank 4/4 sheet with empty
 * chord slots; combined with `?edit=1` the chart opens straight into edit
 * mode so the user can type chord symbols immediately. */
const EMPTY_SONG_ID = '__empty__';
/* `songId` prefix for a saved ChordProject (opened via `/mychord?project=<id>`).
 * Distinguishes a backend project publicId from iReal numeric ids and the two
 * sentinels above, so the loader fetches the saved chart. */
const PROJECT_ID_PREFIX = 'project:';
/* `songId` prefix for a built-in 예시 차트 (opened via `/mychord?example=<id>`).
 * 정적 프론트 데이터라 백엔드 fetch 없이 EXAMPLE_CHARTS 에서 바로 렌더한다. */
const EXAMPLE_ID_PREFIX = 'example:';
const EMPTY_BARS_PER_SYSTEM = 4;
const EMPTY_SYSTEM_COUNT = 4;
function makeEmptySheet(): LeadSheetData {
  return {
    id: EMPTY_SONG_ID,
    title: '새 코드 차트',
    style: '',
    composer: '',
    timeSignature: '4/4',
    key: 'C',
    systems: Array.from({ length: EMPTY_SYSTEM_COUNT }, (_, si) => ({
      bars: Array.from({ length: EMPTY_BARS_PER_SYSTEM }, (_, bi) => ({
        measureNumber: si * EMPTY_BARS_PER_SYSTEM + bi + 1,
        /* One empty chord slot per bar — renders as a single input in
         * edit mode. The user adds more chords via the existing edit
         * UI; we don't try to pre-seed extra slots here. */
        chords: [{ id: `s${si}-b${bi}-c0` }],
      })),
    })),
  };
}

/* Rule-based analysis is forced off while editing the chart. */
const ANALYSIS_OFF = {
  showAnalysis: false, showDegree: false, showIIVI: false, showArrows: false, showColors: false,
} as const;

const SELECTION_QUALITY_PREFIXES: [RegExp, string][] = [
  [/^(-7b5|-7\(b5\)|m7b5|m7♭5)/, 'ø7'],
  [/^h(?=\d)/, 'ø'],
  [/^h$/, 'ø'],
  [/^(dim7|o7|°7)/, '°7'],
  [/^(dim|o|°)(?!\d)/, '°'],
  [/^(-[Mm]aj7|-△7|-Δ7|-\^7|m[Mm]aj7|mM7)/, '-△7'],
  [/^(Δ7|△7|\^7|[Mm]aj7|M7)/, '△7'],
  [/^(Δ|△|\^|[Mm]aj(?!7)|M(?=[69]|$))/, '△'],
  [/^(-7(?!b5)|m7(?!b5)|min7)/, '-7'],
  [/^(-9|m9|min9)/, '-9'],
  [/^(-11|m11|min11)/, '-11'],
  [/^(-6|m6|min6)/, '-6'],
  [/^(-|m(?!aj|7|9|11|6|in)|min(?!7|9|11|6))/, '-'],
];

function normalizeSelectionQuality(raw: string): string {
  const trimmed = raw.trim();
  for (const [re, replacement] of SELECTION_QUALITY_PREFIXES) {
    const match = trimmed.match(re);
    if (match) {
      return `${replacement}${trimmed.slice(match[0].length)}`.replace(/b/g, '♭').replace(/#/g, '♯');
    }
  }
  return trimmed.replace(/b/g, '♭').replace(/#/g, '♯');
}

function formatChordForSelection(chord: LeadSheetChordSelection['chord']): string {
  const accidental = chord.accidental === '#' ? '♯' : chord.accidental === 'b' ? '♭' : '';
  const quality = chord.quality ? normalizeSelectionQuality(chord.quality) : '';
  const bass = chord.bass
    ? `/${chord.bass.root}${chord.bass.accidental === '#' ? '♯' : chord.bass.accidental === 'b' ? '♭' : ''}`
    : '';
  return `${chord.root ?? ''}${accidental}${quality}${bass}` || '(empty)';
}

function selectionToOverlay(target: LeadSheetChordSelection): ChordOverlay {
  const fn = target.chord.analysis?.functions?.[0]?.function;
  const safeFunc: ChordOverlay['analysis']['func'] = fn === 'SD' || fn === 'D' ? fn : 'T';

  return {
    id: target.id,
    symbol: formatChordForSelection(target.chord),
    bar: target.measureNumber,
    pageNumber: 1,
    position: { x: 0, y: 0, width: 0, height: 0 },
    analysis: {
      degree: target.chord.analysis?.degree || '',
      func: safeFunc,
      diatonic: target.chord.analysis?.isDiatonic ?? target.chord.isDiatonic ?? true,
      secDom: target.chord.analysis?.secondaryDominant?.label,
      modal: target.chord.analysis?.modalInterchange?.borrowedDegree,
    },
  };
}

function uniqueOverlays(overlays: ChordOverlay[]): ChordOverlay[] {
  const seen = new Set<string>();
  return overlays.filter((overlay) => {
    if (seen.has(overlay.id)) return false;
    seen.add(overlay.id);
    return true;
  });
}

const PageContainer = styled.div`
  display: flex;
  height: 100vh;
  height: 100dvh;
  width: 100%;
`;

const RightSection = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  /* Positioning context for the absolutely-placed BackingPlayerBar so it
   * anchors to the score section's bottom-left, not the viewport. */
  position: relative;
`;

const MainArea = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`;

const CenterColumn = styled.div<{ $reverse?: boolean }>`
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: ${({ $reverse }) => ($reverse ? 'column-reverse' : 'column')};
  /* Positioning context for the BackingPlayerBar dock so it spans only the
   * score column (not the chat panel on the right). */
  position: relative;
`;

/* White transport bar above the lead sheet (BPM/repeat/transport on the left,
 * key dropdown centered). Zoom & fullscreen stay inside the sheet. */
const TransportBar = styled.div<{ $bottom?: boolean; $safeTop?: boolean }>`
  position: relative;
  /* Lift the bar (and therefore its dropdowns) above the lead sheet, which is
   * a later sibling and would otherwise paint over the open menus. */
  z-index: 60;
  display: flex;
  align-items: center;
  /* The chat panel is user-resizable, so this bar's width is fluid. Stay on a
   * single row (no height growth); the middle group shrinks first and the bar
   * compacts rather than wrapping or overlapping. */
  flex-wrap: nowrap;
  gap: 8px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  flex-shrink: 0;
  min-width: 0;
  box-sizing: border-box;
  width: 100%;

  ${({ $bottom, theme }) => $bottom
    ? `
      border-top: 1px solid ${theme.colors.border};
      padding: 5px 10px max(5px, env(safe-area-inset-bottom, 0px));
    `
    : `
      border-bottom: 1px solid ${theme.colors.border};
      padding: 5px 10px;
    `}

  /* 네이티브: 이 바가 화면 최상단이라(웹의 TopToolbar 는 숨김) 상태바·
   * 다이나믹아일랜드 아래로 내려오도록 safe-area 상단 인셋을 준다. 웹에서는
   * TopToolbar 가 위에 있어 이 인셋을 주면 안 되므로 prop 으로 게이팅한다.
   * (env(safe-area-inset-top) 은 위치를 모르는 뷰포트 상수라 mid-page 바에
   *  그대로 주면 웹 모바일에서도 잘못 밀린다.)
   *
   * 또한 네이티브(폰)에서는 컨트롤이 한 줄에 다 안 들어가 좌측 컨트롤
   * (장르·조성·세션)이 잘렸다. nowrap 은 웹의 '리사이즈 가능한 채팅 패널'
   * 때문이었는데 네이티브엔 그 제약이 없으므로 wrap 을 허용해 여러 줄로
   * 흐르게 한다 — 가로 넘침/클리핑 0, 드롭다운도 overflow:visible 유지. */
  ${({ $safeTop, $bottom }) => (!$bottom && $safeTop)
    ? `
      padding-top: calc(5px + env(safe-area-inset-top, 0px));
      flex-wrap: wrap;
      row-gap: 4px;
      justify-content: center;
    `
    : ''}
`;

/* Second toolbar row shown only in edit mode — the chord "modify tool".
 * For now it just holds the Save button. */
const EditBar = styled.div`
  position: relative;
  z-index: 59;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 7px 14px;
  background: #fff7e6;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
`;

const EditBarLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.85rem;
  font-weight: 500;
  color: #9a6b00;
`;

const EditSaveBtn = styled.button`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.9rem;
  font-weight: 700;
  color: #fff;
  background: #1f9a52;
  border: none;
  border-radius: 7px;
  padding: 7px 18px;
  cursor: pointer;
  transition: background 0.15s;
  &:hover { background: #18803f; }
`;

const BarLeft = styled.div<{ $native?: boolean }>`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  /* 네이티브: 1행을 통째로 차지(전폭) → 사이드바가 좌상단, 장르·조성·세션이
   * 그 뒤로. zoom 으로 크기·여백을 줄여 한 줄에 여유롭게 담는다. */
  ${({ $native }) => $native && `
    flex: 1 0 100%;
    justify-content: flex-start;
    gap: 4px;
    zoom: 0.9;
  `}
`;

/* In-flow (not absolutely centered) so it never paints over the left/right
 * groups when the bar narrows. flex:1 lets it fill the middle and center its
 * content; min-width:0 lets it give up space first as the bar compacts. */
const BarCenter = styled.div<{ $native?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  flex: 1 1 auto;
  min-width: 0;
  /* 네이티브: 2행 왼쪽. 오른쪽 아이콘 그룹과 같은 줄에 들어가도록 zoom 으로
   * 축소 + 간격 최소화. (zoom 은 transform:scale 과 달리 차지 폭도 줄인다.) */
  ${({ $native }) => $native && `
    flex: 0 1 auto;
    gap: 2px;
    zoom: 0.72;
  `}
`;

/* Right-aligned tool icons (share / edit / analysis / settings). Kept intact
 * (the left/center groups absorb the squeeze first). */
const BarRight = styled.div<{ $native?: boolean }>`
  display: flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  /* 네이티브: 2행 오른쪽. BarCenter 와 같은 줄. zoom 으로 아이콘 축소. */
  ${({ $native }) => $native && `
    gap: 0;
    zoom: 0.72;
    margin-left: auto;
  `}
`;

const ToolBtn = styled.button<{ $lit?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  border: none;
  border-radius: 9px;
  background: transparent;
  color: ${({ $lit }) => ($lit ? '#e8a838' : '#5b5b5b')};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  ${({ $lit }) => $lit && 'filter: drop-shadow(0 0 4px rgba(232, 168, 56, 0.55));'}

  &:hover { background: rgba(0, 0, 0, 0.06); }
`;

/* ─── native 전용 배치 (iRealPro 참고 — 컴포넌트 디자인은 기존 그대로, 배치만
 * 재구성): 상단은 뒤로가기 + 유틸 아이콘만 남은 얇은 한 줄. BPM·반복·조성·
 * 장르·세션·재생 등 나머지 컨트롤은 화면 하단 고정 패널로 내려간다
 * (BottomControlPanel, 3행: [BPM|반복|조성] / [장르·세션] / [분석·정지·재생·믹서]).
 * ──────────────────────────────────────────────────────────────────────── */

const NativeTopBar = styled.div`
  position: relative;
  z-index: 60;
  display: flex;
  align-items: center;
  gap: 2px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
  padding: calc(6px + env(safe-area-inset-top, 0px)) 8px 6px;
`;

const NativeTopBarSpacer = styled.div`
  flex: 1 1 auto;
`;

/* 하단 고정 패널의 실제 콘텐츠 높이(3행 합) — 스페이서와 정확히 맞춰야
 * 마지막 코드 줄이 패널에 가리지 않는다. */
const BOTTOM_PANEL_CONTENT_HEIGHT = 148;

const BottomControlPanel = styled.div`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 60;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  padding-bottom: env(safe-area-inset-bottom, 0px);
`;

/* CenterColumn 안, LeadSheet 뒤에 두는 자리표시자 — BottomControlPanel 이
 * 코드 차트 마지막 줄을 덮지 않도록 그만큼 스크롤 영역을 줄여준다. */
const BottomPanelSpacer = styled.div`
  flex: 0 0 auto;
  height: calc(${BOTTOM_PANEL_CONTENT_HEIGHT}px + env(safe-area-inset-bottom, 0px));
`;

const BottomPanelRow = styled.div<{ $divider?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-around;
  gap: 8px;
  padding: 0 12px;
  ${({ $divider, theme }) => $divider && `border-top: 1px solid ${theme.colors.border};`}
`;

const BottomPanelRow1 = styled(BottomPanelRow)`
  height: 46px;
`;

const BottomPanelRow2 = styled(BottomPanelRow)`
  height: 44px;
  gap: 14px;
`;

const BottomPanelRow3 = styled(BottomPanelRow)`
  height: 58px;
`;

/* ─── native-only sidebar (slide-in song list, iRealPro-style) ─────────── */

const SidebarBackdrop = styled.div<{ $entered: boolean }>`
  position: fixed;
  inset: 0;
  z-index: 210;
  background: ${({ $entered }) => ($entered ? 'rgba(0, 0, 0, 0.32)' : 'rgba(0, 0, 0, 0)')};
  display: flex;
  align-items: stretch;
  transition: background 0.28s ease;
  /* Avoid swallowing taps while the backdrop is still fully transparent on
   * the way out — feels snappier and prevents accidental dismiss. */
  pointer-events: ${({ $entered }) => ($entered ? 'auto' : 'none')};
`;

const SidebarPanel = styled.aside<{ $entered: boolean }>`
  width: min(380px, 80vw);
  height: 100%;
  background: #fff;
  display: flex;
  flex-direction: column;
  box-shadow: 4px 0 28px rgba(0, 0, 0, 0.18);
  padding-top: env(safe-area-inset-top, 0px);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  font-family: 'Pretendard', sans-serif;
  transform: translateX(${({ $entered }) => ($entered ? '0' : '-100%')});
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
  will-change: transform;
`;

const SidebarHeader = styled.header`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
`;

const SidebarIconBtn = styled.button`
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #0a84ff;
  cursor: pointer;
  border-radius: 8px;
  &:active { opacity: 0.55; }
`;

const SidebarTitle = styled.div`
  flex: 1;
  font-size: 1.05rem;
  font-weight: 700;
  color: #111;
  text-align: left;
`;

const SidebarSearch = styled.div`
  padding: 8px 12px 4px;
`;

const SidebarSearchInput = styled.input`
  width: 100%;
  height: 34px;
  border-radius: 9px;
  border: none;
  background: #eef0f3;
  padding: 0 12px;
  font-family: inherit;
  font-size: 0.92rem;
  outline: none;
  &::placeholder { color: #9a9a9a; }
`;

const SidebarList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding-bottom: 12px;
`;

const SongRow = styled.button<{ $active?: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  padding: 10px 16px;
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
  background: ${({ $active }) => ($active ? '#eef4ff' : 'transparent')};
  cursor: pointer;
  font-family: inherit;
  &:hover { background: ${({ $active }) => ($active ? '#dde7ff' : '#f7f7f8')}; }
`;

const SongTitle = styled.div`
  font-size: 0.98rem;
  font-weight: 700;
  color: #111;
  margin-bottom: 2px;
`;

const SongComposer = styled.div`
  font-size: 0.78rem;
  color: #777;
`;

const SongMeta = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
  font-size: 0.72rem;
  color: #999;
`;

/* ─── tool icons (Lucide, 24×24 stroke) ───────────────────────────────── */
const SidebarIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <line x1="9" y1="4" x2="9" y2="20" />
  </svg>
);

const BackIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 5 L8 12 L15 19" />
  </svg>
);

const ChatIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const MixerIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </svg>
);

const ShareIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
  </svg>
);

const PencilIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

const LightbulbIcon = ({ lit }: { lit: boolean }) => (
  <svg width="27" height="27" viewBox="0 0 24 24" fill={lit ? 'rgba(232, 168, 56, 0.22)' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18h6" />
    <path d="M10 22h4" />
    <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14" />
  </svg>
);

const GearIcon = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

/* ─── settings modal (analysis sub-filters) ───────────────────────────── */
const ModalOverlay = styled.div<{ $entered: boolean }>`
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ $entered }) => ($entered ? 'rgba(0, 0, 0, 0.42)' : 'rgba(0, 0, 0, 0)')};
  transition: background 0.24s ease;
  pointer-events: ${({ $entered }) => ($entered ? 'auto' : 'none')};
`;

const ModalCard = styled.div<{ $entered: boolean }>`
  width: 340px;
  max-width: calc(100vw - 32px);
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.28);
  padding: 22px 24px 24px;
  font-family: 'Pretendard', sans-serif;
  opacity: ${({ $entered }) => ($entered ? 1 : 0)};
  transform: scale(${({ $entered }) => ($entered ? 1 : 0.94)});
  transition: opacity 0.22s ease, transform 0.24s cubic-bezier(0.32, 0.72, 0, 1);
  will-change: opacity, transform;
`;

const ModalTitle = styled.h3`
  margin: 0 0 4px;
  font-size: 1.1rem;
  font-weight: 700;
  color: #1a1a1a;
`;

const ModalSub = styled.p`
  margin: 0 0 16px;
  font-size: 0.82rem;
  color: #888;
`;

const ModalInput = styled.input`
  width: 100%;
  height: 38px;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  padding: 0 10px;
  font-size: 0.9rem;
  color: #222;
  box-sizing: border-box;
  outline: none;

  &:focus {
    border-color: #1f6feb;
    box-shadow: 0 0 0 2px rgba(31, 111, 235, 0.12);
  }
`;

const ProgressionPreview = styled.pre`
  margin: 12px 0 0;
  max-height: 120px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid #ececec;
  border-radius: 8px;
  background: #fafafa;
  padding: 10px;
  font-size: 0.78rem;
  line-height: 1.45;
  color: #444;
`;

const ModalError = styled.div`
  margin-top: 10px;
  border-radius: 8px;
  background: #fff1f0;
  border: 1px solid #ffccc7;
  color: #a8071a;
  padding: 8px 10px;
  font-size: 0.78rem;
  line-height: 1.4;
`;

const ModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
`;

const ModalButton = styled.button<{ $primary?: boolean }>`
  height: 36px;
  border: 1px solid ${({ $primary }) => ($primary ? '#1f6feb' : '#d9d9d9')};
  border-radius: 8px;
  padding: 0 14px;
  background: ${({ $primary }) => ($primary ? '#1f6feb' : '#fff')};
  color: ${({ $primary }) => ($primary ? '#fff' : '#333')};
  font-weight: 700;
  font-size: 0.86rem;
  cursor: pointer;

  &:disabled {
    opacity: 0.58;
    cursor: default;
  }
`;

/* ─── native-only chat window + mixer bottom-sheet ─────────────────────── */

const ChatWindowOverlay = styled.div<{ $entered: boolean }>`
  position: fixed;
  inset: 0;
  z-index: 220;
  background: ${({ $entered }) => ($entered ? 'rgba(0, 0, 0, 0.42)' : 'rgba(0, 0, 0, 0)')};
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  transition: background 0.28s ease;
  pointer-events: ${({ $entered }) => ($entered ? 'auto' : 'none')};
`;

const ChatWindowCard = styled.div<{ $entered: boolean }>`
  width: 100%;
  max-width: 480px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  display: flex;
  flex-direction: column;
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.24);
  padding-bottom: env(safe-area-inset-bottom, 0px);
  transform: translateX(${({ $entered }) => ($entered ? '0' : '100%')});
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
  will-change: transform;
`;

const ChatWindowHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  font-family: 'Pretendard', sans-serif;
`;

const ChatWindowTitle = styled.div`
  font-size: 1rem;
  font-weight: 700;
  color: #1a1a1a;
`;

const ChatWindowClose = styled.button`
  border: none;
  background: transparent;
  font-size: 1.4rem;
  color: #1a1a1a;
  cursor: pointer;
  line-height: 1;
`;

const ChatWindowBody = styled.div`
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`;

const SheetBackdrop = styled.div<{ $entered: boolean }>`
  position: fixed;
  inset: 0;
  z-index: 220;
  background: ${({ $entered }) => ($entered ? 'rgba(0, 0, 0, 0.42)' : 'rgba(0, 0, 0, 0)')};
  display: flex;
  align-items: flex-end;
  justify-content: center;
  transition: background 0.28s ease;
  pointer-events: ${({ $entered }) => ($entered ? 'auto' : 'none')};
`;

const SheetCard = styled.div<{ $entered: boolean }>`
  width: 100%;
  max-width: 540px;
  background: #fff;
  border-top-left-radius: 18px;
  border-top-right-radius: 18px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  font-family: 'Pretendard', sans-serif;
  transform: translateY(${({ $entered }) => ($entered ? '0' : '100%')});
  transition: transform 0.3s cubic-bezier(0.32, 0.72, 0, 1);
  will-change: transform;
`;

const SheetHandle = styled.div`
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.18);
  margin: 8px auto 4px;
`;

const SheetHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 16px 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
`;

const SheetTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: #1a1a1a;
`;

const SheetDone = styled.button`
  background: none;
  border: none;
  color: #0a84ff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
`;

const SheetBody = styled.div`
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
`;

/* "iRealPro 1460" label — now lives in the toolbar's leftExtra slot. */
const SongPickerLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  white-space: nowrap;
`;

const SongSelect = styled.select`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  padding: 4px 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  max-width: 320px;
`;


const LoadingState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Pretendard', sans-serif;
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

const RightPanelWrapper = styled.div<{ $width: number }>`
  width: ${({ $width }) => $width}px;
  min-width: 180px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;

  ${mq.compactLayout} {
    display: none;
  }
`;

/* Tab strip splitting the right panel into 믹서 / AI 채팅. Sits right under
 * the always-visible BackingTransport. */
const ResizeDivider = styled.div`
  width: 5px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  position: relative;
  transition: background 0.15s;

  &:hover, &.dragging {
    background: ${({ theme }) => theme.colors.border};
  }

  &::after {
    content: '';
    position: absolute;
    inset: 0 -4px;
  }

  ${mq.compactLayout} {
    display: none;
  }
`;

export default function ChordPage({ mychordMode = false }: { mychordMode?: boolean }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { filters, effective, toggleFilter } = useAnalysisFilters();

  // Entering a chord chart starts a FRESH AI-chat session (not a continuation
  // of whatever general chat was last open). Runs once per page entry; song
  // switches within the page are handled by RightChatPanel's songTitle effect.
  // EXCEPTION: arriving via a Recent-Chats click (?chat=<id>) RESTORES that
  // chat so its conversation reopens with this chart. Captured once at mount
  // (setSongId later strips the param from the URL).
  const [restoreChatId] = useState<string | undefined>(() => {
    // Explicit Recent-Chats click carries ?chat=<id>.
    const fromParam = searchParams.get('chat');
    if (fromParam) return fromParam;
    // Otherwise, entering a chart that ALREADY has a chat (any prior
    // conversation on this project) reopens it — so the panel shows the saved
    // log and the Recent-Chats row highlights, instead of a blank start
    // screen. Cache-only lookup (no network); fresh chat when none found.
    const proj = searchParams.get('project');
    if (proj) {
      const mine = (getCachedChatList() ?? [])
        .filter((c) => c.projectPublicId === proj)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      if (mine[0]) return mine[0].publicId;
    }
    return undefined;
  });
  /* publicId of the chord PROJECT this chart was opened from (`/mychord?project=<id>`).
   * Threaded to RightChatPanel so chats started here persist with category=chord +
   * this id → Recent Chats shows the chord icon + song name and reopens this chart. */
  const [chatProjectId] = useState<string | undefined>(
    () => searchParams.get('project') ?? undefined,
  );
  useEffect(() => {
    if (restoreChatId) setActiveChat(restoreChatId);
    else setActiveChat(null);
  }, []);
  /* Gate for Capacitor-app-only UI (native shell OR /preview/* route). */
  const isNativeUi = useIsNativeUi();
  /* compact(좁은 창/터치) 레이아웃에선 MobileChatFab가 자체 RightChatPanel을
   * 마운트한다. 데스크톱 패널을 CSS로 숨기기만 하면 두 인스턴스가 동시에 살아
   * jazzify:requestLicks 이벤트 중복 처리·GET /v1/chat 2회 발사·대화 상태
   * 분기가 생겼다 — JS 레벨에서 한 쪽만 마운트한다. */
  const isCompactLayout = useCompactLayout();
  const [songIndex, setSongIndex] = useState<SongEntry[]>([]);
  const [songId, setSongIdRaw] = useState(() => {
    if (mychordMode && searchParams.get('empty') === '1') return EMPTY_SONG_ID;
    // A saved "내 코드 차트" opens via `/mychord?project=<publicId>`. Tag it with
    // a `project:` prefix so the loader fetches that chart instead of falling
    // through to the All Of Me default.
    const proj = searchParams.get('project');
    if (proj) return `${PROJECT_ID_PREFIX}${proj}`;
    // 기본 예시 차트 — `/mychord?example=<id>` (정적, 백엔드 미사용).
    const ex = searchParams.get('example');
    if (ex) return `${EXAMPLE_ID_PREFIX}${ex}`;
    return mychordMode ? ANALYZED_SONG_ID : (searchParams.get('song') ?? ANALYZED_SONG_ID);
  });

  const setSongId = useCallback((id: string) => {
    setSongIdRaw(id);
    if (id.startsWith(PROJECT_ID_PREFIX)) {
      setSearchParams({ project: id.slice(PROJECT_ID_PREFIX.length) }, { replace: true });
    } else if (id.startsWith(EXAMPLE_ID_PREFIX)) {
      setSearchParams({ example: id.slice(EXAMPLE_ID_PREFIX.length) }, { replace: true });
    } else if (id === EMPTY_SONG_ID) {
      // 빈 시트는 ?empty=1 형태가 정본 — `song=__empty__`로 쓰면 리마운트 후
      // 초기화 로직(mychordMode + empty=1 검사)이 못 알아보고 Analyzed로 빠진다.
      setSearchParams({ empty: '1' }, { replace: true });
    } else if (id === ANALYZED_SONG_ID) {
      setSearchParams({}, { replace: true });
    } else {
      setSearchParams({ song: id }, { replace: true });
    }
  }, [setSearchParams]);
  const [sheet, setSheet] = useState<LeadSheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* Chord-chart edit mode (frontend-only; no per-user backend yet). Edits are
   * collected by source index ("system-bar-chord") and applied on save.
   * Starts ON when the page is entered via `?edit=1` (used by the
   * "직접 입력하기" flow that lands on an empty sheet). */
  const [editMode, setEditMode] = useState(() => searchParams.get('edit') === '1');
  const editValuesRef = useRef<Map<string, string>>(new Map());

  /* Break Editor (고급 기능). Per-song break points, persisted to localStorage
   * keyed by songId. breakEditMode toggles the per-beat marker overlay. */
  const [breakEditMode, setBreakEditMode] = useState(false);
  const [breakPoints, setBreakPoints] = useState<BreakPoint[]>([]);

  /* 구간 반복 (Loop). Per-song region [startBar, endBar] (0-based flat bar
   * indices), persisted to localStorage by songId. loopEditMode opens the
   * picker; loopDraftStart holds the first-clicked bar while awaiting the end. */
  const [loopEditMode, setLoopEditMode] = useState(false);
  const [loopRegion, setLoopRegion] = useState<{ startBar: number; endBar: number } | null>(null);
  const [loopDraftStart, setLoopDraftStart] = useState<number | null>(null);

  const { player: globalPlayer } = useGlobalPlayer();
  const [isPlaying, setIsPlaying] = useState(false);
  /* How many times Play repeats the chart before stopping (default 3). */
  const [repeatCount, setRepeatCount] = useState(3);
  const [tempo, setTempo] = useState(140);
  const [activeBar, setActiveBar] = useState(-1);
  const [selectedChordIds, setSelectedChordIds] = useState<string[]>([]);
  const [selectedChordsData, setSelectedChordsData] = useState<ChordOverlay[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  /* Native-only top-bar toggles. Sidebar drops the song list, chat opens the
   * AI panel as a modal (no right-side dock), mixer opens BackingMixer as a
   * bottom sheet. */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarQuery, setSidebarQuery] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [mixerSheetOpen, setMixerSheetOpen] = useState(false);

  /* All overlays use a shared mount + transition pattern so they slide in
   * and back out smoothly instead of popping. Durations match the CSS
   * transitions on each respective styled component below. */
  const sidebarT = useTransitionState(sidebarOpen);
  const chatT = useTransitionState(chatOpen);
  const mixerSheetT = useTransitionState(mixerSheetOpen);
  // ★ 저장된 릭 있는 마디 번호 세트
  const [savedLickBarNums, setSavedLickBarNums] = useState<Set<number>>(new Set());
  const [savedLicksModal, setSavedLicksModal] = useState<{
    label: string;
    matches: LickMatch[];
    anchorSystem: number;
    anchorBar: number;
  } | null>(null);
  const [inlineLick, setInlineLick] = useState<{
    lick: LickEntry;
    systemIndex: number;
    anchorBar: number;
  } | null>(null);

  /* 채팅 패널에서 추천된 릭의 ▼ 버튼 → 좌측 코드 진행 아래에 인라인 표시.
   * SavedLicksModal의 ▼와 동일하게 동작하되, 채팅 릭에는 클릭 위치가 없으므로
   * 앵커는 "현재 드래그 선택한 코드 구간의 첫 마디"(없으면 차트 첫 마디)로 잡는다.
   * 같은 릭을 같은 앵커에서 다시 누르면 토글로 닫힌다. */
  const handleChatLickInline = useCallback((lick: LickEntry) => {
    if (!sheet) return;
    const barNum = selectedChordsData[0]?.bar ?? sheet.systems[0]?.bars[0]?.measureNumber;
    if (barNum == null) return;
    const anchorSystem = sheet.systems.findIndex((s) => s.bars.some((b) => b.measureNumber === barNum));
    if (anchorSystem < 0) return;
    const anchorBar = sheet.systems[anchorSystem].bars.findIndex((b) => b.measureNumber === barNum);
    if (anchorBar < 0) return;
    setInlineLick((prev) => (
      prev && prev.lick.id === lick.id && prev.systemIndex === anchorSystem && prev.anchorBar === anchorBar
        ? null
        : { lick, systemIndex: anchorSystem, anchorBar }
    ));
  }, [sheet, selectedChordsData]);

  // Mixer toggle: whether the inline lick's melody plays over the chord chart.
  const [playInlineLick, setPlayInlineLick] = useState(() => getPlayerSettings().playInlineLick);
  useEffect(() => subscribePlayerSettings((s) => setPlayInlineLick(s.playInlineLick)), []);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const [saveProjectTitle, setSaveProjectTitle] = useState('새 코드 차트');
  const [saveProjectError, setSaveProjectError] = useState<string | null>(null);
  const [pendingSaveSheet, setPendingSaveSheet] = useState<LeadSheetData | null>(null);
  const [savingProject, setSavingProject] = useState(false);
  /* Share: build a self-contained public link (chart encoded in the URL) and
   * hand it to the native share sheet, falling back to a copy-link modal. */
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  const handleChordClick = (_chord: any, _measureNumber: number, target?: LeadSheetChordSelection) => {
    if (!isSelectionMode) return;
    if (!target) return;
    const overlay = selectionToOverlay(target);
    setSelectedChordIds([overlay.id]);
    setSelectedChordsData([overlay]);
  };

  const [selectionBubblePos, setSelectionBubblePos] = useState<{ x: number; y: number } | null>(null);

  const handleChordRangeSelect = (targets: LeadSheetChordSelection[], pos?: { x: number; y: number }) => {
    if (!isSelectionMode) return;
    const overlays = uniqueOverlays(targets.map(selectionToOverlay));
    setSelectedChordIds(overlays.map((chord) => chord.id));
    setSelectedChordsData(overlays);
    if (pos && overlays.length > 0) {
      setSelectionBubblePos({ x: pos.x, y: pos.y });
    } else {
      setSelectionBubblePos(null);
    }
  };

  const toggleSelectionMode = () => {
    const nextMode = !isSelectionMode;
    setIsSelectionMode(nextMode);
    if (!nextMode) {
      setSelectedChordIds([]);
      setSelectedChordsData([]);
    }
  };

  const clearSelectedChords = useCallback(() => {
    setSelectedChordIds([]);
    setSelectedChordsData([]);
  }, []);

  useEffect(() => {
    setSelectedChordIds([]);
    setSelectedChordsData([]);
    setInlineLick(null);
  }, [sheet?.id]);

  // Mixer state (volumes, drumKit, reverb, bassMode) lives in the global
  // playerSettings store — BackingPlayer subscribes directly, so this page
  // doesn't need to mirror or push those values. Only page-local state
  // (the chart, tempo) is owned here.

  // Load song index on mount
  useEffect(() => {
    getSongIndex().then(setSongIndex).catch(() => {});
  }, []);

  // Build a stable ChartInput for the GlobalPlayer whenever the loaded sheet
  // changes. The GlobalPlayer lazy-instantiates the rule BackingPlayer when
  // play() is called with this input.
  const chartInput = useMemo<ChartInput | null>(() => {
    if (!sheet) return null;
    return { kind: 'chart', data: sheet };
  }, [sheet]);

  // Sync tempo and inferred rhythm style from the chart whenever the
  // sheet changes. (BackingPlayer reads the global playerSettings store
  // on construction, so we don't need to pass volumes/kit/reverb here.)
  useEffect(() => {
    if (!sheet) return;
    const chart = leadSheetToChart(sheet);
    setTempo(chart.bpm);
    setActiveBar(-1);
    // Auto-pick rhythm style from the chart — bossa charts default to bossa,
    // everything else swing. chart.defaultStyle comes from the iReal style
    // string (e.g. "Bossa Nova" → 'bossa', "Medium Swing" → 'medium-swing').
    const inferred = inferPlayStyle(chart.defaultStyle ?? sheet.style);
    if (inferred && inferred !== getPlayerSettings().style) {
      setPlayerSetting('style', inferred);
    }
    // Mirror the richer genre label into the transport dropdown. Prefer the
    // raw iReal style string (e.g. "Bossa Nova", "Bebop") over the normalized
    // StyleId so genres the engine collapses to swing/bossa still display.
    const inferredGenre = inferGenre(sheet.style ?? chart.defaultStyle);
    if (inferredGenre && inferredGenre !== getPlayerSettings().genre) {
      setPlayerSetting('genre', inferredGenre);
    }
  }, [sheet]);

  // Subscribe to GlobalPlayer events for this page's reactive UI state.
  // We use player.on('bar'/'done', …) directly (not the hook's currentBar)
  // because the page already owns `activeBar` and `isPlaying` state for
  // the lead-sheet highlight and transport button.
  useEffect(() => {
    // Only move the chart's bar highlight for the CHART engine. The saved-licks
    // modal auditions licks (kind === 'lick') through this same singleton
    // player; without the guard the chord chart's player would scrub along with
    // the modal's lick playback.
    const offBar = globalPlayer.on('bar', (bar) => {
      if (globalPlayer.currentInput?.kind !== 'chart') return;
      setActiveBar(bar);
    });
    const offDone = globalPlayer.on('done', () => {
      if (globalPlayer.currentInput && globalPlayer.currentInput.kind !== 'chart') return;
      setIsPlaying(false);
    });
    return () => {
      offBar();
      offDone();
    };
  }, [globalPlayer]);

  // Warm up the audio context + instrument/drum samples in the background
  // the moment the chart input is known, so the FIRST Play doesn't stall
  // after the count-in waiting on the (network + decode) load. preload is
  // idempotent so the play-time preload() resolves instantly once this
  // finishes — fixing the "1234 … long pause … sound" first-play delay.
  useEffect(() => {
    if (!chartInput) return;
    void globalPlayer.preload(chartInput).catch(() => { /* retry at play time */ });
  }, [globalPlayer, chartInput]);

  // Inline lick → chart melody track. When a lick is shown inline, inject its
  // notes (shifted to the lick's anchor bar) into the chord-chart engine so it
  // plays over exactly those bars. setConfig({melody}) takes effect mid-play
  // (BackingPlayer re-renders in place) and loops with the chart. Cleared to []
  // when the lick is closed.
  useEffect(() => {
    // Off via the mixer toggle, or no lick shown → silence the chart melody.
    if (!inlineLick || !sheet || !playInlineLick) { globalPlayer.setConfig({ melody: [] }); return; }
    const lickSheet = inlineLick.lick.sheetData;
    const beatsPerBar = parseInt((sheet.timeSignature || '4/4').split('/')[0], 10) || 4;
    // Global flat bar index of the anchor = bars in earlier systems + anchorBar.
    let globalBar = inlineLick.anchorBar;
    for (let k = 0; k < inlineLick.systemIndex; k++) globalBar += sheet.systems[k]?.bars.length ?? 0;
    // Align the lick's FIRST CHORD-BEARING bar (its ii / D-7) to the anchor —
    // NOT its pickup bar. Shift the whole lick left by the pickup count so the
    // pickup plays in the bar(s) before; drop any note pushed before the start.
    // Only the chord-bearing part (the ii-V-I, D-7 →) plays — leading no-chord
    // pickup measures are DROPPED, and the first chord-bearing bar (D-7) is
    // aligned to the anchor bar.
    const pickupBars = leadingPickupBars(lickSheet.measures);
    const startBeat = pickupBars * beatsPerBar;
    const offsetBeats = (globalBar - pickupBars) * beatsPerBar;
    // Swing the lick's eighth-note grid (offbeat eighths land late) so it sits
    // in the jazz pocket. Done here — not in the engine — so ONLY the inline
    // lick swings, leaving note-analysis sheet/solo melodies untouched.
    // swingMelody: 8분 펄스에만 스윙, 16분 런은 균등 유지(인간 연주 그대로).
    const r = getSwingRatio(tempo, 'medium-swing');
    const swung = swingMelody(
      extractMelody(lickSheet, { accidentalStyle: 'explicit' }).filter((m) => m.beatOffset >= startBeat),
      r,
    );
    const melody = swung.map((m) => ({ ...m, beatOffset: m.beatOffset + offsetBeats }));
    globalPlayer.setConfig({ melody });
  }, [globalPlayer, inlineLick, sheet, tempo, playInlineLick]);

  // Stop the GlobalPlayer when this page unmounts so the engine doesn't
  // keep firing bar events into a stale activeBar setter. (Engines are
  // singletons; we just need to halt playback on teardown.)
  useEffect(() => {
    return () => {
      globalPlayer.stop();
    };
  }, [globalPlayer]);

  // Push tempo changes into the live player config (per-page state, not global)
  useEffect(() => {
    globalPlayer.setConfig({ bpm: tempo });
  }, [globalPlayer, tempo]);

  // Load this song's saved break points whenever the song changes.
  // persistedSongIdRef: 곡 전환 commit에서는 load/save effect가 같은 songId
  // deps를 공유해 "새 songId + 이전 곡 state" 조합으로 save가 한 번 실행됐다 —
  // 이전 곡의 break/loop가 새 곡 키에 기록되거나 새 곡의 저장값을 지우는 오염.
  // load가 완료된 songId를 ref에 기록하고, save는 일치할 때만 쓴다.
  const persistedSongIdRef = useRef<string | null>(null);
  useEffect(() => {
    setBreakPoints(loadBreakPoints(songId));
  }, [songId]);

  // Push break points into the live player config + persist per-song. Read
  // live by the scheduler, so edits take effect on the next bar without a
  // restart.
  useEffect(() => {
    globalPlayer.setConfig({ breakBeats: breakPoints });
    if (persistedSongIdRef.current !== songId) return; // 곡 전환 직후 1커밋 스킵
    saveBreakPoints(songId, breakPoints);
  }, [globalPlayer, breakPoints, songId]);

  /* The marker the user clicks is the LAST beat that should PLAY; the rest
   * begins on the next beat. So a click on beat K stores rest-start = K+1.
   * Clicking the final beat (K+1 > beatsPerBar) means "play the whole bar" →
   * clear any break on this bar. */
  const handleToggleBreak = useCallback((bar: number, clickedBeat: number) => {
    const beatsPerBar = parseInt((sheet?.timeSignature ?? '4/4').split('/')[0], 10) || 4;
    const restStart = clickedBeat + 1;
    setBreakPoints((prev) => {
      if (restStart > beatsPerBar) return prev.filter((p) => p.bar !== bar);
      return toggleBreakPoint(prev, bar, restStart);
    });
  }, [sheet]);

  // ── 구간 반복 (Loop) ──
  // Load this song's saved loop region whenever the song changes (editor closed).
  useEffect(() => {
    let next: { startBar: number; endBar: number } | null = null;
    try {
      const raw = window.localStorage.getItem(`jazzify.loop.${songId}`);
      const p = raw ? JSON.parse(raw) as { startBar: number; endBar: number } : null;
      if (p && typeof p.startBar === 'number' && typeof p.endBar === 'number') next = p;
    } catch { /* ignore */ }
    setLoopRegion(next);
    setLoopDraftStart(null);
    setLoopEditMode(false);
    // break+loop 모두 이 시점부터 persist 허용 (load 완료 마커).
    persistedSongIdRef.current = songId;
  }, [songId]);

  // Push the region into the live player config + persist per-song. setConfig
  // applies mid-play (the scheduler reads loopRegion live), so the loop starts
  // on the next wrap without a restart.
  useEffect(() => {
    globalPlayer.setConfig({ loopRegion });
    if (persistedSongIdRef.current !== songId) return; // 곡 전환 직후 1커밋 스킵
    try {
      if (loopRegion) window.localStorage.setItem(`jazzify.loop.${songId}`, JSON.stringify(loopRegion));
      else window.localStorage.removeItem(`jazzify.loop.${songId}`);
    } catch { /* quota / private mode — non-fatal */ }
  }, [globalPlayer, loopRegion, songId]);

  /* Loop editor bar pick: 1st click = start, 2nd click = end (auto-ordered).
   * The previous region keeps looping until the 2nd click commits the new one,
   * so picking never interrupts playback mid-selection. */
  const handlePickLoopBar = useCallback((flatBar: number) => {
    if (loopDraftStart == null) {
      setLoopDraftStart(flatBar);
    } else {
      setLoopRegion({ startBar: Math.min(loopDraftStart, flatBar), endBar: Math.max(loopDraftStart, flatBar) });
      setLoopDraftStart(null);
    }
  }, [loopDraftStart]);

  /* Drag-to-select a loop region on the chart (구간 반복 ON). pointerdown on a
   * bar = anchor, drag over bars = live region preview, release = commit.
   * Independent of the 1st/2nd-click flow (a no-move press still clicks). */
  const loopDragAnchorRef = useRef<number | null>(null);
  const loopDraggingRef = useRef(false);
  const handleLoopBarPointerDown = useCallback((flatBar: number) => {
    loopDragAnchorRef.current = flatBar;
    loopDraggingRef.current = true;
    setLoopDraftStart(null); // 드래그 시작 시 진행 중이던 클릭-선택 취소
  }, []);
  const handleLoopBarPointerEnter = useCallback((flatBar: number) => {
    if (!loopDraggingRef.current || loopDragAnchorRef.current == null) return;
    const a = loopDragAnchorRef.current;
    setLoopRegion({ startBar: Math.min(a, flatBar), endBar: Math.max(a, flatBar) });
  }, []);
  useEffect(() => {
    if (!loopEditMode) return;
    const onUp = () => { loopDraggingRef.current = false; loopDragAnchorRef.current = null; };
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, [loopEditMode]);

  const handleToggleLoopEdit = useCallback(() => {
    setLoopEditMode((v) => {
      if (v) setLoopDraftStart(null); // closing → drop any half-done pick
      return !v;
    });
  }, []);

  const handleClearLoop = useCallback(() => {
    setLoopRegion(null);
    setLoopDraftStart(null);
  }, []);

  const countIn = useCountInIntro();

  const handlePlayPause = useCallback(async () => {
    if (!chartInput) return;
    if (isPlaying || countIn.active) {
      if (isPlaying) globalPlayer.pause();
      countIn.cancel();
      setIsPlaying(false);
      return;
    }
    setIsPlaying(true);
    globalPlayer.setConfig({ repeatCount });
    // Resume the chart engine's AudioContext NOW, synchronously inside this
    // click gesture. play() runs only after the ~2s count-in await — by then
    // the gesture has expired and its resume() can't start a context created
    // suspended during mount warmup, so the first play after a cold page entry
    // stayed silent until a stop+replay. This is the in-gesture resume.
    globalPlayer.unlock(chartInput);
    try {
      // WARM (already loaded): "1 2 3 4" plays the instant the button is pressed
      // and leads straight into the music — preload runs concurrently as a
      // no-op. COLD (not yet loaded — e.g. first play before the mount-time
      // warmup finished): `ready:false` makes the hook show "준비 중…" and finish
      // loading BEFORE the clicks, so the count-in never ends into a silent
      // decode gap the user mistakes for "playback already started". Either way,
      // once loaded every subsequent play is instant.
      // preload에 생성 즉시 .catch — reject 시 unhandledrejection → AudioLifecycle
      // Guard가 stopAllAudio()로 시작하려던 재생을 죽이는 걸 막는다. play()가 재로드.
      const cin = await countIn.run({
        bpm: tempo,
        ready: globalPlayer.isReady(chartInput),
        prepare: globalPlayer.preload(chartInput).catch(() => {}),
      });
      if (!cin.ok) { setIsPlaying(false); return; }
      await globalPlayer.play(chartInput, { downbeatInSec: cin.downbeatInSec });
    } catch (err) {
      console.error('[backing] play failed:', err);
      setIsPlaying(false);
    }
  }, [globalPlayer, chartInput, isPlaying, tempo, countIn, repeatCount]);

  const handleStop = useCallback(() => {
    globalPlayer.stop();
    countIn.cancel();
    setIsPlaying(false);
    setActiveBar(-1);
  }, [globalPlayer, countIn]);

  // Load selected song
  useEffect(() => {
    if (songId === EMPTY_SONG_ID) {
      /* Blank-sheet entry point. Persisted edits keyed by EMPTY_SONG_ID
       * are reused so the user can come back and continue typing. */
      setSheet(loadChartEdit(songId) ?? makeEmptySheet());
      setLoading(false);
      setError(null);
      return;
    }
    if (songId === ANALYZED_SONG_ID) {
      setSheet(loadChartEdit(songId) ?? withLeadSheetSelectionIds(allOfMe, ANALYZED_SONG_ID));
      setLoading(false);
      setError(null);
      return;
    }
    if (songId.startsWith(EXAMPLE_ID_PREFIX)) {
      // 기본 예시 차트 — 정적 분석 완료 LeadSheetData 를 바로 렌더(백엔드 없음).
      // 로컬 편집(있으면)이 우선하는 다른 분기와 동일 규칙.
      const ex = getExampleChart(songId.slice(EXAMPLE_ID_PREFIX.length));
      setSheet(loadChartEdit(songId) ?? (ex ? withLeadSheetSelectionIds(ex.sheet, songId) : null));
      setError(ex ? null : '예시 차트를 찾을 수 없습니다.');
      setLoading(false);
      return;
    }

    if (songId.startsWith(PROJECT_ID_PREFIX)) {
      // A saved "내 코드 차트" — fetch the project + its analysis and render it
      // exactly as MyChordChartsPage's preview does. Local unsaved edits (keyed
      // by this songId) win, matching the other branches.
      const edited = loadChartEdit(songId);
      if (edited) { setSheet(edited); setLoading(false); setError(null); return; }
      const publicId = songId.slice(PROJECT_ID_PREFIX.length);
      let cancelled = false;

      // SWR: render the cached lead-sheet INSTANTLY (any version), then
      // revalidate in the background. The version (updatedAt) isn't known until
      // we fetch the project, so unlike the grid we render-then-check here.
      const cachedEntry = getCachedAnalysisEntry(publicId);
      if (cachedEntry) {
        setSheet(withLeadSheetSelectionIds(cachedEntry.sheet, songId));
        setLoading(false);
        setError(null);
      } else {
        setLoading(true);
      }
      setError(null);
      /* GET /analysis 404s (CHORD_PROJECT_005) when the project hasn't been
       * analyzed yet — common right after OMR, since the backend doesn't
       * auto-analyze. Self-heal by running /analyze once, then use its result.
       * (Mirror of MyChordChartsPage's fetchAnalysisWithRecovery — without
       * this, opening a freshly-OMR'd chart here just shows an error.) */
      const fetchAnalysis = async () => {
        try {
          return await getChordProjectAnalysis(publicId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (!(msg.includes('CHORD_PROJECT_005') || msg.includes('분석 결과가 없습니다'))) throw e;
          return await analyzeChordProject(publicId);
        }
      };
      // Revalidate. If the cached sheet's version still matches the live
      // project.updatedAt, the analysis can't have changed → skip the (heavy)
      // analysis fetch + re-render entirely. Otherwise fetch fresh, re-render,
      // and refresh the cache.
      (async () => {
        try {
          const project = await getChordProject(publicId);
          if (cancelled) return;
          if (cachedEntry && cachedEntry.updatedAt === project.updatedAt) {
            return; // cache is current — already rendered, nothing to do
          }
          const analysis = await fetchAnalysis();
          if (cancelled) return;
          const sheet = analysisToLeadSheet(analysis, project);
          setCachedAnalysis(publicId, project.updatedAt, sheet);
          setSheet(withLeadSheetSelectionIds(sheet, songId));
        } catch (err) {
          // A background revalidation failure must NOT blow away a sheet we
          // already rendered from cache — only surface the error on a cold miss.
          if (!cancelled && !cachedEntry) {
            setError(err instanceof Error ? err.message : 'Failed to load chord chart.');
            setSheet(null);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }

    const idx = parseInt(songId, 10);
    if (isNaN(idx)) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getSong(idx).then((data) => {
      if (cancelled) return;
      if (data) {
        setSheet(loadChartEdit(songId) ?? data);
      } else {
        setError('Song not found.');
        setSheet(null);
      }
    }).catch((err) => {
      if (!cancelled) {
        setError(err instanceof Error ? err.message : 'Failed to load song.');
        setSheet(null);
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => { cancelled = true; };
  }, [songId]);

  const chordContext = useMemo(() => {
    if (sheet) return buildChordContext(sheet);
    return undefined;
  }, [sheet]);

  // B안: 저장된 릭이 있는 ii-V-I 시작 마디 감지
  // sheet가 바뀌거나 저장 릭이 바뀌면 재계산 (jazzify:lickSaved 이벤트로 갱신)
  const refreshSavedLickBars = useCallback(() => {
    if (!sheet) { setSavedLickBarNums(new Set()); return; }
    const saved = loadUserLicksSync();
    if (saved.length === 0) { setSavedLickBarNums(new Set()); return; }
    const keyMatch = chordContext?.match(/Key:\s*([A-G][b#]?)/);
    const songKey = keyMatch ? keyMatch[1] : 'C';
    const barNums = new Set<number>();

    // 모든 (chord, barNum) pair를 한 번에 평탄화 — groupId로 묶어서 ii-V-I 전체 진행을 모음
    const flat: { chord: NonNullable<typeof sheet.systems[0]['bars'][0]['chords'][0]>; barNum: number }[] = [];
    for (const system of sheet.systems) {
      for (const bar of system.bars) {
        for (const c of bar.chords) {
          if (c) flat.push({ chord: c, barNum: bar.measureNumber ?? 0 });
        }
      }
    }

    // groupId → [chords in that ii-V-I group] (role 순서: ii → V → I)
    const byGroup = new Map<number, { chord: typeof flat[0]['chord']; barNum: number; role: string }[]>();
    for (const fc of flat) {
      const memberships = fc.chord.analysis?.groupMemberships ?? [];
      for (const g of memberships) {
        if (g.groupType !== 'ii-V-I' || g.variant === 'incomplete') continue;
        if (!byGroup.has(g.groupId)) byGroup.set(g.groupId, []);
        byGroup.get(g.groupId)!.push({ ...fc, role: g.role });
      }
    }

    for (const group of byGroup.values()) {
      // role 순서대로 정렬: ii → V → I/i
      const ROLE_ORDER: Record<string, number> = { ii: 0, V: 1, I: 2, i: 2 };
      group.sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));
      if (group.length === 0) continue;
      const overlays = group.map(({ chord, barNum }) => ({
        id: String(barNum) + '-' + (chord.root ?? ''),
        symbol: `${chord.root ?? ''}${chord.quality ?? ''}`,
        bar: barNum,
        pageNumber: 1,
        position: { x: 0, y: 0, width: 0, height: 0 },
        analysis: { degree: '', func: 'SD' as const, diatonic: true },
      }));
      const matches = findMatchingLicks(overlays, sheet.title, songKey, saved, 1);
      if (matches.length > 0) {
        // ii 코드가 있는 첫 bar에 뱃지 표시
        const iiBarNum = group.find((g) => g.role === 'ii')?.barNum ?? group[0].barNum;
        barNums.add(iiBarNum);
      }
    }
    setSavedLickBarNums(barNums);
  }, [sheet, chordContext]);

  useEffect(() => { refreshSavedLickBars(); }, [refreshSavedLickBars]);
  useEffect(() => {
    const handler = () => refreshSavedLickBars();
    window.addEventListener('jazzify:lickSaved', handler);
    return () => window.removeEventListener('jazzify:lickSaved', handler);
  }, [refreshSavedLickBars]);

  const [rightPanelWidth, setRightPanelWidth] = useState(515);
  /* Right panel view: mixer (player controls) vs AI chat. */
  /* Transpose key, lifted out of LeadSheet so the player transport owns it. */
  const chartOriginalKey = sheet?.key ?? 'C';
  const [chartKey, setChartKey] = useState(chartOriginalKey);
  useEffect(() => { setChartKey(sheet?.key ?? 'C'); }, [sheet?.key]);

  /* Transposing instrument (global '악보/연주' setting) — shifts only the
   * DISPLAYED chart/key by a fixed interval; chartKey stays the concert source
   * of truth so backing playback is unaffected. The key dropdown/transport edit
   * in WRITTEN terms, so convert picks back to concert. */
  const [instrumentOffset, setInstrumentOffset] = useState(
    () => TRANSPOSING_INSTRUMENT_OFFSET[getPlayerSettings().transposingInstrument],
  );
  useEffect(
    () => subscribePlayerSettings((s) =>
      setInstrumentOffset(TRANSPOSING_INSTRUMENT_OFFSET[s.transposingInstrument])),
    [],
  );
  const writtenKey = shiftKey(chartKey, instrumentOffset);
  useEffect(() => {
    setInlineLick(null);
  }, [writtenKey]);
  const setWrittenKey = useCallback(
    (k: string) => setChartKey(shiftKey(k, -instrumentOffset)),
    [instrumentOffset],
  );

  /* 조성 재해석 — 코드 심볼은 그대로 두고 차트에 '적힌' 조성만 고친다.
   * sheet.key 만 갱신하면 위 effect 가 chartKey 를 따라오게 하므로
   * selectedKey === originalKey 가 되어 이조는 일어나지 않는다.
   * (chartKey 를 별도로 건드리면 LeadSheet 가 새 키로 transpose 해버린다.)
   * TODO(backend): 저장된 코드 프로젝트라면 updateChordProject 로 영속화 필요. */
  const handleApplySuggestedKey = useCallback((k: string) => {
    setSheet((s) => (s ? { ...s, key: k } : s));
  }, []);

  /* Enter/leave chord-chart edit mode. Entering clears any pending edits;
   * leaving via the pencil discards them (Save is the only commit path). */
  const toggleEditMode = useCallback(() => {
    editValuesRef.current.clear();
    setEditMode((on) => !on);
  }, []);

  const handleChordEdit = useCallback(
    (systemIndex: number, barIndex: number, chordIndex: number, value: string) => {
      editValuesRef.current.set(`${systemIndex}-${barIndex}-${chordIndex}`, value);
    },
    [],
  );

  const handleSaveEdit = useCallback(() => {
    if (!sheet) return;
    const next: LeadSheetData = structuredClone(sheet);
    editValuesRef.current.forEach((value, key) => {
      const [s, b, c] = key.split('-').map(Number);
      const chord = next.systems[s]?.bars[b]?.chords[c];
      if (!chord) return;
      next.systems[s].bars[b].chords[c] = { ...parseChordInput(value), id: chord.id };
    });
    setSheet(next);

    if (mychordMode && songId === EMPTY_SONG_ID) {
      setPendingSaveSheet(next);
      setSaveProjectTitle(next.title?.trim() || '새 코드 차트');
      setSaveProjectError(null);
      setSaveConfirmOpen(true);
      return;
    }

    saveChartEdit(songId, next);
    editValuesRef.current.clear();
    setEditMode(false);
  }, [mychordMode, sheet, songId]);

  /* 부분 실패 재시도 시 create부터 다시 돌면 코드 없는 빈 프로젝트가 백엔드에
   * 중복 누적된다 — 생성된 publicId를 보관해 재시도는 addChords/analyze부터
   * 재개한다. (다른 시트로 바뀌면 리셋) */
  const directSaveCreatedIdRef = useRef<string | null>(null);
  useEffect(() => { directSaveCreatedIdRef.current = null; }, [pendingSaveSheet]);

  const handleConfirmDirectInputSave = useCallback(async () => {
    if (!pendingSaveSheet || savingProject) return;
    const title = saveProjectTitle.trim() || pendingSaveSheet.title?.trim() || '새 코드 차트';
    const progression = leadSheetToProgression(pendingSaveSheet);

    setSavingProject(true);
    setError(null);
    setSaveProjectError(null);
    try {
      let publicId = directSaveCreatedIdRef.current;
      if (!publicId) {
        const created = await createChordProject({
          title,
          key: displayKeyToProjectKey(chartKey || pendingSaveSheet.key || 'C'),
          timeSignature: pendingSaveSheet.timeSignature || '4/4',
        });
        publicId = created.publicId;
        directSaveCreatedIdRef.current = publicId; // 재시도는 create 스킵
      }
      await addChordProjectChords(publicId, progression);
      await analyzeChordProject(publicId);

      directSaveCreatedIdRef.current = null;
      editValuesRef.current.clear();
      setEditMode(false);
      setSaveConfirmOpen(false);
      setPendingSaveSheet(null);
      navigate('/my-charts');
    } catch (err) {
      const message = err instanceof Error ? err.message : '코드 차트 저장 실패';
      setError(message);
      setSaveProjectError(message);
    } finally {
      setSavingProject(false);
    }
  }, [chartKey, navigate, pendingSaveSheet, saveProjectTitle, savingProject]);

  const handleShare = useCallback(async () => {
    if (!sheet) return;
    const url = buildShareUrl(sheet);
    if (await tryNativeShare(sheet.title || '코드 차트', url)) return;
    setShareUrl(url);
    setShareModalOpen(true);
  }, [sheet]);

  /* Which instrument the player is using this chart with. Display-only for now;
   * instrument-specific behaviours (vocal lyrics, sax transpose, drum sections)
   * come later. */
  const [session, setSession] = useState<SessionInstrument>('piano');
  const dividerRef = useRef<HTMLDivElement>(null);

  /* 드래그 중 unmount(빠른 네비게이션)나 창 밖 mouseup 유실 시 window 리스너가
   * 잔존하던 것 — 해제 함수를 ref에 보관해 unmount cleanup에서도 정리한다. */
  const dividerCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => { dividerCleanupRef.current?.(); }, []);
  const onDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightPanelWidth;
    dividerRef.current?.classList.add('dragging');

    const onMove = (ev: MouseEvent) => {
      const delta = startX - ev.clientX;
      setRightPanelWidth(Math.max(180, Math.min(720, startWidth + delta)));
    };
    const onUp = () => {
      dividerRef.current?.classList.remove('dragging');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dividerCleanupRef.current = null;
    };
    dividerCleanupRef.current = onUp;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [rightPanelWidth]);

  return (
    <PageContainer onClick={() => setSelectionBubblePos(null)}>
      {countIn.overlay}
      {!isNativeUi && <IconSidebar />}
      <RightSection>
        {!isNativeUi && (
        <TopToolbar
          title={sheet?.title ?? `iRealPro ${songIndex.length || '...'}`}
          subtitle={sheet ? `${(sheet.key ?? '?').replace(/-$/, 'm')} | ${sheet.timeSignature}` : undefined}
          leftExtra={
            <>
              {!mychordMode && <SongPickerLabel>iRealPro {songIndex.length || '...'}</SongPickerLabel>}
              <SongSelect value={songId} onChange={(e) => setSongId(e.target.value)}>
                <option value={ANALYZED_SONG_ID}>All of Me (Analyzed)</option>
                {!mychordMode && songIndex.map((song) => (
                  <option key={song.index} value={String(song.index)}>
                    {song.title} -- {song.composer}
                  </option>
                ))}
              </SongSelect>
            </>
          }
        />
        )}

        <MainArea>
        <CenterColumn>
          {/* 웹: 기존 한 줄 툴바 그대로. 네이티브: 아이콘만 남은 얇은
           *  NativeTopBar + 화면 하단 고정 BottomControlPanel 로 분리
           *  (iRealPro 참고 배치 — 컴포넌트 자체는 기존 것 그대로 재배치만). */}
          {!isNativeUi && (
          <TransportBar $safeTop={isNativeUi}>
            <BarLeft $native={isNativeUi}>
              <GenreSelect />
              <KeyControl selectedKey={writtenKey} onChange={setWrittenKey} isMinor={isMinorKey(writtenKey)} />
              {/* 조성 재해석 제안(모달 → 거절 시 말풍선). 이조 중이거나 편집 중엔
               * 띄우지 않는다 — 무엇이 원본 조성인지 모호해지기 때문. */}
              <KeySuggestPrompt
                data={sheet}
                storageId={songId}
                enabled={!editMode && chartKey === chartOriginalKey}
                onApply={handleApplySuggestedKey}
              />
              <SessionPicker value={session} onChange={setSession} />
            </BarLeft>
            <BarCenter $native={isNativeUi}>
              <MixerButton
                inlineLick
                breakEditMode={breakEditMode}
                onToggleBreakEdit={() => setBreakEditMode((v) => !v)}
                loopEditMode={loopEditMode}
                onToggleLoopEdit={handleToggleLoopEdit}
                loopRegion={loopRegion}
                onClearLoop={handleClearLoop}
              />
              <BpmControl tempo={tempo} onTempoChange={setTempo} disabled={!sheet || loading} />
              <RepeatControl repeatCount={repeatCount} onRepeatChange={setRepeatCount} disabled={!sheet || loading} />
              <TransportButtons playing={isPlaying} onPlayPause={handlePlayPause} onStop={handleStop} disabled={!sheet || loading} />
            </BarCenter>
            <BarRight $native={isNativeUi}>
              <ToolBtn type="button" title="공유" onClick={handleShare} disabled={!sheet || loading}>
                <ShareIcon />
              </ToolBtn>
              <ToolBtn
                type="button"
                title={editMode ? '수정 종료' : '직접 수정'}
                $lit={editMode}
                onClick={toggleEditMode}
              >
                <PencilIcon />
              </ToolBtn>
              {/* 전구 = 분석 보기 ON/OFF 마스터 토글만. 세부 설정은 톱니 모달. */}
              <ToolBtn
                type="button"
                title={filters.showAnalysis ? '분석 보기 끄기' : '분석 보기 켜기'}
                $lit={filters.showAnalysis}
                onClick={() => toggleFilter('showAnalysis')}
              >
                <LightbulbIcon lit={filters.showAnalysis} />
              </ToolBtn>
              <ToolBtn type="button" title="고급 설정" onClick={() => openPerformanceSettings('chordAnalysis')}>
                <GearIcon />
              </ToolBtn>
            </BarRight>
          </TransportBar>
          )}

          {isNativeUi && (
            <NativeTopBar>
              <ToolBtn type="button" title="뒤로가기" onClick={() => navigate(-1)}>
                <BackIcon />
              </ToolBtn>
              <NativeTopBarSpacer />
              <ToolBtn
                type="button"
                title={chatOpen ? 'AI 채팅 닫기' : 'AI 채팅 열기'}
                $lit={chatOpen}
                onClick={() => setChatOpen((v) => !v)}
              >
                <ChatIcon />
              </ToolBtn>
              <ToolBtn
                type="button"
                title={editMode ? '수정 종료' : '직접 수정'}
                $lit={editMode}
                onClick={toggleEditMode}
              >
                <PencilIcon />
              </ToolBtn>
              <ToolBtn type="button" title="공유" onClick={handleShare} disabled={!sheet || loading}>
                <ShareIcon />
              </ToolBtn>
              <ToolBtn type="button" title="고급 설정" onClick={() => openPerformanceSettings('chordAnalysis')}>
                <GearIcon />
              </ToolBtn>
            </NativeTopBar>
          )}

          {editMode && (
            <EditBar>
              <EditBarLabel>코드 수정 모드 — 코드를 클릭해 직접 수정하세요</EditBarLabel>
              <EditSaveBtn type="button" onClick={handleSaveEdit}>저장</EditSaveBtn>
            </EditBar>
          )}

          {sheet && !loading ? (
            <LeadSheet
              data={sheet}
              analysisFilters={editMode || breakEditMode ? ANALYSIS_OFF : effective}
              selectedKey={editMode ? chartOriginalKey : writtenKey}
              editMode={editMode}
              onChordEdit={handleChordEdit}
              breakEditMode={breakEditMode}
              breakPoints={breakPoints}
              onToggleBreak={handleToggleBreak}
              loopEditMode={loopEditMode}
              loopRegion={loopRegion}
              loopDraftStart={loopDraftStart}
              onPickLoopBar={handlePickLoopBar}
              onLoopBarPointerDown={handleLoopBarPointerDown}
              onLoopBarPointerEnter={handleLoopBarPointerEnter}
              activeBar={activeBar}
              bpm={tempo}
              onChordClick={handleChordClick}
              onChordRangeSelect={handleChordRangeSelect}
              selectedChordIds={selectedChordIds}
              selectionMode={!editMode && isSelectionMode}
              savedLickBarNums={savedLickBarNums.size > 0 ? savedLickBarNums : undefined}
              /* Inline lick — shown ONCE at the clicked anchor. LeadSheet lays
               *  each measure 1:1 under consecutive chart bars from the anchor. */
              inlineLick={inlineLick ? {
                systemIndex: inlineLick.systemIndex,
                anchorBar: inlineLick.anchorBar,
                sheet: inlineLick.lick.sheetData,
              } : undefined}
              onInlineLickClose={() => setInlineLick(null)}
              onSavedLickBadgeClick={(barNum, spanLabel) => {
                const anchorSystem = sheet?.systems.findIndex((system) =>
                  system.bars.some((bar) => bar.measureNumber === barNum),
                ) ?? -1;
                const anchorBar = anchorSystem >= 0
                  ? sheet?.systems[anchorSystem]?.bars.findIndex((bar) => bar.measureNumber === barNum) ?? -1
                  : -1;
                if (anchorSystem < 0 || anchorBar < 0) return;
                const saved = loadUserLicksSync();
                if (saved.length === 0) {
                  setSavedLicksModal({ label: spanLabel, matches: [], anchorSystem, anchorBar });
                  return;
                }
                const songKey = writtenKey;
                if (!sheet) return;

                // spanLabel 예: "C Major 2-5-1" / "F minor 2-5-1" → 토닉 + 모드 추출
                const labelMatch = spanLabel.match(/^([A-G][b#]?)\s+(Major|minor)/i);
                const NOTE_TO_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
                const PC_TO_FLAT  = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
                const PC_TO_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
                // use* 이름은 eslint rules-of-hooks가 훅 호출로 오인 — 훅 아님.
                const prefersFlats = (pc: number) => [0,5,10,3,8,1,6].includes(pc);
                const pcToName = (pc: number) => (prefersFlats(pc) ? PC_TO_FLAT : PC_TO_SHARP)[pc];

                let overlays: ChordOverlay[];
                if (labelMatch) {
                  const tonicRoot = labelMatch[1];
                  const isMinor = labelMatch[2].toLowerCase() === 'minor';
                  const tonicLetter = tonicRoot[0].toUpperCase() as keyof typeof NOTE_TO_PC;
                  const acc = tonicRoot[1];
                  let tonicPc = NOTE_TO_PC[tonicLetter] ?? 0;
                  if (acc === 'b') tonicPc = (tonicPc - 1 + 12) % 12;
                  else if (acc === '#') tonicPc = (tonicPc + 1) % 12;

                  const iiPc = (tonicPc + 2) % 12;
                  const vPc  = (tonicPc + 7) % 12;
                  const iiSym = `${pcToName(iiPc)}${isMinor ? 'ø7' : '-7'}`;
                  const vSym  = `${pcToName(vPc)}7`;
                  const iSym  = `${pcToName(tonicPc)}${isMinor ? '-7' : '△7'}`;

                  const mk = (id: string, sym: string): ChordOverlay => ({
                    id, symbol: sym, bar: barNum, pageNumber: 1,
                    position: { x: 0, y: 0, width: 0, height: 0 },
                    analysis: { degree: '', func: 'SD', diatonic: true },
                  });
                  overlays = [mk(`${barNum}-ii`, iiSym), mk(`${barNum}-v`, vSym), mk(`${barNum}-i`, iSym)];
                } else {
                  // fallback: 라벨 파싱 실패 시 기존 동작 (bar 첫 코드)
                  const bar = sheet.systems.flatMap((s) => s.bars).find((b) => b.measureNumber === barNum);
                  const firstChord = bar?.chords[0];
                  if (!firstChord) return;
                  overlays = [{
                    id: String(barNum),
                    symbol: `${firstChord.root ?? ''}${firstChord.quality ?? ''}`,
                    bar: barNum, pageNumber: 1,
                    position: { x: 0, y: 0, width: 0, height: 0 },
                    analysis: { degree: '', func: 'SD', diatonic: true },
                  }];
                }

                const all = findMatchingLicks(overlays, sheet.title, songKey, saved, 50);
                // tier 3은 임의 전조 결과라 제외, tier 1/2만 표시 (없으면 전체)
                const direct = all.filter((m) => m.tier <= 2);
                setSavedLicksModal({
                  label: spanLabel,
                  matches: direct.length > 0 ? direct : all,
                  anchorSystem,
                  anchorBar,
                });
              }}
            />
          ) : (
            <LoadingState>{error ?? (loading ? 'Loading chart...' : 'Loading song list...')}</LoadingState>
          )}

          {/* BottomControlPanel(고정)에 가려지는 만큼 스크롤 영역을 미리 줄여
           *  마지막 코드 줄이 패널 밑에 숨지 않게 한다. */}
          {isNativeUi && <BottomPanelSpacer />}

        </CenterColumn>

        {isNativeUi && (
          <BottomControlPanel>
            <BottomPanelRow1>
              <BpmControl tempo={tempo} onTempoChange={setTempo} disabled={!sheet || loading} />
              <RepeatControl repeatCount={repeatCount} onRepeatChange={setRepeatCount} disabled={!sheet || loading} />
              <KeyControl selectedKey={writtenKey} onChange={setWrittenKey} isMinor={isMinorKey(writtenKey)} />
              {/* 조성 재해석 제안(모달 → 거절 시 말풍선). 이조 중이거나 편집 중엔
               * 띄우지 않는다 — 무엇이 원본 조성인지 모호해지기 때문. */}
              <KeySuggestPrompt
                data={sheet}
                storageId={songId}
                enabled={!editMode && chartKey === chartOriginalKey}
                onApply={handleApplySuggestedKey}
              />
            </BottomPanelRow1>
            <BottomPanelRow2 $divider>
              <GenreSelect />
              <SessionPicker value={session} onChange={setSession} />
            </BottomPanelRow2>
            <BottomPanelRow3 $divider>
              <ToolBtn
                type="button"
                title={filters.showAnalysis ? '분석 보기 끄기' : '분석 보기 켜기'}
                $lit={filters.showAnalysis}
                onClick={() => toggleFilter('showAnalysis')}
              >
                <LightbulbIcon lit={filters.showAnalysis} />
              </ToolBtn>
              <MixerButton
                inlineLick
                breakEditMode={breakEditMode}
                onToggleBreakEdit={() => setBreakEditMode((v) => !v)}
                loopEditMode={loopEditMode}
                onToggleLoopEdit={handleToggleLoopEdit}
                loopRegion={loopRegion}
                onClearLoop={handleClearLoop}
              />
              <TransportButtons playing={isPlaying} onPlayPause={handlePlayPause} onStop={handleStop} disabled={!sheet || loading} />
              <ToolBtn type="button" title="믹서" onClick={() => setMixerSheetOpen(true)}>
                <MixerIcon />
              </ToolBtn>
            </BottomPanelRow3>
          </BottomControlPanel>
        )}

        {!isNativeUi && !isCompactLayout && <ResizeDivider ref={dividerRef} onMouseDown={onDividerMouseDown} />}

        {!isNativeUi && !isCompactLayout && (
        <RightPanelWrapper $width={rightPanelWidth}>
          <RightChatPanel
            hideHeader
            chartKind="chord"
            projectPublicId={chatProjectId}
            restoreChatId={restoreChatId}
            selectedChords={selectedChordsData}
            groupExplanation={selectedChordsData.length > 0 ? "이 구간이 다음 질문의 분석 대상으로 포함됩니다." : null}
            songTitle={sheet?.title ?? 'Jazzify AI'}
            chordContext={chordContext}
            isSelectionMode={isSelectionMode}
            onToggleSelectionMode={toggleSelectionMode}
            onClearSelectedChords={clearSelectedChords}
            songTempo={tempo}
            onLickShowInline={handleChatLickInline}
            activeInlineLickId={inlineLick?.lick.id}
          />
        </RightPanelWrapper>
        )}
        </MainArea>
      </RightSection>

      <MobileChatFab
        selectedChords={selectedChordsData}
        groupExplanation={selectedChordsData.length > 0 ? "이 구간이 다음 질문의 분석 대상으로 포함됩니다." : null}
        songTitle={sheet?.title ?? 'Jazzify AI'}
        chartKind="chord"
        projectPublicId={chatProjectId}
        restoreChatId={restoreChatId}
        chordContext={chordContext}
        isSelectionMode={isSelectionMode}
        onToggleSelectionMode={toggleSelectionMode}
        onClearSelectedChords={clearSelectedChords}
      />

      {/* 드래그 선택 후 뜨는 플로팅 말풍선 */}
      {selectionBubblePos && selectedChordsData.length > 0 && (
        <div
          style={{
            position: 'fixed',
            left: selectionBubblePos.x,
            top: selectionBubblePos.y,
            transform: 'translate(-50%, -100%)',
            zIndex: 2000,
            pointerEvents: 'auto',
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={() => {
            setSelectionBubblePos(null);
            window.dispatchEvent(new CustomEvent('jazzify:requestLicks'));
          }}
        >
          <div style={{
            background: 'rgba(180, 130, 10, 0.9)',
            color: '#fff',
            padding: '3px 11px',
            borderRadius: '4px 4px 0 0',
            display: 'flex',
            alignItems: 'center',
            gap: '5px',
            fontSize: '11px',
            fontWeight: 700,
            fontFamily: "'Pretendard', sans-serif",
            cursor: 'pointer',
            userSelect: 'none',
            whiteSpace: 'nowrap',
            letterSpacing: '0.02em',
          }}>
            💡 릭 추천받기
          </div>
        </div>
      )}

      {saveConfirmOpen && (
        <ModalOverlay
          $entered
          onClick={() => {
            if (savingProject) return;
            setSaveConfirmOpen(false);
            setPendingSaveSheet(null);
            setSaveProjectError(null);
          }}
        >
          <ModalCard $entered onClick={(e) => e.stopPropagation()}>
            <ModalTitle>코드 차트 저장</ModalTitle>
            <ModalSub>입력한 코드를 내 코드 차트에 저장할까요?</ModalSub>
            <ModalInput
              value={saveProjectTitle}
              onChange={(e) => setSaveProjectTitle(e.target.value)}
              placeholder="차트 제목"
              disabled={savingProject}
            />
            <ProgressionPreview>
              {pendingSaveSheet ? leadSheetToProgression(pendingSaveSheet) : ''}
            </ProgressionPreview>
            {saveProjectError && <ModalError>{saveProjectError}</ModalError>}
            <ModalActions>
              <ModalButton
                type="button"
                disabled={savingProject}
                onClick={() => {
                  setSaveConfirmOpen(false);
                  setPendingSaveSheet(null);
                  setSaveProjectError(null);
                }}
              >
                취소
              </ModalButton>
              <ModalButton
                type="button"
                $primary
                disabled={savingProject}
                onClick={handleConfirmDirectInputSave}
              >
                {savingProject ? '저장 중...' : '저장'}
              </ModalButton>
            </ModalActions>
          </ModalCard>
        </ModalOverlay>
      )}

      {shareModalOpen && (
        <ShareLinkModal url={shareUrl} onClose={() => setShareModalOpen(false)} />
      )}

      {savedLicksModal && (
        <SavedLicksModal
          spanLabel={savedLicksModal.label}
          matches={savedLicksModal.matches}
          onClose={() => setSavedLicksModal(null)}
          songTempo={tempo}
          onShowInline={(lick) => {
            setInlineLick((prev) => (
              prev &&
              prev.lick.id === lick.id &&
              prev.systemIndex === savedLicksModal.anchorSystem &&
              prev.anchorBar === savedLicksModal.anchorBar
                ? null
                : {
                  lick,
                  systemIndex: savedLicksModal.anchorSystem,
                  anchorBar: savedLicksModal.anchorBar,
                }
            ));
          }}
          activeInlineLickId={
            inlineLick &&
            inlineLick.systemIndex === savedLicksModal.anchorSystem &&
            inlineLick.anchorBar === savedLicksModal.anchorBar
              ? inlineLick.lick.id
              : undefined
          }
        />
      )}


      {/* Native: song-list sidebar slides in from the left. Backdrop click
       *  or the close icon dismisses it. Mounted while animating in either
       *  direction so the slide-out transition plays out. */}
      {isNativeUi && sidebarT.mounted && (
        <SidebarBackdrop $entered={sidebarT.entered} onClick={() => setSidebarOpen(false)}>
          <SidebarPanel $entered={sidebarT.entered} onClick={(e) => e.stopPropagation()}>
            <SidebarHeader>
              <SidebarIconBtn type="button" onClick={() => setSidebarOpen(false)} aria-label="닫기">
                <SidebarIcon />
              </SidebarIconBtn>
              <SidebarTitle>노래</SidebarTitle>
            </SidebarHeader>
            <SidebarSearch>
              <SidebarSearchInput
                placeholder="검색"
                value={sidebarQuery}
                onChange={(e) => setSidebarQuery(e.target.value)}
              />
            </SidebarSearch>
            <SidebarList>
              {(() => {
                const q = sidebarQuery.trim().toLowerCase();
                const filter = (s: string) => !q || s.toLowerCase().includes(q);
                const items: { id: string; title: string; composer: string; meta?: string }[] = [];
                if (filter('all of me') || filter('analyzed')) {
                  items.push({ id: ANALYZED_SONG_ID, title: 'All of Me (Analyzed)', composer: 'Gerald Marks' });
                }
                for (const song of songIndex) {
                  if (filter(song.title) || filter(song.composer)) {
                    items.push({
                      id: String(song.index),
                      title: song.title,
                      composer: song.composer,
                      meta: [song.style, song.key].filter(Boolean).join(' · '),
                    });
                  }
                }
                return items.map((it) => (
                  <SongRow
                    key={it.id}
                    type="button"
                    $active={songId === it.id}
                    onClick={() => { setSongId(it.id); setSidebarOpen(false); }}
                  >
                    <SongTitle>{it.title}</SongTitle>
                    <SongComposer>{it.composer}</SongComposer>
                    {it.meta && <SongMeta><span>{it.meta}</span></SongMeta>}
                  </SongRow>
                ));
              })()}
            </SidebarList>
          </SidebarPanel>
        </SidebarBackdrop>
      )}

      {/* Native: AI chat opens as a sliding side window (not the resizable
       *  right panel). Tapping the backdrop or × closes it. */}
      {isNativeUi && chatT.mounted && (
        <ChatWindowOverlay $entered={chatT.entered} onClick={() => setChatOpen(false)}>
          <ChatWindowCard $entered={chatT.entered} onClick={(e) => e.stopPropagation()}>
            <ChatWindowHeader>
              <ChatWindowTitle>AI 채팅</ChatWindowTitle>
              <ChatWindowClose type="button" onClick={() => setChatOpen(false)}>×</ChatWindowClose>
            </ChatWindowHeader>
            <ChatWindowBody>
              <RightChatPanel
                hideHeader
                chartKind="chord"
                projectPublicId={chatProjectId}
                restoreChatId={restoreChatId}
                selectedChords={selectedChordsData}
                groupExplanation={selectedChordsData.length > 0 ? '이 구간이 다음 질문의 분석 대상으로 포함됩니다.' : null}
                songTitle={sheet?.title ?? 'Jazzify AI'}
                chordContext={chordContext}
                isSelectionMode={isSelectionMode}
                onToggleSelectionMode={toggleSelectionMode}
                onClearSelectedChords={clearSelectedChords}
                songTempo={tempo}
              />
            </ChatWindowBody>
          </ChatWindowCard>
        </ChatWindowOverlay>
      )}

      {/* Native: mixer opens as a bottom sheet. */}
      {isNativeUi && mixerSheetT.mounted && (
        <SheetBackdrop $entered={mixerSheetT.entered} onClick={() => setMixerSheetOpen(false)}>
          <SheetCard $entered={mixerSheetT.entered} onClick={(e) => e.stopPropagation()}>
            <SheetHandle />
            <SheetHeader>
              <SheetTitle>믹서</SheetTitle>
              <SheetDone type="button" onClick={() => setMixerSheetOpen(false)}>완료</SheetDone>
            </SheetHeader>
            <SheetBody>
              <BackingMixer
                inlineLick
                breakEditMode={breakEditMode}
                onToggleBreakEdit={() => setBreakEditMode((v) => !v)}
                loopEditMode={loopEditMode}
                onToggleLoopEdit={handleToggleLoopEdit}
                loopRegion={loopRegion}
                onClearLoop={handleClearLoop}
              />
            </SheetBody>
          </SheetCard>
        </SheetBackdrop>
      )}

    </PageContainer>
  );
}
