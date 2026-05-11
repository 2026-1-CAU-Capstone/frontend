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
import styled from 'styled-components';
import { NoteSheet } from '../notesheet/NoteSheet';
import type { NoteSheetData } from '../../data/sampleMelody';
import { loadXmlMelody } from '../../lib/note/xmlMelodyParser';
import { useLickRegionPicker, LickRegionControls } from './lickRegionPicker';
import { inferKeyFromMeasures } from '../../lib/note/keyInference';
import { OMNIBOOK_KEY_OVERRIDES } from '../../data/omnibookKeys';

const parkerModules = import.meta.glob('../../../data/omnibook/Omnibook xml/*.xml', {
  import: 'default',
  query: '?url',
}) as Record<string, () => Promise<string>>;

const milesModules = import.meta.glob('../../../data/miles_davis_xml/*.musicxml', {
  import: 'default',
  query: '?url',
}) as Record<string, () => Promise<string>>;

interface OmnibookEntry {
  id: string;
  title: string;
  loadUrl: () => Promise<string>;
}

function buildEntries(modules: Record<string, () => Promise<string>>): OmnibookEntry[] {
  return Object.entries(modules)
    .map(([path, loadUrl]) => {
      const fn = path.split('/').pop() ?? '';
      const title = decodeURIComponent(fn).replace(/\.(musicxml|xml)$/i, '').replace(/_/g, ' ');
      return { id: fn, title, loadUrl };
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

const SOURCES = {
  parker: { entries: buildEntries(parkerModules), composer: 'Charlie Parker' },
  miles:  { entries: buildEntries(milesModules),  composer: 'Miles Davis' },
} as const;

export type OmnibookSource = keyof typeof SOURCES;

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
  const { entries: omnibookEntries } = SOURCES[source];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<NoteSheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  // Source 바뀌면 선택/상태 초기화
  useEffect(() => {
    setSelectedId(null);
    setSheet(null);
    setError(null);
    setSearch('');
  }, [source]);

  const composerOverride = SOURCES[source].composer;
  useEffect(() => {
    if (!selectedId) { setSheet(null); setError(null); return; }
    const entry = omnibookEntries.find((e) => e.id === selectedId);
    if (!entry) return;
    setLoading(true);
    setError(null);
    entry.loadUrl()
      .then((url) => loadXmlMelody(url, entry.title))
      .then((data) => {
        // The Omnibook XMLs almost never have a <creator type="composer"> tag —
        // force the composer to the performer so the header is never blank/"Unknown".
        // The XMLs also almost all have <fifths>0</fifths> regardless of the
        // tune's actual key; recover the tonal center from the chord progression,
        // falling back to a manual override map for tunes where the heuristic
        // doesn't land on the right answer.
        const manualKey = OMNIBOOK_KEY_OVERRIDES[source]?.[entry.id];
        const inferredKey = manualKey ?? inferKeyFromMeasures(data.measures) ?? data.key;
        setSheet({ ...data, composer: composerOverride, key: inferredKey });
        setLoading(false);
      })
      .catch((e) => {
        console.error('Failed to load Omnibook XML', e);
        setError(String(e));
        setSheet(null);
        setLoading(false);
      });
  }, [selectedId, omnibookEntries, composerOverride, source]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return omnibookEntries;
    return omnibookEntries.filter((e) => e.title.toLowerCase().includes(q));
  }, [search, omnibookEntries]);

  /* ── Lick region picker (always-on hook; uses empty sheet when none loaded) ─ */
  const emptySheet: NoteSheetData = useMemo(
    () => ({ title: '', composer: '', key: 'C', timeSignature: '4/4', measures: [] }),
    [],
  );
  const performer = source === 'parker' ? 'Charlie Parker' : 'Miles Davis';
  const picker = useLickRegionPicker({
    sheetData: sheet ?? emptySheet,
    performer,
    title: sheet?.title ?? '',
    tag: source === 'parker' ? 'omnibook-parker-region' : 'omnibook-miles-region',
  });

  return (
    <Layout>
      <Sidebar>
        <ControlsWrapper>
          <LickRegionControls picker={picker} />
        </ControlsWrapper>
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
            <Heading>{sheet.title}</Heading>
            <MetaRow>
              <span>composer: {sheet.composer}</span>
              <span>key: {sheet.key}</span>
              <span>time: {sheet.timeSignature}</span>
              {sheet.tempo && <span>tempo: {sheet.tempo}</span>}
              <span>{sheet.measures.length} measures</span>
            </MetaRow>
            <Section>
              <NoteSheet
                data={sheet}
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
