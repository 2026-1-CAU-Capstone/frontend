import { useState, useRef, useEffect, type KeyboardEvent } from 'react';
import styled from 'styled-components';
import { isNativeApp } from '../../lib/platform';
import { IntroPlusSheet } from './IntroPlusSheet';

/* Intro-mode chat input — pixel-matched to the Claude apps:
 *   - Desktop (web): tall white box, soft border, large textarea, floating
 *     focus shadow. Send arrow appears as a dark circle on type.
 *   - Mobile (native): warm cream pill, no border / no shadow, compact
 *     single-line height, four-icon bottom row: [+] [Opus 4.7] … [mic] [⬛].
 *     The right-most dark circle shows a waveform when idle and morphs
 *     into the send-arrow when the user has typed. */

interface Props {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}

const PLUS_MENU: { icon: string; label: string; shortcut?: string }[] = [
  { icon: '📎', label: '파일 또는 사진 추가', shortcut: '⌘U' },
  { icon: '🎵', label: 'MIDI 가져오기' },
  { icon: '📄', label: '악보 (PDF / MusicXML)' },
  { icon: '📷', label: '악보 사진 촬영' },
];

export function IntroChatInput({ onSend, disabled, placeholder, autoFocus }: Props) {
  const [value, setValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const native = isNativeApp();

  useEffect(() => {
    if (!autoFocus) return;
    const id = setTimeout(() => ref.current?.focus(), 2300);
    return () => clearTimeout(id);
  }, [autoFocus]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || plusBtnRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const send = () => {
    const t = value.trim();
    if (!t) return;
    onSend(t);
    setValue('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const hasText = value.trim().length > 0;

  return (
    <>
    <Box>
      <TA
        ref={ref}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKey}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
      />
      <BottomRow>
        <LeftCluster>
          <PlusWrap>
            <PlusBtn
              ref={plusBtnRef}
              type="button"
              aria-label="추가"
              onClick={() => {
                if (native) setSheetOpen(true);
                else setMenuOpen((v) => !v);
              }}
            >
              <PlusIcon />
            </PlusBtn>
            {menuOpen && !native && (
              <Menu ref={menuRef} role="menu">
                {PLUS_MENU.map((item) => (
                  <MenuItem key={item.label} role="menuitem" onClick={() => setMenuOpen(false)}>
                    <MenuIcon>{item.icon}</MenuIcon>
                    <MenuLabel>{item.label}</MenuLabel>
                    {item.shortcut && <MenuShortcut>{item.shortcut}</MenuShortcut>}
                  </MenuItem>
                ))}
              </Menu>
            )}
          </PlusWrap>
          <ModelPill type="button" aria-label="Model">
            Opus 4.7
            <ChevronDown />
          </ModelPill>
        </LeftCluster>

        <RightCluster>
          {/* Mobile-only second icon: mic (separate from the dark circle). */}
          <MicBtn type="button" aria-label="Voice">
            <MicIcon />
          </MicBtn>
          {/* Dark circle — waveform when idle, send arrow when typing. */}
          <DarkCircle
            type="button"
            onClick={hasText ? send : undefined}
            disabled={disabled && hasText}
            aria-label={hasText ? 'Send' : 'Voice mode'}
          >
            {hasText ? <ArrowUpIcon /> : <WaveformIcon />}
          </DarkCircle>
        </RightCluster>
      </BottomRow>
    </Box>
    {native && <IntroPlusSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />}
    </>
  );
}

/* ── SVG icons ───────────────────────────────────────────── */

const PlusIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
    <line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const ChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    <path d="M2 4 L6 8 L10 4" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const MicIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <rect x="9" y="3" width="6" height="12" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <path d="M5 11 a7 7 0 0 0 14 0" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    <line x1="12" y1="18" x2="12" y2="22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const WaveformIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
    {[3, 6, 9, 12, 15, 18, 21].map((x, i) => {
      const h = [6, 12, 18, 14, 18, 10, 6][i];
      return (
        <line
          key={x}
          x1={x}
          y1={12 - h / 2}
          x2={x}
          y2={12 + h / 2}
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      );
    })}
  </svg>
);

const ArrowUpIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <path
      d="M12 19 L12 5 M5 12 L12 5 L19 12"
      stroke="currentColor"
      strokeWidth="2.2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/* ── styles ──────────────────────────────────────────────── */

const Box = styled.div`
  width: 100%;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 28px;
  box-shadow: 0 10px 36px rgba(0, 0, 0, 0.06);
  display: flex;
  flex-direction: column;
  padding: 32px 32px 20px;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;

  &:focus-within {
    border-color: rgba(0, 0, 0, 0.18);
    box-shadow:
      0 2px 6px rgba(0, 0, 0, 0.04),
      0 22px 50px -12px rgba(0, 0, 0, 0.18);
  }

  /* ── Mobile (native Claude-iOS look) — white pill, no border ─ */
  @media (max-width: 768px) {
    background: #ffffff;
    border: 1px solid rgba(255, 255, 255, 0.9);
    border-radius: 26px;
    padding: 12px 16px 10px;
    box-shadow: none;

    &:focus-within {
      border: 1px solid rgba(255, 255, 255, 0.9);
      box-shadow: none;
    }
  }
`;

const TA = styled.textarea`
  width: 100%;
  min-height: 130px;
  max-height: 360px;
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: #1a1a1a;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 20px;
  line-height: 1.55;
  padding: 0;

  &::placeholder {
    color: rgba(0, 0, 0, 0.35);
  }

  @media (max-width: 768px) {
    min-height: 40px;
    max-height: 180px;
    font-size: 16px;
    line-height: 1.45;
    padding: 4px 4px 0;
  }
`;

const BottomRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
  gap: 10px;

  @media (max-width: 768px) {
    margin-top: 8px;
  }
`;

const LeftCluster = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`;

const RightCluster = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const PlusWrap = styled.div`
  position: relative;
`;

/* + button — desktop: outlined ring. Mobile: filled cream-darker circle. */
const PlusBtn = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: transparent;
  color: rgba(0, 0, 0, 0.7);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, color 0.12s;
  flex-shrink: 0;

  &:hover { background: rgba(0, 0, 0, 0.04); color: #000; }

  @media (max-width: 768px) {
    width: 34px;
    height: 34px;
    border: none;
    background: rgba(0, 0, 0, 0.04);
    color: rgba(0, 0, 0, 0.75);

    &:hover { background: rgba(0, 0, 0, 0.07); }
  }
`;

/* Model pill — desktop: ghost button. Mobile: filled pill, matches Claude. */
const ModelPill = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border-radius: 18px;
  border: none;
  background: transparent;
  color: rgba(0, 0, 0, 0.65);
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  font-weight: 500;
  cursor: default;
  flex-shrink: 0;

  &:hover { background: rgba(0, 0, 0, 0.04); color: #000; }

  @media (max-width: 768px) {
    padding: 6px 12px;
    border-radius: 16px;
    background: rgba(0, 0, 0, 0.04);
    color: rgba(0, 0, 0, 0.75);
    font-size: 14px;
    font-weight: 500;
  }
`;

/* Mobile-only mic icon — hidden on desktop (desktop uses single dark
 * circle on the right; the waveform/send-arrow lives there). */
const MicBtn = styled.button`
  display: none;

  @media (max-width: 768px) {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: none;
    background: rgba(0, 0, 0, 0.04);
    color: rgba(0, 0, 0, 0.75);
    cursor: pointer;
    flex-shrink: 0;

    &:hover { background: rgba(0, 0, 0, 0.07); }
  }
`;

/* The dark filled circle on the right. Mobile shows the waveform glyph
 * when idle and morphs into ↑ on type. Desktop hides the waveform branch
 * and only shows ↑ when typing — IconBtn (border ring) used elsewhere. */
const DarkCircle = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: #1a1a1a;
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  flex-shrink: 0;

  &:hover { opacity: 0.85; }
  &:active { transform: scale(0.95); }
  &:disabled { opacity: 0.4; cursor: default; }

  @media (max-width: 768px) {
    width: 34px;
    height: 34px;
  }
`;

/* ── + dropdown menu ─────────────────────────────────────── */

const Menu = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  min-width: 280px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.12);
  padding: 6px;
  z-index: 100;
  animation: menuIn 0.12s ease both;

  @keyframes menuIn {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
`;

const MenuItem = styled.button`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  border-radius: 10px;
  cursor: pointer;
  text-align: left;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 15px;
  color: #1a1a1a;
  transition: background 0.1s;

  &:hover, &:focus-visible {
    background: rgba(0, 0, 0, 0.04);
    outline: none;
  }
`;

const MenuIcon = styled.span`
  font-size: 18px;
  width: 22px;
  text-align: center;
  flex-shrink: 0;
`;

const MenuLabel = styled.span`
  flex: 1;
  font-weight: 500;
`;

const MenuShortcut = styled.span`
  font-size: 13px;
  color: rgba(0, 0, 0, 0.4);
  margin-left: 8px;
  flex-shrink: 0;
`;
