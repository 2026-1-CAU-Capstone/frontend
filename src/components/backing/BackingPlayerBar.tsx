import { useEffect, useRef, useState, type RefObject } from 'react';
import styled from 'styled-components';
import { DRUM_KIT_PRESETS, type DrumKitId } from '../../lib/backing/drumKitPresets';
import {
  getPlayerSettings,
  setPlayerSetting,
  subscribePlayerSettings,
  type BassMode,
  type PlayStyle,
  type PlayerSettings,
} from '../../lib/note/playerSettings';
import { StyleSelector, type StyleSelectorChoice } from '../yamaha-sty/StyleSelector';

export type EngineBackend = 'rule' | 'sty' | 'hybrid';

const ENGINE_OPTIONS: { id: EngineBackend; label: string; hint: string }[] = [
  { id: 'rule', label: 'Rule', hint: '룰 기반 — 안정적인 swing/bossa 백킹' },
  { id: 'hybrid', label: 'Hybrid', hint: '.sty 피아노/기타 + 룰 베이스·드럼' },
  { id: 'sty', label: 'Pure .sty', hint: 'Yamaha .sty 단독 (실험적)' },
];

export interface BackingEngineControls {
  backend: EngineBackend;
  onBackendChange: (b: EngineBackend) => void;
  styleChoice: StyleSelectorChoice;
  onStyleChange: (c: StyleSelectorChoice) => void;
}

/** Close a popover when a mousedown lands outside its container. */
function useOutsideClose(
  open: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open, ref, onClose]);
}

/* ─────────────────────────────────────────────────────────────────────────
 * The chord-player UI is split into two pieces that live in the right panel
 * (see ChordPage). The transport stays pinned at the top of the panel; the
 * mixer is the body of the "믹서" tab (the "AI 채팅" tab shows RightChatPanel).
 *
 * Both read/write the global playerSettings store, so changes propagate to
 * every player in the app.
 * ──────────────────────────────────────────────────────────────────────── */

/* ─── Transport — always-visible play / stop / bpm / style / key ───────── */

/** Mock genre list for the (non-functional) genre dropdown. */
const GENRES = [
  'Ballad', 'Medium Swing', 'Up-Tempo Swing', 'Bossa Nova',
  'Samba', 'Latin', 'Funk', 'Jazz Waltz', 'Bebop',
] as const;

/** Longest label — used as an invisible sizer so the genre box keeps a fixed
 *  width regardless of which genre is selected. */
const WIDEST_GENRE = GENRES.reduce((a, b) => (b.length > a.length ? b : a));

/** The engine supports two feels; map the (richer) genre menu onto them.
 *  Latin-family genres play with the bossa feel, everything else swings.
 *  (Migrated here from the old mixer "스타일" section.) */
const BOSSA_GENRES = new Set<string>(['Bossa Nova', 'Samba', 'Latin']);
const genreToStyle = (g: string): PlayStyle => (BOSSA_GENRES.has(g) ? 'bossa' : 'swing');

/* ── Genre — visual mock dropdown. ─────────────────────────────────────── */
export function GenreSelect() {
  const [genre, setGenre] = useState<string>('Ballad');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));
  return (
    <GenreDropdown ref={ref}>
      <GenreBtn type="button" onClick={() => setOpen((v) => !v)}>
        <GenreSizer aria-hidden>{WIDEST_GENRE}</GenreSizer>
        <GenreLabel>{genre}</GenreLabel>
      </GenreBtn>
      {open && (
        <GenreMenu>
          {GENRES.map((g) => (
            <GenreOpt key={g} type="button" $on={g === genre}
              onClick={() => { setGenre(g); setOpen(false); setPlayerSetting('style', genreToStyle(g)); }}>
              {g}
            </GenreOpt>
          ))}
        </GenreMenu>
      )}
    </GenreDropdown>
  );
}

/* Big number inside a dropdown: shows as plain text, but clicking it reveals a
 * bordered input the user can type into directly (commits on blur / Enter). */
function EditableBigNum({ value, min, max, onCommit }: {
  value: number; min: number; max: number; onCommit: (n: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);

  const commit = () => {
    const n = parseInt(text, 10);
    const clamped = Math.max(min, Math.min(max, Number.isFinite(n) ? n : value));
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
    setEditing(false);
  };

  if (!editing) {
    return (
      <BigNumBtn type="button" onClick={() => setEditing(true)} title="클릭해서 직접 입력">
        {value}
      </BigNumBtn>
    );
  }
  return (
    <BigNumInput
      autoFocus
      type="text"
      inputMode="numeric"
      value={text}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setText(e.target.value.replace(/\D/g, ''))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') { setText(String(value)); setEditing(false); }
      }}
    />
  );
}

/* Tabler "metronome" icon — shared by the bar toggle and the tempo dropdown. */
const MetronomeIcon = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11.29 4.57 7.37 19.19a1 1 0 0 0 .97 1.26h7.32a1 1 0 0 0 .97 -1.26L12.7 4.57a1.01 1.01 0 0 0 -1.41 0Z" />
    <path d="M9 13l5.5 -5.5" />
    <path d="M7.35 17.31h9.3" />
  </svg>
);

/** Reads + toggles the global metronome flag. */
function useMetronome() {
  const [on, setOn] = useState<boolean>(() => getPlayerSettings().metroEnabled);
  useEffect(() => subscribePlayerSettings((s) => setOn(s.metroEnabled)), []);
  return [on, () => setPlayerSetting('metroEnabled', !on)] as const;
}

/* ── Metronome — icon toggle (sits left of the BPM cell). ──────────────── */
export function MetronomeToggle() {
  const [on, toggle] = useMetronome();
  return (
    <MetroBtn
      type="button"
      $on={on}
      onClick={toggle}
      title={on ? '메트로놈 끄기' : '메트로놈 켜기'}
      aria-pressed={on}
    >
      <MetronomeIcon size={28} />
    </MetroBtn>
  );
}

/* Metronome glyph between − / + inside the tempo dropdown — same icon and
 * on/off color logic as the bar toggle, and clickable to toggle. */
function MetroGlyphToggle() {
  const [on, toggle] = useMetronome();
  return (
    <MetroGlyphBtn
      type="button"
      $on={on}
      onClick={toggle}
      title={on ? '메트로놈 끄기' : '메트로놈 켜기'}
      aria-pressed={on}
    >
      <MetronomeIcon size={30} />
    </MetroGlyphBtn>
  );
}

/* ── BPM — boxed button → tempo dropdown. ──────────────────────────────── */
export interface BpmControlProps {
  tempo: number;
  onTempoChange: (bpm: number) => void;
  disabled?: boolean;
}
export function BpmControl({ tempo, onTempoChange, disabled = false }: BpmControlProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));

  const clampBpm = (n: number) => Math.max(40, Math.min(300, n));

  return (
    <FieldDropdown ref={ref}>
      <FieldBtn type="button" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <FieldVal>{tempo}</FieldVal>
        <FieldU>BPM</FieldU>
      </FieldBtn>
      {open && (
        <MenuPanel>
          <MenuTitle>템포</MenuTitle>
          <EditableBigNum value={tempo} min={40} max={300} onCommit={onTempoChange} />
          <MenuRow>
            <CircleBtn type="button" onClick={() => onTempoChange(clampBpm(tempo - 1))} aria-label="감소">−</CircleBtn>
            <MetroGlyphToggle />
            <CircleBtn type="button" onClick={() => onTempoChange(clampBpm(tempo + 1))} aria-label="증가">+</CircleBtn>
          </MenuRow>
        </MenuPanel>
      )}
    </FieldDropdown>
  );
}

/* ── 반복 — boxed button → repeat dropdown with ∞ toggle. ──────────────── */
export interface RepeatControlProps {
  repeatCount?: number;
  onRepeatChange?: (n: number) => void;
  disabled?: boolean;
}
export function RepeatControl({ repeatCount = 3, onRepeatChange, disabled = false }: RepeatControlProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));

  const infinite = (repeatCount ?? 3) <= 0;
  const commitRepeat = (n: number) => onRepeatChange?.(Math.max(1, Math.min(99, n)));
  /* ∞ doubles as the old mixer "루프": repeatCount→0 so the player falls back
   * to the loop flag — keep that flag in sync. */
  const toggleInfinite = () => {
    const next = infinite ? 3 : 0;
    onRepeatChange?.(next);
    setPlayerSetting('loop', next <= 0);
  };

  return (
    <FieldDropdown ref={ref}>
      <FieldBtn type="button" $tight onClick={() => setOpen((v) => !v)} disabled={disabled || !onRepeatChange}>
        {infinite ? <FieldVal>∞</FieldVal> : <><FieldVal>{repeatCount}</FieldVal><FieldU>x</FieldU></>}
      </FieldBtn>
      {open && (
        <MenuPanel>
          {infinite ? (
            <BigNumStatic>∞</BigNumStatic>
          ) : (
            <EditableBigNum value={repeatCount} min={1} max={99} onCommit={commitRepeat} />
          )}
          <MenuRow>
            <CircleBtn type="button" onClick={() => commitRepeat(Math.max(1, (repeatCount || 1) - 1))} aria-label="감소">−</CircleBtn>
            <InfToggle type="button" $on={infinite} onClick={toggleInfinite} title="무한 반복" aria-label="무한 반복">
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12a8 8 0 0 1 13.7-5.6L20 8" />
                <polyline points="20 3 20 8 15 8" />
                <path d="M20 12a8 8 0 0 1-13.7 5.6L4 16" />
                <polyline points="4 21 4 16 9 16" />
              </svg>
            </InfToggle>
            <CircleBtn type="button" onClick={() => commitRepeat((repeatCount || 0) + 1)} aria-label="증가">+</CircleBtn>
          </MenuRow>
        </MenuPanel>
      )}
    </FieldDropdown>
  );
}

/* ── Stop / Play buttons. ──────────────────────────────────────────────── */
export interface TransportButtonsProps {
  playing: boolean;
  onPlayPause: () => void;
  onStop?: () => void;
  disabled?: boolean;
}
export function TransportButtons({ playing, onPlayPause, onStop, disabled = false }: TransportButtonsProps) {
  return (
    <TransportBtns>
      {onStop && (
        <SquareBtn $variant="stop" type="button" onClick={onStop} disabled={disabled} title="정지" aria-label="Stop">
          <svg width="24" height="24" viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor" /></svg>
        </SquareBtn>
      )}
      <SquareBtn
        $variant="play"
        type="button"
        onClick={onPlayPause}
        disabled={disabled}
        title={playing ? 'Pause' : 'Play'}
        aria-label={playing ? 'Pause backing track' : 'Play backing track'}
      >
        {playing ? (
          <svg width="26" height="26" viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" fill="currentColor" /><rect x="14" y="4" width="4" height="16" fill="currentColor" /></svg>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24"><polygon points="6,3 21,12 6,21" fill="currentColor" /></svg>
        )}
      </SquareBtn>
    </TransportBtns>
  );
}

/* ─── Mixer — advanced channel strips (body of the "믹서" tab) ──────────── */

export interface BackingMixerProps {
  /** When supplied, an Engine section (Rule / Hybrid / Pure .sty + style
   *  picker) is rendered at the top. */
  engine?: BackingEngineControls;
  /** "분석 보기" master toggle, lifted out of the old FilterBar. Omit to hide. */
  analysisOn?: boolean;
  onToggleAnalysis?: () => void;
}

export function BackingMixer({ engine, analysisOn, onToggleAnalysis }: BackingMixerProps) {
  const [settings, setSettings] = useState<PlayerSettings>(() => getPlayerSettings());
  useEffect(() => subscribePlayerSettings(setSettings), []);

  const {
    melodyVolume, pianoVolume, pianoReverb,
    bassVolume, bassMode,
    drumVolume, drumKit,
  } = settings;

  return (
    <MixerScroll>
      {onToggleAnalysis && (
        <MixerSection $accent='#c45c5c'>
          <MixerSectionTitle>🎼 분석 보기</MixerSectionTitle>
          <MixerRow>
            <MixerLabel>{analysisOn ? 'ON' : 'OFF'}</MixerLabel>
            <MetroToggle $on={analysisOn} onClick={onToggleAnalysis}>
              {analysisOn ? 'ON' : 'OFF'}
            </MetroToggle>
          </MixerRow>
        </MixerSection>
      )}

      {engine && (
        <MixerSection $accent='#6aaa7e'>
          <MixerSectionTitle>⚙ 엔진</MixerSectionTitle>
          <MixerRow>
            <MixerLabel>방식</MixerLabel>
            <KitGroup>
              {ENGINE_OPTIONS.map(({ id, label, hint }) => (
                <KitBtn key={id} type='button' $on={engine.backend === id} title={hint}
                  onClick={() => engine.onBackendChange(id)}>
                  {label}
                </KitBtn>
              ))}
            </KitGroup>
          </MixerRow>
          {(engine.backend === 'sty' || engine.backend === 'hybrid') && (
            <MixerRow>
              <MixerLabel>.sty</MixerLabel>
              <StyleSelectorWrap>
                <StyleSelector currentName={engine.styleChoice.name} onSelect={engine.onStyleChange} />
              </StyleSelectorWrap>
            </MixerRow>
          )}
        </MixerSection>
      )}

      {/* 볼륨 — every instrument level grouped under one category. */}
      <MixerSection $accent='#e8a838'>
        <MixerSectionTitle>🔊 볼륨</MixerSectionTitle>
        {([
          { key: 'melodyVolume', label: '🎵 멜로디', value: melodyVolume },
          { key: 'pianoVolume',  label: '🎹 피아노', value: pianoVolume },
          { key: 'bassVolume',   label: '🎸 베이스', value: bassVolume },
          { key: 'drumVolume',   label: '🥁 드럼',   value: drumVolume },
        ] as const).map(({ key, label, value }) => (
          <MixerRow key={key}>
            <MixerLabel>{label}</MixerLabel>
            <MixerSlider type='range' min='0' max='200' value={Math.round(value * 100)}
              onChange={(e) => setPlayerSetting(key, Number(e.target.value) / 100)} />
            <MixerValue>{Math.round(value * 100)}</MixerValue>
          </MixerRow>
        ))}
      </MixerSection>

      {/* 잔향 — managed as a single control. */}
      <MixerSection $accent='#7eb6e8'>
        <MixerSectionTitle>🌫 잔향</MixerSectionTitle>
        <MixerRow>
          <MixerLabel>세기</MixerLabel>
          <MixerSlider type='range' min='0' max='100' value={Math.round(pianoReverb * 100)}
            onChange={(e) => setPlayerSetting('pianoReverb', Number(e.target.value) / 100)} />
          <MixerValue>{Math.round(pianoReverb * 100)}</MixerValue>
        </MixerRow>
      </MixerSection>

      {/* 악기 디테일 — per-instrument options. */}
      <MixerSection $accent='#b87edd'>
        <MixerSectionTitle>🎛 악기 디테일</MixerSectionTitle>
        <MixerRow>
          <MixerLabel>베이스</MixerLabel>
          <KitGroup>
            {(
              [
                { id: 'half',       label: '1박/코드' },
                { id: 'two-feel',   label: '2-feel' },
                { id: 'four-feel',  label: '4-feel' },
              ] as { id: BassMode; label: string }[]
            ).map(({ id, label }) => (
              <KitBtn key={id} type='button' $on={bassMode === id}
                onClick={() => setPlayerSetting('bassMode', id)}>
                {label}
              </KitBtn>
            ))}
          </KitGroup>
        </MixerRow>
        <MixerRow>
          <MixerLabel>드럼 킷</MixerLabel>
          <KitGroup>
            {(Object.keys(DRUM_KIT_PRESETS) as DrumKitId[]).map((id) => (
              <KitBtn key={id} type='button' $on={drumKit === id}
                onClick={() => setPlayerSetting('drumKit', id)}>
                {DRUM_KIT_PRESETS[id].label}
              </KitBtn>
            ))}
          </KitGroup>
        </MixerRow>
        {DRUM_KIT_PRESETS[drumKit].attribution && (
          <AttribLine>{DRUM_KIT_PRESETS[drumKit].attribution}</AttribLine>
        )}
      </MixerSection>
    </MixerScroll>
  );
}

/* ─── styled — transport (white theme, black text) ───────────────────── */

/* Shared height so every cell (genre / bpm / repeat / key / transport) lines
 * up with the transpose key button. */
const CONTROL_H = '32px';

/* Metronome icon toggle — very light gray off, very dark black on. */
const MetroBtn = styled.button<{ $on?: boolean }>`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${CONTROL_H};
  height: ${CONTROL_H};
  border: none;
  border-radius: 8px;
  background: transparent;
  color: ${({ $on }) => ($on ? '#0a0a0a' : '#d6d6d6')};
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  &:hover { background: rgba(0, 0, 0, 0.05); }
`;

/* Genre — visual mock dropdown. */
const GenreDropdown = styled.div`
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
`;

const GenreBtn = styled.button`
  position: relative;
  height: ${CONTROL_H};
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: 'Pretendard', sans-serif;
  font-size: 1.04rem;
  font-weight: 600;
  color: #1a1a1a;
  background: #fff;
  border: 1.5px solid #ccc;
  border-radius: 6px;
  padding: 0 12px;
  cursor: pointer;
  &:hover { border-color: #888; }
`;

/* Invisible — only there to fix the genre box width to the longest label. */
const GenreSizer = styled.span`
  visibility: hidden;
  white-space: nowrap;
  font-weight: 600;
  font-size: 1.04rem;
`;

/* The actually-shown label, centered over the sizer. */
const GenreLabel = styled.span`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  white-space: nowrap;
`;

const GenreMenu = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 60;
  min-width: 160px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.16);
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const GenreOpt = styled.button<{ $on?: boolean }>`
  text-align: left;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.9rem;
  font-weight: ${({ $on }) => ($on ? 700 : 500)};
  color: ${({ $on }) => ($on ? '#1a1a1a' : '#444')};
  background: ${({ $on }) => ($on ? '#f0f0f1' : 'transparent')};
  border: none;
  border-radius: 7px;
  padding: 8px 10px;
  cursor: pointer;
  &:hover { background: #f0f0f1; }
`;

/* BPM / 반복 — boxed buttons that open a dropdown (display only). */
const FieldDropdown = styled.div`
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
`;

const FieldBtn = styled.button<{ $tight?: boolean }>`
  height: ${CONTROL_H};
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: ${({ $tight }) => ($tight ? '0' : '4px')};
  background: #fff;
  border: 1.5px solid #ccc;
  border-radius: 6px;
  padding: 0 12px;
  cursor: pointer;
  &:hover:not(:disabled) { border-color: #888; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const FieldVal = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 1.04rem;
  font-weight: 700;
  line-height: 1;
  color: #1a1a1a;
`;

const FieldU = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.96rem;
  font-weight: 600;
  line-height: 1;
  color: #1a1a1a;
`;

/* Dropdown panel (iOS-tempo style): title + big number + circular ± + extras. */
const MenuPanel = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 80;
  width: 220px;
  background: #fff;
  border: 1px solid #e0e0e0;
  border-radius: 14px;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
  padding: 14px 16px 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
`;

const MenuTitle = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.9rem;
  font-weight: 600;
  color: #888;
`;

/* Static, clickable big number — clicking swaps in BigNumInput. */
const BigNumBtn = styled.button`
  font-family: 'Pretendard', sans-serif;
  font-size: 3rem;
  font-weight: 200;
  width: 100%;
  border: none;
  background: transparent;
  color: #1a1a1a;
  text-align: center;
  line-height: 1.1;
  cursor: text;
  border-radius: 8px;
  padding: 0;
  &:hover { background: #f4f4f5; }
`;

/* Bordered input revealed when the big number is clicked. */
const BigNumInput = styled.input`
  font-family: 'Pretendard', sans-serif;
  font-size: 3rem;
  font-weight: 200;
  width: 100%;
  box-sizing: border-box;
  border: 2px solid #2b8aef;
  border-radius: 8px;
  background: #fff;
  color: #1a1a1a;
  text-align: center;
  line-height: 1.1;
  padding: 0 4px;
  outline: none;
  -moz-appearance: textfield;
  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
`;

const BigNumStatic = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 3rem;
  font-weight: 200;
  color: #1a1a1a;
  line-height: 1;
`;

const MenuRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
`;

const CircleBtn = styled.button`
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 1.6rem;
  line-height: 1;
  color: #2b8aef;
  background: transparent;
  border: 1.8px solid #2b8aef;
  border-radius: 50%;
  cursor: pointer;
  transition: background 0.12s;
  &:hover { background: rgba(43, 138, 239, 0.08); }
`;

/* Center metronome inside the tempo dropdown — same on/off colors as MetroBtn. */
const MetroGlyphBtn = styled.button<{ $on?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: ${({ $on }) => ($on ? '#0a0a0a' : '#d6d6d6')};
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
  &:hover { background: rgba(0, 0, 0, 0.05); }
`;

const InfToggle = styled.button<{ $on?: boolean }>`
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  border: 1.8px solid ${({ $on }) => ($on ? '#2b8aef' : '#ccc')};
  background: ${({ $on }) => ($on ? 'rgba(43,138,239,0.12)' : 'transparent')};
  color: ${({ $on }) => ($on ? '#2b8aef' : '#666')};
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  &:hover { border-color: #2b8aef; color: #2b8aef; }
`;

/* Stop + play grouped together. */
const TransportBtns = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`;

/* Stop / play — boxed round-square buttons, same height as the other cells.
 * stop = red-tinted, play = green-tinted. $push shoves the button (and the
 * rest) to the right edge so play lands at the end of the row. */
const SquareBtn = styled.button<{ $variant?: 'stop' | 'play'; $push?: boolean }>`
  width: ${CONTROL_H};
  height: ${CONTROL_H};
  margin-left: ${({ $push }) => ($push ? 'auto' : '0')};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 8px;
  background: ${({ $variant }) =>
    $variant === 'stop' ? '#fbe0e0' : $variant === 'play' ? '#dcf0e3' : '#f0f0f1'};
  color: ${({ $variant }) =>
    $variant === 'stop' ? '#d63b3b' : $variant === 'play' ? '#1f9a52' : '#1a1a1a'};
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, transform 0.1s;
  &:hover:not(:disabled) {
    background: ${({ $variant }) =>
      $variant === 'stop' ? '#f6cfcf' : $variant === 'play' ? '#cbe9d6' : '#e7e7e9'};
  }
  &:active:not(:disabled) { transform: scale(0.92); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;


/* ─── styled — mixer channel strips (white theme) ────────────────────── */

const MixerScroll = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 22px;
  padding: 20px 18px;
  background: #fff;
`;

/* Flat sections — no card backgrounds / borders. A hairline divider plus
 * generous spacing separates each strip. ($accent kept as an optional prop
 * for callers; no longer rendered as a heavy left bar.) */
const MixerSection = styled.div<{ $accent?: string }>`
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 22px;
  border-bottom: 1px solid #efefef;

  &:last-child {
    padding-bottom: 0;
    border-bottom: none;
  }
`;

const MixerSectionTitle = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 1.05rem;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: 0;
  display: flex;
  align-items: center;
  gap: 8px;
`;

const MixerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 30px;
`;

const MixerLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.95rem;
  font-weight: 500;
  color: #444;
  width: 82px;
  flex-shrink: 0;
  white-space: nowrap;
`;

const MixerValue = styled.span`
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.9rem;
  font-weight: 600;
  color: #333;
  width: 40px;
  text-align: right;
  flex-shrink: 0;
`;

const MixerSlider = styled.input`
  -webkit-appearance: none;
  flex: 1;
  min-width: 0;
  height: 6px;
  border-radius: 3px;
  background: #e4e4e6;
  outline: none;
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #4ea1ff;
    cursor: pointer;
  }
  &::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #4ea1ff;
    border: none;
    cursor: pointer;
  }
`;

const KitGroup = styled.div`
  display: flex;
  gap: 6px;
  flex: 1;
`;

const StyleSelectorWrap = styled.div`
  flex: 1;
  min-width: 0;
  & > * { width: 100%; }
`;

const KitBtn = styled.button<{ $on?: boolean }>`
  flex: 1;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 8px 6px;
  border: 1.5px solid ${({ $on }) => ($on ? '#4ea1ff' : '#dcdcdc')};
  border-radius: 8px;
  background: ${({ $on }) => ($on ? 'rgba(78,161,255,0.12)' : '#fff')};
  color: ${({ $on }) => ($on ? '#2b8aef' : '#444')};
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, border-color 0.12s;
  &:hover {
    background: ${({ $on }) => ($on ? 'rgba(78,161,255,0.2)' : '#f4f4f5')};
  }
`;

const AttribLine = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  color: #999;
  margin-top: 2px;
  text-align: right;
  line-height: 1.3;
`;

const MetroToggle = styled.button<{ $on?: boolean }>`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 6px 16px;
  border: 1.5px solid ${({ $on }) => ($on ? '#4ea1ff' : '#dcdcdc')};
  border-radius: 8px;
  background: ${({ $on }) => ($on ? 'rgba(78,161,255,0.12)' : '#fff')};
  color: ${({ $on }) => ($on ? '#2b8aef' : '#555')};
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, border-color 0.12s;
`;
