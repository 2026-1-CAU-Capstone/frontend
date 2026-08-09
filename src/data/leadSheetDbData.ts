/* ─────────────────────────────────────────────────────────────────────────
 * Lead Sheet Database — **로컬(localStorage) 저장소**.
 *
 * 리드시트(코드 진행 차트)를 스타일별로 모으는 admin 수집 도구. 백엔드는 요구사항
 * 문서 #60 으로 올렸고 아직 없어서, Comping(`compingData`)과 같은 방식으로 프론트
 * 로컬에만 남긴다. 백엔드가 생기면 이 모듈의 load/save 를 API 호출로 갈아끼우고
 * 기존 로컬 데이터는 `exportLeadSheets()` JSON 으로 이관한다.
 *
 * ⚠️ Comping 과 저장하는 데이터가 다르다 — 컴핑은 기보(`NoteSheetData`), 리드시트는
 * **코드 진행(`LeadSheetData`)** 이다. 음표가 없고 마디별 코드 심볼이 본체다.
 *
 * 용량 주의: localStorage(~5MB). 리드시트는 코드 진행만 담아 기보보다 훨씬 작지만
 * (한 곡 수 KB), 쓰기가 실패하면 조용히 넘어가므로 건수가 늘면 백엔드가 필요하다.
 * ──────────────────────────────────────────────────────────────────────── */

import type { LeadSheetData } from './leadSheetTypes';

/* 분류축 — 목록 사이드바가 이 값으로 묶는다. Comping 의 4종 장르와 달리 리드시트는
 * 스탠더드 스타일이 더 다양해서 넉넉하게 둔다(요구사항 문서 #60 에서 백엔드에
 * enum/문자열 선택을 열어 뒀다 — 정해지면 그 값으로 맞춘다). */
export const LEAD_SHEET_STYLES = [
  'SWING', 'BALLAD', 'BOSSA', 'LATIN', 'BLUES', 'WALTZ', 'MODAL', 'FUNK', 'ETC',
] as const;
export type LeadSheetStyle = typeof LEAD_SHEET_STYLES[number];

export const LEAD_SHEET_STYLE_LABELS: Record<LeadSheetStyle, string> = {
  SWING: 'Swing',
  BALLAD: 'Ballad',
  BOSSA: 'BossaNova',
  LATIN: 'Latin',
  BLUES: 'Blues',
  WALTZ: 'Waltz',
  MODAL: 'Modal',
  FUNK: 'Funk',
  ETC: '기타',
};

export interface LeadSheetEntry {
  id: string;
  title: string;
  style: LeadSheetStyle;
  composer?: string;
  key?: string;
  tempo?: number;
  /** 코드 진행 본체. `LeadSheet` 렌더러가 그대로 받는다. */
  chart: LeadSheetData;
  /** 원본 iReal URL(붙여넣기로 만든 경우) — 재파싱·검증에 쓰려고 남긴다. */
  irealSource?: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'jazzify_lead_sheet_entries';

function readAll(): LeadSheetEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? (arr as LeadSheetEntry[]) : [];
  } catch (e) {
    console.warn('[leadSheetDbData] localStorage read failed', e);
    return [];
  }
}

function writeAll(entries: LeadSheetEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    /* 용량 초과가 여기로 온다. 조용히 삼키면 사용자는 저장된 줄 알므로 경고를 남긴다
     * — 백엔드(#60)가 붙으면 사라지는 문제다. */
    console.warn('[leadSheetDbData] localStorage write failed (용량 초과일 수 있음)', e);
  }
}

/** 최근 수정 순. */
export function loadLeadSheets(): LeadSheetEntry[] {
  return readAll().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getLeadSheet(id: string): LeadSheetEntry | null {
  return readAll().find((e) => e.id === id) ?? null;
}

export function createLeadSheet(
  input: Omit<LeadSheetEntry, 'id' | 'createdAt' | 'updatedAt'>,
): LeadSheetEntry {
  const now = Date.now();
  const entry: LeadSheetEntry = {
    ...input,
    /* 서버 발급 publicId 를 흉내내지 않는다 — 로컬 전용임이 드러나야 이관 때 헷갈리지 않는다. */
    id: `local-${now}-${Math.floor(Math.random() * 1e6)}`,
    createdAt: now,
    updatedAt: now,
  };
  writeAll([entry, ...readAll()]);
  return entry;
}

export function updateLeadSheet(
  id: string,
  patch: Partial<Omit<LeadSheetEntry, 'id' | 'createdAt'>>,
): LeadSheetEntry | null {
  const all = readAll();
  const i = all.findIndex((e) => e.id === id);
  if (i < 0) return null;
  const next: LeadSheetEntry = { ...all[i], ...patch, updatedAt: Date.now() };
  all[i] = next;
  writeAll(all);
  return next;
}

export function deleteLeadSheet(id: string): void {
  writeAll(readAll().filter((e) => e.id !== id));
}

/** 백엔드 이관·백업용 JSON. 화면의 '내보내기' 버튼이 쓴다. */
export function exportLeadSheets(): string {
  return JSON.stringify(readAll(), null, 1);
}
