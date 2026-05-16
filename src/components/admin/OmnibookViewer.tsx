/**
 * Omnibook MusicXML viewer.
 *
 * source prop으로 어떤 작곡가 폴더를 렌더할지 결정:
 *   - 'parker' → data/omnibook/Omnibook xml/*.xml (50+ songs)
 *   - 'miles'  → data/miles_davis_xml/*.musicxml
 * Vite glob은 빌드 타임에 static 경로를 요구하므로 두 글랍을 모두 정의해 두고
 * source별로 분기.
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { NoteSheet } from '../notesheet/NoteSheet';
import type { NoteSheetData } from '../../data/sampleMelody';
import { loadXmlMelody } from '../../lib/note/xmlMelodyParser';
import { useLickRegionPicker, LickRegionControls } from './lickRegionPicker';
import { inferKeyFromMeasures } from '../../lib/note/keyInference';
import { OMNIBOOK_KEY_OVERRIDES } from '../../data/omnibookKeys';
import { loadAllSolos } from '../../data/soloData';
import {
  ALL_KEYS_MAJOR,
  ALL_KEYS_MINOR,
  normalizeNoteKeyDisplay,
  noteKeyIsMinor,
  transposeNoteSheet,
} from '../../lib/note/transposeNoteSheet';

const parkerModules = import.meta.glob('../../../data/omnibook/Omnibook xml/*.xml', {
  import: 'default',
  query: '?url',
}) as Record<string, () => Promise<string>>;

const milesModules = import.meta.glob('../../../data/miles_davis_xml/*.musicxml', {
  import: 'default',
  query: '?url',
}) as Record<string, () => Promise<string>>;

/* Patrick Bartley solos are authored directly as NoteSheetData JSON
 * (not MusicXML), so they're eager-imported and bypass the XML parser. */
const bartleyJsonModules = import.meta.glob('../../../data/patrick_bartley/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, NoteSheetData>;

type ArtistId = 'parker' | 'miles' | 'bartley' | 'backend';

interface OmnibookEntry {
  id: string;            // unique key (artist-prefixed for merged mode)
  fileId: string;        // original filename (used for OMNIBOOK_KEY_OVERRIDES lookup)
  title: string;
  artist: ArtistId;
  composer: string;
  /** XML-based loader: resolves to a URL string the XML parser fetches. */
  loadUrl?: () => Promise<string>;
  /** JSON-based loader: resolves directly to a parsed NoteSheetData. */
  loadJson?: () => NoteSheetData;
}

function buildEntries(
  modules: Record<string, () => Promise<string>>,
  artist: 'parker' | 'miles',
  composer: string,
): OmnibookEntry[] {
  return Object.entries(modules)
    .map(([path, loadUrl]) => {
      const fn = path.split('/').pop() ?? '';
      const title = decodeURIComponent(fn).replace(/\.(musicxml|xml)$/i, '').replace(/_/g, ' ');
      return { id: `${artist}/${fn}`, fileId: fn, title, artist, composer, loadUrl };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

function buildJsonEntries(
  modules: Record<string, NoteSheetData>,
  artist: ArtistId,
  composer: string,
): OmnibookEntry[] {
  return Object.entries(modules)
    .map(([path, data]) => {
      const fn = path.split('/').pop() ?? '';
      const title = data.title || decodeURIComponent(fn).replace(/\.json$/i, '').replace(/_/g, ' ');
      return {
        id: `${artist}/${fn}`,
        fileId: fn,
        title,
        artist,
        composer,
        loadJson: () => data,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

const PARKER_ENTRIES  = buildEntries(parkerModules, 'parker', 'Charlie Parker');
const MILES_ENTRIES   = buildEntries(milesModules,  'miles',  'Miles Davis');
const BARTLEY_ENTRIES = buildJsonEntries(bartleyJsonModules, 'bartley', 'Patrick Bartley');

const SOURCES = {
  parker:  { entries: PARKER_ENTRIES,  composer: 'Charlie Parker'  },
  miles:   { entries: MILES_ENTRIES,   composer: 'Miles Davis'     },
  bartley: { entries: BARTLEY_ENTRIES, composer: 'Patrick Bartley' },
  solo:    {
    entries: [...PARKER_ENTRIES, ...MILES_ENTRIES, ...BARTLEY_ENTRIES]
      .sort((a, b) => a.title.localeCompare(b.title)),
    composer: '',
  },
} as const;

export type OmnibookSource = keyof typeof SOURCES;

type ArtistFilter = 'all' | ArtistId;

const Layout = styled.div`
  display: grid;
  grid-template-columns: 320px 1fr;
  gap: 16px;
  height: 100%;
  padding: 16px;
  box-sizing: border-box;
  overflow: hidden;
`;

const Sidebar = styled.div`
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  display: flex;
  flex-direction: column;
  min-height: 0;
`;

const ControlsWrapper = styled.div`
  padding: 10px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgSecondary};
  display: flex;
  flex-direction: column;
  align-items: center;
  border-radius: 8px 8px 0 0;
`;

const FilterRow = styled.div`
  display: flex;
  gap: 6px;
  padding: 6px 10px 0;
  align-items: center;
`;

const FilterLabel = styled.label`
  font-family: 'DM Sans', sans-serif;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ArtistSelect = styled.select`
  flex: 1;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  padding: 4px 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 5px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  &:focus { outline: none; border-color: ${({ theme }) => theme.colors.gold}; }
`;

/** Per-artist color tokens (background + foreground for the inline tag). */
const ARTIST_COLORS: Record<ArtistId, { bg: string; fg: string }> = {
  parker:  { bg: 'rgba(184, 134, 11, 0.18)', fg: '#8B6914' },
  miles:   { bg: 'rgba(40, 100, 160, 0.18)', fg: '#1a4f8a' },
  bartley: { bg: 'rgba(120, 50, 160, 0.18)', fg: '#5e2484' },
  backend: { bg: 'rgba(46, 125, 50, 0.18)',  fg: '#2e7d32' },
};

const ArtistTag = styled.span<{ $artist: ArtistId }>`
  display: inline-block;
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 3px;
  margin-right: 6px;
  vertical-align: middle;
  white-space: nowrap;
  background: ${({ $artist }) => ARTIST_COLORS[$artist].bg};
  color: ${({ $artist }) => ARTIST_COLORS[$artist].fg};
`;

/** Centralized artist display info — single source of truth for full names. */
const ARTIST_INFO: Record<ArtistId, { full: string }> = {
  parker:  { full: 'Charlie Parker' },
  miles:   { full: 'Miles Davis' },
  bartley: { full: 'Patrick Bartley' },
  backend: { full: 'Backend (Saved)' },
};

const SearchInput = styled.input`
  margin: 10px;
  padding: 8px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Status = styled.div`
  padding: 4px 12px 8px;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: 'DM Sans', sans-serif;
`;

const SongList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 0 4px 8px;
`;

const SongItem = styled.button<{ $active: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  padding: 7px 10px;
  border: none;
  background: ${({ $active, theme }) => $active ? theme.colors.gold + '22' : 'transparent'};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 12.5px;
  cursor: pointer;
  border-radius: 4px;
  margin-bottom: 2px;
  font-family: 'DM Sans', sans-serif;
  &:hover { background: ${({ theme }) => theme.colors.gold + '15'}; }
`;

const Main = styled.div`
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding-right: 8px;
`;

const Heading = styled.div`
  font-family: 'DM Sans', sans-serif;
  font-weight: 700;
  font-size: 1.05rem;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const MetaRow = styled.div`
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const HeadingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
`;

const KeySelect = styled.select`
  height: 34px;
  padding: 0 34px 0 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;

  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.gold};
  }
`;

const EditBtn = styled.button`
  padding: 5px 12px;
  font-family: 'DM Sans', sans-serif;
  font-size: 12px;
  font-weight: 600;
  background: #fff;
  color: #1565c0;
  border: 1px solid #90caf9;
  border-radius: 5px;
  cursor: pointer;
  &:hover { background: #e3f2fd; }
`;

const Section = styled.section`
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: #fff;
  padding: 12px 14px 6px;
`;

const Empty = styled.div`
  padding: 40px;
  text-align: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
`;

export function OmnibookViewer({ source = 'parker' }: { source?: OmnibookSource } = {}) {
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<NoteSheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [artistFilter, setArtistFilter] = useState<ArtistFilter>('all');
  const [selectedKey, setSelectedKey] = useState('C');
  /** Solos saved to the backend (GET /v1/solos). Lazily fetched only when
   *  this viewer is rendered with source='solo'. The static Patrick Bartley
   *  JSON entries stay too — backend ones are appended. */
  const [backendSolos, setBackendSolos] = useState<OmnibookEntry[]>([]);

  // Source 바뀌면 선택/상태 초기화
  useEffect(() => {
    setSelectedId(null);
    setSheet(null);
    setError(null);
    setSearch('');
    setArtistFilter('all');
    setSelectedKey('C');
  }, [source]);

  // Backend solos: fetch on mount for the merged 'solo' source.
  useEffect(() => {
    if (source !== 'solo') return;
    let cancelled = false;
    loadAllSolos(true)
      .then((solos) => {
        if (cancelled) return;
        const entries: OmnibookEntry[] = solos.map((s) => ({
          id: `backend/${s.publicId}`,
          fileId: s.publicId,
          title: s.title || '(untitled solo)',
          artist: 'backend',
          composer: s.performer || 'Saved Solo',
          loadJson: () => s.sheetData,
        }));
        setBackendSolos(entries);
      })
      .catch((e) => {
        console.warn('[OmnibookViewer] backend solos load failed:', e);
        if (!cancelled) setBackendSolos([]);
      });
    return () => { cancelled = true; };
  }, [source]);

  /** Final entries list. For 'solo' source we merge backend solos in;
   *  others keep their static set verbatim. */
  const omnibookEntries = useMemo<OmnibookEntry[]>(() => {
    const base = SOURCES[source].entries as OmnibookEntry[];
    if (source !== 'solo' || backendSolos.length === 0) return base;
    return [...base, ...backendSolos].sort((a, b) => a.title.localeCompare(b.title));
  }, [source, backendSolos]);

  useEffect(() => {
    if (!selectedId) { setSheet(null); setError(null); return; }
    const entry = omnibookEntries.find((e) => e.id === selectedId);
    if (!entry) return;
    setLoading(true);
    setError(null);

    // JSON entries: already a parsed NoteSheetData — use as-is, no XML parser
    // and no key inference (the JSON is authored, so its `key` is trusted).
    if (entry.loadJson) {
      try {
        const data = entry.loadJson();
        setSheet({ ...data, composer: entry.composer || data.composer });
        setLoading(false);
      } catch (e) {
        console.error('Failed to read JSON entry', e);
        setError(String(e));
        setSheet(null);
        setLoading(false);
      }
      return;
    }

    if (!entry.loadUrl) {
      setError('Entry has neither loadUrl nor loadJson');
      setSheet(null);
      setLoading(false);
      return;
    }

    entry.loadUrl()
      .then((url) => loadXmlMelody(url, entry.title))
      .then((data) => {
        // The Omnibook XMLs almost never have a <creator type="composer"> tag —
        // force the composer to the performer so the header is never blank/"Unknown".
        // The XMLs also almost all have <fifths>0</fifths> regardless of the
        // tune's actual key; recover the tonal center from the chord progression,
        // falling back to a manual override map for tunes where the heuristic
        // doesn't land on the right answer.
        const manualKey = (entry.artist === 'parker' || entry.artist === 'miles')
          ? OMNIBOOK_KEY_OVERRIDES[entry.artist]?.[entry.fileId]
          : undefined;
        const inferredKey = manualKey ?? inferKeyFromMeasures(data.measures) ?? data.key;
        setSheet({ ...data, composer: entry.composer, key: inferredKey });
        setLoading(false);
      })
      .catch((e) => {
        console.error('Failed to load Omnibook XML', e);
        setError(String(e));
        setSheet(null);
        setLoading(false);
      });
  }, [selectedId, omnibookEntries]);

  useEffect(() => {
    if (!sheet) return;
    setSelectedKey(normalizeNoteKeyDisplay(sheet.key));
  }, [sheet]);

  const filtered = useMemo(() => {
    let list = omnibookEntries;
    if (artistFilter !== 'all') {
      list = list.filter((e) => e.artist === artistFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((e) => e.title.toLowerCase().includes(q));
    return list;
  }, [search, omnibookEntries, artistFilter]);

  /* ── Lick region picker (always-on hook; uses empty sheet when none loaded) ─ */
  const emptySheet: NoteSheetData = useMemo(
    () => ({ title: '', composer: '', key: 'C', timeSignature: '4/4', measures: [] }),
    [],
  );
  const originalKey = normalizeNoteKeyDisplay(sheet?.key);
  const keyOptions = noteKeyIsMinor(originalKey) ? ALL_KEYS_MINOR : ALL_KEYS_MAJOR;
  const transposedSheet = useMemo(() => {
    if (!sheet) return null;
    const normalizedSheet = { ...sheet, key: originalKey };
    return transposeNoteSheet(normalizedSheet, selectedKey);
  }, [sheet, originalKey, selectedKey]);
  const selectedEntry = selectedId ? omnibookEntries.find((e) => e.id === selectedId) : null;
  const performer = selectedEntry?.composer
    ?? (source === 'parker' ? 'Charlie Parker' : source === 'miles' ? 'Miles Davis' : 'Solo');
  const picker = useLickRegionPicker({
    sheetData: transposedSheet ?? emptySheet,
    performer,
    title: transposedSheet?.title ?? '',
    tag: source === 'solo'
      ? (selectedEntry?.artist === 'miles' ? 'omnibook-miles-region' : 'omnibook-parker-region')
      : (source === 'parker' ? 'omnibook-parker-region' : 'omnibook-miles-region'),
  });

  return (
    <Layout>
      <Sidebar>
        <ControlsWrapper>
          <LickRegionControls picker={picker} />
        </ControlsWrapper>
        {source === 'solo' && (
          <FilterRow>
            <FilterLabel htmlFor="artist-select">Artist:</FilterLabel>
            <ArtistSelect
              id="artist-select"
              value={artistFilter}
              onChange={(e) => setArtistFilter(e.target.value as ArtistFilter)}
            >
              <option value="all">All Artists ({omnibookEntries.length})</option>
              <option value="parker">{ARTIST_INFO.parker.full} ({PARKER_ENTRIES.length})</option>
              <option value="miles">{ARTIST_INFO.miles.full} ({MILES_ENTRIES.length})</option>
              <option value="bartley">{ARTIST_INFO.bartley.full} ({BARTLEY_ENTRIES.length})</option>
              {backendSolos.length > 0 && (
                <option value="backend">{ARTIST_INFO.backend.full} ({backendSolos.length})</option>
              )}
            </ArtistSelect>
          </FilterRow>
        )}
        <SearchInput
          placeholder={`Search ${omnibookEntries.length} pieces…`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Status>{filtered.length} / {omnibookEntries.length}</Status>
        <SongList>
          {filtered.map((e) => (
            <SongItem
              key={e.id}
              $active={e.id === selectedId}
              onClick={() => setSelectedId(e.id)}
            >
              {source === 'solo' && <ArtistTag $artist={e.artist}>{ARTIST_INFO[e.artist].full}</ArtistTag>}
              {e.title}
            </SongItem>
          ))}
        </SongList>
      </Sidebar>

      <Main>
        {!selectedId && <Empty>왼쪽에서 곡을 선택하세요.</Empty>}
        {selectedId && loading && <Empty>Loading…</Empty>}
        {error && <Empty style={{ color: '#c0392b' }}>Error: {error}</Empty>}
        {sheet && (
          <>
            <HeadingRow>
              <Heading>{transposedSheet?.title ?? sheet.title}</Heading>
              <KeySelect
                aria-label="전조 키 선택"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
              >
                {keyOptions.map((key) => (
                  <option key={key} value={key}>{key}</option>
                ))}
              </KeySelect>
              <EditBtn
                onClick={() => navigate('/note/sologenerator', { state: { prefillSheet: transposedSheet ?? sheet } })}
                title="이 악보를 Solo Generator에서 열어 수정"
              >
                ✎ 수정하기
              </EditBtn>
            </HeadingRow>
            <MetaRow>
              <span>composer: {transposedSheet?.composer ?? sheet.composer}</span>
              <span>key: {selectedKey}{selectedKey !== originalKey ? ` (orig ${originalKey})` : ''}</span>
              <span>time: {transposedSheet?.timeSignature ?? sheet.timeSignature}</span>
              {transposedSheet?.tempo && <span>tempo: {transposedSheet.tempo}</span>}
              <span>{(transposedSheet ?? sheet).measures.length} measures</span>
            </MetaRow>
            <Section>
              <NoteSheet
                data={transposedSheet ?? sheet}
                selectable={picker.selectMode}
                selectedRanges={picker.selectedRanges}
                onSelectionChange={picker.setSelectedRanges}
                showMeasureNumbers
                forceAutoStem
              />
            </Section>
          </>
        )}
      </Main>
    </Layout>
  );
}
