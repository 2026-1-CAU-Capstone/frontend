import { useEffect, useMemo, useState } from 'react';
import styled from 'styled-components';
import { isComposingEvent } from '../../lib/ime';
import { getSongIndex, type SongEntry } from '../../lib/ireal/irealLoader';

/* ─────────────────────────────────────────────────────────────────────────
 * SongPicker — searches the iReal Pro "Jazz 1460" catalog by title/composer
 * and lets the admin lock the AMT clip to one song. The picked song's chord
 * progression becomes the ground-truth label (rendered elsewhere via
 * LeadSheet), so the metadata chords always come from the catalog — never
 * free-typed. Same data path as the app's SearchSheet: getSongIndex() →
 * substring match → index → getSong(index).
 * ──────────────────────────────────────────────────────────────────────── */

interface Props {
  selected: SongEntry | null;
  onPick: (entry: SongEntry) => void;
  onClear: () => void;
}

const MAX_RESULTS = 40;

export function SongPicker({ selected, onPick, onClear }: Props) {
  const [songs, setSongs] = useState<SongEntry[]>([]);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    getSongIndex().then(setSongs).catch(() => {});
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return songs
      .filter((s) => s.title.toLowerCase().includes(q) || s.composer.toLowerCase().includes(q))
      .slice(0, MAX_RESULTS);
  }, [query, songs]);

  if (selected) {
    return (
      <Picked>
        <PickedMain>
          <PickedTitle>{selected.title}</PickedTitle>
          <PickedMeta>{selected.composer} · {selected.style} · Key {selected.key}</PickedMeta>
        </PickedMain>
        <ChangeBtn onClick={() => { setQuery(''); onClear(); }}>변경</ChangeBtn>
      </Picked>
    );
  }

  return (
    <SearchWrap>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 150)}
        placeholder="곡 제목 또는 작곡가 검색 (iReal Pro 1460곡)"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isComposingEvent(e) && results[0]) onPick(results[0]);
        }}
      />
      {focused && query.trim() && (
        <Dropdown>
          {results.length === 0 ? (
            <Empty>검색 결과 없음</Empty>
          ) : (
            results.map((s) => (
              <Item key={s.index} onMouseDown={() => onPick(s)}>
                <ItemTitle>{s.title}</ItemTitle>
                <ItemMeta>{s.composer} · {s.style}</ItemMeta>
              </Item>
            ))
          )}
        </Dropdown>
      )}
    </SearchWrap>
  );
}

const SearchWrap = styled.div`
  position: relative;
`;

const Input = styled.input`
  width: 100%;
  padding: 10px 14px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.92rem;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.gold}; }
`;

const Dropdown = styled.div`
  position: absolute;
  z-index: 20;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 320px;
  overflow-y: auto;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.18);
`;

const Item = styled.button`
  display: block;
  width: 100%;
  text-align: left;
  padding: 9px 14px;
  background: transparent;
  border: none;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  cursor: pointer;
  &:last-child { border-bottom: none; }
  &:hover { background: ${({ theme }) => theme.colors.bgSecondary}; }
`;

const ItemTitle = styled.div`
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const ItemMeta = styled.div`
  font-size: 0.76rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Empty = styled.div`
  padding: 12px 14px;
  font-size: 0.85rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Picked = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  border-radius: 10px;
  border: 1.5px solid ${({ theme }) => theme.colors.gold};
  background: ${({ theme }) => theme.colors.gold}14;
`;

const PickedMain = styled.div`
  flex: 1;
  min-width: 0;
`;

const PickedTitle = styled.div`
  font-size: 1rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const PickedMeta = styled.div`
  font-size: 0.8rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const ChangeBtn = styled.button`
  padding: 6px 12px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.82rem;
  cursor: pointer;
  &:hover { border-color: ${({ theme }) => theme.colors.gold}; }
`;
