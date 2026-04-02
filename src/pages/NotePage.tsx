import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';
import { TopToolbar } from '../components/layout/TopToolbar';
import { LeftSidebar } from '../components/layout/LeftSidebar';
import { RightChatPanel } from '../components/layout/RightChatPanel';
import { NoteSheet } from '../components/notesheet/NoteSheet';
import { Toggle } from '../components/common/Toggle';
import { ToolbarButton } from '../components/layout/TopToolbar.styles';
import { useAutoHighlight } from '../hooks/useAutoHighlight';
import { sampleMelody } from '../data/sampleMelody';
import type { NoteSheetData } from '../data/sampleMelody';
import type { TocEntry } from '../data/types';
import { noteSongs, externalSongs, manualSongs } from '../data/noteSongs';
import type { SongGroup } from '../data/noteSongs';
import { loadMidiMelody } from '../lib/note/midiMelodyParser';
import { loadXmlMelody, loadMxlMelody } from '../lib/note/xmlMelodyParser';

const SAMPLE_ID = '__sample__';

/* ─── transposition ──────────────────────────────────────────────────── */

const ALL_KEYS_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const ALL_KEYS_MINOR = ['Cm', 'Dbm', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'Abm', 'Am', 'Bbm', 'Bm'] as const;

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
  const clean = key.replace(/m$/i, '');
  const root = clean[0].toUpperCase();
  const acc = clean.length > 1 ? clean[1] : '';
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

const CHORD_KEY_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const CHORD_NAME_TO_SEMI: Record<string, number> = {
  'C': 0, 'C#': 1, 'Db': 1, 'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4, 'F': 5, 'F#': 6, 'Gb': 6, 'G': 7, 'G#': 8,
  'Ab': 8, 'A': 9, 'A#': 10, 'Bb': 10, 'B': 11,
};

function transposeChord(chord: string, semitones: number): string {
  if (!chord) return chord;
  // Handle multi-chord (e.g. "Dm7  G7")
  return chord.replace(/([A-G][b#]?)/g, (match) => {
    const rootSemi = CHORD_NAME_TO_SEMI[match] ?? 0;
    const newSemi = ((rootSemi + semitones) % 12 + 12) % 12;
    return CHORD_KEY_NAMES[newSemi];
  });
}

/* Minor key → relative major for key sig lookup */
const MINOR_TO_MAJOR: Record<string, string> = {
  'Cm': 'Eb', 'C#m': 'E', 'Dbm': 'E', 'Dm': 'F', 'D#m': 'F#', 'Ebm': 'Gb',
  'Em': 'G', 'Fm': 'Ab', 'F#m': 'A', 'Gm': 'Bb', 'G#m': 'B', 'Abm': 'B',
  'Am': 'C', 'A#m': 'Db', 'Bbm': 'Db', 'Bm': 'D',
};

function transposeNoteData(data: NoteSheetData, targetKey: string): NoteSheetData {
  const origPc = keyToPc(data.key ?? 'C');
  const targetPc = keyToPc(targetKey);
  const semitones = (targetPc - origPc + 12) % 12;

  const useFlats = FLAT_KEYS.has(targetKey.replace(/m$/i, ''));
  const majorKey = MINOR_TO_MAJOR[targetKey] ?? targetKey.replace(/m$/i, '');
  const keySigNotes = KEY_SIG_NOTES[majorKey] ?? new Set();

  return {
    ...data,
    key: targetKey,
    measures: data.measures.map((m) => ({
      ...m,
      chord: m.chord ? transposeChord(m.chord, semitones) : m.chord,
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

  ${mq.mobile} {
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 10px;
  }
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

  ${mq.mobile} {
    width: 100%;
  }
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
  display: block;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.75rem;
  margin-top: 2px;
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

  ${mq.mobile} {
    display: none;
  }
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

  ${mq.mobile} {
    display: none;
  }
`;

/* ─── component ──────────────────────────────────────────────────────── */

export default function NotePage() {
  const navigate = useNavigate();
  const { autoHighlight, toggleAutoHighlight } = useAutoHighlight(true);

  /* song state */
  const [songGroup, setSongGroup] = useState<SongGroup | '__sample__'>('__sample__');
  const [songId, setSongId] = useState(SAMPLE_ID);
  const [sheet, setSheet] = useState<NoteSheetData | null>(sampleMelody);

  const filteredSongs = useMemo(() => {
    if (songGroup === '__sample__') return [];
    return songGroup === 'manual' ? manualSongs : externalSongs;
  }, [songGroup]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* key transposition */
  const originalKey = sheet?.key ?? 'C';
  const isMinorKey = /m$/i.test(originalKey);
  const allKeys = isMinorKey ? ALL_KEYS_MINOR : ALL_KEYS_MAJOR;
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
          song.fileType === 'json'
            ? await fetch(url).then((r) => { if (!r.ok) throw new Error(`${r.status} ${r.statusText}`); return r.json(); }) as NoteSheetData
            : song.fileType === 'midi'
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
    const pool = songGroup === '__sample__' ? noteSongs : filteredSongs;
    return pool
      .filter((s) => s.title.toLowerCase().includes(q) || s.composer.toLowerCase().includes(q))
      .slice(0, 30);
  }, [searchQuery, songGroup, filteredSongs]);

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
      <IconSidebar />
      <RightSection>
        <TopToolbar
          title={sheet?.title ?? 'Note'}
          subtitle={sheet ? `${sheet.timeSignature}` : undefined}
        />

        <MainArea>
          <LeftSidebar
            toc={toc}
            activePage={1}
            onPageSelect={() => {}}
          />

        <CenterColumn>
          <SongPickerBar>
            <span>Note</span>
            <LeadSheetBtn onClick={() => navigate('/note/leadsheetgenerator')}>Lead Sheet Generator</LeadSheetBtn>
            <SongSelect
              value={songGroup}
              onChange={(e) => {
                const g = e.target.value as SongGroup | '__sample__';
                setSongGroup(g);
                if (g === '__sample__') setSongId(SAMPLE_ID);
                else {
                  const list = g === 'manual' ? manualSongs : externalSongs;
                  if (list.length > 0) setSongId(list[0].id);
                }
              }}
            >
              <option value="__sample__">Sample</option>
              <option value="manual">Manual</option>
              <option value="external">External</option>
            </SongSelect>
            {songGroup !== '__sample__' && (
              <SongSelect value={songId} onChange={(e) => setSongId(e.target.value)}>
                {filteredSongs.map((song) => (
                  <option key={song.id} value={song.id}>
                    {song.title} — {song.composer}
                  </option>
                ))}
              </SongSelect>
            )}
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
                          setSongGroup(song.group);
                          setSongId(song.id);
                          setSearchQuery('');
                          setSearchOpen(false);
                        }}
                      >
                        {song.title}
                        <SearchComposer>{song.composer}</SearchComposer>
                        <CollectionTag>[{song.collection}]</CollectionTag>
                      </SearchItem>
                    ))
                  )}
                </SearchResults>
              )}
            </SearchWrap>
            <Toggle
              label="분석 보기"
              active={autoHighlight}
              onToggle={toggleAutoHighlight}
            />

            <ToolbarButton>자동 번역</ToolbarButton>
          </SongPickerBar>

          {transposedSheet && !loading ? (
            <NoteSheet
              data={transposedSheet}
              selectedKey={selectedKey}
              allKeys={allKeys}
              onKeyChange={(k) => setSelectedKey(k)}
            />
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
      </RightSection>
    </PageContainer>
  );
}
