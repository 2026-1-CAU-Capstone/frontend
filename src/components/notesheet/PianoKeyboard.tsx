import { useRef, useState, useCallback, useLayoutEffect } from 'react';
import styled from 'styled-components';
/* Click-to-hear uses the app-wide shared piano singleton (GlobalKeyboard)
 * so we don't spin up a per-page AudioContext + SplendidGrandPiano. */
import { getGlobalKeyboard } from '../../lib/player/GlobalKeyboard';

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

export async function playMidi(midi: number, gain = 2) {
  const kb = getGlobalKeyboard();
  // Best-effort: trigger lazy load so the next click works; play() returns
  // null on the very first call before samples land — that's intentional.
  await kb.ensureReady();
  kb.play(String(midi), { duration: 0.5, gain });
}

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
  font-family: 'Pretendard', sans-serif;
  font-size: 0.7rem;
  color: ${({ $black }) => ($black ? '#999' : '#bbb')};
  pointer-events: none;
  line-height: 1;
`;

const NoteLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
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
  /** 배율 — 에디터처럼 피아노를 더 크고 넓게 보여주고 싶을 때. 기본 1(기존 크기). */
  scale?: number;
  /** 컨테이너 폭에 맞춰 자동 축소한다(= `scale` 은 상한이 된다).
   *
   *  피아노는 흰건반 29개 × 52px = 1,508px 고정폭이라, 좁은 화면에서는 잘리거나
   *  가로 스크롤이 생긴다(에디터에서 `scale=1.28` 이면 1,930px 라 1,186px 창에서
   *  화면 밖으로 나갔다 — 브라우저를 75% 로 줄여야 맞던 이유). 이 옵션을 켜면
   *  래퍼 폭을 재서 `min(scale, 가용폭/1508)` 로 낮춘다. 넓은 화면에서는 상한인
   *  `scale` 그대로라 기존 모습이 유지된다. 기본 false = 기존 동작 그대로. */
  fitToWidth?: boolean;
}

export function PianoKeyboard({ onNotePress, mute, scale = 1, fitToWidth }: PianoKeyboardProps) {
  const [pressedMidi, setPressedMidi] = useState<number | null>(null);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  /* fitToWidth: 래퍼(폭 100%)를 관측해 배율을 낮춘다. 래퍼는 부모가 폭을 정하는
   * 블록이라 피아노 크기가 되먹임되지 않는다. */
  const hostRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(scale);
  useLayoutEffect(() => {
    // fitToWidth 가 꺼져 있으면 fitScale 을 아예 읽지 않으므로(아래 eff) 갱신 불필요.
    if (!fitToWidth) return;
    const el = hostRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setFitScale(Math.min(scale, w / PIANO_W));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToWidth, scale]);

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

  /* eff!==1: 컨테이너를 좌상단 기준으로 확대/축소하고, 바깥 래퍼가 그만큼의
   * 레이아웃 크기를 차지하도록 한다(transform 은 레이아웃 박스를 바꾸지 않으므로). */
  const eff = fitToWidth ? fitScale : scale;
  const inner = (
    <PianoContainer style={eff !== 1 ? { transform: `scale(${eff})`, transformOrigin: 'left top' } : undefined}>
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

  if (!fitToWidth && eff === 1) return inner;   // 기존 경로 그대로 (래퍼 없음)
  const box = <div style={{ width: PIANO_W * eff, height: WHITE_H * eff }}>{inner}</div>;
  if (!fitToWidth) return box;
  // 관측용 래퍼는 폭 100% — 축소된 건반은 그 안에서 가운데 정렬된다.
  return (
    <div ref={hostRef} style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      {box}
    </div>
  );
}
