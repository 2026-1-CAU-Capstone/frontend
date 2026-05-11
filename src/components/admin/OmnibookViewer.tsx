/**
 * Charlie Parker Omnibook MusicXML viewer.
 *
 * data/omnibook/Omnibook xml/*.xml 50곡을 좌측 사이드바에 나열하고
 * 선택 시 xmlMelodyParser로 파싱해 NoteSheet로 렌더 — SJS 뷰어와 동일 패턴.
 */

import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { NoteSheet } from '../notesheet/NoteSheet';
import type { NoteSheetData } from '../../data/sampleMelody';
import { loadXmlMelody } from '../../lib/note/xmlMelodyParser';

const omnibookModules = import.meta.glob('../../../data/omnibook/Omnibook xml/*.xml', {
  import: 'default',
  query: '?url',
}) as Record<string, () => Promise<string>>;

interface OmnibookEntry {
  id: string;
  title: string;
  loadUrl: () => Promise<string>;
}

const omnibookEntries: OmnibookEntry[] = Object.entries(omnibookModules)
  .map(([path, loadUrl]) => {
    const fn = path.split('/').pop() ?? '';
    const title = decodeURIComponent(fn).replace(/\.xml$/i, '').replace(/_/g, ' ');
    return { id: fn, title, loadUrl };
  })
  .sort((a, b) => a.title.localeCompare(b.title));

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

export function OmnibookViewer() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<NoteSheetData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!selectedId) { setSheet(null); setError(null); return; }
    const entry = omnibookEntries.find((e) => e.id === selectedId);
    if (!entry) return;
    setLoading(true);
    setError(null);
    entry.loadUrl()
      .then((url) => loadXmlMelody(url, entry.title))
      .then((data) => { setSheet(data); setLoading(false); })
      .catch((e) => {
        console.error('Failed to load Omnibook XML', e);
        setError(String(e));
        setSheet(null);
        setLoading(false);
      });
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return omnibookEntries;
    return omnibookEntries.filter((e) => e.title.toLowerCase().includes(q));
  }, [search]);

  return (
    <Layout>
      <Sidebar>
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
              <NoteSheet data={sheet} />
            </Section>
          </>
        )}
      </Main>
    </Layout>
  );
}
