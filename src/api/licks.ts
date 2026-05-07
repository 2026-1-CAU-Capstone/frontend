import type { LickEntry } from '../data/lickData';
import type { NoteSheetData } from '../data/sampleMelody';

const API_BASE = 'https://jazzify.p-e.kr/api';

/* ── API response types ───────────────────────────────────────────────────── */

interface LickResponse {
  publicId: string;
  performer: string;
  title: string;
  album: string | null;
  instrument: string;
  style: string | null;
  tempo: number | null;
  key: string;
  rhythmFeel: string | null;
  timeSignature: string;
  chords: string[] | null;
  harmonicContext: string | null;
  sheetData: NoteSheetData;
  nEvents: number;
  intervals: number[] | null;
  parsons: number[] | null;
  fuzzyIntervals: number[] | null;
  durationClasses: number[] | null;
}

interface PageData<T> {
  content: T[];
  totalPages: number;
  last: boolean;
}

interface ApiResponse<T> {
  data: PageData<T>;
}

/* ── Mapper ───────────────────────────────────────────────────────────────── */

function toEntry(r: LickResponse): LickEntry {
  return {
    id: r.publicId,
    performer: r.performer,
    title: r.title,
    album: r.album ?? undefined,
    instrument: r.instrument,
    style: r.style ?? '',
    tempo: r.tempo,
    key: r.key,
    rhythmfeel: r.rhythmFeel ?? '',
    tag: r.harmonicContext ?? '',
    chords: r.chords ?? [],
    nEvents: r.nEvents,
    label: `${r.performer} — ${r.title}`,
    sheetData: r.sheetData,
    intervals: r.intervals ?? [],
    parsons: r.parsons ?? [],
    fuzzyIntervals: r.fuzzyIntervals ?? [],
    durationClasses: r.durationClasses ?? [],
  };
}

/* ── Fetch ────────────────────────────────────────────────────────────────── */

export async function fetchAllLicks(): Promise<LickEntry[]> {
  const PAGE_SIZE = 200;
  const all: LickEntry[] = [];
  let page = 0;
  let isLast = false;

  while (!isLast) {
    const res = await fetch(
      `${API_BASE}/v1/licks?page=${page}&size=${PAGE_SIZE}&sort=createdAt,desc`,
    );
    if (!res.ok) throw new Error(`licks API ${res.status}`);
    const json: ApiResponse<LickResponse> = await res.json();
    all.push(...json.data.content.map(toEntry));
    isLast = json.data.last;
    page++;
  }

  return all;
}
