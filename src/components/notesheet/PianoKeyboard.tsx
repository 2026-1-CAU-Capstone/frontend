import { useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
import Soundfont from 'soundfont-player';

/* ─── types ──────────────────────────────────────────────────────────── */

export interface PianoNote {
  vexKey: string;
  acc?: '#';
  midi: number;
}

/* ─── constants ──────────────────────────────────────────────────────── */

const WHITE_W = 52;
const WHITE_H = 210;
const BLACK_W = 33;
const BLACK_H = 130;

const SEMI: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const WHITE_NAMES = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const HAS_BLACK = new Set(['c', 'd', 'f', 'g', 'a']);

interface KeyDef {
  note: PianoNote;
  isBlack: boolean;
  x: number;
}

function buildKeys(): KeyDef[] {
  const keys: KeyDef[] = [];
  let wi = 0;
  // Full octaves 3, 4, 5, 6
  for (let oct = 3; oct <= 6; oct++) {
    for (const name of WHITE_NAMES) {
      const midi = (oct + 1) * 12 + SEMI[name];
      keys.push({ note: { vexKey: `${name}/${oct}`, midi }, isBlack: false, x: wi * WHITE_W });
      if (HAS_BLACK.has(name)) {
        keys.push({
          note: { vexKey: `${name}/${oct}`, acc: '#', midi: midi + 1 },
          isBlack: true,
          x: wi * WHITE_W + WHITE_W - BLACK_W / 2,
        });
      }
      wi++;
    }
  }
  // Add C7
  keys.push({ note: { vexKey: 'c/7', midi: 96 }, isBlack: false, x: wi * WHITE_W });
  return keys;
}

const ALL_KEYS = buildKeys();
const TOTAL_WHITE = ALL_KEYS.filter((k) => !k.isBlack).length;
const PIANO_W = TOTAL_WHITE * WHITE_W;

/* ─── keyboard mapping (FL Studio style) ─────────────────────────────── */

const KEY_MAP: Record<string, PianoNote> = {
  // Lower octave C4-B4
  z: { vexKey: 'c/4', midi: 60 },
  s: { vexKey: 'c/4', acc: '#', midi: 61 },
  x: { vexKey: 'd/4', midi: 62 },
  d: { vexKey: 'd/4', acc: '#', midi: 63 },
  c: { vexKey: 'e/4', midi: 64 },
  v: { vexKey: 'f/4', midi: 65 },
  g: { vexKey: 'f/4', acc: '#', midi: 66 },
  b: { vexKey: 'g/4', midi: 67 },
  h: { vexKey: 'g/4', acc: '#', midi: 68 },
  n: { vexKey: 'a/4', midi: 69 },
  j: { vexKey: 'a/4', acc: '#', midi: 70 },
  m: { vexKey: 'b/4', midi: 71 },
  // Upper octave C5-B5
  q: { vexKey: 'c/5', midi: 72 },
  '2': { vexKey: 'c/5', acc: '#', midi: 73 },
  w: { vexKey: 'd/5', midi: 74 },
  '3': { vexKey: 'd/5', acc: '#', midi: 75 },
  e: { vexKey: 'e/5', midi: 76 },
  r: { vexKey: 'f/5', midi: 77 },
  '5': { vexKey: 'f/5', acc: '#', midi: 78 },
  t: { vexKey: 'g/5', midi: 79 },
  '6': { vexKey: 'g/5', acc: '#', midi: 80 },
  y: { vexKey: 'a/5', midi: 81 },
  '7': { vexKey: 'a/5', acc: '#', midi: 82 },
  u: { vexKey: 'b/5', midi: 83 },
  // C6
  i: { vexKey: 'c/6', midi: 84 },
};

// Reverse: midi → keyboard shortcut label
const MIDI_TO_SHORTCUT: Record<number, string> = {};
for (const [k, v] of Object.entries(KEY_MAP)) {
  MIDI_TO_SHORTCUT[v.midi] = k.toUpperCase();
}

/* ─── sound ──────────────────────────────────────────────────────────── */

let _audioCtx: AudioContext | null = null;
let _pianoInst: Soundfont.Player | null = null;
let _loading: Promise<void> | null = null;

function ensurePiano(): Promise<Soundfont.Player> {
  if (_pianoInst) return Promise.resolve(_pianoInst);
  if (!_audioCtx) _audioCtx = new AudioContext();
  if (_audioCtx.state === 'suspended') _audioCtx.resume();
  if (!_loading) {
    _loading = Soundfont.instrument(
      _audioCtx,
      'acoustic_grand_piano' as Soundfont.InstrumentName,
      { gain: 2.2 },
    ).then((inst) => {
      _pianoInst = inst;
    });
  }
  return _loading.then(() => _pianoInst!);
}

export async function playMidi(midi: number) {
  const piano = await ensurePiano();
  piano.play(String(midi), 0, { duration: 0.5, gain: 2 });
}

// preload on import
// ensurePiano().catch(() => {});

/* ─── styled ─────────────────────────────────────────────────────────── */

const PianoContainer = styled.div`
  position: relative;
  width: ${PIANO_W}px;
  height: ${WHITE_H}px;
  user-select: none;
`;

const WhiteKeyEl = styled.div<{ $x: number; $pressed: boolean }>`
  position: absolute;
  left: ${({ $x }) => $x}px;
  top: 0;
  width: ${WHITE_W - 1}px;
  height: ${WHITE_H}px;
  background: ${({ $pressed }) => ($pressed ? '#e8e0c8' : '#fff')};
  border: 1px solid #bbb;
  border-radius: 0 0 4px 4px;
  cursor: pointer;
  z-index: 1;
  transition: background 0.06s;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 8px;

  &:hover {
    background: #f5f0e0;
  }
  &:active {
    background: #e8e0c8;
  }
`;

const BlackKeyEl = styled.div<{ $x: number; $pressed: boolean }>`
  position: absolute;
  left: ${({ $x }) => $x}px;
  top: 0;
  width: ${BLACK_W}px;
  height: ${BLACK_H}px;
  background: ${({ $pressed }) => ($pressed ? '#555' : '#333')};
  border-radius: 0 0 4px 4px;
  cursor: pointer;
  z-index: 2;
  transition: background 0.06s;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: 6px;

  &:hover {
    background: #444;
  }
  &:active {
    background: #555;
  }
`;

const ShortcutLabel = styled.span<{ $black?: boolean }>`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.7rem;
  color: ${({ $black }) => ($black ? '#999' : '#bbb')};
  pointer-events: none;
  line-height: 1;
`;

const NoteLabel = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.72rem;
  color: #aaa;
  pointer-events: none;
  line-height: 1;
  margin-bottom: 2px;
`;

/* ─── component ──────────────────────────────────────────────────────── */

interface PianoKeyboardProps {
  onNotePress: (note: PianoNote) => void;
  mute?: boolean;
}

export function PianoKeyboard({ onNotePress, mute }: PianoKeyboardProps) {
  const [pressedMidi, setPressedMidi] = useState<number | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handlePress = useCallback(
    (note: PianoNote) => {
      onNotePress(note);
      if (!mute) playMidi(note.midi);
      setPressedMidi(note.midi);
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = setTimeout(() => setPressedMidi(null), 150);
    },
    [onNotePress, mute],
  );

  // keyboard input disabled — use on-screen piano only

  const whites = ALL_KEYS.filter((k) => !k.isBlack);
  const blacks = ALL_KEYS.filter((k) => k.isBlack);

  return (
    <PianoContainer>
      {whites.map((k) => {
        const isC = k.note.vexKey.startsWith('c/');
        const sc = MIDI_TO_SHORTCUT[k.note.midi];
        return (
          <WhiteKeyEl
            key={k.note.midi}
            $x={k.x}
            $pressed={pressedMidi === k.note.midi}
            onMouseDown={() => handlePress(k.note)}
          >
            {isC && <NoteLabel>{k.note.vexKey.toUpperCase().replace('/', '')}</NoteLabel>}
            {sc && <ShortcutLabel>{sc}</ShortcutLabel>}
          </WhiteKeyEl>
        );
      })}
      {blacks.map((k) => {
        const sc = MIDI_TO_SHORTCUT[k.note.midi];
        return (
          <BlackKeyEl
            key={k.note.midi}
            $x={k.x}
            $pressed={pressedMidi === k.note.midi}
            onMouseDown={() => handlePress(k.note)}
          >
            {sc && <ShortcutLabel $black>{sc}</ShortcutLabel>}
          </BlackKeyEl>
        );
      })}
    </PianoContainer>
  );
}
