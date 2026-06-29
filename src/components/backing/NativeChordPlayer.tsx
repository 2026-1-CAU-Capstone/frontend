import { useState } from 'react';
import styled from 'styled-components';
import {
  BackingMixer,
  BpmControl,
  GenreSelect,
  RepeatControl,
  TransportButtons,
} from './BackingPlayerBar';
import { KeyControl, isMinorKey } from '../leadsheet/LeadSheet';
import { SessionPicker, type SessionInstrument } from '../chord/SessionPicker';
import { PlayerBarPositionProvider } from '../../contexts/PlayerBarPositionContext';

/* ─────────────────────────────────────────────────────────────────────────
 * NativeChordPlayer — iReal Pro–style 2-row bottom bar for the ChordPage in
 * the Capacitor iOS/iPad shell (and the /preview/chord browser preview).
 *
 * Mounted INSIDE the score CenterColumn so its width matches the score area
 * only (the chat panel beside it isn't covered).
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │   [Genre]   [BPM]   [3x|∞]   [Key]                              │  row 1 — real dropdowns
 *   │     🎹 piano   ◼ stop   ▶/⏸ play(big)   ≡ mixer   ▦ voicing     │  row 2 — icons
 *   └────────────────────────────────────────────────────────────────┘
 *                                                  ↑ safe-area-inset-bottom
 *
 * Row 1 wraps in PlayerBarPositionProvider position="bottom" so the cells'
 * dropdowns open UPWARD (otherwise they'd fall off-screen). */

interface Props {
  /* Top-row cells (functional). */
  tempo: number;
  onTempoChange: (n: number) => void;
  repeatCount: number;
  onRepeatChange: (n: number) => void;
  writtenKey: string;
  onWrittenKeyChange: (k: string) => void;
  /* Bottom-row instrument picker (replaces the iReal cap icon). */
  session: SessionInstrument;
  onSessionChange: (s: SessionInstrument) => void;
  /* Transport. */
  playing: boolean;
  onPlayPause: () => void;
  onStop: () => void;
  disabled?: boolean;
  /* Mixer sheet content. */
  inlineLick?: boolean;
  analysisOn?: boolean;
  onToggleAnalysis?: () => void;
}

export function NativeChordPlayer({
  tempo,
  onTempoChange,
  repeatCount,
  onRepeatChange,
  writtenKey,
  onWrittenKeyChange,
  session,
  onSessionChange,
  playing,
  onPlayPause,
  onStop,
  disabled = false,
  inlineLick,
  analysisOn,
  onToggleAnalysis,
}: Props) {
  const [mixerOpen, setMixerOpen] = useState(false);

  return (
    <>
      <Bar>
        <PlayerBarPositionProvider position="bottom">
          <CellRow>
            <GenreSelect />
            <BpmControl tempo={tempo} onTempoChange={onTempoChange} disabled={disabled} />
            <RepeatControl repeatCount={repeatCount} onRepeatChange={onRepeatChange} disabled={disabled} />
            <KeyControl
              selectedKey={writtenKey}
              onChange={onWrittenKeyChange}
              isMinor={isMinorKey(writtenKey)}
            />
          </CellRow>
        </PlayerBarPositionProvider>

        <IconRow>
          <SessionPicker value={session} onChange={onSessionChange} />
          <TransportButtons
            playing={playing}
            onPlayPause={onPlayPause}
            onStop={onStop}
            disabled={disabled}
          />
          <RoundBtn type="button" aria-label="믹서" title="믹서" onClick={() => setMixerOpen(true)}>
            <MixerIcon />
          </RoundBtn>
          <RoundBtn type="button" aria-label="보이싱" title="보이싱">
            <GridIcon />
          </RoundBtn>
        </IconRow>
      </Bar>

      {mixerOpen && (
        <SheetBackdrop onClick={() => setMixerOpen(false)}>
          <Sheet onClick={(e) => e.stopPropagation()}>
            <SheetHandle />
            <SheetHeader>
              <SheetTitle>믹서</SheetTitle>
              <SheetDone type="button" onClick={() => setMixerOpen(false)}>완료</SheetDone>
            </SheetHeader>
            <SheetBody>
              <BackingMixer
                inlineLick={inlineLick}
                analysisOn={analysisOn}
                onToggleAnalysis={onToggleAnalysis}
              />
            </SheetBody>
          </Sheet>
        </SheetBackdrop>
      )}
    </>
  );
}

/* ── icons ───────────────────────────────────────────────────────────── */

const MixerIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
    <line x1="4" y1="6" x2="20" y2="6" />
    <circle cx="9" cy="6" r="2.2" fill="#fff" />
    <line x1="4" y1="12" x2="20" y2="12" />
    <circle cx="15" cy="12" r="2.2" fill="#fff" />
    <line x1="4" y1="18" x2="20" y2="18" />
    <circle cx="11" cy="18" r="2.2" fill="#fff" />
  </svg>
);

const GridIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

/* ── styled ──────────────────────────────────────────────────────────── */

const Bar = styled.div`
  position: relative;
  z-index: 60;
  flex-shrink: 0;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  padding: 8px 14px max(8px, env(safe-area-inset-bottom, 0px));
  font-family: ${({ theme }) => theme.fonts.ui};
  display: flex;
  flex-direction: column;
  gap: 8px;
`;

/* Row 1 — functional cells, evenly distributed (mirrors iRealPro). */
const CellRow = styled.div`
  display: flex;
  justify-content: space-around;
  align-items: center;
  gap: 6px;
  flex-wrap: nowrap;
  min-width: 0;
`;

/* Row 2 — instrument picker + transport + mixer + voicing, centered. */
const IconRow = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: clamp(14px, 4vw, 28px);
`;

const RoundBtn = styled.button<{ $primary?: boolean; $tone?: 'stop' }>`
  background: ${({ $primary }) => ($primary ? '#0a84ff' : 'transparent')};
  color: ${({ $primary, $tone }) => ($primary ? '#fff' : $tone === 'stop' ? '#d63b3b' : '#0a84ff')};
  border: none;
  width: ${({ $primary }) => ($primary ? '56px' : '44px')};
  height: ${({ $primary }) => ($primary ? '56px' : '44px')};
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: transform 0.1s, background 0.15s, opacity 0.15s;
  ${({ $primary }) => $primary && 'box-shadow: 0 4px 12px rgba(10, 132, 255, 0.32);'}

  &:active:not(:disabled) { transform: scale(0.92); }
  &:disabled { opacity: 0.35; cursor: not-allowed; }
`;

/* ── mixer sheet (bottom-sheet modal) ────────────────────────────────── */

const SheetBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${({ theme }) => theme.zIndex.overlay};
  background: rgba(0, 0, 0, 0.35);
  display: flex;
  align-items: flex-end;
  justify-content: center;
`;

const Sheet = styled.div`
  width: 100%;
  max-width: 540px;
  background: #fff;
  border-top-left-radius: 18px;
  border-top-right-radius: 18px;
  max-height: 80vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  padding-bottom: env(safe-area-inset-bottom, 0px);
  font-family: ${({ theme }) => theme.fonts.ui};
`;

const SheetHandle = styled.div`
  width: 40px;
  height: 4px;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.18);
  margin: 8px auto 4px;
`;

const SheetHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 16px 10px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
`;

const SheetTitle = styled.div`
  font-size: 15px;
  font-weight: 700;
  color: #1a1a1a;
`;

const SheetDone = styled.button`
  background: none;
  border: none;
  color: #0a84ff;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
`;

const SheetBody = styled.div`
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #fff;
`;
