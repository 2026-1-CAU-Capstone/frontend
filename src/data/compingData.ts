/* Comping Database — **로컬(localStorage) 저장소**.
 *
 * 피아노 컴핑 자료를 장르별로 모으는 admin 수집 도구. 백엔드는 나중에 붙일
 * 예정이라 지금은 프론트 로컬에만 남긴다(릭의 user-lick localStorage 패턴과
 * 동일한 결). 백엔드가 생기면 이 모듈의 load/save 를 API 호출로 갈아끼우고,
 * 기존 로컬 데이터는 exportCompings() JSON 으로 이관한다.
 *
 * 용량 주의: localStorage(~5MB) 에 sheetData JSON 을 통째로 담는다. 컴핑은
 * 짧은 패턴(수 마디) 위주라 수백 건까지 무리 없다 — 쓰기 실패는 조용히 warn.
 */
import type { NoteSheetData } from './sampleMelody';

export const COMPING_GENRES = ['SWING', 'BLUES', 'BOSSA', 'LATIN'] as const;
export type CompingGenre = typeof COMPING_GENRES[number];

export const COMPING_GENRE_LABELS: Record<CompingGenre, string> = {
  SWING: 'Swing',
  BLUES: 'Blues',
  BOSSA: 'BossaNova',
  LATIN: 'Latin',
};

export interface CompingEntry {
  id: string;
  title: string;
  genre: CompingGenre;
  composer?: string;
  key: string;
  tempo?: number;
  sheetData: NoteSheetData;
  /** 원본 MusicXML(있을 때) — 양손·화음 등 **전체 정보의 원천**을 함께 보존한다.
   *  sheetData 파싱이 놓친 게 있어도 나중에 재파싱·백엔드 이관이 가능하도록.
   *  (OMR 경로는 백엔드가 원문을 안 줘서 비어 있음 — 문서 #33 반영 시 채워질 예정) */
  musicXml?: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'jazzify_comping_entries';

function read(): CompingEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(entries: CompingEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch (e) {
    console.warn('[compingData] localStorage write failed', e);
  }
}

/** 전체 목록 — 최근 수정 순. */
export function loadCompings(): CompingEntry[] {
  return read().sort((a, b) => b.updatedAt - a.updatedAt);
}

export function getComping(id: string): CompingEntry | null {
  return read().find((e) => e.id === id) ?? null;
}

/** 새 컴핑 저장. id 를 돌려준다. */
export function createComping(input: Omit<CompingEntry, 'id' | 'createdAt' | 'updatedAt'>): CompingEntry {
  const now = Date.now();
  const entry: CompingEntry = {
    ...input,
    id: `cmp-${now}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: now,
    updatedAt: now,
  };
  write([...read(), entry]);
  return entry;
}

/** 기존 컴핑 갱신(에디터 수정 저장). 없는 id 면 null. */
export function updateComping(
  id: string,
  patch: Partial<Omit<CompingEntry, 'id' | 'createdAt'>>,
): CompingEntry | null {
  const entries = read();
  const i = entries.findIndex((e) => e.id === id);
  if (i === -1) return null;
  entries[i] = { ...entries[i], ...patch, updatedAt: Date.now() };
  write(entries);
  return entries[i];
}

export function deleteComping(id: string): void {
  write(read().filter((e) => e.id !== id));
}

/** 백엔드 이관/백업용 JSON 내보내기. */
export function exportCompings(): string {
  return JSON.stringify(read(), null, 2);
}
