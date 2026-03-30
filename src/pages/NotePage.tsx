import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { TopToolbar } from '../components/layout/TopToolbar';
import { LeftSidebar } from '../components/layout/LeftSidebar';
import { RightChatPanel } from '../components/layout/RightChatPanel';
import { NoteSheet } from '../components/notesheet/NoteSheet';
import { useAutoHighlight } from '../hooks/useAutoHighlight';
import { sampleMelody } from '../data/sampleMelody';
import type { NoteSheetData } from '../data/sampleMelody';
import type { TocEntry } from '../data/types';
import { noteSongs } from '../data/noteSongs';
import { loadMidiMelody } from '../lib/note/midiMelodyParser';
import { loadXmlMelody, loadMxlMelody } from '../lib/note/xmlMelodyParser';

const SAMPLE_ID = '__sample__';

/* ─── transposition ──────────────────────────────────────────────────── */

const ALL_KEYS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;

const NOTE_TO_PC: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
};

const FLAT_KEYS = new Set(['C', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb']);

const PC_FLAT: [string, 'b' | '#' | undefined][] = [
  ['C',undefined],['D','b'],['D',undefined],['E','b'],['E',undefined],
  ['F',undefined],['G','b'],['G',undefined],['A','b'],['A',undefined],
  ['B','b'],['B',undefined],
];
const PC_SHARP: [string, 'b' | '#' | undefined][] = [
  ['C',undefined],['C','#'],['D',undefined],['D','#'],['E',undefined],
  ['F',undefined],['F','#'],['G',undefined],['G','#'],['A',undefined],
  ['A','#'],['B',undefined],
];

function keyToPc(key: string): number {
  const root = key[0].toUpperCase();
  const acc = key.length > 1 ? key[1] : '';
  return ((NOTE_TO_PC[root] ?? 0) + (acc === '#' ? 1 : acc === 'b' ? -1 : 0) + 12) % 12;
}

function transposeNoteKey(vexKey: string, accidental: '#' | 'b' | 'n' | undefined, semitones: number, useFlats: boolean): { key: string; acc?: '#' | 'b' | 'n' } {
  // vexKey e.g. "c/4", "f/5"
  const [notePart, octStr] = vexKey.split('/');
  const noteName = notePart.toUpperCase();
  let pc = NOTE_TO_PC[noteName] ?? 0;
  if (accidental === '#') pc += 1;
  else if (accidental === 'b') pc -= 1;
  pc = ((pc + semitones) % 12 + 12) % 12;

  // Compute new octave
  let origPc = NOTE_TO_PC[noteName] ?? 0;
  if (accidental === '#') origPc += 1;
  else if (accidental === 'b') origPc -= 1;
  const origMidi = parseInt(octStr) * 12 + origPc;
  const newMidi = origMidi + semitones;
  const newOctave = Math.floor(newMidi / 12);
  const newPcInOctave = ((newMidi % 12) + 12) % 12;

  const table = useFlats ? PC_FLAT : PC_SHARP;
  const [newNote, newAcc] = table[newPcInOctave];

  // Clamp octave to playable range: if above C6 (midi 84) → octave down, below C3 (midi 48) → octave up
  let finalOctave = newOctave;
  const finalMidi = finalOctave * 12 + newPcInOctave;
  if (finalMidi >= 84) finalOctave -= 1;   // above C6 → drop octave
  else if (finalMidi < 48) finalOctave += 1; // below C3 → raise octave

  const newKey = `${newNote.toLowerCase()}/${finalOctave}`;
  return { key: newKey, acc: newAcc === undefined ? undefined : newAcc };
}

// Notes altered by each key signature (sharps/flats in the key)
const KEY_SIG_NOTES: Record<string, Set<string>> = {
  'C': new Set(),
  'G': new Set(['F#']), 'D': new Set(['F#','C#']), 'A': new Set(['F#','C#','G#']),
  'E': new Set(['F#','C#','G#','D#']), 'B': new Set(['F#','C#','G#','D#','A#']),
  'F#': new Set(['F#','C#','G#','D#','A#','E#']),
  'F': new Set(['Bb']), 'Bb': new Set(['Bb','Eb']), 'Eb': new Set(['Bb','Eb','Ab']),
  'Ab': new Set(['Bb','Eb','Ab','Db']), 'Db': new Set(['Bb','Eb','Ab','Db','Gb']),
  'Gb': new Set(['Bb','Eb','Ab','Db','Gb','Cb']),
};

function transposeNoteData(data: NoteSheetData, targetKey: string): NoteSheetData {
  const origPc = keyToPc(data.key ?? 'C');
  const targetPc = keyToPc(targetKey);
  const semitones = (targetPc - origPc + 12) % 12;
  if (semitones === 0) return { ...data, key: targetKey };

  const useFlats = FLAT_KEYS.has(targetKey);
  const keySigNotes = KEY_SIG_NOTES[targetKey] ?? new Set();

  return {
    ...data,
    key: targetKey,
    measures: data.measures.map((m) => ({
      ...m,
      notes: m.notes.map((n) => {
        if (n.duration.endsWith('r')) return n; // rests don't transpose
        const origAcc = n.accidentals?.[0] as '#' | 'b' | 'n' | undefined;
        const { key: newKey, acc: newAcc } = transposeNoteKey(n.keys[0], origAcc, semitones, useFlats);
        // Check if this accidental is already in the key signature → omit it
        const noteName = newKey.split('/')[0].toUpperCase();
        const fullNote = newAcc ? `${noteName}${newAcc}` : noteName;
        let finalAcc: Record<number, '#' | 'b' | 'n'> | undefined;
        if (newAcc && keySigNotes.has(fullNote)) {
          // Accidental is part of key signature — don't show it explicitly
          finalAcc = undefined;
        } else if (newAcc) {
          finalAcc = { 0: newAcc };
        } else if (!newAcc && (keySigNotes.has(`${noteName}b`) || keySigNotes.has(`${noteName}#`))) {
          // Natural note but key sig has an altered version → need natural sign
          finalAcc = { 0: 'n' };
        }
        return {
          ...n,
          keys: [newKey],
          accidentals: finalAcc,
        };
      }),
    })),
  };
}

/* ─── styled ─────────────────────────────────────────────────────────── */

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  width: 100vw;
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
  flex-direction: column;
`;

const SongPickerBar = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 16px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
`;

const SongSelect = styled.select`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  padding: 3px 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  max-width: 420px;
`;

const StatusText = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const SearchWrap = styled.div`
  position: relative;
  margin-left: auto;
`;

const SearchInput = styled.input`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  padding: 3px 8px 3px 24px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  width: 220px;
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.textSecondary}; }
  &::placeholder { color: ${({ theme }) => theme.colors.textSecondary}; opacity: 0.6; }
`;

const SearchIcon = styled.span`
  position: absolute;
  left: 7px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.75rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  pointer-events: none;
`;

const SearchResults = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 320px;
  overflow-y: auto;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  z-index: 200;
`;

const SearchItem = styled.button<{ $active?: boolean }>`
  display: block;
  width: 100%;
  text-align: left;
  padding: 6px 10px;
  border: none;
  background: ${({ $active, theme }) => $active ? theme.colors.bgSecondary : 'transparent'};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  cursor: pointer;
  &:hover { background: ${({ theme }) => theme.colors.bgSecondary}; }
`;

const SearchComposer = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-left: 6px;
`;

const CollectionTag = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-left: 4px;
  font-size: 0.72rem;
  opacity: 0.7;
`;

const LeadSheetBtn = styled.button`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  padding: 4px 12px;
  border: 1px solid #b8960a;
  border-radius: 5px;
  background: #fff8e1;
  color: #8B6914;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  &:hover { background: #f5ecd0; }
`;

const KeyDropdownWrap = styled.div`
  position: relative;
  display: inline-block;
`;

const KeyButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  background: #fff;
  border: 1.5px solid #ccc;
  border-radius: 5px;
  padding: 5px 14px;
  cursor: pointer;
  font-family: 'MuseJazz Text', 'Oswald', 'DM Sans', sans-serif;
  font-size: clamp(1.2rem, 2.8cqi, 1.8rem);
  font-weight: 600;
  line-height: 1.3;
  color: #222;
  &:hover { border-color: #888; }

  &::after {
    content: '▾';
    font-size: 0.7em;
    color: #999;
  }
`;

const KeyMenu = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 3px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 8px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.15);
  z-index: 100;
`;

const KeyOption = styled.button<{ $active?: boolean }>`
  background: ${({ $active }) => $active ? '#333' : 'transparent'};
  color: ${({ $active }) => $active ? '#fff' : '#333'};
  border: none;
  border-radius: 4px;
  padding: 7px 12px;
  cursor: pointer;
  font-family: 'MuseJazz Text', 'Oswald', 'DM Sans', sans-serif;
  font-size: clamp(1.0rem, 1.8cqi, 1.3rem);
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
  &:hover { background: ${({ $active }) => $active ? '#333' : '#f0f0f0'}; }
`;

const LoadingState = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'DM Sans', sans-serif;
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

const RightPanelWrapper = styled.div<{ $width: number }>`
  width: ${({ $width }) => $width}px;
  min-width: 180px;
  flex-shrink: 0;
  display: flex;
`;

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
`;

/* ─── component ──────────────────────────────────────────────────────── */

export default function NotePage() {
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const { autoHighlight, toggleAutoHighlight } = useAutoHighlight(true);

  /* song state */
  const [songId, setSongId] = useState(SAMPLE_ID);
  const [sheet, setSheet] = useState<NoteSheetData | null>(sampleMelody);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* key transposition */
  const originalKey = sheet?.key ?? 'C';
  const [selectedKey, setSelectedKey] = useState(originalKey);
  const [keyMenuOpen, setKeyMenuOpen] = useState(false);
  const keyMenuRef = useRef<HTMLDivElement>(null);

  // Reset key when song changes
  useEffect(() => { setSelectedKey(sheet?.key ?? 'C'); }, [sheet]);

  // Close key menu on outside click
  useEffect(() => {
    if (!keyMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (keyMenuRef.current && !keyMenuRef.current.contains(e.target as Node)) setKeyMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [keyMenuOpen]);

  // Transposed sheet data
  const transposedSheet = useMemo(() => {
    if (!sheet) return null;
    if (selectedKey === sheet.key) return sheet;
    return transposeNoteData(sheet, selectedKey);
  }, [sheet, selectedKey]);

  /* search state */
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  /* load selected song */
  useEffect(() => {
    if (songId === SAMPLE_ID) {
      setSheet(sampleMelody);
      setLoading(false);
      setError(null);
      return;
    }

    const song = noteSongs.find((s) => s.id === songId);
    if (!song) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const url = await song.loadUrl();
        const data =
          song.fileType === 'midi'
            ? await loadMidiMelody(url, song.title, song.composer)
            : song.fileType === 'mxl'
              ? await loadMxlMelody(url, song.title)
              : await loadXmlMelody(url, song.title);
        if (!cancelled) setSheet(data);
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load song:', err);
          setError(err instanceof Error ? err.message : 'Failed to load song.');
          setSheet(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [songId]);

  /* search filter */
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const q = searchQuery.toLowerCase();
    return noteSongs
      .filter((s) => s.title.toLowerCase().includes(q) || s.composer.toLowerCase().includes(q))
      .slice(0, 30);
  }, [searchQuery]);

  /* close search on outside click */
  useEffect(() => {
    if (!searchOpen) return;
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [searchOpen]);

  /* toc */
  const toc = useMemo<TocEntry[]>(() => {
    if (!sheet) return [];
    return [{ title: sheet.title, page: 1 }];
  }, [sheet]);

  /* resizable right panel */
  const [rightPanelWidth, setRightPanelWidth] = useState(360);
  const dividerRef = useRef<HTMLDivElement>(null);

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
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [rightPanelWidth]);

  return (
    <PageContainer>
      <TopToolbar
        autoHighlight={autoHighlight}
        onToggleHighlight={toggleAutoHighlight}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
      />

      <MainArea>
        <LeftSidebar
          open={sidebarOpen}
          toc={toc}
          activePage={1}
          onPageSelect={() => {}}
        />

        <CenterColumn>
          <SongPickerBar>
            <span>Note {noteSongs.length}</span>
            <LeadSheetBtn onClick={() => navigate('/note/leadsheetgenerator')}>Lead Sheet Generator</LeadSheetBtn>
            <SongSelect value={songId} onChange={(e) => setSongId(e.target.value)}>
              <option value={SAMPLE_ID}>Blues for Alice (Sample)</option>
              {noteSongs.map((song) => (
                <option key={song.id} value={song.id}>
                  {song.title} -- {song.composer} [{song.collection}]
                </option>
              ))}
            </SongSelect>
            {sheet && !loading && (
              <KeyDropdownWrap ref={keyMenuRef}>
                <KeyButton onClick={() => setKeyMenuOpen((v) => !v)}>
                  {selectedKey}
                </KeyButton>
                {keyMenuOpen && (
                  <KeyMenu>
                    {ALL_KEYS.map((k) => (
                      <KeyOption
                        key={k}
                        $active={k === selectedKey}
                        onClick={() => { setSelectedKey(k); setKeyMenuOpen(false); }}
                      >
                        {k}
                      </KeyOption>
                    ))}
                  </KeyMenu>
                )}
              </KeyDropdownWrap>
            )}
            <StatusText>
              {loading
                ? 'Loading...'
                : sheet
                  ? `${sheet.timeSignature}`
                  : error ?? ''}
            </StatusText>
            <SearchWrap ref={searchRef}>
              <SearchIcon>&#128269;</SearchIcon>
              <SearchInput
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSearchOpen(true); }}
                onFocus={() => setSearchOpen(true)}
              />
              {searchOpen && searchQuery.trim() && (
                <SearchResults>
                  {searchResults.length === 0 ? (
                    <SearchItem as="div">No results</SearchItem>
                  ) : (
                    searchResults.map((song) => (
                      <SearchItem
                        key={song.id}
                        onClick={() => {
                          setSongId(song.id);
                          setSearchQuery('');
                          setSearchOpen(false);
                        }}
                      >
                        {song.title}
                        <SearchComposer>-- {song.composer}</SearchComposer>
                        <CollectionTag>[{song.collection}]</CollectionTag>
                      </SearchItem>
                    ))
                  )}
                </SearchResults>
              )}
            </SearchWrap>
          </SongPickerBar>

          {transposedSheet && !loading ? (
            <NoteSheet data={transposedSheet} />
          ) : (
            <LoadingState>
              {error ?? (loading ? 'Loading...' : 'Loading song list...')}
            </LoadingState>
          )}
        </CenterColumn>

        <ResizeDivider ref={dividerRef} onMouseDown={onDividerMouseDown} />

        <RightPanelWrapper $width={rightPanelWidth}>
          <RightChatPanel
            selectedChords={[]}
            groupExplanation={null}
            songTitle={sheet?.title ?? 'Jazzify AI'}
          />
        </RightPanelWrapper>
      </MainArea>
    </PageContainer>
  );
}
