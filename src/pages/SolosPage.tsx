import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled, { keyframes, css } from 'styled-components';
import { mq, tint } from '../styles/theme';
import { exportScoreSvgToPdf } from '../lib/note/scoreToPdf';
import { AppSidebar } from '../components/layout/AppSidebar';
import { NoteSheet, type NoteSheetHandle } from '../components/notesheet/NoteSheet';
import { BpmControl, RepeatControl, TransportButtons, MixerButton, GenreSelect } from '../components/backing/BackingPlayerBar';
import { KeyControl } from '../components/leadsheet/LeadSheet';
import { useGlobalPlayer } from '../lib/player';
import { parseXmlString, parseMxlArrayBuffer, sortPartsByMelody, type ScorePart } from '../lib/note/xmlMelodyParser';
import { parseMidiArrayBuffer } from '../lib/note/midiMelodyParser';
import type { NoteSheetData, SheetStaff } from '../data/sampleMelody';
import {
  deleteSolo,
  listSolos,
  listSoloPerformers,
  getSolo,
  updateSolo,
  createSolo,
  createSoloViaOMR,
  getSoloOmrStatus,
  toWeimarKey,
  type SoloDraft,
  type SoloFacet,
  type SoloResponse,
} from '../api/solos';
import { useNotification } from '../contexts/NotificationContext';
import { buildMergedSoloDraft } from '../lib/mergeSolos';
import { OMRUploadModal } from '../components/common/OMRUploadModal';
import { RawJsonModal } from '../components/common/RawJsonModal';
import {
  listQueueLog, effectiveStatus, clearQueueLog,
  type QueueLogEntry,
} from '../lib/soloOmrQueueLog';
import {
  subscribeOmrQueue, getOmrQueueState, enqueueOmrFiles, enqueueMoreFiles,
  dismissOmrQueueItem, dismissOmrQueueAll, pauseOmrQueue, resumeOmrQueue,
  retryOmrQueueItem, resumeOmrQueueFromDisk, type OmrQueueItem,
} from '../lib/soloOmrQueue';
import { useIsStudio } from '../lib/surface';
import { BackButton } from '../components/common/BackButton';
import type { OMRMetadata } from '../api/licks';
import {
  transposeLick,
  normalizeKeyInput,
  formatKeyDisplay,
} from '../lib/transpose';
import { showLyricsDefault, getChartLyrics, setChartLyrics } from '../lib/pagePrefs';
import { usePref } from '../lib/prefsStore';
import { maxVerseCount } from '../lib/note/lyricLayout';
import {
  ALL_KEYS_MAJOR,
  ALL_KEYS_MINOR,
  noteKeyIsMinor,
  normalizeNoteKeyDisplay,
  transposeNoteSheet,
  respellNoteSheetKey,
} from '../lib/note/transposeNoteSheet';
import { bakeExplicitAccidentals } from '../lib/note/resolvePitches';
import type { LickEntry } from '../data/lickData';


/* Large page size because the backend currently ignores the `performer`
 * query filter — we have to receive every solo and filter client-side, so
 * smaller pages would leave the target performer's rows on later pages
 * and show "no results" by accident. Safe while the catalog is small. */
const PAGE_SIZE = 500;

/* ─── styled ─────────────────────────────────────────────────────────── */

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
`;

const MainArea = styled.div`
  display: flex;
  flex: 1;
  overflow: hidden;
`;

const CenterColumn = styled.div`
  display: flex;
  flex: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
`;

const ToolBar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  /* 세로 여백을 넉넉히 — 연주자명 아래 개수까지 2줄이 들어간다. */
  padding: 12px 16px;
  background: ${({ theme }) => theme.colors.barTop};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  flex-wrap: wrap;

  ${mq.mobile} {
    gap: 6px;
    padding: 10px 10px;
  }
`;

/* 인트로(연주자 디렉터리) 헤더 — 제목이 맨 위, 그 옆에 생성 버튼들. */
const IntroHead = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  flex-wrap: wrap;
`;

const IntroTitle = styled.h1`
  margin: 0;
  font-family: 'Pretendard', sans-serif;
  font-size: 1.3rem;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const IntroActions = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

/* 연주자명 + 개수 세로 스택 (개수가 연주자 바로 아래 오도록). */
const PerformerBlock = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
`;

const PerformerCount = styled.span`
  font-size: 0.74rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
`;

/* 좌측 컬럼 — 독립 검색 박스 + 목록 카드를 세로로 쌓는다.
 * (폭은 SplitArea 의 grid 트랙이 정한다.) */
const ListColumn = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  min-height: 0;

  /* 목록 카드가 남는 세로 공간을 채우도록. */
  > *:last-child { flex: 1; min-height: 0; }
`;

/* 목록과 분리된 독립 검색 박스 — 목록 바로 위.
 * 새로고침 버튼이 박스 '안' 오른쪽 끝에 들어간다. */
const SearchBox = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  padding: 5px 10px;

  input {
    flex: 1;
    min-width: 0;
    border: none;
    background: transparent;
    padding: 2px 0;
    &:focus { border: none; outline: none; }
  }
`;

/* 검색 박스 + 새로고침을 나란히 — 새로고침은 박스 '밖'의 독립 버튼. */
const SearchRow = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SearchInput = styled.input`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  padding: 3px 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.textSecondary}; }
  &::placeholder { color: ${({ theme }) => theme.colors.textSecondary}; opacity: 0.6; }
`;

/* 폰 팝오버 브레이크포인트 — 상단 헤더 스택 전환과 동일 폭. */
const HEADER_PHONE_POPOVER = '@media (max-width: 820px)';

const RefreshBtn = styled.button<{ $big?: boolean }>`
  font-family: 'Pretendard', sans-serif;
  font-size: ${({ $big }) => ($big ? '0.9rem' : '0.78rem')};
  font-weight: ${({ $big }) => ($big ? 600 : 400)};
  padding: ${({ $big }) => ($big ? '8px 15px' : '3px 10px')};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  &:hover { border-color: ${({ theme }) => theme.colors.gold}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const OMRBtn = styled.button`
  margin-left: auto;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  font-weight: 600;
  padding: 6px 14px;
  border: none;
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.inkSurface};
  color: ${({ theme }) => theme.colors.onInk};
  cursor: pointer;
  &:hover { opacity: 0.9; }
`;

/* MusicXML/MIDI 가져오기 모달. */
const ImportOverlay = styled.div`
  position: fixed; inset: 0; z-index: 120;
  background: ${({ theme }) => theme.colors.scrim};
  display: flex; align-items: center; justify-content: center;
`;
const ImportBox = styled.div`
  width: 560px; max-width: 92vw; max-height: 84vh; overflow-y: auto;
  background: ${tint('#fffdf7', 'rgba(224, 184, 88, 0.10)')}; border-radius: 12px; padding: 22px 24px;
  font-family: 'Pretendard', sans-serif;
  display: flex; flex-direction: column; gap: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.25);
  h3 { margin: 0; font-size: 1.08rem; }
  .sub { margin: 0; font-size: 0.82rem; line-height: 1.5; color: ${({ theme }) => theme.colors.textSecondary}; }
`;
const ImportFileRow = styled.div`
  input { font-size: 0.85rem; }
`;
const ImportDivider = styled.div`
  font-size: 0.75rem; color: ${({ theme }) => theme.colors.textSecondary}; text-align: center;
  display: flex; align-items: center; gap: 10px;
  &::before, &::after { content: ''; flex: 1; height: 1px; background: ${({ theme }) => theme.colors.surfaceSunken}; }
`;
const ImportTextarea = styled.textarea`
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.72rem; line-height: 1.4;
  min-height: 180px; resize: vertical;
  border: 1px solid ${({ theme }) => theme.colors.border}; border-radius: 8px; padding: 10px;
  outline: none;
  &:focus { border-color: #b8960a; }
`;
const ImportActions = styled.div`
  display: flex; justify-content: flex-end; gap: 8px;
`;
const ImportError = styled.div`
  font-size: 0.8rem; color: #c62828;
  background: rgba(198, 40, 40, 0.08); border-radius: 6px; padding: 8px 10px;
`;

const MergeDoBtn = styled.button<{ $big?: boolean }>`
  font-family: 'Pretendard', sans-serif;
  font-size: ${({ $big }) => ($big ? '0.9rem' : '0.78rem')};
  font-weight: 700;
  padding: ${({ $big }) => ($big ? '8px 15px' : '3px 12px')};
  border-radius: ${({ $big }) => ($big ? '6px' : '4px')};
  border: none;
  border-radius: 4px;
  background: #1f9a52;
  color: #fff;
  cursor: pointer;
  &:hover:not(:disabled) { background: #18803f; }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
`;

/* 내 코드 차트(ChordPage)의 ToolBtn 과 동일 — 테두리 없는 38x38 아이콘 버튼. */
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

  &:hover:not(:disabled) { background: ${({ theme }) => theme.colors.activeFill}; }
  &:disabled { opacity: 0.4; cursor: default; }
`;

/* Lick 구간 선택 버튼 — 장르/조성 드롭다운(GenreBtn·KeyButton)과 같은 크기·폰트. */
const LickModeBtn = styled.button<{ $on?: boolean }>`
  height: 32px;
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  font-family: 'Pretendard', sans-serif;
  font-size: 1.04rem;
  font-weight: 600;
  color: ${({ $on }) => ($on ? '#17773e' : '#1a1a1a')};
  background: ${({ $on }) => ($on ? 'rgba(31,154,82,0.10)' : '#fff')};
  border: 1.5px solid ${({ $on }) => ($on ? '#1f9a52' : '#ccc')};
  border-radius: 6px;
  padding: 0 12px;
  white-space: nowrap;
  cursor: pointer;
  &:hover { border-color: ${({ $on }) => ($on ? '#1f9a52' : '#888')}; }
`;

/* 구간 선택 모드 안내줄 — 프리뷰 헤더 바로 아래. */
const SelHintBar = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.76rem;
  color: #17773e;
  background: rgba(31, 154, 82, 0.08);
  border-bottom: 1px solid rgba(31, 154, 82, 0.25);
  padding: 5px 12px;
  flex-shrink: 0;
`;

/* 조성 패널 — 악보 헤더 바 바로 아래로 펼쳐진다 (Transpose / 조성만 변경). */
/* 버튼에 앵커된 팝오버 — 전체 폭 바가 아니라 해당 버튼 아래로 겹쳐 뜬다. */
const KeyPanelBar = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 45;
  min-width: 360px;
  max-width: calc(100vw - 32px);
  font-family: 'Pretendard', sans-serif;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.06);
  padding: 18px 20px 20px;
  display: flex;
  flex-direction: column;
  gap: 13px;
  /* 폰: 앵커(버튼) 기준 절대배치는 화면 밖으로 잘린다 → 화면 하단 중앙 고정 시트. */
  ${HEADER_PHONE_POPOVER} {
    position: fixed;
    left: 50%;
    right: auto;
    top: auto;
    bottom: 16px;
    transform: translateX(-50%);
    width: calc(100vw - 24px);
    min-width: 0;
    max-width: 420px;
    max-height: 70vh;
    overflow-y: auto;
  }
`;

const KeyPanelTitle = styled.div`
  font-size: 1.12rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

/* 음표 함께 이동 ｜ 키만 변경 — 예전 'Only key change' 버튼을 흡수한 세그먼트. */
const ModeSwitch = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  padding: 3px;
  border-radius: 9px;
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

const ModeTab = styled.button<{ $on?: boolean }>`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.9rem;
  font-weight: 700;
  padding: 8px 6px;
  border: 1.5px solid ${({ $on }) => ($on ? '#1f9a52' : 'transparent')};
  border-radius: 7px;
  background: ${({ $on, theme }) => ($on ? theme.colors.bgPrimary : 'transparent')};
  color: ${({ $on, theme }) => ($on ? '#17773e' : theme.colors.textSecondary)};
  cursor: pointer;
`;

const ModeHint = styled.div`
  font-size: 0.8rem;
  line-height: 1.45;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

/* Lick 구간 선택 드롭다운 — 버튼 아래로 겹쳐 뜨는 모달성 패널. */
const LickPanel = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 46;
  min-width: 300px;
  max-width: calc(100vw - 32px);
  font-family: 'Pretendard', sans-serif;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18), 0 2px 6px rgba(0, 0, 0, 0.06);
  padding: 16px 18px 18px;
  display: flex;
  flex-direction: column;
  gap: 11px;
  /* 폰: 앵커(버튼) 기준 절대배치는 화면 밖으로 잘린다 → 화면 하단 중앙 고정 시트. */
  ${HEADER_PHONE_POPOVER} {
    position: fixed;
    left: 50%;
    right: auto;
    top: auto;
    bottom: 16px;
    transform: translateX(-50%);
    width: calc(100vw - 24px);
    min-width: 0;
    max-width: 420px;
    max-height: 70vh;
    overflow-y: auto;
  }
`;

const LickPanelHint = styled.div`
  font-size: 0.8rem;
  line-height: 1.5;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const LickPanelCount = styled.div`
  font-size: 0.9rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

/* 버튼 + 팝오버 앵커 래퍼. */
const KeyAnchor = styled.div`
  position: relative;
  display: inline-flex;
`;

const KeyPanelRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;

const KeyFromChip = styled.span`
  font-size: 0.92rem;
  font-weight: 700;
  padding: 6px 12px;
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const KeyInput = styled.input`
  flex: 1;
  min-width: 100px;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.92rem;
  font-weight: 600;
  padding: 7px 11px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.gold}; }
`;

const KeyPresetBtn = styled.button`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.86rem;
  font-weight: 600;
  text-align: left;
  padding: 9px 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s;

  small { color: ${({ theme }) => theme.colors.textSecondary}; font-weight: 500; margin-left: 4px; }
  &:hover:not(:disabled) { border-color: ${({ theme }) => theme.colors.gold}; background: ${({ theme }) => theme.colors.bgSecondary}; }
  &:disabled { opacity: 0.5; cursor: default; }
`;

/* Ordered pick indicator shown on each row while merging. */
const MergeCheck = styled.span<{ $picked?: boolean }>`
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 0.78rem;
  font-weight: 700;
  border: 2px solid ${({ $picked, theme }) => ($picked ? '#1f9a52' : theme.colors.border)};
  background: ${({ $picked }) => ($picked ? '#1f9a52' : 'transparent')};
  color: ${({ $picked }) => ($picked ? '#fff' : 'transparent')};
`;

const SplitArea = styled.div<{ $single?: boolean }>`
  display: grid;
  /* 좌측(검색+목록) 폭을 380 → 320 으로 줄였다. */
  grid-template-columns: ${({ $single }) => ($single ? '1fr' : '360px minmax(0, 1fr)')};
  gap: 12px;
  padding: 12px 16px;
  flex: 1;
  min-height: 0;
  overflow: hidden;

  ${mq.mobile} {
    grid-template-columns: 1fr;
  }
`;

const ListCard = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  overflow: hidden;
`;

const ListBody = styled.div`
  flex: 1;
  overflow-y: auto;
`;

const Row = styled.div<{ $active?: boolean; $merge?: boolean }>`
  position: relative;
  display: grid;
  grid-template-columns: ${({ $merge }) => ($merge ? 'auto minmax(0, 1fr)' : 'minmax(0, 1fr)')};
  gap: 8px;
  align-items: center;
  padding: 9px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  /* 현재 열려 있는 악보는 굵은 링 + 살짝 진한 배경으로 확실히 구분한다. */
  background: ${({ $active }) => ($active ? 'rgba(31,154,82,0.09)' : 'transparent')};
  box-shadow: ${({ $active }) => ($active ? 'inset 0 0 0 2.5px rgba(31,154,82,0.6)' : 'none')};
  cursor: pointer;
  font-family: 'Pretendard', sans-serif;
  &:hover {
    background: ${({ $active, theme }) => ($active ? 'rgba(31,154,82,0.13)' : theme.colors.bgPrimary)};
  }
  &:last-child { border-bottom: 0; }
`;

const RowMain = styled.div`
  min-width: 0;
  /* 우측 상단 아이콘과 겹치지 않게 제목 줄만 여백 확보. */
  > *:first-child { padding-right: 100px; }
`;

/* 행 우측 상단 아이콘 묶음 — 테두리·배경 없이 아이콘만. */
const RowIcons = styled.div`
  position: absolute;
  top: 6px;
  right: 8px;
  display: flex;
  align-items: center;
  gap: 2px;
  z-index: 1;
`;

const RowIconBtn = styled.button`
  width: 30px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  border-radius: 5px;
  transition: color 0.12s, background 0.12s, opacity 0.12s;

  &:hover:not(:disabled) {
    color: ${({ theme }) => theme.colors.textPrimary};
    background: ${({ theme }) => theme.colors.activeFill};
  }
  &:disabled { opacity: 0.4; cursor: default; }
  svg { display: block; }
`;

const RowTitle = styled.div`
  font-weight: 700;
  font-size: 1rem;
  letter-spacing: -0.01em;
  color: ${({ theme }) => theme.colors.textPrimary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/* 연주자 — 제목 바로 아래 (아이패드 iReal 목록 스타일). */
const RowPerformer = styled.div`
  font-size: 0.88rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

/* 스타일(좌) · bpm + 조성(우) — 흐린 한 줄. */
const RowMetaLine = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-top: 3px;
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textSecondary};

  .style { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .right {
    margin-left: auto;
    display: inline-flex;
    align-items: baseline;
    gap: 14px;
    flex: 0 0 auto;
    font-variant-numeric: tabular-nums;
  }
  .bpm { display: inline-flex; align-items: baseline; gap: 3px; }
  b { font-weight: 600; color: ${({ theme }) => theme.colors.textSecondary}; }
  em { font-style: normal; min-width: 1.6em; text-align: right; }
`;


/* Performer directory (shown before a performer is picked). */
const PerformerRow = styled.button`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 11px 14px;
  border: none;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: transparent;
  cursor: pointer;
  font-family: 'Pretendard', sans-serif;
  color: ${({ theme }) => theme.colors.textPrimary};
  transition: background 0.12s;
  &:hover { background: ${({ theme }) => theme.colors.bgPrimary}; }
  &:last-child { border-bottom: 0; }
`;

const PerformerName = styled.span`
  font-weight: 600;
  font-size: 0.92rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const CountBadge = styled.span`
  flex-shrink: 0;
  font-size: 0.74rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 999px;
  padding: 2px 9px;
`;

/* 전체 연주자로 돌아가기 — 글자 없이 1:1 정사각 라운드 블록(화살표만). */

/* 새로고침 — 배경 없는 작은 아이콘 버튼. */
const IconRefreshBtn = styled.button<{ $spinning?: boolean }>`
  width: 32px;
  height: 32px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  transition: color 0.12s, opacity 0.12s;

  &:hover:not(:disabled) { color: ${({ theme }) => theme.colors.textPrimary}; }
  &:disabled { opacity: 0.5; cursor: default; }

  svg { animation: ${({ $spinning }) => ($spinning ? 'soloRefreshSpin 0.9s linear infinite' : 'none')}; }
  @keyframes soloRefreshSpin { to { transform: rotate(360deg); } }
`;

/* ── 공용 액션 아이콘 (악보 바 버튼 · 목록 행에서 같은 모양을 쓴다) ────── */
/* ── 내 코드 차트와 동일 규격(26px · stroke 2)의 바 아이콘 ─────────────── */
const IcoInfo = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" />
  </svg>
);
const IcoPencil = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);
const IcoDownload = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
/** 가사 아이콘 — 음표 + 그 아래 글줄(가사 행)을 형상화. */
const IcoLyrics = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7" cy="8" r="2.6" fill="currentColor" stroke="none" />
    <path d="M9.6 8V3.2l5.4-1.1V7" />
    <circle cx="17.6" cy="7" r="2.6" fill="currentColor" stroke="none" />
    <path d="M4 15.5h16" /><path d="M4 19.5h11" />
  </svg>
);
const IcoTranspose = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="17 3 21 7 17 11" /><path d="M21 7H8a4 4 0 0 0-4 4" />
    <polyline points="7 21 3 17 7 13" /><path d="M3 17h13a4 4 0 0 0 4-4" />
  </svg>
);
const IcoTrash = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" /><path d="M14 11v6" />
  </svg>
);

/* 목록 행의 미니 아이콘(연필·다운로드·휴지통). */
const PencilGlyph = ({ s = 13 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);
const DownloadGlyph = ({ s = 13 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);
/* { } — 응답값 받기(admin 디버깅). */
const JsonGlyph = ({ s = 13 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M9 4H8a2 2 0 0 0-2 2v3a2 2 0 0 1-2 2 2 2 0 0 1 2 2v3a2 2 0 0 0 2 2h1" />
    <path d="M15 4h1a2 2 0 0 1 2 2v3a2 2 0 0 0 2 2 2 2 0 0 0-2 2v3a2 2 0 0 1-2 2h-1" />
  </svg>
);
const TrashGlyph = ({ s = 13 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

/* 조성 변경 팝오버 — Transpose 아이콘 아래로 겹쳐 뜨는 모달성 드롭다운.
 * 예전의 'Only key change' 버튼을 여기 모드 선택으로 합쳤다:
 *   음표 함께 이동 = 실제 이조 / 키만 변경 = 표기만 교체(파싱 교정용).
 * 이조악기 프리셋(E♭→C, B♭→C)은 '음표 함께 이동' 에서만 활성. */
function KeyChangePopover({
  currentKey, value, onChange, onApplyTranspose, onApplyKeyOnly, onPreset, onClose, busy,
}: {
  currentKey: string;
  value: string;
  onChange: (v: string) => void;
  onApplyTranspose: () => void;
  onApplyKeyOnly: () => void;
  onPreset: (semitones: number) => void;
  onClose: () => void;
  busy: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'notes' | 'keyOnly'>('notes');
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      // 버튼 자체 클릭은 토글이 처리 — 팝오버 밖이면 닫는다.
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const apply = () => { if (mode === 'notes') onApplyTranspose(); else onApplyKeyOnly(); };

  return (
    <KeyPanelBar ref={ref} role="dialog">
      <KeyPanelTitle>Transpose</KeyPanelTitle>
      <ModeSwitch role="tablist">
        <ModeTab type="button" $on={mode === 'notes'} onClick={() => setMode('notes')}>
          음표 함께 이동
        </ModeTab>
        <ModeTab type="button" $on={mode === 'keyOnly'} onClick={() => setMode('keyOnly')}>
          키만 변경
        </ModeTab>
      </ModeSwitch>
      <ModeHint>
        {mode === 'notes'
          ? '조표와 음표를 함께 옮긴다 — 실제 이조.'
          : '음표는 그대로 두고 조성 표기만 교체한다 (파싱 교정용).'}
      </ModeHint>
      <KeyPanelRow>
        <KeyFromChip>{currentKey}</KeyFromChip>
        <span aria-hidden>→</span>
        <KeyInput
          autoFocus
          placeholder="예: Bb, F#m"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && value.trim()) apply(); }}
        />
        <MergeDoBtn type="button" $big disabled={!value.trim() || busy} onClick={apply}>적용</MergeDoBtn>
      </KeyPanelRow>

      <KeyPresetBtn type="button" disabled={busy || mode !== 'notes'} onClick={() => onPreset(3)}>
        E♭ → C 로 이조하기 <small>(알토 색소폰 · +3)</small>
      </KeyPresetBtn>
      <KeyPresetBtn type="button" disabled={busy || mode !== 'notes'} onClick={() => onPreset(-2)}>
        B♭ → C 로 이조하기 <small>(테너 색소폰 · 트럼펫 · −2)</small>
      </KeyPresetBtn>
    </KeyPanelBar>
  );
}

/** 백엔드 style/genre 는 대문자 enum(BEBOP) — 표시용 Title Case 로. */
function formatStyleLabel(v: string | undefined | null): string {
  if (!v) return '';
  return v.trim().toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** WJD(Weimar Jazz Database) 악기 축약코드 → 사람이 읽는 이름.
 *  솔로 DB 의 instrument 는 'as'(alto sax)·'p'(piano) 같은 WJD 코드다. */
const INSTRUMENT_NAMES: Record<string, string> = {
  as: 'Alto Sax', ts: 'Tenor Sax', ss: 'Soprano Sax', bs: 'Baritone Sax',
  cl: 'Clarinet', bcl: 'Bass Clarinet', fl: 'Flute',
  tp: 'Trumpet', ptp: 'Pocket Trumpet', cor: 'Cornet', flgh: 'Flugelhorn',
  tb: 'Trombone', frh: 'French Horn', tu: 'Tuba',
  p: 'Piano', org: 'Organ', g: 'Guitar', vib: 'Vibraphone',
  b: 'Bass', eb: 'Electric Bass', d: 'Drums', dr: 'Drums',
  voc: 'Vocal', vln: 'Violin',
};
function formatInstrument(v: string | undefined | null): string {
  if (!v) return '—';
  const key = v.trim().toLowerCase();
  if (key === 'unknown' || key === '') return 'Unknown';
  return INSTRUMENT_NAMES[key] ?? formatStyleLabel(v);
}

/** ISO 문자열 → '2026년 5월 16일' (백엔드가 createdAt 을 주므로 프론트만으로 표시). */
function formatAddedDate(iso: string | undefined | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' });
}

const PC_BY_LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const PC_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
function shiftKeyBySemitones(weimarKey: string, semitones: number): string | null {
  const disp = formatKeyDisplay(weimarKey).trim();     // 'F' | 'Gm'
  const m = /^([A-G])([#b]?)(m?)$/i.exec(disp);
  if (!m) return null;
  const base = PC_BY_LETTER[m[1].toUpperCase()];
  if (base == null) return null;
  const pc = (base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12;
  const next = (((pc + semitones) % 12) + 12) % 12;
  return normalizeKeyInput(PC_NAMES_FLAT[next] + (m[3] ? 'm' : ''));
}

const CurrentPerformer = styled.span`
  font-weight: 700;
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const PreviewCard = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  overflow: hidden;
`;

/* 좌(릭 구간 선택) / 중앙(믹서·BPM·트랜스포트) / 우(Edit~Delete) 3분할.
 * 1fr auto 1fr 이라야 가운데 묶음이 바 정중앙에 온다. */
/* 데스크톱: 좌(장르·키·릭) / 중앙(믹서·BPM·재생) / 우(아이콘) 3분할.
 * 중앙은 아래 악보 제목과 같은 '바 정중앙'에 절대배치로 고정한다.
 * 모바일(≤820px): 절대배치를 풀고 세 그룹을 세로로 쌓아 아무것도 잘리지 않게 한다. */
const HEADER_PHONE = '@media (max-width: 820px)';
const PreviewHeader = styled.div`
  position: relative;   /* 메타 드롭다운의 기준 */
  /* 헤더를 본문(PreviewBody)보다 위 레이어로 올린다. 헤더의 드롭다운들
   * (조성 팝오버 45 · Lick 구간 46 · 메타 40)이 악보 내부의 z-index
   * (NoteSheet KeyMenu 100 등)보다 낮아 악보 뒤로 숨던 문제 수정.
   * 본문도 z-index:0 으로 스택 컨텍스트를 만들어 내부 z-index 를 가둔다. */
  z-index: 5;
  padding: 6px 14px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 36px;

  ${HEADER_PHONE} {
    flex-wrap: wrap;
    row-gap: 8px;
    padding: 10px 12px;
  }
`;

const BarLeft = styled.div`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
  /* 좌·우 그룹이 중앙 절대배치 묶음 위로 겹치지 않도록 절반 폭 이내로 제한. */
  max-width: calc(50% - 130px);

  ${HEADER_PHONE} {
    max-width: none;
    flex: 1 1 100%;
    justify-content: flex-start;
  }
`;

const BarCenter = styled.div`
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;

  ${HEADER_PHONE} {
    position: static;
    transform: none;
    flex: 1 1 100%;
    flex-wrap: wrap;
    justify-content: flex-start;
  }
`;

const BarRight = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 7px;
  min-width: 0;
  max-width: calc(50% - 130px);
  margin-left: auto;

  ${HEADER_PHONE} {
    max-width: none;
    flex: 1 1 100%;
    justify-content: flex-start;
    margin-left: 0;
  }
`;

/* ⓘ 클릭 시 열리는 메타데이터 — 레이아웃을 밀지 않고 위로 겹쳐 뜨는 드롭다운. */
const MetaPanel = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 14px;
  z-index: 40;
  min-width: 300px;
  max-width: calc(100vw - 32px);
  font-family: 'Pretendard', sans-serif;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.06);
  padding: 11px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  /* 폰: 앵커(버튼) 기준 절대배치는 화면 밖으로 잘린다 → 화면 하단 중앙 고정 시트. */
  ${HEADER_PHONE_POPOVER} {
    position: fixed;
    left: 50%;
    right: auto;
    top: auto;
    bottom: 16px;
    transform: translateX(-50%);
    width: calc(100vw - 24px);
    min-width: 0;
    max-width: 420px;
    max-height: 70vh;
    overflow-y: auto;
  }
`;

const MetaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 0.8rem;

  > span:first-child {
    flex: 0 0 64px;
    color: ${({ theme }) => theme.colors.textSecondary};
  }
  > b {
    font-weight: 600;
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

const MetaIdValue = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;

  code {
    font-family: 'JetBrains Mono', 'Menlo', monospace;
    font-size: 0.72rem;
    color: ${({ theme }) => theme.colors.textSecondary};
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

const MetaCopyBtn = styled.button<{ $copied?: boolean }>`
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.72rem;
  padding: 0;
  border: 1px solid ${({ theme, $copied }) => ($copied ? '#2a7a4a' : theme.colors.border)};
  border-radius: 5px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ $copied, theme }) => ($copied ? '#2a7a4a' : theme.colors.textSecondary)};
  cursor: pointer;
  transition: border-color 0.12s, color 0.12s;

  &:hover { border-color: ${({ theme }) => theme.colors.gold}; }
`;

const PreviewBody = styled.div`
  flex: 1;
  min-height: 0;
  overflow: auto;
  /* 스택 컨텍스트 — 악보 내부의 z-index(KeyMenu 100 등)를 이 안에 가둬
   * 헤더 드롭다운(위 레이어)을 덮지 못하게 한다. */
  position: relative;
  z-index: 0;
  background: ${({ theme }) => theme.colors.bgPrimary};
`;

const EmptyState = styled.div`
  padding: 28px 16px;
  text-align: center;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.85rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Sentinel = styled.div`
  height: 1px;
`;

const ErrorBanner = styled.div`
  margin: 10px 16px 0;
  padding: 8px 12px;
  border: 1px solid #e08080;
  border-radius: 6px;
  background: ${tint('#fdecea', 'rgba(240, 113, 103, 0.13)')};
  color: ${({ theme }) => theme.colors.danger};
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
`;

/* ─── OMR status panel ──────────────────────────────────────────────────
 * A persistent, always-visible panel (bottom-right) that shows every
 * in-flight / just-finished OMR solo job in real time: 인식 중 → 완료 / 오류.
 * Fed by the background OMR flow (createSoloViaOMR promise) and, when the
 * backend /omr-status endpoint is available, live progress polling. */

const spin = keyframes`to { transform: rotate(360deg); }`;
/* Indeterminate sweep for the progress track while OMR is running and the
 * backend reports no numeric progress (0). */
const indeterminate = keyframes`
  0%   { left: -35%; width: 35%; }
  60%  { left: 100%; width: 35%; }
  100% { left: 100%; width: 35%; }
`;

const OmrPanel = styled.div`
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: ${({ theme }) => theme.zIndex.toast};
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(340px, calc(100vw - 32px));
  ${mq.mobile} { right: 10px; bottom: 10px; }
`;

const OmrCard = styled.div<{ $status: SoloOmrJobStatus }>`
  border: 1px solid
    ${({ $status }) =>
      $status === 'FAILED' ? '#e0a0a0' : $status === 'COMPLETED' ? '#a3d9b8' : '#e6d3a0'};
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  box-shadow: ${({ theme }) => theme.shadows.md};
  padding: 12px 14px;
  font-family: 'Pretendard', sans-serif;
`;

const OmrTop = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const OmrIcon = styled.span<{ $status: SoloOmrJobStatus }>`
  flex: none;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 0.85rem;
  ${({ $status }) =>
    $status === 'PROCESSING' &&
    css`
      border: 2px solid rgba(180, 134, 11, 0.25);
      border-top-color: #B8860B;
      border-radius: 50%;
      animation: ${spin} 0.8s linear infinite;
    `}
  color: ${({ $status }) => ($status === 'FAILED' ? '#c0392b' : $status === 'COMPLETED' ? '#1f9a52' : 'inherit')};
`;

const OmrLabel = styled.div`
  flex: 1;
  min-width: 0;
  font-size: 0.85rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const OmrDismiss = styled.button`
  flex: none;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 1.05rem;
  line-height: 1;
  cursor: pointer;
  padding: 2px 4px;
  &:hover { color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const OmrStatusText = styled.div<{ $status: SoloOmrJobStatus }>`
  margin-top: 6px;
  font-size: 0.78rem;
  color: ${({ $status, theme }) =>
    $status === 'FAILED' ? '#c0392b' : $status === 'COMPLETED' ? '#17773e' : theme.colors.textSecondary};
  word-break: break-word;
`;

const OmrBar = styled.div`
  position: relative;
  margin-top: 8px;
  height: 5px;
  border-radius: 3px;
  background: rgba(180, 134, 11, 0.14);
  overflow: hidden;
`;

const OmrBarFill = styled.div<{ $progress: number }>`
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 3px;
  background: #B8860B;
  ${({ $progress }) =>
    $progress > 0
      ? css`left: 0; width: ${Math.min(100, Math.max(0, $progress))}%; transition: width 0.4s ease;`
      : css`animation: ${indeterminate} 1.3s ease-in-out infinite;`}
`;

const OmrOpenBtn = styled.button`
  margin-top: 10px;
  width: 100%;
  padding: 7px 0;
  border: none;
  border-radius: 6px;
  background: #1f9a52;
  color: #fff;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
  &:hover { background: #18803f; }
`;

/* ── 통합 OMR 큐 카드 (대량 직렬 파이프라인 집계) ─────────────────────── */
const QueueCard = styled.div`
  border: 1px solid #e6d3a0;
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 8px 26px rgba(0, 0, 0, 0.14);
  overflow: hidden;
  font-family: ${({ theme }) => theme.fonts.ui};
`;
const QueueHead = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 12px 10px;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
`;
const QueueHeadIcon = styled.span<{ $running: boolean }>`
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 800;
  ${({ $running }) => ($running
    ? css`
        border: 2.5px solid rgba(184, 134, 11, 0.25);
        border-top-color: #b8860b;
        animation: ${spin} 0.9s linear infinite;
      `
    : css`
        background: #1f9a52;
        color: #fff;
      `)}
`;
const QueueHeadMain = styled.span` flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; `;
const QueueHeadTitle = styled.span`
  display: flex; align-items: baseline; gap: 8px;
  font-size: 0.92rem; font-weight: 800; color: ${({ theme }) => theme.colors.textPrimary};
`;
const QueueHeadPct = styled.span` font-size: 0.78rem; font-weight: 700; color: #b8860b; `;
const QueueHeadFail = styled.span`
  font-size: 0.72rem; font-weight: 700; color: ${({ theme }) => theme.colors.danger};
  background: rgba(196, 92, 92, 0.12); padding: 1px 7px; border-radius: 999px;
`;
const QueueHeadSub = styled.span`
  font-size: 0.76rem; color: #8a7a52;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const QueueChevron = styled.span<{ $open: boolean }>`
  flex: none; color: #b09a5e; font-size: 15px; line-height: 1;
  transform: rotate(${({ $open }) => ($open ? 180 : 0)}deg);
  transition: transform 0.15s;
`;
/* 진행 바 — 완료(골드) + 오류(빨강) 구간을 이어 그린다. */
const QueueBarTrack = styled.div`
  position: relative; height: 6px; margin: 0 12px 12px;
  background: ${({ theme }) => theme.colors.activeFill}; border-radius: 3px; overflow: hidden;
`;
const QueueBarDone = styled.div<{ $pct: number }>`
  position: absolute; inset: 0 auto 0 0;
  width: ${({ $pct }) => $pct}%;
  background: linear-gradient(90deg, #d4a843, #b8860b);
  transition: width 0.4s ease;
`;
const QueueBarFailSeg = styled.div<{ $left: number; $pct: number }>`
  position: absolute; top: 0; bottom: 0;
  left: ${({ $left }) => $left}%;
  width: ${({ $pct }) => $pct}%;
  background: #c45c5c;
  transition: left 0.4s ease, width 0.4s ease;
`;
const QueueDetail = styled.div`
  max-height: 320px;
  overflow-y: auto;
  border-top: 1px solid #f0e6cc;
  padding: 6px;
  scrollbar-width: thin;
`;
const QueueDetailRow = styled.div<{ $status: SoloOmrJobStatus }>`
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 8px;
  border-radius: 9px;
  cursor: ${({ onClick }) => (onClick ? 'pointer' : 'default')};
  background: ${({ $status }) =>
    $status === 'PROCESSING' ? 'rgba(184, 134, 11, 0.10)'
    : $status === 'FAILED' ? 'rgba(196, 92, 92, 0.07)'
    : 'transparent'};
  ${({ onClick }) => (onClick ? css`&:hover { background: rgba(31, 154, 82, 0.08); }` : '')}
`;
const QueueRowIcon = styled.span<{ $status: SoloOmrJobStatus }>`
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10.5px;
  font-weight: 800;
  ${({ $status, theme }) => $status === 'PROCESSING'
    ? css`
        border: 2.5px solid rgba(184, 134, 11, 0.25);
        border-top-color: #b8860b;
        animation: ${spin} 0.9s linear infinite;
      `
    : $status === 'COMPLETED'
      ? css`background: #1f9a52; color: #fff;`
      : $status === 'FAILED'
        ? css`background: #c45c5c; color: #fff;`
        : css`background: ${theme.colors.activeFill}; color: ${theme.colors.textSecondary};`}
`;
const QueueRowMain = styled.span` flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; `;
const QueueRowName = styled.span`
  font-size: 0.82rem; font-weight: 600; color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const QueueRowInfo = styled.span<{ $fail?: boolean }>`
  font-size: 0.72rem;
  color: ${({ $fail }) => ($fail ? '#c0392b' : '#8a7a52')};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const QueueRowRemove = styled.button`
  flex: none; width: 20px; height: 20px; border: none; border-radius: 50%;
  background: transparent; color: ${({ theme }) => theme.colors.textSecondary}; font-size: 14px; line-height: 1; cursor: pointer;
  &:hover { background: rgba(196, 92, 92, 0.12); color: #c45c5c; }
`;
/* 진행 중 큐에 파일 추가 — 헤더의 둥근 ＋ 버튼과 상세 하단의 점선 행. */
const QueueAddBtn = styled.span`
  flex: none;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(184, 134, 11, 0.12);
  color: #8a6d1c;
  font-size: 15px;
  font-weight: 800;
  line-height: 1;
  cursor: pointer;
  &:hover { background: rgba(184, 134, 11, 0.22); }
`;
const QueueAddRow = styled.button`
  width: 100%;
  margin-top: 4px;
  padding: 8px 0;
  border: 1.5px dashed rgba(184, 134, 11, 0.35);
  border-radius: 9px;
  background: transparent;
  color: #8a6d1c;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.78rem;
  font-weight: 700;
  cursor: pointer;
  &:hover { background: rgba(184, 134, 11, 0.08); border-color: rgba(184, 134, 11, 0.55); }
`;
const HiddenQueueInput = styled.input`
  display: none;
`;

/* ── 큐 영속 기록 모달 (admin) ─────────────────────────────────────────── */
type QLogSt = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'INTERRUPTED';
const QLogBackdrop = styled.div`
  position: fixed; inset: 0; background: ${({ theme }) => theme.colors.scrim};
  z-index: ${({ theme }) => theme.zIndex.max};
  display: flex; align-items: center; justify-content: center; padding: 24px;
`;
const QLogCard = styled.div`
  width: min(560px, 100%); max-height: 84vh;
  display: flex; flex-direction: column;
  background: ${({ theme }) => theme.colors.surface}; border-radius: 16px; overflow: hidden;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  font-family: ${({ theme }) => theme.fonts.ui};
`;
const QLogHead = styled.div`
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 16px 18px 12px; border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;
const QLogTitle = styled.h2` margin: 0; font-size: 16px; font-weight: 800; color: ${({ theme }) => theme.colors.textPrimary}; `;
const QLogSummary = styled.div` display: flex; gap: 6px; margin-left: auto; `;
const QLogStat = styled.span<{ $tone?: 'ok' | 'fail' | 'warn' }>`
  font-size: 11.5px; font-weight: 700; padding: 3px 9px; border-radius: 999px;
  color: ${({ $tone }) => ($tone === 'ok' ? '#1f7a45' : $tone === 'fail' ? '#c0392b' : $tone === 'warn' ? '#8a6d1c' : '#666')};
  background: ${({ $tone }) => ($tone === 'ok' ? 'rgba(45,143,94,0.12)' : $tone === 'fail' ? 'rgba(196,92,92,0.12)' : $tone === 'warn' ? 'rgba(184,134,11,0.14)' : '#f1f1ef')};
`;
const QLogClose = styled.button`
  border: none; background: transparent; color: ${({ theme }) => theme.colors.textSecondary}; font-size: 20px; line-height: 1; cursor: pointer;
  &:hover { color: ${({ theme }) => theme.colors.textSecondary}; }
`;
const QLogHint = styled.div`
  margin: 10px 18px 0; padding: 9px 12px; border-radius: 9px;
  background: rgba(184, 134, 11, 0.08); color: #8a6d1c; font-size: 12px; line-height: 1.55;
  b { font-weight: 700; }
`;
const QLogList = styled.div`
  flex: 1; min-height: 0; overflow-y: auto; padding: 10px 12px; scrollbar-width: thin;
`;
const QLogEmpty = styled.div` padding: 28px 0; text-align: center; color: ${({ theme }) => theme.colors.textSecondary}; font-size: 13px; `;
const QLogRow = styled.div<{ $st: QLogSt }>`
  display: flex; align-items: center; gap: 10px;
  padding: 8px 8px; border-radius: 9px;
  background: ${({ $st }) =>
    $st === 'FAILED' ? 'rgba(196,92,92,0.06)'
    : $st === 'INTERRUPTED' ? 'rgba(184,134,11,0.07)'
    : 'transparent'};
`;
const QLogIcon = styled.span<{ $st: QLogSt }>`
  flex: none; width: 20px; height: 20px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10.5px; font-weight: 800; color: #fff;
  background: ${({ $st }) =>
    $st === 'COMPLETED' ? '#1f9a52'
    : $st === 'FAILED' ? '#c45c5c'
    : $st === 'INTERRUPTED' ? '#c9a13b'
    : $st === 'PROCESSING' ? '#b8860b'
    : '#c0c0c0'};
`;
const QLogMain = styled.div` flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; `;
const QLogName = styled.div`
  font-size: 13px; font-weight: 600; color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const QLogInfo = styled.div<{ $st: QLogSt }>`
  font-size: 11.5px; line-height: 1.4;
  color: ${({ $st }) => ($st === 'FAILED' ? '#c0392b' : $st === 'INTERRUPTED' ? '#8a6d1c' : '#999')};
  word-break: break-word;
`;
const QLogTime = styled.div` flex: none; font-size: 10.5px; color: ${({ theme }) => theme.colors.textSecondary}; white-space: nowrap; `;
const QLogFoot = styled.div`
  display: flex; justify-content: flex-end; padding: 10px 16px; border-top: 1px solid ${({ theme }) => theme.colors.border};
`;
const QLogClearBtn = styled.button`
  border: 1px solid ${({ theme }) => theme.colors.border}; background: ${({ theme }) => theme.colors.surface}; border-radius: 8px; padding: 6px 14px;
  font-size: 12px; font-weight: 600; color: ${({ theme }) => theme.colors.textSecondary}; cursor: pointer;
  &:hover { background: rgba(196, 92, 92, 0.07); color: ${({ theme }) => theme.colors.danger}; border-color: rgba(196, 92, 92, 0.35); }
`;

/** One OMR job tracked by the status panel. `progress` 0 ⇒ indeterminate bar. */
/** QUEUED = 대량 큐에서 자기 차례를 기다리는 중(직렬 — 앞 파일이 끝나야 시작). */
type SoloOmrJobStatus = 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

interface SoloOmrJob {
  id: string;
  label: string;
  status: SoloOmrJobStatus;
  progress: number;
  failureReason?: string | null;
  publicId?: string;
  solo?: SoloResponse;
  /** 다중 페이지 PDF: 완료/전체 페이지 수 (백엔드 omr-status, 문서 #23). */
  totalPages?: number | null;
  completedPages?: number | null;
}

/* ─── component ─────────────────────────────────────────────────────── */

export default function SolosPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { notify } = useNotification();
  /* selectedPerformer: '' = none chosen → show the performer directory.
   * Clicking a performer fetches that performer's solos. */
  const [performers, setPerformers] = useState<SoloFacet[]>([]);
  const [performersLoading, setPerformersLoading] = useState(true);
  const [performerQuery, setPerformerQuery] = useState('');
  const [selectedPerformer, setSelectedPerformer] = useState('');
  /* Instrument 드롭다운은 UI 에서 제거됨. 필터 로직은 휴면 상태로 남겨둔다
   * (항상 '' → no-op). 다시 노출할 때 셋터만 되살리면 된다. */
  const [filterInstrument] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  const refreshPerformers = useCallback(() => {
    setPerformersLoading(true);
    return listSoloPerformers()
      .then((facets) => {
        // backend already counts; sort by count desc then name for a stable directory
        const sorted = [...facets].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
        setPerformers(sorted);
      })
      .catch(() => { /* 실패 시 빈 목록 유지 */ })
      .finally(() => setPerformersLoading(false));
  }, []);

  useEffect(() => { void refreshPerformers(); }, [refreshPerformers]);

  const visiblePerformers = useMemo(() => {
    const q = performerQuery.trim().toLowerCase();
    return q ? performers.filter((p) => p.name.toLowerCase().includes(q)) : performers;
  }, [performers, performerQuery]);

  const [solos, setSolos] = useState<SoloResponse[]>([]);
  const [page, setPage] = useState(0);
  const [isLast, setIsLast] = useState(true);
  const [totalElements, setTotalElements] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copyId = useCallback((id: string) => {
    const done = () => {
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1200);
    };
    // navigator.clipboard needs a secure context; fall back to a temp textarea.
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(id).then(done).catch(() => {
        try {
          const ta = document.createElement('textarea');
          ta.value = id; ta.style.position = 'fixed'; ta.style.opacity = '0';
          document.body.appendChild(ta); ta.select(); document.execCommand('copy');
          document.body.removeChild(ta); done();
        } catch { /* ignore */ }
      });
    }
  }, []);
  const [previewKey, setPreviewKey] = useState('C');
  /* Solo preview playback — count-in + global player live inside NoteSheet;
   * we drive it via its imperative handle and mirror its play/tempo state so
   * the transport (Play/Stop + BPM) can sit in the preview header (same wiring
   * NotePage uses; NoteSheet's own floating bar is hidden via hideTransport). */
  const noteSheetRef = useRef<NoteSheetHandle | null>(null);
  const [soloPlaying, setSoloPlaying] = useState(false);
  const [soloTempo, setSoloTempo] = useState(120);
  const handleSoloPlayPause = useCallback(() => { noteSheetRef.current?.togglePlay(); }, []);
  const handleSoloStop = useCallback(() => { noteSheetRef.current?.stop(); }, []);
  const handleSoloTempo = useCallback((n: number) => { noteSheetRef.current?.setTempo(n); }, []);
  const [busy, setBusy] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  /* 조성 패널 — 악보 바의 'Transpose' / '조성만 변경' 을 누르면 헤더 아래로 열린다.
   *   'transpose' : 음표까지 함께 이조 (기존 동작) + 이조악기 프리셋 제공
   *   'keyOnly'   : 음표·VexFlow 출력은 그대로 두고 조성 표기만 교체 (파싱 교정용) */
  const [keyPanel, setKeyPanel] = useState<null | 'transpose' | 'keyOnly'>(null);
  /* ── 가사 표시 ─────────────────────────────────────────────────────────
   * 곡마다 가사가 필요할 수도, 아닐 수도 있어 **악보별 오버라이드**를 우선하고
   * 없으면 전역 기본값을 따른다. 버튼은 가사가 실제로 있는 악보에만 뜬다. */
  const [lyricsDefault] = usePref(showLyricsDefault);
  const [lyricsOverride, setLyricsOverride] = useState<boolean | undefined>(undefined);
  const [keyInput, setKeyInput] = useState('');
  /* 제목 클릭 시 펼쳐지는 메타데이터 패널 (연주자·악기·장르·BPM·조성·고유 키). */
  const [metaOpen, setMetaOpen] = useState(false);
  const [omrOpen, setOmrOpen] = useState(false);
  /* MusicXML/MIDI 파일 → 파싱 → 에디터 prefill 로 넘기는 가져오기 모달. */
  const [importModal, setImportModal] = useState<null | 'xml' | 'midi'>(null);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState('');
  const [importBusy, setImportBusy] = useState(false);

  /** ScorePart[] → prefillSheet. 다중 파트는 멜로디 우선 정렬 뒤 staves 로 전부
   *  싣는다 — 에디터가 파트 메타/스토어로 복원해 그대로 VexFlow 로 그린다. */
  const partsToSheet = useCallback((parts: ScorePart[]): NoteSheetData => {
    const sorted = sortPartsByMelody(parts);
    const first = sorted[0].data;
    if (sorted.length === 1) return first;
    const staves: SheetStaff[] = sorted.map((pt) => ({
      kind: pt.data.bassMeasures?.length ? 'grand' as const
        : pt.data.isDrum ? 'drum' as const
        : 'treble' as const,
      measures: pt.data.measures,
      ...(pt.data.bassMeasures?.length ? { bassMeasures: pt.data.bassMeasures } : {}),
      ...(pt.data.instrument && !pt.data.isDrum ? { instrument: pt.data.instrument } : {}),
    }));
    return { ...first, staves };
  }, []);

  const finishImport = useCallback((sheet: NoteSheetData) => {
    setImportModal(null); setImportText(''); setImportError('');
    navigate('/editor?mode=solo', { state: { prefillSheet: sheet } });
  }, [navigate]);

  const importFromFile = useCallback(async (f: File) => {
    setImportBusy(true); setImportError('');
    try {
      const name = f.name.replace(/\.(mxl|xml|musicxml|mid|midi)$/i, '');
      const lower = f.name.toLowerCase();
      if (importModal === 'midi' || lower.endsWith('.mid') || lower.endsWith('.midi')) {
        const sheet = parseMidiArrayBuffer(await f.arrayBuffer(), name, '');
        if (!sheet.measures.length) throw new Error('MIDI 에서 음표를 찾지 못했습니다.');
        finishImport(sheet);
      } else if (lower.endsWith('.mxl')) {
        finishImport(partsToSheet(parseMxlArrayBuffer(await f.arrayBuffer(), name)));
      } else {
        finishImport(partsToSheet(parseXmlString(await f.text(), name)));
      }
    } catch (e) {
      setImportError(e instanceof Error ? e.message : '파싱에 실패했습니다.');
    } finally {
      setImportBusy(false);
    }
  }, [importModal, partsToSheet, finishImport]);

  const importFromText = useCallback(() => {
    setImportBusy(true); setImportError('');
    try {
      finishImport(partsToSheet(parseXmlString(importText.trim(), 'Imported Score')));
    } catch (e) {
      setImportError(e instanceof Error ? e.message : '파싱에 실패했습니다.');
    } finally {
      setImportBusy(false);
    }
  }, [importText, partsToSheet, finishImport]);

  /* 제작·디버그 도구(큐 기록 · 응답값 원문)는 **스튜디오에서만** 뜬다.
   * 예전엔 계정 등급(isAdminUser)으로 갈랐는데, 그러면 실서비스에서 admin 으로
   * 로그인해도 제작 도구가 보였다 — 판정 기준이 애초에 틀렸다(lib/surface 참조). */
  const isStudio = useIsStudio();
  /* 응답값 받기(admin 전용 디버깅) — 솔로 GET 원문을 그대로 확인. */
  const [rawJsonTarget, setRawJsonTarget] = useState<{ id: string; title: string } | null>(null);
  const [queueLogOpen, setQueueLogOpen] = useState(false);
  const [queueLogEntries, setQueueLogEntries] = useState<QueueLogEntry[]>([]);
  /* Live OMR status panel: one card per in-flight / just-finished job. */
  const [omrJobs, setOmrJobs] = useState<SoloOmrJob[]>([]);
  /* Merge mode: pick solos in click order (numbered 1,2,3…) → concatenate
   * their measures into one new solo. */
  const [mergeMode, setMergeMode] = useState(false);
  const [mergeIds, setMergeIds] = useState<string[]>([]);
  const [mergeBusy, setMergeBusy] = useState(false);
  const previewBodyRef = useRef<HTMLDivElement>(null);
  /* 구간 선택 → 릭 저장: NoteSheet 의 selectable/selectedRanges 프리미티브에
   * 연결. 인덱스는 현재 표시 중인 previewSheet.measures 기준(이조돼도 마디
   * 수는 불변이라 유지 가능; 솔로가 바뀌면 초기화). */
  const [lickSelectMode, setLickSelectMode] = useState(false);
  const [lickRanges, setLickRanges] = useState<Array<[number, number]>>([]);
  const [lickSaving, setLickSaving] = useState(false);
  /* Lick 구간 선택 드롭다운(모달성). 선택 모드 자체는 lickSelectMode. */
  const [lickPanelOpen, setLickPanelOpen] = useState(false);
  const lickPanelRef = useRef<HTMLDivElement>(null);
  /* 장르 드롭다운 — 기본값은 솔로의 style(없으면 Unknown), 사용자가 바꾸면 override. */
  const [genreOverride, setGenreOverride] = useState<string | null>(null);
  /* 반복 횟수 — 내 코드 차트(ChordPage)와 완전히 동일한 배선:
   * RepeatControl UI + globalPlayer.setConfig({ repeatCount }). 솔로는 1회 기본. */
  const { player: globalPlayer } = useGlobalPlayer();
  const [repeatCount, setRepeatCount] = useState(1);
  useEffect(() => {
    globalPlayer.setConfig({ repeatCount });
  }, [globalPlayer, repeatCount]);

  /* token so concurrent fetches (e.g. fast performer-switching) can be
   * discarded when stale. */
  const fetchTokenRef = useRef(0);

  const loadPage = useCallback(async (performer: string, nextPage: number) => {
    if (!performer) return;
    const myToken = ++fetchTokenRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await listSolos({
        page: nextPage,
        size: PAGE_SIZE,
        sort: 'title,asc',
        performer,
      });
      if (myToken !== fetchTokenRef.current) return;  // stale
      /* Defensive client-side filter — the backend may ignore `performer`,
       * in which case we still want only the picked performer's rows. */
      const filtered = data.content.filter((s) => s.performer === performer);
      // If the backend honored `performer`, filtered === content and we trust
      // its last/totalElements. If it ignored the filter (other performers
      // mixed in), fetching more pages would just repeat the situation — so
      // stop infinite scroll and count only what we actually kept, otherwise
      // the sentinel keeps pulling empty pages forever.
      const backendFiltered = filtered.length === data.content.length;
      setSolos((prev) => (nextPage === 0 ? filtered : [...prev, ...filtered]));
      setPage(nextPage + 1);
      setIsLast(data.last || !backendFiltered);
      setTotalElements((prev) =>
        backendFiltered
          ? data.totalElements
          : nextPage === 0 ? filtered.length : prev + filtered.length,
      );
    } catch (e) {
      if (myToken !== fetchTokenRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (myToken === fetchTokenRef.current) setLoading(false);
    }
  }, []);

  /* Switch performer: reset list + fetch first page. Empty value = clear. */
  const handlePerformerChange = useCallback((p: string) => {
    setSelectedPerformer(p);
    setSolos([]);
    setPage(0);
    setIsLast(true);
    setTotalElements(0);
    setSelectedId(null);
    if (p) void loadPage(p, 0);
  }, [loadPage]);

  /* Client-side filters applied on top of the loaded (per-performer) pages. */
  const visibleList = useMemo(() => {
    let list = solos;
    if (filterInstrument) list = list.filter((s) => s.instrument === filterInstrument);
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((s) =>
        (s.title || '').toLowerCase().includes(q) ||
        (s.performer || '').toLowerCase().includes(q) ||
        (s.album || '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [solos, filterInstrument, searchQuery]);

  const selected = useMemo(
    () => (selectedId ? solos.find((s) => s.publicId === selectedId) ?? null : null),
    [solos, selectedId],
  );

  /* `/solos?solo=<publicId>` 로 특정 솔로를 바로 연다. 에디터에서 저장한 뒤
   * 방금 저장한 악보로 곧장 이동해 수정사항을 바로 확인하기 위한 진입점.
   * 목록에 아직 그 항목이 없으면(다른 페이지) 단건 조회로 채워 넣는다. */
  const deepLinkId = searchParams.get('solo');
  const deepLinkDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (!deepLinkId || deepLinkDoneRef.current === deepLinkId) return;
    deepLinkDoneRef.current = deepLinkId;
    /* 이 화면은 '연주자 선택 → 솔로 목록' 2단계다. 딥링크로 곧장 악보를 열려면
     * 그 솔로의 연주자까지 함께 지정해야 연주자 디렉터리에 갇히지 않는다. */
    void (async () => {
      try {
        const full = await getSolo(deepLinkId);
        if (!full) return;
        if (full.performer) {
          // 그 연주자의 목록을 정상 경로로 적재(무한스크롤·필터 상태 일관성 유지).
          setSelectedPerformer(full.performer);
          setSolos([]);
          setPage(0);
          setIsLast(true);
          setTotalElements(0);
          await loadPage(full.performer, 0);
        }
        // 첫 페이지에 없더라도(뒤 페이지 항목) 미리보기가 가능하도록 주입.
        setSolos((prev) => (prev.some((s) => s.publicId === full.publicId)
          ? prev.map((s) => (s.publicId === full.publicId ? full : s))
          : [full, ...prev]));
        setSelectedId(full.publicId);
      } catch { /* 실패하면 평소 흐름(연주자 디렉터리)으로 둔다 */ }
    })();
  }, [deepLinkId, loadPage]);

  useEffect(() => {
    // 딥링크로 지정된 솔로가 아직 로드 중이면 첫 항목으로 덮어쓰지 않는다.
    if (deepLinkId && deepLinkDoneRef.current === deepLinkId && !selected) return;
    if (!selected && visibleList.length > 0) {
      setSelectedId(visibleList[0].publicId);
    }
  }, [visibleList, selected, deepLinkId]);

  /* Infinite scroll — fetch next page when sentinel enters viewport. */
  const sentinelRef = useRef<HTMLDivElement>(null);
  const listBodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinelRef.current;
    const root = listBodyRef.current;
    if (!el || !root || !selectedPerformer || isLast || loading) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !loading) {
          void loadPage(selectedPerformer, page);
        }
      },
      { root, rootMargin: '200px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [selectedPerformer, isLast, loading, page, loadPage]);

  const originalDisplayKey = normalizeNoteKeyDisplay(selected?.sheetData?.key ?? selected?.key ?? 'C');
  const allKeys = noteKeyIsMinor(originalDisplayKey) ? ALL_KEYS_MINOR : ALL_KEYS_MAJOR;

  // The list endpoint returns metadata-only rows (no sheetData). When a solo is
  // selected for preview, fetch the full record and merge it into `solos` so the
  // preview/transpose has measures to work with. Re-running after the merge is a
  // no-op (sheetData now present), so this self-terminates without a loop.
  useEffect(() => {
    if (!selected || (selected.sheetData?.measures?.length ?? 0) > 0) return;
    let cancelled = false;
    getSolo(selected.publicId)
      .then((full) => {
        if (cancelled || !full?.sheetData) return;
        setSolos((prev) => prev.map((s) => (s.publicId === full.publicId ? full : s)));
      })
      .catch(() => { /* preview stays empty until retry; non-fatal */ });
    return () => { cancelled = true; };
  }, [selected]);

  useEffect(() => {
    setPreviewKey(originalDisplayKey);
  }, [selected?.publicId, originalDisplayKey]);

  /* 바의 장르 라벨 — style 이 비면 악기코드로 떨어지지 않고 Unknown. */
  const genreLabel = genreOverride ?? (formatStyleLabel(selected?.style) || 'Unknown');

  /* Lick 패널 바깥 클릭 / ESC → 닫기 (선택 모드는 유지). */
  useEffect(() => {
    if (!lickPanelOpen) return;
    const onDown = (e: MouseEvent) => {
      const anchor = lickPanelRef.current?.parentElement;
      if (anchor && !anchor.contains(e.target as Node)) setLickPanelOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLickPanelOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [lickPanelOpen]);

  /* 다른 솔로로 이동하면 진행 중이던 구간 선택은 무효 — 초기화. */
  useEffect(() => {
    setLickSelectMode(false);
    setLickRanges([]);
    setLickPanelOpen(false);
    setGenreOverride(null);
  }, [selected?.publicId]);

  const previewSheet = useMemo(() => {
    // List items arrive metadata-only (no sheetData) — the selection effect
    // below fetches the full solo and merges it in, after which this recomputes.
    if (!selected?.sheetData) return null;
    const sheet = {
      ...selected.sheetData,
      title: selected.sheetData.title || selected.title,
      composer: selected.sheetData.composer || selected.performer || '',
      key: originalDisplayKey,
      tempo: selected.sheetData.tempo ?? selected.tempo ?? undefined,
      timeSignature: selected.sheetData.timeSignature ?? selected.timeSignature ?? '4/4',
    };
    return previewKey === sheet.key ? sheet : transposeNoteSheet(sheet, previewKey);
  }, [selected, previewKey, originalDisplayKey]);


  /* 이 악보에 가사가 있는가 — 버튼 노출 여부를 정한다. */
  const lyricVerses = useMemo(
    () => (previewSheet ? maxVerseCount(previewSheet.measures) : 0),
    [previewSheet],
  );
  /* 실효 표시값 — 악보별 오버라이드가 있으면 그것, 없으면 전역 기본값. */
  const lyricsShown = lyricsOverride ?? lyricsDefault;
  /* 다른 솔로를 고르면 그 악보에 저장된 오버라이드를 불러온다. */
  useEffect(() => {
    setLyricsOverride(getChartLyrics(selected?.publicId));
  }, [selected?.publicId]);
  /* 선택된 마디 수(중복 제거) — 저장 버튼 라벨/활성화용. */
  const lickSelCount = useMemo(() => {
    if (lickRanges.length === 0 || !previewSheet) return 0;
    const seen = new Set<number>();
    for (const [a, b] of lickRanges) {
      const lo = Math.max(0, Math.min(a, b));
      const hi = Math.min(previewSheet.measures.length - 1, Math.max(a, b));
      for (let i = lo; i <= hi; i++) seen.add(i);
    }
    return seen.size;
  }, [lickRanges, previewSheet]);

  /** 선택 구간을 "지금 화면에 보이는 그대로"(이조 반영) 릭으로 백엔드에 저장.
   *  악보(score) 임시표 의미론을 explicit 으로 구운 뒤 저장 — 릭 렌더러/플레이어
   *  (LickCard, non-courtesy)와 데이터 의미가 정확히 일치해야 반음이 안 틀린다. */
  const handleSaveLickFromSelection = useCallback(async () => {
    if (!selected || !previewSheet || lickSaving) return;
    // 범위 병합 → 오름차순 마디 인덱스 (Cmd/Ctrl 다중 구간도 순서대로 이어붙임)
    const seen = new Set<number>();
    const idxs: number[] = [];
    const sorted = [...lickRanges]
      .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])
      .sort((x, y) => x[0] - y[0]);
    for (const [lo, hi] of sorted) {
      for (let i = Math.max(0, lo); i <= Math.min(previewSheet.measures.length - 1, hi); i++) {
        if (!seen.has(i)) { seen.add(i); idxs.push(i); }
      }
    }
    if (idxs.length === 0) return;
    const LICK_MAX_BARS = 8;
    if (idxs.length > LICK_MAX_BARS) {
      notify({ kind: 'error', title: '릭 저장 불가', message: `릭은 최대 ${LICK_MAX_BARS}마디예요 — 지금 ${idxs.length}마디가 선택돼 있어요.` });
      return;
    }
    // 마디 통째 슬라이스 + 경계 정리: 구조 마커(도돌이/볼타/내비/브래킷)와
    // 구간 밖으로 이어지던 tie/gliss 는 릭에서 무의미하므로 제거.
    const sliced = idxs.map((i) => {
      const m = previewSheet.measures[i];
      const { repeatStart, repeatEnd, volta, navigation, bracket, anacrusis, ...rest } = m;
      void repeatStart; void repeatEnd; void volta; void navigation; void bracket; void anacrusis;
      return { ...rest, notes: m.notes.map((n) => ({ ...n })) };
    });
    const firstNotes = sliced[0].notes;
    if (firstNotes.length > 0) delete firstNotes[0].tieContinuation;
    const lastNotes = sliced[sliced.length - 1].notes;
    if (lastNotes.length > 0) {
      delete lastNotes[lastNotes.length - 1].tie;
      delete lastNotes[lastNotes.length - 1].gliss;
    }
    const baked = bakeExplicitAccidentals(sliced, previewSheet.key);
    const totalN = baked.reduce((s, m) => s + m.notes.filter((n) => !n.duration.endsWith('r')).length, 0);
    if (totalN === 0) {
      notify({ kind: 'error', title: '릭 저장 불가', message: '선택 구간에 음표가 없어요.' });
      return;
    }
    const rangeLabel = idxs.length === 1 ? `m.${idxs[0] + 1}` : `m.${idxs[0] + 1}–${idxs[idxs.length - 1] + 1}`;
    const title = `${selected.title} (${rangeLabel})`;
    const chords = baked.map((m) => m.chord ?? '');
    setLickSaving(true);
    try {
      const { computeLickFeatures, saveUserLick, invalidateLicksCache } = await import('../data/lickData');
      const { createLick } = await import('../api/licks');
      const entry: LickEntry = {
        id: Date.now(),
        performer: selected.performer || 'Unknown',
        title,
        album: selected.album ?? '',
        instrument: selected.instrument || '',
        style: selected.style ?? '',
        tempo: selected.tempo ?? previewSheet.tempo ?? null,
        key: previewSheet.key,
        rhythmfeel: selected.rhythmFeel ?? '',
        tag: 'solo-excerpt',
        chords,
        nEvents: totalN,
        label: `${selected.performer || 'Unknown'} — ${title}${chords.filter(Boolean).length ? ` (${chords.filter(Boolean).join(' → ')})` : ''}`,
        sheetData: {
          title,
          composer: selected.performer ?? '',
          key: previewSheet.key,
          timeSignature: previewSheet.timeSignature || '4/4',
          tempo: previewSheet.tempo,
          measures: baked,
        },
        ...computeLickFeatures(baked),
      };
      const persisted = await createLick(entry);
      invalidateLicksCache();
      saveUserLick(persisted);
      notify({ kind: 'success', title: '릭 저장 완료', message: `${selected.title} ${rangeLabel} · ${idxs.length}마디를 릭으로 저장했어요.` });
      setLickRanges([]);
      setLickSelectMode(false);
    } catch (e) {
      notify({ kind: 'error', title: '릭 저장 실패', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setLickSaving(false);
    }
  }, [selected, previewSheet, lickRanges, lickSaving, notify]);

  /* OMR upload → backend persists the Solo and returns it. Jump into the
   * Editor (solo mode) pre-loaded with the result so the user can review/edit
   * immediately, mirroring the lick OMR flow. (Same prefill shape as the row
   * "Edit" button.) */
  /** Open a fully-loaded solo in the Editor (solo mode), prefilled so re-save
   *  updates the same record — 덮어쓰기 판정이 title + performer 라서 연주자를
   *  Performer 칸에 그대로 실어 보낸다(예전엔 Composer 칸에 밀어넣었다). */
  const openSoloInEditor = useCallback((full: SoloResponse) => {
    const sheet = full.sheetData;
    navigate('/editor?mode=solo', {
      state: {
        prefillSheet: {
          ...sheet,
          /* sheetData.composer 는 백엔드가 저장하지 않으므로 레코드의 top-level
           * composer 가 진짜 값이다(BR-40). */
          composer: full.composer ?? sheet.composer ?? '',
          tempo: full.tempo ?? sheet.tempo,
          key: sheet.key,
        },
        prefillPerformer: full.performer ?? '',
        prefillAlbum: full.album ?? '',
      },
    });
  }, [navigate]);

  /** Row "Edit" — the row may be metadata-only (no sheetData), so fetch the
   *  full solo first, then open the Editor prefilled (연주자를 Performer 칸에
   *  실어야 재저장이 같은 레코드를 갱신한다). */
  const editRow = useCallback(async (row: SoloResponse) => {
    let s = row;
    if (!s.sheetData?.measures?.length) {
      try {
        const full = await getSolo(s.publicId);
        if (full?.sheetData) s = full;
      } catch { /* guarded below */ }
    }
    if (!s.sheetData) { alert('악보 데이터를 불러오지 못했습니다.'); return; }
    navigate('/editor?mode=solo', {
      state: {
        prefillSheet: {
          ...s.sheetData,
          composer: s.composer ?? s.sheetData.composer ?? '',
          tempo: s.tempo ?? s.sheetData.tempo,
          key: s.sheetData.key,
        },
        prefillPerformer: s.performer ?? '',
        prefillAlbum: s.album ?? '',
      },
    });
  }, [navigate]);

  /** Fetch a solo by id and open it; surfaces a toast on failure. Used by the
   *  "열기" action on the OMR-complete notification. */
  const fetchAndOpenSolo = useCallback(async (publicId: string) => {
    try {
      const full = await getSolo(publicId);
      if (!full?.sheetData?.measures?.length) {
        notify({ kind: 'error', title: '열기 실패', message: '악보 데이터를 받지 못했어요.' });
        return;
      }
      openSoloInEditor(full);
    } catch (e) {
      notify({
        kind: 'error',
        title: '열기 실패',
        message: e instanceof Error ? e.message : '솔로를 불러오지 못했어요.',
      });
    }
  }, [notify, openSoloInEditor]);

  /* ── OMR status panel: background jobs ─────────────────────────────────
   * OMR runs in the background (modal closes on submit) and each job shows a
   * live status card via the panel at the bottom-right. The authoritative
   * terminal signal is the createSoloViaOMR promise; /omr-status polling only
   * fills in progress % / early completion when the backend supports it
   * (currently the solos endpoint may 500 — handled gracefully). */

  // setState guard: the detached upload promise can resolve after the page
  // unmounts (user navigated away) — don't setState then.
  const mountedRef = useRef(true);
  // Set true in the effect BODY (not just useRef's initial value): React
  // StrictMode runs mount effects setup→cleanup→setup, so relying on the
  // initial value leaves mountedRef stuck at false after the first cleanup,
  // which made upsertOmrJob bail out and the panel never appear.
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const upsertOmrJob = useCallback((id: string, patch: Partial<SoloOmrJob>) => {
    if (!mountedRef.current) return;
    setOmrJobs((prev) => {
      const i = prev.findIndex((j) => j.id === id);
      if (i === -1) {
        return [...prev, { id, label: '새 솔로', status: 'PROCESSING', progress: 0, ...patch }];
      }
      const next = prev.slice();
      next[i] = { ...next[i], ...patch };
      return next;
    });
  }, []);

  /* publicId → pending timeout. 동일 솔로 중복 폴러 방지 + 정리 가능하게 추적.
   * (대량 큐는 전역 모듈 lib/soloOmrQueue 소유 — 여기는 단건 백그라운드 잡 전용) */
  const omrPollersRef = useRef<Map<string, number>>(new Map());

  const dismissOmrJob = useCallback((id: string) => {
    setOmrJobs((prev) => {
      const job = prev.find((j) => j.id === id);
      if (job?.publicId) {
        const t = omrPollersRef.current.get(job.publicId);
        if (t) { window.clearTimeout(t); omrPollersRef.current.delete(job.publicId); }
      }
      return prev.filter((j) => j.id !== id);
    });
  }, []);
  useEffect(() => () => {
    // 언마운트: 모든 폴러 정지
    omrPollersRef.current.forEach((t) => window.clearTimeout(t));
    omrPollersRef.current.clear();
  }, []);

  /** Best-effort poll of /v1/solos/{id}/omr-status → updates the job card's
   *  progress/status. The solos endpoint may be unavailable (500); such errors
   *  are swallowed and the card stays "인식 중" until the promise or MAX_MS
   *  resolves it — so a broken status endpoint never hangs a card forever. */
  const pollSoloOmrIntoJob = useCallback((jobId: string, publicId: string) => {
    const INTERVAL_MS = 5000; // OMR takes tens of seconds — slow poll keeps the request rate low
    const MAX_MS = 5 * 60_000;
    if (omrPollersRef.current.has(publicId)) return; // 중복 폴러 방지
    const startedAt = Date.now();
    const tick = async () => {
      omrPollersRef.current.delete(publicId);
      try {
        const st = await getSoloOmrStatus(publicId);
        if (st.status === 'COMPLETED') {
          upsertOmrJob(jobId, { status: 'COMPLETED', progress: 100, publicId });
          void refreshPerformers();
          return;
        }
        if (st.status === 'FAILED') {
          upsertOmrJob(jobId, { status: 'FAILED', failureReason: st.failureReason ?? '악보 인식에 실패했어요.' });
          return;
        }
        // 진행률 + 다중 페이지 PDF 의 페이지 카운트를 함께 반영.
        upsertOmrJob(jobId, {
          ...(st.progress > 0 ? { progress: st.progress } : {}),
          totalPages: st.totalPages,
          completedPages: st.completedPages,
        });
      } catch (e) {
        // 인증 만료(401/403)면 더 폴링해도 영원히 실패 — 즉시 종료.
        const msg = e instanceof Error ? e.message : '';
        if (/\b401\b|\b403\b/.test(msg)) return;
        /* 그 외(엔드포인트 500 등) — 무시하고 계속: 완료는 아래 MAX_MS 또는 promise가 확정한다 */
      }
      if (Date.now() - startedAt > MAX_MS) {
        upsertOmrJob(jobId, {
          status: 'FAILED',
          failureReason: '처리 상태를 확인하지 못했어요. 목록에서 다시 확인해 주세요.',
        });
        return;
      }
      const t = window.setTimeout(() => void tick(), INTERVAL_MS);
      omrPollersRef.current.set(publicId, t);
    };
    void tick();
  }, [upsertOmrJob, refreshPerformers]);

  /* Kick off a background OMR job from the modal's onBackgroundStart. */
  const omrJobSeq = useRef(0);
  const startSoloOmrJob = useCallback(async (file: File, metadata: OMRMetadata) => {
    const id = `omr-${Date.now()}-${omrJobSeq.current++}`;
    const label = metadata.title?.trim() || metadata.performer?.trim() || file.name || '새 솔로';
    upsertOmrJob(id, { id, label, status: 'PROCESSING', progress: 0 });
    try {
      const solo = await createSoloViaOMR(file, metadata);
      if (solo?.sheetData?.measures?.length) {
        upsertOmrJob(id, { status: 'COMPLETED', progress: 100, publicId: solo.publicId, solo });
        void refreshPerformers(); // 새 솔로가 연주자 목록에 바로 반영되게
        return;
      }
      if (solo?.publicId) {
        // Response minimal — one full fetch to catch "done, just trimmed",
        // else OMR is in flight → poll (best-effort).
        try {
          const full = await getSolo(solo.publicId);
          if (full?.sheetData?.measures?.length) {
            upsertOmrJob(id, { status: 'COMPLETED', progress: 100, publicId: full.publicId, solo: full });
            void refreshPerformers();
            return;
          }
        } catch { /* fall through to poll */ }
        upsertOmrJob(id, { publicId: solo.publicId });
        pollSoloOmrIntoJob(id, solo.publicId);
        return;
      }
      upsertOmrJob(id, { status: 'FAILED', failureReason: '서버 응답에 악보 데이터가 없어요.' });
    } catch (e) {
      upsertOmrJob(id, { status: 'FAILED', failureReason: e instanceof Error ? e.message : 'OMR 인식 실패' });
    }
  }, [upsertOmrJob, pollSoloOmrIntoJob, refreshPerformers]);

  /* ── 대량 OMR 큐 — **전역 모듈**(lib/soloOmrQueue)이 소유 ────────────────
   * 러너가 페이지 밖에서 돌므로 앱 내 라우트를 이동해도 큐가 죽지 않는다
   * (2026-07-25 "93개 중 32개" 중단 사건의 근본 수정). 이 페이지는 상태를
   * 구독해 카드만 그린다. 직렬·candidate 규칙·영속 로그는 모듈이 보장. */
  const queueState = useSyncExternalStore(subscribeOmrQueue, getOmrQueueState);

  // 새로고침/재방문 시 이전 세션 잔여 큐 자동 이어받기(1회) — IndexedDB 원본 + 로그.
  useEffect(() => { void resumeOmrQueueFromDisk(); }, []);

  // 큐에서 완료가 새로 나올 때마다 연주자 목록 갱신(candidate 그룹 반영).
  const queueDoneCount = queueState.items.filter((i) => i.status === 'COMPLETED').length;
  const prevQueueDoneRef = useRef(queueDoneCount);
  useEffect(() => {
    if (queueDoneCount > prevQueueDoneRef.current) void refreshPerformers();
    prevQueueDoneRef.current = queueDoneCount;
  }, [queueDoneCount, refreshPerformers]);

  /* 큐 카드 "＋ 추가" — 전역 큐 맨 뒤에 붙는다(제목=파일명·candidate 규칙 동일). */
  const queueAddInputRef = useRef<HTMLInputElement>(null);
  const handleQueueAddFiles = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // 같은 파일 재선택 허용
    if (files.length === 0) return;
    const MAX_BYTES = 20 * 1024 * 1024; // 백엔드 동기 검증 한도(문서 #23)
    const valid = (f: File) =>
      (/^image\/(png|jpe?g)$/i.test(f.type) || /\.(png|jpe?g)$/i.test(f.name)
        || f.type === 'application/pdf' || /\.pdf$/i.test(f.name))
      && f.size <= MAX_BYTES;
    const ok = files.filter(valid);
    const rejected = files.filter((f) => !valid(f)).map((f) => f.name);
    if (ok.length > 0) enqueueMoreFiles(ok);
    if (rejected.length > 0) {
      setError(`큐에서 제외됨(형식/20MB): ${rejected.join(', ')}`);
      setTimeout(() => setError(null), 4000);
    }
  }, []);

  /* 통합 큐 카드 펼침 + 활성 행 자동 스크롤 */
  const [queueOpen, setQueueOpen] = useState(false);
  const queueListRef = useRef<HTMLDivElement>(null);
  const queueActiveId = queueState.items.find((i) => i.status === 'PROCESSING')?.id ?? null;
  useEffect(() => {
    if (!queueOpen || !queueActiveId) return;
    // 펼치거나 진행 항목이 바뀌면 그 행이 보이게 스크롤.
    const el = queueListRef.current?.querySelector('[data-active="true"]');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [queueOpen, queueActiveId]);

  /** 큐 행(완료) 클릭 — 카드에서 지우지 **않고** 연다(집계 카운트 유지). */
  const openQueueItem = useCallback((item: OmrQueueItem) => {
    if (item.solo?.sheetData?.measures?.length) openSoloInEditor(item.solo);
    else if (item.publicId) void fetchAndOpenSolo(item.publicId);
  }, [openSoloInEditor, fetchAndOpenSolo]);


  /* Panel "에디터로 열기" — open the finished solo, then clear its card. */
  const openOmrJob = useCallback((job: SoloOmrJob) => {
    if (job.solo?.sheetData?.measures?.length) openSoloInEditor(job.solo);
    else if (job.publicId) void fetchAndOpenSolo(job.publicId);
    dismissOmrJob(job.id);
  }, [openSoloInEditor, fetchAndOpenSolo, dismissOmrJob]);

  const toggleMergePick = useCallback((id: string) => {
    setMergeIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const exitMergeMode = useCallback(() => {
    setMergeMode(false);
    setMergeIds([]);
  }, []);

  /* Concatenate the picked solos (in click order) into one new solo. Originals
   * are kept; the new merged solo is created via POST and surfaced at the top. */
  const handleMerge = useCallback(async () => {
    if (mergeIds.length < 2) return;
    const ordered = mergeIds
      .map((id) => solos.find((s) => s.publicId === id))
      .filter((s): s is SoloResponse => !!s);
    if (ordered.length < 2) return;
    setMergeBusy(true);
    setError(null);
    try {
      const created = await createSolo(buildMergedSoloDraft(ordered));
      exitMergeMode();
      await loadPage(selectedPerformer, 0);
      setSelectedId(created.publicId);
    } catch (e) {
      setError(e instanceof Error ? e.message : '솔로 합치기 실패');
      setTimeout(() => setError(null), 4000);
    } finally {
      setMergeBusy(false);
    }
  }, [mergeIds, solos, selectedPerformer, exitMergeMode, loadPage]);

  const handleDelete = useCallback(async (solo: SoloResponse) => {
    if (!window.confirm(`"${solo.performer ?? '—'} — ${solo.title}" 솔로를 삭제할까요?`)) return;
    try {
      await deleteSolo(solo.publicId);
      setSolos((prev) => prev.filter((s) => s.publicId !== solo.publicId));
      setTotalElements((n) => Math.max(0, n - 1));
      if (selectedId === solo.publicId) setSelectedId(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '삭제 실패';
      setError(msg);
      setTimeout(() => setError(null), 4000);
    }
  }, [selectedId]);

  /* PDF 다운로드 — 화면에 렌더된 악보 SVG 를 고해상도 canvas 로 raster 한 뒤
   * jsPDF 페이지에 staff 단위로 배치해서 자동 다운로드한다 (scoreToPdf.ts).
   * 브라우저 렌더러가 음표/코드 폰트를 정확히 그리므로 깨지지 않고, 머리글·
   * 바닥글이 없으며, 빈 페이지 없이 1페이지부터 시작하고, 페이지 경계는 빈
   * 행에서 끊겨 staff 가 반토막 나지 않는다. */
  const handlePdfDownload = useCallback(async (solo: SoloResponse) => {
    setPdfBusy(solo.publicId);
    try {
      // 1) sheetData 보장 — 목록 행은 metadata-only일 수 있다. 고정 350ms 대기는
      //    fetch+렌더가 그보다 느리면 실패했고, 이미 선택된 행이라도 getSolo가
      //    아직 머지 전이면(분기 미진입) 거의 항상 실패했다. 직접 await로 해소.
      if (!solo.sheetData) {
        const full = await getSolo(solo.publicId);
        setSolos((prev) => prev.map((s) => (s.publicId === full.publicId ? full : s)));
        solo = full;
      }
      if (selectedId !== solo.publicId) setSelectedId(solo.publicId);
      if (typeof document !== 'undefined' && document.fonts?.ready) {
        await document.fonts.ready;
      }

      // 2) 악보 SVG가 실제로 그려질 때까지 폴링 (최대 ~5s). "가장 큰 svg"가
      //    아이콘 수준 크기면 아직 악보가 아니다 — 최소 면적으로 검증.
      const MIN_SCORE_AREA = 40_000; // px² — 아이콘(수백)과 악보(수십만)의 중간
      const findScoreSvg = (): SVGSVGElement | null => {
        const all = Array.from(
          previewBodyRef.current?.querySelectorAll('svg') ?? [],
        ) as SVGSVGElement[];
        if (all.length === 0) return null;
        const best = all.reduce((b, s) => {
          const r = s.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return r.width * r.height > rb.width * rb.height ? s : b;
        });
        const br = best.getBoundingClientRect();
        return br.width * br.height >= MIN_SCORE_AREA ? best : null;
      };
      let scoreSvg = findScoreSvg();
      for (let i = 0; i < 50 && !scoreSvg; i++) {
        await new Promise((r) => setTimeout(r, 100));
        scoreSvg = findScoreSvg();
      }
      if (!scoreSvg) throw new Error('악보가 준비되지 않았습니다.');

      const safe = (s: string) => s.replace(/[/\\?%*:|"<>]/g, '-').trim();
      const filename = `${safe(solo.performer ?? 'Unknown')} - ${safe(solo.title)}`;
      await exportScoreSvgToPdf(scoreSvg, filename, {
        title: solo.title,
        artist: solo.performer ?? undefined,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'PDF 생성 실패';
      setError(msg);
      setTimeout(() => setError(null), 4000);
    } finally {
      setPdfBusy(null);
    }
  }, [selectedId]);

  /** 음표까지 함께 이조. `newKeyRaw` 는 'Ab' · 'F#m' · 'Bb-maj' 등 자유 표기. */
  const applyTranspose = useCallback(async (row: SoloResponse, newKeyRaw: string) => {
    // Row may be metadata-only (no sheetData) — fetch the full solo first.
    let solo = row;
    if (!solo.sheetData?.measures?.length) {
      try {
        const full = await getSolo(solo.publicId);
        if (full?.sheetData) solo = full;
      } catch { /* fall through — guarded below */ }
    }
    if (!solo.sheetData) { alert('악보 데이터를 불러오지 못했습니다.'); return; }
    const fromWeimar = toWeimarKey(solo.key ?? solo.sheetData.key ?? 'C') ?? 'C-maj';
    const newWeimar = normalizeKeyInput(newKeyRaw);
    if (!newWeimar) {
      alert(`조성을 알아볼 수 없습니다: "${newKeyRaw}"`);
      return;
    }
    if (newWeimar === fromWeimar) { setKeyPanel(null); return; }

    const result = transposeLick(solo.sheetData, solo.chords ?? [], fromWeimar, newWeimar);
    if (!result) {
      alert('이조 실패 (조성을 해석하지 못했습니다).');
      return;
    }

    setBusy(solo.publicId);
    try {
      const draft: SoloDraft = {
        source: solo.source,
        title: solo.title,
        instrument: solo.instrument,
        sheetData: result.sheetData,
        userId: solo.userId ?? null,
        sourceUrl: solo.sourceUrl ?? undefined,
        performer: solo.performer ?? undefined,
        album: solo.album ?? undefined,
        style: solo.style ?? undefined,
        tempo: solo.tempo ?? undefined,
        key: result.key,
        rhythmFeel: solo.rhythmFeel ?? undefined,
        timeSignature: solo.timeSignature ?? undefined,
        chords: result.chords.length > 0 ? result.chords : undefined,
        chordsPerNote: solo.chordsPerNote ?? undefined,
        harmonicContext: solo.harmonicContext ?? undefined,
        targetChord: solo.targetChord ?? undefined,
      };
      const updated = await updateSolo(solo.publicId, draft);
      setSolos((prev) => prev.map((s) => (s.publicId === solo.publicId ? updated : s)));
      setKeyPanel(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Transpose 실패';
      setError(msg);
      setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(null);
    }
  }, []);

  /** 조성 표기만 교체 — 음표·VexFlow 출력은 1도 건드리지 않는다.
   *
   *  OMR/파싱이 조성을 잘못 잡았을 때 쓰는 교정 도구다. 이조(transposeLick)는
   *  모든 음을 옮기지만 이건 `key` 필드만 바꾸므로 악보 모양이 그대로 유지된다. */
  const applyKeyOnly = useCallback(async (row: SoloResponse, newKeyRaw: string) => {
    let solo = row;
    if (!solo.sheetData?.measures?.length) {
      try {
        const full = await getSolo(solo.publicId);
        if (full?.sheetData) solo = full;
      } catch { /* fall through */ }
    }
    if (!solo.sheetData) { alert('악보 데이터를 불러오지 못했습니다.'); return; }
    const newWeimar = normalizeKeyInput(newKeyRaw);
    if (!newWeimar) {
      alert(`조성을 알아볼 수 없습니다: "${newKeyRaw}"`);
      return;
    }

    setBusy(solo.publicId);
    try {
      /* 조표만 교체하되 **소리는 보존**한다. measures 를 그대로 두고 key 만
       * 갈아끼우면, 임시표가 없는 음표는 새 조표를 따라가 음높이가 바뀐다
       * (C장조의 F → B장조에선 F♯). respellNoteSheetKey 가 원래 피치를
       * 확정한 뒤 새 조표에서 그 피치를 유지할 임시표(♮ 등)를 다시 붙인다. */
      const respelled = respellNoteSheetKey(
        { ...solo.sheetData, key: solo.sheetData.key ?? formatKeyDisplay(solo.key ?? 'C') },
        formatKeyDisplay(newWeimar),
      );

      const draft: SoloDraft = {
        source: solo.source,
        title: solo.title,
        instrument: solo.instrument,
        sheetData: { ...respelled, key: formatKeyDisplay(newWeimar) },
        userId: solo.userId ?? null,
        sourceUrl: solo.sourceUrl ?? undefined,
        performer: solo.performer ?? undefined,
        album: solo.album ?? undefined,
        style: solo.style ?? undefined,
        tempo: solo.tempo ?? undefined,
        key: newWeimar,
        rhythmFeel: solo.rhythmFeel ?? undefined,
        timeSignature: solo.timeSignature ?? undefined,
        chords: solo.chords ?? undefined,
        chordsPerNote: solo.chordsPerNote ?? undefined,
        harmonicContext: solo.harmonicContext ?? undefined,
        targetChord: solo.targetChord ?? undefined,
      };
      const updated = await updateSolo(solo.publicId, draft);
      setSolos((prev) => prev.map((s) => (s.publicId === solo.publicId ? updated : s)));
      setKeyPanel(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : '조성 변경 실패';
      setError(msg);
      setTimeout(() => setError(null), 4000);
    } finally {
      setBusy(null);
    }
  }, []);

  return (
    <PageContainer>
      <AppSidebar />
      <RightSection>
        {/* 상단 '돌아가기' 바 제거 — 솔로 DB 는 연주자 바가 최상단이다. */}
        <MainArea>
          <CenterColumn>
            <ToolBar>
              {!selectedPerformer ? (
                /* 인트로(연주자 디렉터리) — '내 코드 차트'와 같은 결:
                 * 제목이 맨 위, 그 옆에 생성 버튼 2개. 검색은 아래 독립 박스. */
                <IntroHead>
                  {/* 시작 화면에서도 뒤로 — 앱 공통 '<' 와 동일 디자인. */}
                  <BackButton onClick={() => navigate(-1)} label="이전 페이지" />
                  <IntroTitle>Solo Database</IntroTitle>
                  <IntroActions>
                    <OMRBtn onClick={() => setOmrOpen(true)} title="악보 이미지를 업로드해 OMR로 솔로 생성">
                      📄 OMR로 생성하기
                    </OMRBtn>
                    <OMRBtn onClick={() => navigate('/editor?mode=solo')} title="에디터에서 직접 솔로 작성">
                      ✏ Editor로 생성하기
                    </OMRBtn>
                    <OMRBtn onClick={() => setImportModal('xml')} title="MusicXML(.xml/.musicxml/.mxl) 파일이나 원문 붙여넣기로 악보 불러오기">
                      🎼 MusicXML로 생성하기
                    </OMRBtn>
                    <OMRBtn onClick={() => setImportModal('midi')} title="MIDI(.mid) 파일에서 멜로디를 추출해 악보로 불러오기">
                      🎹 MIDI로 생성하기
                    </OMRBtn>
                    {isStudio && (
                      <OMRBtn
                        onClick={() => { setQueueLogEntries(listQueueLog()); setQueueLogOpen(true); }}
                        title="대량 OMR 큐의 영속 기록 — 새로고침·이탈 후에도 결과 확인 (admin)"
                      >
                        🗂 큐 기록
                      </OMRBtn>
                    )}
                  </IntroActions>
                </IntroHead>
              ) : (
                <>
                  <BackButton onClick={() => handlePerformerChange('')} label="전체 연주자" />
                  {/* 연주자명 + 그 바로 아래 개수 (세로 스택) */}
                  <PerformerBlock>
                    <CurrentPerformer>{selectedPerformer}</CurrentPerformer>
                    <PerformerCount>
                      {mergeMode
                        ? '합칠 솔로를 순서대로 클릭하세요 (번호 순으로 이어붙임)'
                        : `${visibleList.length.toLocaleString()} / ${totalElements.toLocaleString()} solos${isLast ? '' : ' (스크롤로 더 불러오기)'}`}
                    </PerformerCount>
                  </PerformerBlock>

                  {/* 새로고침은 아래 검색 박스 안으로 옮겼다. */}

                  {/* 솔로 합치기 UI 는 화면에서만 감춘다 — mergeMode/handleMerge 구현은 유지.
                   *  (합치기 진행 중이면 완료/취소는 계속 노출해 갇히지 않게 한다.) */}
                  {mergeMode && (
                    <>
                      <MergeDoBtn
                        onClick={handleMerge}
                        disabled={mergeIds.length < 2 || mergeBusy}
                      >
                        {mergeBusy ? '합치는 중…' : `합치기 (${mergeIds.length})`}
                      </MergeDoBtn>
                      <RefreshBtn onClick={exitMergeMode} disabled={mergeBusy}>취소</RefreshBtn>
                    </>
                  )}
                </>
              )}
            </ToolBar>

            {error && <ErrorBanner>{error}</ErrorBanner>}

            <SplitArea $single={!selectedPerformer}>
              <ListColumn>
                {/* 인트로: 연주자 검색 — 곡 검색과 동일한 독립 박스 스타일. */}
                {!selectedPerformer && (
                  <SearchRow>
                    <SearchBox>
                      <SearchInput
                        placeholder="연주자 검색..."
                        value={performerQuery}
                        onChange={(e) => setPerformerQuery(e.target.value)}
                      />
                    </SearchBox>
                  </SearchRow>
                )}
                {/* 제목/앨범 검색 + 새로고침 — 서로 '독립된' 요소로 나란히.
                    새로고침은 검색 input 테두리 밖에 있다. */}
                {selectedPerformer && (
                  <SearchRow>
                    <SearchBox>
                      <SearchInput
                        placeholder="제목 / 앨범 검색..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                    </SearchBox>
                    <IconRefreshBtn
                      onClick={() => loadPage(selectedPerformer, 0)}
                      disabled={loading}
                      aria-label="새로고침"
                      title={loading ? '불러오는 중…' : '새로고침'}
                      $spinning={loading}
                    >
                      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <polyline points="23 4 23 10 17 10" />
                        <polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                      </svg>
                    </IconRefreshBtn>
                  </SearchRow>
                )}
              <ListCard>
                <ListBody ref={listBodyRef}>
                  {!selectedPerformer ? (
                    performersLoading ? (
                      <EmptyState>연주자 목록 불러오는 중…</EmptyState>
                    ) : visiblePerformers.length === 0 ? (
                      <EmptyState>연주자가 없습니다.</EmptyState>
                    ) : (
                      visiblePerformers.map((p) => (
                        <PerformerRow key={p.name} onClick={() => handlePerformerChange(p.name)}>
                          <PerformerName title={p.name}>{p.name}</PerformerName>
                          <CountBadge>{p.count.toLocaleString()} solos</CountBadge>
                        </PerformerRow>
                      ))
                    )
                  ) : visibleList.length === 0 && loading ? (
                    <EmptyState>불러오는 중…</EmptyState>
                  ) : visibleList.length === 0 ? (
                    <EmptyState>조건에 맞는 솔로가 없습니다.</EmptyState>
                  ) : (
                    <>
                      {visibleList.map((s) => {
                        const mergeIdx = mergeIds.indexOf(s.publicId);
                        return (
                        <Row
                          key={s.publicId}
                          $active={mergeMode ? mergeIdx >= 0 : s.publicId === selectedId}
                          $merge={mergeMode}
                          onClick={() => (mergeMode ? toggleMergePick(s.publicId) : setSelectedId(s.publicId))}
                        >
                          {mergeMode && (
                            <MergeCheck $picked={mergeIdx >= 0}>
                              {mergeIdx >= 0 ? mergeIdx + 1 : ''}
                            </MergeCheck>
                          )}
                          {/* 행 우측 상단 아이콘 — 테두리·배경 없이 아이콘만. */}
                          {!mergeMode && (
                            <RowIcons>
                              <RowIconBtn
                                title="에디터에서 열기"
                                aria-label="편집"
                                onClick={(e) => { e.stopPropagation(); void editRow(s); }}
                              >
                                <PencilGlyph s={17} />
                              </RowIconBtn>
                              <RowIconBtn
                                title="PDF 로 내려받기"
                                aria-label="PDF 다운로드"
                                disabled={pdfBusy === s.publicId}
                                onClick={(e) => { e.stopPropagation(); handlePdfDownload(s); }}
                              >
                                <DownloadGlyph s={17} />
                              </RowIconBtn>
                              <RowIconBtn
                                title="삭제"
                                aria-label="삭제"
                                onClick={(e) => { e.stopPropagation(); handleDelete(s); }}
                              >
                                <TrashGlyph s={17} />
                              </RowIconBtn>
                              {/* admin 전용 — 백엔드 GET 응답 원문 확인(디버깅용). */}
                              {isStudio && (
                                <RowIconBtn
                                  title="응답값 받기 (admin)"
                                  aria-label="응답값 받기"
                                  onClick={(e) => { e.stopPropagation(); setRawJsonTarget({ id: s.publicId, title: s.title }); }}
                                >
                                  <JsonGlyph s={17} />
                                </RowIconBtn>
                              )}
                            </RowIcons>
                          )}
                          <RowMain>
                            <RowTitle title={s.title}>{s.title}</RowTitle>
                            <RowPerformer title={s.performer ?? ''}>{s.performer ?? '—'}</RowPerformer>
                            <RowMetaLine>
                              <span className="style">{formatStyleLabel(s.style) || 'Unknown'}</span>
                              <span className="right">
                                {s.tempo ? <span className="bpm"><b>{s.tempo}</b>BPM</span> : null}
                                <em>{formatKeyDisplay(toWeimarKey(s.key ?? s.sheetData?.key ?? 'C') ?? 'C-maj')}</em>
                              </span>
                            </RowMetaLine>
                          </RowMain>
                        </Row>
                        );
                      })}
                      {!isLast && <Sentinel ref={sentinelRef} />}
                      {loading && visibleList.length > 0 && (
                        <EmptyState>더 불러오는 중…</EmptyState>
                      )}
                    </>
                  )}
                </ListBody>
              </ListCard>
              </ListColumn>

              {selectedPerformer && (
              <PreviewCard>
                {selected ? (
                  <>
                    <PreviewHeader>
                      {/* ── 좌: 장르 → 조성 → Lick 구간 선택 (내 코드 차트와 동일 배치) ── */}
                      <BarLeft>
                        <GenreSelect value={genreLabel} onChange={setGenreOverride} />
                        <KeyControl
                          selectedKey={previewKey}
                          onChange={setPreviewKey}
                          isMinor={noteKeyIsMinor(previewKey)}
                          keys={allKeys}
                        />
                        <KeyAnchor>
                          <LickModeBtn
                            type="button"
                            $on={lickSelectMode}
                            onClick={() => setLickPanelOpen((v) => !v)}
                          >
                            Lick 구간 선택
                          </LickModeBtn>
                          {lickPanelOpen && (
                            <LickPanel role="dialog" ref={lickPanelRef}>
                              <KeyPanelTitle>Lick 구간 선택</KeyPanelTitle>
                              <LickPanelHint>
                                마디를 클릭해 구간을 선택한다. Shift+클릭으로 범위 확장,
                                다시 클릭하면 해제 · 최대 8마디.
                              </LickPanelHint>
                              <MergeDoBtn
                                type="button"
                                $big
                                onClick={() => {
                                  setLickSelectMode((v) => {
                                    if (v) setLickRanges([]); // 끌 때 선택도 정리
                                    return !v;
                                  });
                                }}
                              >
                                {lickSelectMode ? '선택 모드 종료' : '선택 모드 시작'}
                              </MergeDoBtn>
                              {lickSelectMode && (
                                <>
                                  <LickPanelCount>선택: {lickSelCount}마디</LickPanelCount>
                                  <MergeDoBtn
                                    type="button"
                                    $big
                                    disabled={lickSaving || lickSelCount === 0}
                                    onClick={() => { void handleSaveLickFromSelection(); }}
                                  >
                                    {lickSaving ? '저장 중…' : `릭으로 저장 (${lickSelCount}마디)`}
                                  </MergeDoBtn>
                                  <RefreshBtn
                                    type="button"
                                    $big
                                    disabled={lickSelCount === 0}
                                    onClick={() => setLickRanges([])}
                                  >
                                    선택 해제
                                  </RefreshBtn>
                                </>
                              )}
                            </LickPanel>
                          )}
                        </KeyAnchor>
                      </BarLeft>
                      {/* ── 중앙: 믹서 · BPM · 재생 ─────────────────────── */}
                      <BarCenter>
                        {/* 믹서 — 트랙별 악기·볼륨·S/M·드럼킷·베이스 모드·카운트인 전체. */}
                        <MixerButton />
                        <BpmControl tempo={soloTempo} onTempoChange={handleSoloTempo} />
                        <RepeatControl repeatCount={repeatCount} onRepeatChange={setRepeatCount} />
                        <TransportButtons
                          playing={soloPlaying}
                          onPlayPause={handleSoloPlayPause}
                          onStop={handleSoloStop}
                        />
                      </BarCenter>

                      {/* ── 우: 정보 · Edit · PDF · Transpose · 삭제 ──────
                          내 코드 차트의 ToolBtn(테두리 없는 38px 아이콘)과 동일. */}
                      <BarRight>
                        <ToolBtn
                          type="button"
                          title="상세 정보"
                          $lit={metaOpen}
                          aria-expanded={metaOpen}
                          onClick={() => setMetaOpen((v) => !v)}
                        >
                          <IcoInfo />
                        </ToolBtn>
                        <ToolBtn type="button" title="에디터에서 열기" onClick={() => { void editRow(selected); }}>
                          <IcoPencil />
                        </ToolBtn>
                        <ToolBtn
                          type="button"
                          title="PDF 로 내려받기"
                          disabled={pdfBusy === selected.publicId}
                          onClick={() => handlePdfDownload(selected)}
                        >
                          <IcoDownload />
                        </ToolBtn>
                        {/* 가사 — 가사가 있는 악보에만 뜬다. 이 악보 전용으로 켜고 끄며,
                            선택은 기기에 기억된다(전역 기본값은 설정에서). */}
                        {lyricVerses > 0 && (
                          <ToolBtn
                            type="button"
                            title={lyricsShown ? '가사 숨기기' : `가사 보기 (${lyricVerses}절)`}
                            aria-pressed={lyricsShown}
                            $lit={lyricsShown}
                            onClick={() => {
                              const next = !lyricsShown;
                              setLyricsOverride(next);
                              setChartLyrics(selected.publicId, next);
                            }}
                          >
                            <IcoLyrics />
                          </ToolBtn>
                        )}
                        <KeyAnchor>
                          <ToolBtn
                            type="button"
                            title="Transpose · 조성 변경"
                            $lit={keyPanel === 'transpose'}
                            disabled={busy === selected.publicId}
                            onClick={() => {
                              setKeyInput('');
                              setKeyPanel((p) => (p === 'transpose' ? null : 'transpose'));
                            }}
                          >
                            <IcoTranspose />
                          </ToolBtn>
                          {keyPanel === 'transpose' && (
                            <KeyChangePopover
                              currentKey={originalDisplayKey}
                              value={keyInput}
                              onChange={setKeyInput}
                              busy={busy === selected.publicId}
                              onApplyTranspose={() => { void applyTranspose(selected, keyInput.trim()); }}
                              onApplyKeyOnly={() => { void applyKeyOnly(selected, keyInput.trim()); }}
                              onPreset={(semi) => {
                                const from = toWeimarKey(selected.key ?? selected.sheetData?.key ?? 'C') ?? 'C-maj';
                                const to = shiftKeyBySemitones(from, semi);
                                if (to) void applyTranspose(selected, to);
                              }}
                              onClose={() => setKeyPanel(null)}
                            />
                          )}
                        </KeyAnchor>
                        <ToolBtn type="button" title="삭제" onClick={() => handleDelete(selected)}>
                          <IcoTrash />
                        </ToolBtn>
                        {/* admin 전용 — 백엔드 GET 응답 원문 확인(디버깅용). */}
                        {isStudio && (
                          <ToolBtn
                            type="button"
                            title="응답값 받기 (admin)"
                            onClick={() => setRawJsonTarget({ id: selected.publicId, title: selected.title })}
                          >
                            <JsonGlyph s={26} />
                          </ToolBtn>
                        )}
                      </BarRight>

                      {/* 메타데이터 — 헤더에 앵커된 오버랩 드롭다운(레이아웃을 밀지 않음). */}
                      {metaOpen && (
                      <MetaPanel>
                        <MetaRow><span>제목</span><b>{selected.title}</b></MetaRow>
                        <MetaRow><span>연주자</span><b>{selected.performer ?? '—'}</b></MetaRow>
                        <MetaRow><span>악기</span><b>{formatInstrument(selected.instrument)}</b></MetaRow>
                        <MetaRow><span>장르</span><b>{formatStyleLabel(selected.style) || 'Unknown'}</b></MetaRow>
                        <MetaRow><span>BPM</span><b>{selected.tempo ?? '—'}</b></MetaRow>
                        <MetaRow><span>조성</span><b>{originalDisplayKey}</b></MetaRow>
                        <MetaRow><span>마디 수</span><b>{selected.sheetData?.measures?.length ?? '—'}</b></MetaRow>
                        <MetaRow><span>추가된 날짜</span><b>{formatAddedDate(selected.createdAt)}</b></MetaRow>
                        <MetaRow>
                          <span>고유 키</span>
                          <MetaIdValue>
                            <code>{selected.publicId}</code>
                            <MetaCopyBtn
                              type="button"
                              $copied={copiedId === selected.publicId}
                              title="고유 키 복사"
                              onClick={() => copyId(String(selected.publicId))}
                            >
                              {copiedId === selected.publicId ? '✓' : '📋'}
                            </MetaCopyBtn>
                          </MetaIdValue>
                        </MetaRow>
                      </MetaPanel>
                      )}
                    </PreviewHeader>
                    {lickSelectMode && (
                      <SelHintBar>
                        마디를 클릭해 구간을 선택하세요 — Shift+클릭: 범위 확장 · 다시 클릭: 해제 · 최대 8마디
                      </SelHintBar>
                    )}
                    <PreviewBody ref={previewBodyRef}>
                      {previewSheet && (
                        <NoteSheet
                          ref={noteSheetRef}
                          data={previewSheet}
                          lineStartMeasureNumbers
                          forceAutoStem
                          hideTransport
                          lockSwing
                          onPlayingChange={setSoloPlaying}
                          onTempoChange={setSoloTempo}
                          selectable={lickSelectMode}
                          selectedRanges={lickRanges}
                          onSelectionChange={setLickRanges}
                          showLyrics={lyricsShown}
                        />
                      )}
                    </PreviewBody>
                  </>
                ) : (
                  <EmptyState>왼쪽에서 솔로를 선택해주세요.</EmptyState>
                )}
              </PreviewCard>
              )}
            </SplitArea>
          </CenterColumn>
        </MainArea>
      </RightSection>

      {importModal && (
        <ImportOverlay onClick={() => { if (!importBusy) { setImportModal(null); setImportText(''); setImportError(''); } }}>
          <ImportBox onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h3>{importModal === 'xml' ? 'MusicXML로 생성하기' : 'MIDI로 생성하기'}</h3>
            <p className="sub">
              {importModal === 'xml'
                ? '.xml · .musicxml · .mxl 파일을 선택하거나, 아래에 MusicXML 원문을 붙여넣으세요. 파싱된 악보는 에디터에서 열립니다 — 확인 후 저장하면 Solo Database 에 등록됩니다.'
                : '.mid 파일을 선택하세요. 멜로디 트랙을 자동으로 골라 8분음표 그리드로 양자화해 악보로 만듭니다. 에디터에서 확인 후 저장하세요.'}
            </p>
            <ImportFileRow>
              <input
                type="file"
                accept={importModal === 'xml' ? '.xml,.musicxml,.mxl' : '.mid,.midi'}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void importFromFile(f); e.target.value = ''; }}
              />
            </ImportFileRow>
            {importModal === 'xml' && (
              <>
                <ImportDivider>또는 원문 붙여넣기</ImportDivider>
                <ImportTextarea
                  placeholder={'<?xml version="1.0" ...?>\n<score-partwise ...>'}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                />
                <ImportActions>
                  <MergeDoBtn type="button" $big disabled={!importText.trim() || importBusy} onClick={importFromText}>
                    {importBusy ? '파싱 중…' : '파싱해서 에디터로'}
                  </MergeDoBtn>
                </ImportActions>
              </>
            )}
            {importError && <ImportError>{importError}</ImportError>}
            <ImportActions>
              <RefreshBtn type="button" $big onClick={() => { setImportModal(null); setImportText(''); setImportError(''); }}>닫기</RefreshBtn>
            </ImportActions>
          </ImportBox>
        </ImportOverlay>
      )}

      <OMRUploadModal
        open={omrOpen}
        onClose={() => setOmrOpen(false)}
        title="OMR로 솔로 생성"
        submitLabel="인식 시작 (백그라운드)"
        upload={createSoloViaOMR}
        onBackgroundStart={startSoloOmrJob}
        onQueueStart={enqueueOmrFiles}
      />

      {/* 응답값 받기(admin) — 솔로 GET 원문. */}
      <RawJsonModal
        open={!!rawJsonTarget}
        title={rawJsonTarget?.title ?? ''}
        sources={rawJsonTarget ? [
          { label: 'solo', path: `/v1/solos/${encodeURIComponent(rawJsonTarget.id)}` },
        ] : []}
        onClose={() => setRawJsonTarget(null)}
      />

      {/* ── 큐 영속 기록 (admin) — localStorage 라 이탈/새로고침 후에도 남는다 ── */}
      {queueLogOpen && (
        <QLogBackdrop onClick={() => setQueueLogOpen(false)}>
          <QLogCard onClick={(e) => e.stopPropagation()}>
            <QLogHead>
              <QLogTitle>🗂 OMR 큐 기록</QLogTitle>
              {(() => {
                const eff = queueLogEntries.map(effectiveStatus);
                const done = eff.filter((s) => s === 'COMPLETED').length;
                const failed = eff.filter((s) => s === 'FAILED').length;
                const interrupted = eff.filter((s) => s === 'INTERRUPTED').length;
                return (
                  <QLogSummary>
                    <QLogStat $tone="ok">성공 {done}</QLogStat>
                    <QLogStat $tone="fail">실패 {failed}</QLogStat>
                    {interrupted > 0 && <QLogStat $tone="warn">중단 {interrupted}</QLogStat>}
                    <QLogStat>전체 {queueLogEntries.length}</QLogStat>
                  </QLogSummary>
                );
              })()}
              <QLogClose type="button" aria-label="닫기" onClick={() => setQueueLogOpen(false)}>×</QLogClose>
            </QLogHead>
            <QLogHint>
              큐는 이 페이지가 열려 있어야 진행됩니다 — 탭을 닫거나 새로고침하면 남은 항목은
              <b> 중단</b>으로 남습니다. 중단·실패 항목은 파일을 다시 큐에 넣어 재시도하세요.
            </QLogHint>
            <QLogList>
              {queueLogEntries.length === 0 && <QLogEmpty>기록이 없습니다.</QLogEmpty>}
              {queueLogEntries.map((entry) => {
                const st = effectiveStatus(entry);
                return (
                  <QLogRow key={entry.id} $st={st}>
                    <QLogIcon $st={st} aria-hidden>
                      {st === 'COMPLETED' ? '✓' : st === 'FAILED' ? '✕' : st === 'INTERRUPTED' ? '⏸' : st === 'PROCESSING' ? '▶' : '○'}
                    </QLogIcon>
                    <QLogMain>
                      <QLogName title={entry.title}>{entry.title}</QLogName>
                      <QLogInfo $st={st}>
                        {st === 'COMPLETED' && `완료${entry.endedAt && entry.startedAt ? ` · ${Math.round((entry.endedAt - entry.startedAt) / 1000)}초` : ''}`}
                        {st === 'FAILED' && (entry.failureReason || '실패')}
                        {st === 'INTERRUPTED' && '중단됨 — 페이지 이탈로 처리되지 않음 (다시 큐에 넣어주세요)'}
                        {st === 'PROCESSING' && '인식 중…'}
                        {st === 'QUEUED' && '대기 중'}
                      </QLogInfo>
                    </QLogMain>
                    <QLogTime>
                      {new Date(entry.queuedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </QLogTime>
                  </QLogRow>
                );
              })}
            </QLogList>
            <QLogFoot>
              <QLogClearBtn
                type="button"
                onClick={() => { clearQueueLog(); setQueueLogEntries([]); }}
              >
                기록 비우기
              </QLogClearBtn>
            </QLogFoot>
          </QLogCard>
        </QLogBackdrop>
      )}

      {(omrJobs.length > 0 || queueState.items.length > 0) && (
        <OmrPanel role="status" aria-live="polite">
          {/* ── 통합 큐 카드 — 전역 큐(lib/soloOmrQueue) 상태를 그린다 ── */}
          {(() => {
            const qItems = queueState.items;
            if (qItems.length === 0) return null;
            const done = qItems.filter((j) => j.status === 'COMPLETED').length;
            const failed = qItems.filter((j) => j.status === 'FAILED').length;
            const finished = done + failed;
            const total = qItems.length;
            const pct = total > 0 ? Math.round((finished / total) * 100) : 0;
            const active = qItems.find((j) => j.status === 'PROCESSING');
            const running = finished < total;
            const paused = queueState.paused;
            return (
              <QueueCard>
                <QueueHead
                  type="button"
                  onClick={() => setQueueOpen((v) => !v)}
                  aria-expanded={queueOpen}
                >
                  <QueueHeadIcon $running={running && !paused} aria-hidden>
                    {paused ? '⏸' : running ? '' : '✓'}
                  </QueueHeadIcon>
                  <QueueHeadMain>
                    <QueueHeadTitle>
                      OMR 큐 {finished}/{total}
                      <QueueHeadPct>{pct}%</QueueHeadPct>
                      {failed > 0 && <QueueHeadFail>오류 {failed}</QueueHeadFail>}
                    </QueueHeadTitle>
                    <QueueHeadSub>
                      {paused
                        ? '일시정지됨 — 진행 중이던 항목은 마무리됩니다'
                        : active
                        ? `지금: ${active.title}${active.totalPages && active.totalPages > 1 ? ` (${active.completedPages ?? 0}/${active.totalPages}p)` : ''}`
                        : running ? '다음 악보 준비 중…' : failed > 0 ? '완료 — 일부 오류' : '모두 완료'}
                    </QueueHeadSub>
                  </QueueHeadMain>
                  {running && (
                    <QueueAddBtn
                      as="span"
                      role="button"
                      aria-label={paused ? '큐 재개' : '큐 일시정지'}
                      title={paused ? '재개 — 다음 항목부터 다시 진행' : '일시정지 — 진행 중 항목은 마무리, 다음 항목부터 멈춤'}
                      onClick={(e: React.MouseEvent) => {
                        e.stopPropagation();
                        if (paused) resumeOmrQueue(); else pauseOmrQueue();
                      }}
                    >
                      {paused ? '▶' : '⏸'}
                    </QueueAddBtn>
                  )}
                  <QueueAddBtn
                    as="span"
                    role="button"
                    aria-label="큐에 파일 추가"
                    title="큐 맨 뒤에 PDF/이미지 추가 (모두 candidate 로 저장)"
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); queueAddInputRef.current?.click(); }}
                  >
                    ＋
                  </QueueAddBtn>
                  <QueueChevron $open={queueOpen} aria-hidden>⌄</QueueChevron>
                  <OmrDismiss
                    as="span"
                    role="button"
                    aria-label="큐 전체 닫기"
                    onClick={(e: React.MouseEvent) => { e.stopPropagation(); dismissOmrQueueAll(); }}
                  >
                    ×
                  </OmrDismiss>
                </QueueHead>
                <HiddenQueueInput
                  ref={queueAddInputRef}
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/jpg,application/pdf"
                  onChange={handleQueueAddFiles}
                />
                <QueueBarTrack>
                  <QueueBarDone $pct={(done / total) * 100} />
                  <QueueBarFailSeg $left={(done / total) * 100} $pct={(failed / total) * 100} />
                </QueueBarTrack>
                {queueOpen && (
                  <QueueDetail ref={queueListRef}>
                    {qItems.map((job, i) => (
                      <QueueDetailRow
                        key={job.id}
                        data-active={job.status === 'PROCESSING' ? 'true' : undefined}
                        $status={job.status}
                        onClick={job.status === 'COMPLETED' ? () => openQueueItem(job) : undefined}
                        title={job.status === 'FAILED' ? (job.failureReason ?? undefined) : job.status === 'COMPLETED' ? '에디터로 열기' : undefined}
                      >
                        <QueueRowIcon $status={job.status} aria-hidden>
                          {job.status === 'COMPLETED' ? '✓' : job.status === 'FAILED' ? '✕' : job.status === 'PROCESSING' ? '' : i + 1}
                        </QueueRowIcon>
                        <QueueRowMain>
                          <QueueRowName>{job.title}</QueueRowName>
                          {job.status === 'PROCESSING' && (
                            <QueueRowInfo>
                              인식 중{job.totalPages && job.totalPages > 1 ? ` · ${job.completedPages ?? 0}/${job.totalPages}페이지` : ''}{job.progress > 0 ? ` · ${Math.round(job.progress)}%` : ''}
                            </QueueRowInfo>
                          )}
                          {job.status === 'FAILED' && (
                            <QueueRowInfo $fail>{job.failureReason || '인식 실패'}</QueueRowInfo>
                          )}
                        </QueueRowMain>
                        {job.status === 'FAILED' && (
                          <QueueRowRemove
                            type="button"
                            aria-label={`${job.title} 재시도`}
                            title="재시도 — 파일 보관분 재업로드 또는 서버 상태 재확인"
                            onClick={(e) => { e.stopPropagation(); retryOmrQueueItem(job.id); }}
                          >
                            ↻
                          </QueueRowRemove>
                        )}
                        {(job.status === 'QUEUED' || job.status === 'FAILED') && (
                          <QueueRowRemove
                            type="button"
                            aria-label={`${job.title} 큐에서 제거`}
                            onClick={(e) => { e.stopPropagation(); dismissOmrQueueItem(job.id); }}
                          >
                            ×
                          </QueueRowRemove>
                        )}
                      </QueueDetailRow>
                    ))}
                    <QueueAddRow type="button" onClick={() => queueAddInputRef.current?.click()}>
                      ＋ PDF·이미지 추가 (맨 뒤에 붙음 · candidate)
                    </QueueAddRow>
                  </QueueDetail>
                )}
              </QueueCard>
            );
          })()}

          {/* ── 단건 백그라운드 잡(큐 아님)은 기존 개별 카드 유지 ── */}
          {omrJobs.map((job) => (
            <OmrCard key={job.id} $status={job.status}>
              <OmrTop>
                <OmrIcon $status={job.status} aria-hidden>
                  {job.status === 'COMPLETED' ? '✓' : job.status === 'FAILED' ? '!' : ''}
                </OmrIcon>
                <OmrLabel title={job.label}>{job.label}</OmrLabel>
                <OmrDismiss onClick={() => dismissOmrJob(job.id)} aria-label="닫기">×</OmrDismiss>
              </OmrTop>
              <OmrStatusText $status={job.status}>
                {job.status === 'QUEUED'
                  ? '대기 중 — 앞 악보가 끝나면 시작합니다'
                  : job.status === 'PROCESSING'
                  ? [
                      '악보 인식 중…',
                      // 다중 페이지 PDF: 몇 페이지까지 됐는지 함께 보여준다.
                      job.totalPages && job.totalPages > 1
                        ? `${job.completedPages ?? 0}/${job.totalPages}페이지`
                        : null,
                      job.progress > 0 ? `${Math.round(job.progress)}%` : null,
                    ].filter(Boolean).join(' · ')
                  : job.status === 'COMPLETED'
                    ? '인식 완료'
                    : (job.failureReason || '악보 인식에 실패했어요.')}
              </OmrStatusText>
              {job.status === 'PROCESSING' && (
                <OmrBar>
                  <OmrBarFill $progress={job.progress} />
                </OmrBar>
              )}
              {job.status === 'COMPLETED' && (
                <OmrOpenBtn onClick={() => openOmrJob(job)}>에디터로 열기</OmrOpenBtn>
              )}
            </OmrCard>
          ))}
        </OmrPanel>
      )}
    </PageContainer>
  );
}
