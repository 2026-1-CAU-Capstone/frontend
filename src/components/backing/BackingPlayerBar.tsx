import { useEffect, useRef, useState, type RefObject } from 'react';
import { isComposingEvent } from '../../lib/ime';
import styled from 'styled-components';
import { DRUM_KIT_PRESETS, type DrumKitId } from '../../lib/backing/drumKitPresets';
import {
  getPlayerSettings,
  setPlayerSetting,
  setPlayerSettings,
  subscribePlayerSettings,
  MELODY_INSTRUMENTS,
  COMP_INSTRUMENTS,
  BASS_INSTRUMENTS,
  type PlayStyle,
  type PlayerSettings,
  type MixTrack,
} from '../../lib/note/playerSettings';
import { usePlayerBarPosition } from '../../contexts/PlayerBarPositionContext';
import { openPerformanceSettings } from '../../lib/settingsBus';
import { SettingsGearIcon } from '../common/SettingsGearIcon';
import { instrumentIconUrl, MELODY_ICON_SLUG, BASS_ICON_SLUG, DRUMKIT_ICON_SLUG } from '../../data/instrumentIcons';

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

/** Per-track instrument/timbre picker: a button showing the current label with
 *  a ▾ caret; click opens a popover list. Used at the left of each mixer track. */
function InstDropdown({ value, options, onSelect, iconFor }: {
  value: string;
  options: { id: string; label: string }[];
  onSelect: (id: string) => void;
  iconFor?: (id: string) => string | null;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));
  // 라벨 앞 이모지 제거(🎹 피아노 → 피아노) — 그 자리에 악기 아이콘이 들어간다.
  const clean = (s: string) => s.replace(/\p{Extended_Pictographic}/gu, '').trim();
  const current = clean(options.find((o) => o.id === value)?.label ?? value);
  const currentIcon = iconFor?.(value) ?? null;
  return (
    <InstDD ref={ref}>
      <InstDDBtn type='button' onClick={() => setOpen((v) => !v)} title={current}>
        {currentIcon && <InstDDIcon src={currentIcon} alt='' aria-hidden />}
        <InstDDLabel>{current}</InstDDLabel>
        <InstCaret>▾</InstCaret>
      </InstDDBtn>
      {open && (
        <InstDDMenu>
          {options.map((o) => {
            const ic = iconFor?.(o.id) ?? null;
            return (
              <InstDDOpt key={o.id} type='button' $on={o.id === value}
                onClick={() => { onSelect(o.id); setOpen(false); }}>
                {ic && <InstDDIcon src={ic} alt='' aria-hidden />}
                <span>{clean(o.label)}</span>
              </InstDDOpt>
            );
          })}
        </InstDDMenu>
      )}
    </InstDD>
  );
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

/** Genre dropdown — each maps to an engine StyleId via genreToStyleId (player.ts)
 *  and drives its own groove/feel/swing. */
const GENRES = [
  'Ballad', 'Medium Swing', 'Up-Tempo Swing', 'Bebop', 'Shuffle',
  'New Orleans Swing', 'Straight 8ths',
  'Bossa Nova', 'Samba', 'Latin', 'Latin Swing', 'Cha-Cha', 'Afro-Cuban',
  'Funk', 'Jazz Waltz',
  /* 미정/불명 — OMR·외부 악보처럼 장르를 알 수 없을 때. 연주 느낌은 swing 기본. */
  'Unknown',
] as const;

/** The engine supports two feels; map the (richer) genre menu onto them.
 *  Latin-family genres play with the bossa feel, everything else swings.
 *  (Migrated here from the old mixer "스타일" section.) */
const BOSSA_GENRES = new Set<string>(['Bossa Nova', 'Samba', 'Latin', 'Cha-Cha', 'Afro-Cuban']);
const genreToStyle = (g: string): PlayStyle => (BOSSA_GENRES.has(g) ? 'bossa' : 'swing');

/* ── Genre — reflects the loaded song's genre (global playerSettings.genre)
 *  and lets the user override it. Picking a genre also sets the engine feel
 *  (swing|bossa) via genreToStyle. ──────────────────────────────────────── */
export function GenreSelect({ value, onChange }: {
  /** 제어 모드 — 넘기면 이 값이 라벨이 된다(에디터: 악보 자체의 장르).
   *  생략하면 기존처럼 전역 playerSettings.genre 를 따른다(코드차트·뷰어). */
  value?: string;
  /** 제어 모드에서 선택 시 호출. 전역 playerSettings 도 함께 갱신되어 반주 느낌이 따라간다. */
  onChange?: (genre: string) => void;
} = {}) {
  const [storeGenre, setStoreGenre] = useState<string>(() => getPlayerSettings().genre);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));
  // Stay in sync with the store so loading a song (ChordPage/NoteSheet set
  // `genre` from the chart) updates the label without a manual selection.
  useEffect(() => subscribePlayerSettings((s) => setStoreGenre(s.genre)), []);
  const genre = value ?? storeGenre;
  const up = usePlayerBarPosition() === 'bottom';
  return (
    <GenreDropdown ref={ref}>
      <GenreBtn type="button" onClick={() => setOpen((v) => !v)} title={genre}>
        <GenreLabel>{genre}</GenreLabel>
      </GenreBtn>
      {open && (
        <GenreMenu $up={up}>
          {GENRES.map((g) => (
            <GenreOpt key={g} type="button" $on={g === genre}
              onClick={() => {
                setOpen(false);
                setPlayerSettings({ genre: g, style: genreToStyle(g) });
                onChange?.(g);
              }}>
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
        if (e.key === 'Enter') { if (isComposingEvent(e)) return; commit(); }
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

/* Tabler "adjustments-horizontal" — sliders/mixer icon. */
const MixerIcon = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 6m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
    <path d="M4 6l8 0" /><path d="M16 6l4 0" />
    <path d="M8 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
    <path d="M4 12l2 0" /><path d="M10 12l10 0" />
    <path d="M17 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0" />
    <path d="M4 18l11 0" /><path d="M19 18l1 0" />
  </svg>
);

/** True when the viewport is too narrow for the wide dropdown — fall back to a
 *  centered modal so the mixer never gets clipped/broken. */
function useNarrowViewport(maxPx = 760): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(`(max-width:${maxPx}px)`).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(`(max-width:${maxPx}px)`);
    const onChange = () => setNarrow(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [maxPx]);
  return narrow;
}

/* Transport mixer button — icon in the top bar that opens the full BackingMixer.
 * Wide screens: a large dropdown popover. Narrow screens: a centered modal so it
 * never breaks. Same controls as the docked 믹서 tab (copy). */
export function MixerButton(props: BackingMixerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutsideClose(open, ref, () => setOpen(false));
  const narrow = useNarrowViewport();

  const panel = (
    <>
      <MixerPanelHeader>
        <MixerPanelTitle>믹서</MixerPanelTitle>
        {/* 제목 오른쪽 톱니 — 곡과 무관한 재생 설정(카운트인·베이스 모드 등)은
          * 전체 설정으로 옮겨졌다. 여기서 그 섹션을 바로 연다. */}
        <MixerPanelGear
          type="button"
          title="믹서 설정"
          aria-label="믹서 설정"
          onClick={() => { setOpen(false); openPerformanceSettings('mixer'); }}
        >
          <SettingsGearIcon size={17} />
        </MixerPanelGear>
        <MixerPanelClose type="button" title="닫기" onClick={() => setOpen(false)}>✕</MixerPanelClose>
      </MixerPanelHeader>
      {props.inlineLick && (
        <MixerNote>
          코드 차트에는 멜로디가 없어, ‘멜로디’ 트랙 설정은 인라인 릭(악보 위에 띄운 라인) 재생에만 적용됩니다.
        </MixerNote>
      )}
      <BackingMixer {...props} />
    </>
  );

  return (
    <MixerBtnWrap ref={ref}>
      <MixerIconBtn type="button" $on={open} onClick={() => setOpen((v) => !v)} title="믹서" aria-pressed={open}>
        <MixerIcon size={22} />
      </MixerIconBtn>
      {open && (
        narrow ? (
          <MixerModalBackdrop onClick={() => setOpen(false)}>
            <MixerModal onClick={(e) => e.stopPropagation()}>{panel}</MixerModal>
          </MixerModalBackdrop>
        ) : (
          <MixerPopover>{panel}</MixerPopover>
        )
      )}
    </MixerBtnWrap>
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
  const up = usePlayerBarPosition() === 'bottom';

  const clampBpm = (n: number) => Math.max(40, Math.min(300, n));

  return (
    <FieldDropdown ref={ref}>
      <FieldBtn type="button" onClick={() => setOpen((v) => !v)} disabled={disabled}>
        <FieldVal>{tempo}</FieldVal>
        <FieldU>BPM</FieldU>
      </FieldBtn>
      {open && (
        <MenuPanel $up={up}>
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
  const up = usePlayerBarPosition() === 'bottom';

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
        <MenuPanel $up={up}>
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
  /** Show the "인라인 릭" toggle (chord-chart pages only). */
  inlineLick?: boolean;
  /** "분석 보기" master toggle, lifted out of the old FilterBar. Omit to hide. */
  analysisOn?: boolean;
  onToggleAnalysis?: () => void;
  /** Break Editor (고급 기능). When the host wires these, an Advanced section
   *  with a "Break Editor" toggle appears at the very bottom of the mixer. */
  breakEditMode?: boolean;
  onToggleBreakEdit?: () => void;
  /** Loop Region editor (구간 반복) — mirrors the Break Editor wiring. When the
   *  host wires these, a "구간 반복" toggle appears under Break Editor: ON lets
   *  the user click a start/end measure on the chart; a saved region loops on
   *  play. `loopRegion` (0-based bar indices) drives the label + 해제 button. */
  loopEditMode?: boolean;
  onToggleLoopEdit?: () => void;
  loopRegion?: { startBar: number; endBar: number } | null;
  onClearLoop?: () => void;
}

export function BackingMixer({ analysisOn, onToggleAnalysis, breakEditMode, onToggleBreakEdit, loopEditMode, onToggleLoopEdit, loopRegion, onClearLoop }: BackingMixerProps) {
  const [settings, setSettings] = useState<PlayerSettings>(() => getPlayerSettings());
  useEffect(() => subscribePlayerSettings(setSettings), []);

  /* 카운트인·인라인 릭·베이스 모드는 전체 설정(악보/연주 → 믹서)으로 옮겼다.
   * 여기 남은 값은 곡을 들으며 바로 만지는 것들뿐이다. */
  const {
    melodyVolume, melodyInstrument, pianoVolume, compInstrument,
    bassVolume, bassInstrument,
    drumVolume, drumKit,
    mutes, solos,
  } = settings;

  // 트랙 행: [악기 드롭다운 ▾] [S][M] [고급] [볼륨 바]. 멜로디=악기 목록, 드럼=킷
  // 목록(실작동). 피아노/베이스는 현재 단일 음색(콘트라베이스 고정) — 추후 확장.
  const tracks: {
    key: 'melodyVolume' | 'pianoVolume' | 'bassVolume' | 'drumVolume';
    track: MixTrack; value: number;
    instValue: string; options: { id: string; label: string }[];
    onInst: (id: string) => void;
    iconFor?: (id: string) => string | null;
  }[] = [
    { key: 'melodyVolume', track: 'melody', value: melodyVolume,
      instValue: melodyInstrument, options: MELODY_INSTRUMENTS,
      onInst: (id) => setPlayerSetting('melodyInstrument', id as PlayerSettings['melodyInstrument']),
      iconFor: (id) => instrumentIconUrl(MELODY_ICON_SLUG[id]) },
    { key: 'pianoVolume', track: 'piano', value: pianoVolume,
      instValue: compInstrument, options: COMP_INSTRUMENTS,
      onInst: (id) => setPlayerSetting('compInstrument', id),
      iconFor: (id) => instrumentIconUrl(MELODY_ICON_SLUG[id]) },
    { key: 'bassVolume', track: 'bass', value: bassVolume,
      instValue: bassInstrument, options: BASS_INSTRUMENTS,
      onInst: (id) => setPlayerSetting('bassInstrument', id),
      iconFor: (id) => instrumentIconUrl(BASS_ICON_SLUG[id]) },
    { key: 'drumVolume', track: 'drums', value: drumVolume,
      instValue: drumKit,
      options: (Object.keys(DRUM_KIT_PRESETS) as DrumKitId[]).map((id) => ({ id, label: DRUM_KIT_PRESETS[id].label })),
      onInst: (id) => setPlayerSetting('drumKit', id as DrumKitId),
      iconFor: (id) => instrumentIconUrl(DRUMKIT_ICON_SLUG[id]) },
  ];

  return (
    <MixerScroll>
      {onToggleAnalysis && (
        <MixerSection $accent='#c45c5c'>
          <MixerSectionTitle>분석 보기</MixerSectionTitle>
          <MixerRow>
            <MixerLabel>{analysisOn ? 'ON' : 'OFF'}</MixerLabel>
            <MetroToggle $on={analysisOn} onClick={onToggleAnalysis}>
              {analysisOn ? 'ON' : 'OFF'}
            </MetroToggle>
          </MixerRow>
        </MixerSection>
      )}

      {/* 트랙 — [악기 ▾] [S][M] [고급] [볼륨 바]. */}
      <MixerSection $accent='#e8a838'>
        {tracks.map(({ key, track, value, instValue, options, onInst, iconFor }) => {
          const pct = Math.round(value * 100);
          return (
          <MixerRow key={track} $tight>
            <InstDropdown value={instValue} options={options} onSelect={onInst} iconFor={iconFor} />
            <SmGroup>
              <SmBtn type='button' $on={solos[track]} title='솔로 (이 트랙만)'
                onClick={() => setPlayerSetting('solos', { ...solos, [track]: !solos[track] })}>S</SmBtn>
              <SmBtn type='button' $on={mutes[track]} $mute title='뮤트'
                onClick={() => setPlayerSetting('mutes', { ...mutes, [track]: !mutes[track] })}>M</SmBtn>
            </SmGroup>
            <SliderCell>
              <MixerSlider type='range' min='0' max='100' value={pct}
                onChange={(e) => setPlayerSetting(key, Number(e.target.value) / 100)} />
              {/* 숫자가 파란 thumb 바로 아래에 떠서 값에 따라 같이 움직인다(thumb=18px 보정). */}
              <SliderValue style={{ left: `calc(${pct}% + ${9 - pct * 0.18}px)` }}>{pct}</SliderValue>
            </SliderCell>
          </MixerRow>
          );
        })}
        {DRUM_KIT_PRESETS[drumKit].attribution && (
          <AttribLine>{DRUM_KIT_PRESETS[drumKit].attribution}</AttribLine>
        )}
      </MixerSection>


      {/* ── 고급 기능 (Advanced) — 열어둔 차트를 클릭해 쓰는 편집 모드만 남는다.
        * 곡과 무관한 설정(카운트인·인라인 릭·베이스 모드)은 전체 설정으로 옮겼다.
        * 둘 다 없는 화면(에디터 등)에서는 제목만 덩그러니 남으므로 통째로 숨긴다. */}
      {(onToggleBreakEdit || onToggleLoopEdit) && (
      <MixerSection $accent='#8a5cf0'>
        <MixerSectionTitle>고급 기능</MixerSectionTitle>

        {/* 브레이크 에디터 */}
        {onToggleBreakEdit && (
          <AdvItem>
            <AdvText>
              <AdvItemTitle>브레이크 에디터</AdvItemTitle>
              <AdvItemDesc>마디 위 음표를 클릭해 그 박부터 백킹을 멈춥니다 (멜로디·메트로놈은 유지).</AdvItemDesc>
            </AdvText>
            <Switch type='button' role='switch' aria-checked={!!breakEditMode} $on={!!breakEditMode}
              onClick={onToggleBreakEdit} />
          </AdvItem>
        )}

        {/* 구간 반복 */}
        {onToggleLoopEdit && (
          <>
            <AdvItem>
              <AdvText>
                <AdvItemTitle>구간 반복</AdvItemTitle>
                <AdvItemDesc>
                  {loopEditMode
                    ? '차트에서 시작 → 끝 마디를 클릭하세요. 저장되면 그 구간만 무한 반복합니다.'
                    : loopRegion
                      ? '구간이 설정됨 — 재생하면 정지 전까지 그 구간만 무한 반복합니다.'
                      : '켜고 차트에서 시작/끝 마디를 클릭해 연습 구간을 정합니다.'}
                </AdvItemDesc>
              </AdvText>
              <Switch type='button' role='switch' aria-checked={!!loopEditMode} $on={!!loopEditMode}
                onClick={onToggleLoopEdit} />
            </AdvItem>
            {loopRegion && (
              <AdvSubRow>
                <AdvSubLabel>구간</AdvSubLabel>
                <LoopRangeBox>{loopRegion.startBar + 1} ~ {loopRegion.endBar + 1}마디</LoopRangeBox>
                {onClearLoop && (
                  <LoopClearBtn type='button' onClick={onClearLoop}>해제하기</LoopClearBtn>
                )}
              </AdvSubRow>
            )}
          </>
        )}
      </MixerSection>
      )}

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

/* Transport mixer button + its dropdown popover. */
const MixerBtnWrap = styled.div`
  position: relative;
  display: inline-flex;
  flex-shrink: 0;
`;
/* Dark filled square with a white icon (distinct from the ghost MetroBtn). */
const MixerIconBtn = styled.button<{ $on?: boolean }>`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: ${CONTROL_H};
  height: ${CONTROL_H};
  border: none;
  border-radius: 8px;
  background: ${({ $on }) => ($on ? '#000' : '#2a2a2a')};
  color: #fff;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
  &:hover { background: #000; }
  &:active { transform: scale(0.94); }
`;
const MixerPopover = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 9000;
  width: 620px;
  max-width: calc(100vw - 24px);
  max-height: 72vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border: 1px solid #e2e2e2;
  border-radius: 14px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.2);
  overflow: hidden;
`;
/* Narrow-screen fallback: centered modal. */
const MixerModalBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 10000;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
`;
const MixerModal = styled.div`
  width: min(620px, 94vw);
  max-height: 86vh;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 16px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  overflow: hidden;
`;
/* Shared header for both popover & modal — "믹서" title (top-left) + close. */
const MixerPanelHeader = styled.div`
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  /* 제목 → 톱니 순으로 붙고, 닫기(✕)만 margin-left:auto 로 맨 끝에 선다.
   * space-between 이면 3요소가 균등하게 벌어져 톱니가 가운데로 떠버린다. */
  gap: 4px;
  padding: 12px 16px 8px;
`;
const MixerPanelTitle = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 1.05rem;
  font-weight: 800;
  color: #222;
`;
/* 믹서 제목 오른쪽 톱니 — 목록 페이지 툴바의 톱니와 같은 모양/역할. */
const MixerPanelGear = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #8b8b84;
  cursor: pointer;
  &:hover { background: rgba(0, 0, 0, 0.06); color: #1a1a1a; }
`;

const MixerPanelClose = styled.button`
  margin-left: auto;
  border: none;
  background: transparent;
  color: #999;
  font-size: 1rem;
  line-height: 1;
  padding: 4px 6px;
  cursor: pointer;
  border-radius: 6px;
  &:hover { background: #f2f2f2; color: #333; }
`;

/* Genre — visual mock dropdown. Shrinks (min-width:0) so it gives up width as
 * the transport bar narrows instead of staying a fixed-width block. */
const GenreDropdown = styled.div`
  position: relative;
  display: inline-flex;
  flex-shrink: 1;
  min-width: 0;
`;

const GenreBtn = styled.button`
  height: ${CONTROL_H};
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  max-width: 100%;
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

/* Label truncates with an ellipsis when the cell is squeezed. */
const GenreLabel = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
`;

const GenreMenu = styled.div<{ $up?: boolean }>`
  position: absolute;
  ${({ $up }) => ($up ? 'bottom: calc(100% + 6px);' : 'top: calc(100% + 6px);')}
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
const MenuPanel = styled.div<{ $up?: boolean }>`
  position: absolute;
  ${({ $up }) => ($up ? 'bottom: calc(100% + 6px);' : 'top: calc(100% + 6px);')}
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
  padding: 8px 18px 18px;
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

const MixerRow = styled.div<{ $top?: boolean; $tight?: boolean }>`
  display: flex;
  align-items: ${({ $top }) => ($top ? 'flex-start' : 'center')};
  gap: ${({ $tight }) => ($tight ? '6px' : '12px')};
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

/* Slider fills from after the 고급 button to the right edge; value bubble
 * floats under the thumb. */
const SliderCell = styled.div`
  position: relative;
  flex: 1;
  min-width: 0;
  height: 42px;
`;
const SliderValue = styled.span`
  position: absolute;
  top: 32px;
  transform: translateX(-50%);
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.74rem;
  font-weight: 600;
  color: #888;
  pointer-events: none;
  white-space: nowrap;
`;

/* 활성 구간 — 초록 박스 + 흰 글자. */
const LoopRangeBox = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  font-weight: 700;
  color: #fff;
  background: #34c759;
  padding: 5px 12px;
  border-radius: 8px;
  white-space: nowrap;
  flex-shrink: 0;
`;
/* 해제하기 — 빨간 버튼. */
const LoopClearBtn = styled.button`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.8rem;
  font-weight: 700;
  color: #e5484d;
  background: #fff;
  border: 1.5px solid #f3b6b8;
  border-radius: 8px;
  padding: 5px 12px;
  cursor: pointer;
  white-space: nowrap;
  flex-shrink: 0;
  &:hover { background: #fff5f5; border-color: #e5484d; }
`;

const MixerSlider = styled.input`
  -webkit-appearance: none;
  position: absolute;
  left: 0;
  right: 0;
  top: 15px;
  width: 100%;
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




/* Compact Solo/Mute (and AUTO) toggle chip used inside volume rows.
 * $mute → "on" state turns red (muted); otherwise green (solo/auto active). */
const SmBtn = styled.button<{ $on?: boolean; $mute?: boolean }>`
  flex: 0 0 auto;
  min-width: 30px;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.72rem;
  font-weight: 700;
  padding: 4px 7px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  border: 1.5px solid ${({ $on, $mute }) => ($on ? ($mute ? '#e06666' : '#5cc8a0') : '#dcdcdc')};
  background: ${({ $on, $mute }) => ($on ? ($mute ? 'rgba(224,102,102,0.15)' : 'rgba(92,200,160,0.15)') : '#fff')};
  color: ${({ $on, $mute }) => ($on ? ($mute ? '#c0392b' : '#1f9d6b') : '#888')};
  &:hover { filter: brightness(0.97); }
`;

/* ── Per-track instrument dropdown (left of each mixer track row) ──────── */
const InstDD = styled.div`
  position: relative;
  flex: 0 0 168px;
  min-width: 0;
`;
const InstDDBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.85rem;
  font-weight: 600;
  padding: 5px 6px;
  border: 1.5px solid #dcdcdc;
  border-radius: 8px;
  background: #fff;
  color: #333;
  cursor: pointer;
  &:hover { background: #f7f7f8; }
`;
const InstDDLabel = styled.span`
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
`;
const InstCaret = styled.span`
  flex: 0 0 auto;
  font-size: 0.7rem;
  color: #999;
`;
const InstDDMenu = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 30;
  min-width: 150px;
  max-height: 280px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid #e2e2e2;
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.14);
  padding: 4px;
`;
const InstDDOpt = styled.button<{ $on?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  text-align: left;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.88rem;
  font-weight: ${({ $on }) => ($on ? 700 : 500)};
  padding: 9px 10px;
  border: none;
  border-radius: 7px;
  background: ${({ $on }) => ($on ? 'rgba(78,161,255,0.12)' : 'transparent')};
  color: ${({ $on }) => ($on ? '#2b8aef' : '#333')};
  cursor: pointer;
  &:hover { background: ${({ $on }) => ($on ? 'rgba(78,161,255,0.18)' : '#f4f4f5')}; }
`;
const InstDDIcon = styled.img`
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  object-fit: contain;
`;

/* S/M 묶음 — 두 버튼을 타이트하게 붙인다. */
const SmGroup = styled.div`
  display: flex;
  gap: 2px;
  flex: 0 0 auto;
`;



const AttribLine = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  color: #999;
  margin-top: 2px;
  text-align: right;
  line-height: 1.3;
`;

/* 코드 차트 전용 안내 문구 (회색) — 드롭다운 "믹서" 제목 바로 아래. */
const MixerNote = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  color: #9a9a9a;
  line-height: 1.4;
  padding: 0 16px 2px;
`;

/* ── 고급 기능: 토글 스위치 + 제목/설명 행 ── */
const Switch = styled.button<{ $on?: boolean }>`
  position: relative;
  flex: 0 0 auto;
  width: 44px;
  height: 26px;
  border: none;
  border-radius: 13px;
  cursor: pointer;
  background: ${({ $on }) => ($on ? '#34c759' : '#d4d4d8')};
  transition: background 0.18s ease;
  &::after {
    content: '';
    position: absolute;
    top: 3px;
    left: ${({ $on }) => ($on ? '21px' : '3px')};
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
    transition: left 0.18s ease;
  }
`;
const AdvItem = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  & + & { border-top: 1px solid #f1f1f3; }
`;
const AdvText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
`;
const AdvItemTitle = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.95rem;
  font-weight: 600;
  color: #333;
`;
const AdvItemDesc = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  color: #9a9a9a;
  line-height: 1.4;
`;
const AdvSubRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 0 8px 4px;
`;
const AdvSubLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  color: #777;
  flex-shrink: 0;
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
