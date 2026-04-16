import { useState, useEffect } from 'react';
import styled from 'styled-components';

/* ─────────────────────────────────────────────────────────────────────────
 * Fixed bottom-left transport bar for the backing-track player.
 *
 * Visual style mirrors NoteSheet's PlayerBar + MixerPopup so the two pages
 * feel like siblings. Stateless w.r.t. tempo/volumes — owners pass the
 * current values and receive change callbacks.
 * ──────────────────────────────────────────────────────────────────────── */

export type MixChannel = 'piano' | 'bass' | 'drums';

export interface BackingPlayerBarProps {
  playing: boolean;
  tempo: number;
  onTempoChange: (bpm: number) => void;
  onPlayPause: () => void;
  volumes: Record<MixChannel, number>;
  onVolumeChange: (channel: MixChannel, volume: number) => void;
  disabled?: boolean;
}

const CHANNEL_LABELS: Record<MixChannel, string> = {
  piano: '피아노',
  bass: '베이스',
  drums: '드럼',
};

export function BackingPlayerBar({
  playing,
  tempo,
  onTempoChange,
  onPlayPause,
  volumes,
  onVolumeChange,
  disabled = false,
}: BackingPlayerBarProps) {
  const [tempoText, setTempoText] = useState(String(tempo));
  const [mixerOpen, setMixerOpen] = useState(false);

  useEffect(() => {
    setTempoText(String(tempo));
  }, [tempo]);

  const commitTempo = () => {
    const n = parseInt(tempoText, 10);
    const clamped = Math.max(40, Math.min(300, Number.isFinite(n) ? n : 140));
    setTempoText(String(clamped));
    if (clamped !== tempo) onTempoChange(clamped);
  };

  return (
    <Bar>
      {mixerOpen && (
        <MixerPopup>
          {(Object.keys(CHANNEL_LABELS) as MixChannel[]).map((ch) => (
            <MixerRow key={ch}>
              <MixerLabel>{CHANNEL_LABELS[ch]}</MixerLabel>
              <MixerSlider
                type="range"
                min={0}
                max={100}
                value={Math.round(volumes[ch] * 100)}
                onChange={(e) => onVolumeChange(ch, Number(e.target.value) / 100)}
              />
              <MixerValue>{Math.round(volumes[ch] * 100)}</MixerValue>
            </MixerRow>
          ))}
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

const Bar = styled.div`
  position: fixed;
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
  min-width: 260px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const BpmLabel = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  color: #ccc;
  letter-spacing: 0.5px;
`;

const BpmInput = styled.input`
  font-family: 'DM Sans', sans-serif;
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
  font-family: 'DM Sans', sans-serif;
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

/* ─── mixer popup ────────────────────────────────────────────────────── */

const MixerPopup = styled.div`
  background: #171717;
  border: 1px solid #333;
  border-radius: 10px;
  padding: 10px 14px;
`;

const MixerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  &:not(:last-child) { margin-bottom: 8px; }
`;

const MixerLabel = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.72rem;
  color: #aaa;
  width: 46px;
  flex-shrink: 0;
  white-space: nowrap;
`;

const MixerSlider = styled.input`
  -webkit-appearance: none;
  flex: 1;
  min-width: 0;
  height: 4px;
  border-radius: 2px;
  background: #444;
  outline: none;
  &::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #ccc;
    cursor: pointer;
  }
`;

const MixerValue = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.7rem;
  color: #888;
  width: 28px;
  text-align: right;
`;
