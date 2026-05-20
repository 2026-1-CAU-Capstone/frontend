import { useEffect, useState } from 'react';
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

/* ─────────────────────────────────────────────────────────────────────────
 * Fixed bottom-left transport bar for the backing-track / chord player.
 *
 * The mixer mirrors NoteSheet's MixerPopup 1:1 — piano / bass / drums
 * channel strips reading from the global playerSettings store. All slider
 * writes go to setPlayerSetting() so every player (note sheet, lick card,
 * backing chord player) picks them up automatically.
 * ──────────────────────────────────────────────────────────────────────── */

export interface BackingEngineControls {
  backend: EngineBackend;
  onBackendChange: (b: EngineBackend) => void;
  styleChoice: StyleSelectorChoice;
  onStyleChange: (c: StyleSelectorChoice) => void;
}

export interface BackingPlayerBarProps {
  playing: boolean;
  tempo: number;
  onTempoChange: (bpm: number) => void;
  onPlayPause: () => void;
  disabled?: boolean;
  /** When supplied, an Engine section (Rule / Hybrid / Pure .sty + style
   *  picker) is rendered at the top of the mixer popup. */
  engine?: BackingEngineControls;
}

export function BackingPlayerBar({
  playing,
  tempo,
  onTempoChange,
  onPlayPause,
  disabled = false,
  engine,
}: BackingPlayerBarProps) {
  const [tempoText, setTempoText] = useState(String(tempo));
  const [mixerOpen, setMixerOpen] = useState(false);

  // Subscribe to the global mixer store; the bar re-renders whenever any
  // setting changes anywhere in the app.
  const [settings, setSettings] = useState<PlayerSettings>(() => getPlayerSettings());
  useEffect(() => subscribePlayerSettings(setSettings), []);

  useEffect(() => {
    setTempoText(String(tempo));
  }, [tempo]);

  const commitTempo = () => {
    const n = parseInt(tempoText, 10);
    const clamped = Math.max(40, Math.min(300, Number.isFinite(n) ? n : 140));
    setTempoText(String(clamped));
    if (clamped !== tempo) onTempoChange(clamped);
  };

  const {
    melodyVolume, pianoVolume, pianoReverb,
    bassVolume, bassMode,
    drumVolume, drumKit,
    style: playStyle,
    metroEnabled, metroVolume,
    loop,
  } = settings;

  return (
    <Bar>
      {mixerOpen && (
        <MixerPopup>
          {/* Engine — pick between the rule generator, .sty playback, and
           *  the hybrid blend. Only rendered when the host page passes
           *  `engine` controls (ChordPage does; lick/solo previews don't
           *  need an engine choice). */}
          {engine && (
            <MixerSectionFull $accent='#6aaa7e'>
              <MixerSectionTitle>⚙ 엔진</MixerSectionTitle>
              <MixerRow>
                <MixerLabel>방식</MixerLabel>
                <KitGroup>
                  {ENGINE_OPTIONS.map(({ id, label, hint }) => (
                    <KitBtn
                      key={id}
                      type='button'
                      $on={engine.backend === id}
                      title={hint}
                      onClick={() => engine.onBackendChange(id)}
                    >
                      {label}
                    </KitBtn>
                  ))}
                </KitGroup>
              </MixerRow>
              {(engine.backend === 'sty' || engine.backend === 'hybrid') && (
                <MixerRow>
                  <MixerLabel>.sty</MixerLabel>
                  <StyleSelectorWrap>
                    <StyleSelector
                      currentName={engine.styleChoice.name}
                      onSelect={engine.onStyleChange}
                    />
                  </StyleSelectorWrap>
                </MixerRow>
              )}
            </MixerSectionFull>
          )}

          {/* Melody — present even though backing track has no melody, kept
              so settings stay symmetric with the note-sheet mixer. */}
          <MixerSectionFull $accent='#e8a838'>
            <MixerSectionTitle>🎵 멜로디</MixerSectionTitle>
            <MixerRow>
              <MixerLabel>볼륨</MixerLabel>
              <MixerSlider type='range' min='0' max='200' value={Math.round(melodyVolume * 100)}
                onChange={(e) => setPlayerSetting('melodyVolume', Number(e.target.value) / 100)} />
              <MixerValue>{Math.round(melodyVolume * 100)}</MixerValue>
            </MixerRow>
          </MixerSectionFull>

          {/* Piano — volume + reverb */}
          <MixerSection $accent='#7eb6e8'>
            <MixerSectionTitle>🎹 피아노</MixerSectionTitle>
            <MixerRow>
              <MixerLabel>볼륨</MixerLabel>
              <MixerSlider type='range' min='0' max='200' value={Math.round(pianoVolume * 100)}
                onChange={(e) => setPlayerSetting('pianoVolume', Number(e.target.value) / 100)} />
              <MixerValue>{Math.round(pianoVolume * 100)}</MixerValue>
            </MixerRow>
            <MixerRow>
              <MixerLabel>잔향</MixerLabel>
              <MixerSlider type='range' min='0' max='100' value={Math.round(pianoReverb * 100)}
                onChange={(e) => setPlayerSetting('pianoReverb', Number(e.target.value) / 100)} />
              <MixerValue>{Math.round(pianoReverb * 100)}</MixerValue>
            </MixerRow>
          </MixerSection>

          {/* Bass — volume + walking pattern */}
          <MixerSection $accent='#b87edd'>
            <MixerSectionTitle>🎸 베이스</MixerSectionTitle>
            <MixerRow>
              <MixerLabel>볼륨</MixerLabel>
              <MixerSlider type='range' min='0' max='200' value={Math.round(bassVolume * 100)}
                onChange={(e) => setPlayerSetting('bassVolume', Number(e.target.value) / 100)} />
              <MixerValue>{Math.round(bassVolume * 100)}</MixerValue>
            </MixerRow>
            <MixerRow>
              <MixerLabel>패턴</MixerLabel>
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
          </MixerSection>

          {/* Drums — kit + volume in the same section */}
          <MixerSectionFull $accent='#dd7e7e'>
            <MixerSectionTitle>🥁 드럼</MixerSectionTitle>
            <MixerRow>
              <MixerLabel>볼륨</MixerLabel>
              <MixerSlider type='range' min='0' max='200' value={Math.round(drumVolume * 100)}
                onChange={(e) => setPlayerSetting('drumVolume', Number(e.target.value) / 100)} />
              <MixerValue>{Math.round(drumVolume * 100)}</MixerValue>
            </MixerRow>
            <MixerRow>
              <MixerLabel>킷</MixerLabel>
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
          </MixerSectionFull>

          {/* Style / genre — drives comp + drum + bass patterns
           *  AND forces straight 8ths when 'bossa'. */}
          <MixerSectionFull $accent='#e8c878'>
            <MixerSectionTitle>🎵 스타일</MixerSectionTitle>
            <MixerRow>
              <MixerLabel>장르</MixerLabel>
              <KitGroup>
                {(
                  [
                    { id: 'swing', label: 'Swing' },
                    { id: 'bossa', label: 'Bossa Nova' },
                  ] as { id: PlayStyle; label: string }[]
                ).map(({ id, label }) => (
                  <KitBtn key={id} type='button' $on={playStyle === id}
                    onClick={() => setPlayerSetting('style', id)}>
                    {label}
                  </KitBtn>
                ))}
              </KitGroup>
            </MixerRow>
          </MixerSectionFull>

          {/* Metronome */}
          <MixerSectionFull $accent='#888'>
            <MixerSectionTitle>⏱ 메트로놈</MixerSectionTitle>
            <MixerRow>
              <MixerLabel>{metroEnabled ? 'ON' : 'OFF'}</MixerLabel>
              <MetroToggle $on={metroEnabled}
                onClick={() => setPlayerSetting('metroEnabled', !metroEnabled)}>
                {metroEnabled ? 'ON' : 'OFF'}
              </MetroToggle>
              {metroEnabled && (
                <>
                  <MixerSlider type='range' min='0' max='200' value={Math.round(metroVolume * 100)}
                    onChange={(e) => setPlayerSetting('metroVolume', Number(e.target.value) / 100)} />
                  <MixerValue>{Math.round(metroVolume * 100)}</MixerValue>
                </>
              )}
            </MixerRow>
          </MixerSectionFull>

          {/* Loop — chorus repeat toggle */}
          <MixerSectionFull $accent='#7a9ea0'>
            <MixerSectionTitle>🔁 루프</MixerSectionTitle>
            <MixerRow>
              <MixerLabel>{loop ? 'ON' : 'OFF'}</MixerLabel>
              <MetroToggle $on={loop}
                title='코러스 한 번 끝나면 자동으로 처음부터 반복'
                onClick={() => setPlayerSetting('loop', !loop)}>
                {loop ? 'ON' : 'OFF'}
              </MetroToggle>
            </MixerRow>
          </MixerSectionFull>
        </MixerPopup>
      )}

      <Row>
        <BpmLabel>BPM</BpmLabel>
        <BpmInput
          type="text"
          inputMode="numeric"
          value={tempoText}
          disabled={disabled}
          onChange={(e) => {
            const cleaned = e.target.value.replace(/\D/g, '');
            setTempoText(cleaned);
            const n = parseInt(cleaned, 10);
            if (n >= 20 && n <= 400) onTempoChange(n);
          }}
          onBlur={commitTempo}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        />
        <PlayBtn
          type="button"
          onClick={onPlayPause}
          disabled={disabled}
          title={playing ? 'Pause' : 'Play'}
          aria-label={playing ? 'Pause backing track' : 'Play backing track'}
        >
          {playing ? (
            <svg width="18" height="18" viewBox="0 0 14 14">
              <rect x="1" y="1" width="4" height="12" fill="#fff" />
              <rect x="9" y="1" width="4" height="12" fill="#fff" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 14 14">
              <polygon points="2,0 14,7 2,14" fill="#fff" />
            </svg>
          )}
        </PlayBtn>
        <Sep />
        <MixToggle
          type="button"
          $on={mixerOpen}
          onClick={() => setMixerOpen((v) => !v)}
          aria-expanded={mixerOpen}
        >
          믹서
        </MixToggle>
      </Row>
    </Bar>
  );
}

/* ─── styled bits ────────────────────────────────────────────────────── */

/* Anchored to the bottom-left of the score section (its positioned
 * ancestor), not the viewport — so it sits inside the sheet area and
 * shifts with the sidebar instead of overlapping it. */
const Bar = styled.div`
  position: absolute;
  bottom: 24px;
  left: 24px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: #1e1e1e;
  padding: 12px 16px;
  border-radius: 12px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
  z-index: 1000;
  min-width: 280px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const BpmLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  color: #ccc;
  letter-spacing: 0.5px;
`;

const BpmInput = styled.input`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.92rem;
  width: 50px;
  padding: 5px 5px;
  border: 1px solid #555;
  border-radius: 6px;
  background: #2a2a2a;
  color: #fff;
  text-align: center;
  outline: none;
  -moz-appearance: textfield;
  &::-webkit-inner-spin-button,
  &::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
  &:focus { border-color: #888; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;

const PlayBtn = styled.button`
  font-size: 1rem;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: #2a6e3f;
  color: #fff;
  cursor: pointer;
  transition: opacity 0.15s;
  &:hover:not(:disabled) { opacity: 0.85; }
  &:disabled { opacity: 0.45; cursor: not-allowed; }
`;

const Sep = styled.div`
  width: 1px;
  height: 20px;
  background: #444;
`;

const MixToggle = styled.button<{ $on?: boolean }>`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.72rem;
  padding: 4px 10px;
  border: 1px solid ${({ $on }) => ($on ? '#6aaa7e' : '#555')};
  border-radius: 6px;
  background: ${({ $on }) => ($on ? '#2a6e3f' : '#2a2a2a')};
  color: ${({ $on }) => ($on ? '#fff' : '#999')};
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.15s;
  &:hover { border-color: #888; }
`;

const MetroToggle = styled.button<{ $on?: boolean }>`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.7rem;
  padding: 3px 8px;
  border: 1px solid ${({ $on }) => ($on ? '#6aaa7e' : '#555')};
  border-radius: 5px;
  background: ${({ $on }) => ($on ? '#2a6e3f' : '#2a2a2a')};
  color: ${({ $on }) => ($on ? '#fff' : '#999')};
  cursor: pointer;
  white-space: nowrap;
`;

/* ─── mixer popup (4-section channel strips, mirrors NoteSheet) ────── */

const MixerPopup = styled.div`
  background: #1e1e1e;
  border-radius: 14px;
  padding: 14px 16px;
  box-shadow: 0 -6px 22px rgba(0,0,0,0.55);
  max-width: 540px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;

  @media (max-width: 720px) {
    grid-template-columns: 1fr;
    max-width: 100%;
  }
`;

const MixerSection = styled.div<{ $accent?: string }>`
  background: #262626;
  border: 1px solid #333;
  border-left: 3px solid ${({ $accent }) => $accent ?? '#666'};
  border-radius: 10px;
  padding: 8px 12px 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const MixerSectionFull = styled(MixerSection)`
  grid-column: 1 / -1;
`;

const MixerSectionTitle = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.74rem;
  font-weight: 700;
  color: #ddd;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  display: flex;
  align-items: center;
  gap: 6px;
`;

const MixerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const MixerLabel = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.74rem;
  color: #aaa;
  width: 56px;
  flex-shrink: 0;
  white-space: nowrap;
`;

const MixerValue = styled.span`
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 0.68rem;
  color: #888;
  width: 32px;
  text-align: right;
  flex-shrink: 0;
`;

const MixerSlider = styled.input`
  -webkit-appearance: none;
  flex: 1;
  min-width: 0;
  height: 4px;
  border-radius: 2px;
  background: #3a3a3a;
  outline: none;
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #ddd;
    cursor: pointer;
  }
  &::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #ddd;
    border: none;
    cursor: pointer;
  }
`;

const KitGroup = styled.div`
  display: flex;
  gap: 4px;
  flex: 1;
`;

/* Wrapper for the embedded StyleSelector — keeps it from breaking the mixer's
 * column rhythm and gives it the same dark-on-dark styling vibe. */
const StyleSelectorWrap = styled.div`
  flex: 1;
  min-width: 0;
  & > * { width: 100%; }
`;

const KitBtn = styled.button<{ $on?: boolean }>`
  flex: 1;
  font-family: 'Pretendard', sans-serif;
  font-size: 10.5px;
  font-weight: 600;
  padding: 4px 0;
  border: 1px solid ${({ $on }) => ($on ? '#4caf50' : '#4a4a4a')};
  border-radius: 5px;
  background: ${({ $on }) => ($on ? '#4caf50' : '#3a3a3a')};
  color: #fff;
  cursor: pointer;
  white-space: nowrap;
  &:hover {
    background: ${({ $on }) => ($on ? '#45a049' : '#4a4a4a')};
  }
`;

const AttribLine = styled.div`
  font-family: 'Pretendard', sans-serif;
  font-size: 9px;
  color: #888;
  margin-top: 2px;
  text-align: right;
  line-height: 1.2;
`;
