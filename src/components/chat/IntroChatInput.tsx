import { Fragment, useState, useRef, useEffect, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import styled from 'styled-components';
import { isNativeApp } from '../../lib/platform';
import { IntroPlusSheet } from './IntroPlusSheet';
import { getCachedUser, onAuthChange } from '../../api/auth';
import type { ChordOverlay } from '../../data/types';
import { formatChordsInText } from './chordFormat';
import {
  SelectedContext,
  SelectedContextClose,
  SelectedContextLabel,
  SelectedChordRow,
  SelectedChordStep,
  SelectedChordChip,
  SelectedChordArrow,
  SelectedMoreChip,
  QuickActionRow,
  QuickActionButton,
} from './ChatInput.styles';

/** Files we accept as attachments: images + PDF (악보/사진). */
const ATTACH_ACCEPT = 'image/*,application/pdf,.pdf';
const MAX_VISIBLE_CHIPS = 6;

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
  /** Compact variant used when this input is pinned at the bottom of an
   *  active conversation (mid-chat). Shrinks the padding, border-radius and
   *  textarea height so the input doesn't dominate the chat area. */
  compact?: boolean;
  /* ── chord-selection (chord/note pages only) ───────────────────────── */
  selectedChords?: ChordOverlay[];
  onClearSelectedChords?: () => void;
  isSelectionMode?: boolean;
  onToggleSelectionMode?: () => void;
  onRequestLicks?: () => void;
  hideSelectionQuickAction?: boolean;
}

interface MenuEntry {
  id: string;
  /** Function so the icon JSX is created lazily — avoids TDZ when defined
   *  at module top alongside arrays. */
  renderIcon: () => ReactNode;
  label: string;
}

/* Always-available actions — work whether or not the user is signed in. */
const ALWAYS_ITEMS: MenuEntry[] = [
  { id: 'photo', renderIcon: () => <PaperclipIcon />, label: '악보 또는 사진 추가' },
  { id: 'web',   renderIcon: () => <GlobeIcon />,     label: '웹 검색' },
];

/* Actions gated by login — rendered greyed-out with a "로그인해 써 보세요…"
 *  label above them when the user isn't authed. */
const LOGIN_GATED_ITEMS: MenuEntry[] = [
  { id: 'file',  renderIcon: () => <ClipPlusIcon />,  label: '파일 추가' },
  { id: 'think', renderIcon: () => <LightbulbIcon />, label: '더 오래 생각하기' },
  { id: 'gpt5',  renderIcon: () => <AtomIcon />,      label: 'GPT-5' },
];

export function IntroChatInput({
  onSend, disabled, placeholder, autoFocus, compact,
  selectedChords = [],
  onClearSelectedChords,
  isSelectionMode,
  onToggleSelectionMode,
  onRequestLicks,
  hideSelectionQuickAction,
}: Props) {
  const [value, setValue] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [loggedIn, setLoggedIn] = useState(() => getCachedUser() !== null);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const plusBtnRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const native = isNativeApp();

  const showSelectionQuickAction = !hideSelectionQuickAction && !!onToggleSelectionMode;
  const showLickQuickAction = selectedChords.length > 0 && !!onRequestLicks;
  const visibleChords = selectedChords.slice(0, MAX_VISIBLE_CHIPS);
  const hiddenChordCount = selectedChords.length - visibleChords.length;

  const openFilePicker = () => fileInputRef.current?.click();
  const onFilesPicked = (files: FileList | null) => {
    const picked = Array.from(files ?? []);
    if (picked.length === 0) return;
    setAttachments((prev) => [...prev, ...picked]);
  };

  /* Drag & drop — accept any files dropped onto the input box. Stored in
   * local state as attachments and shown as thumbnail chips above the
   * textarea. (Sending is currently text-only; the chip persists as a
   * visual hint for the upcoming file-attachment backend work.) */
  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) setIsDragOver(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    /* Guard against leaving for child elements (dragleave fires when the
     * pointer crosses any sub-element). Only clear when truly outside. */
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = Array.from(e.dataTransfer.files ?? []);
    if (dropped.length === 0) return;
    setAttachments((prev) => [...prev, ...dropped]);
  };
  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  useEffect(() => onAuthChange((isLoggedIn) => setLoggedIn(isLoggedIn)), []);

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
    {/* Quick actions ("코드 구간 선택" / "릭 추천") sit ABOVE the input box. */}
    {(showSelectionQuickAction || showLickQuickAction) && (
      <QuickActionRow style={{ padding: '0 4px 8px' }}>
        {showSelectionQuickAction && (
          <QuickActionButton
            onClick={onToggleSelectionMode}
            disabled={disabled}
            style={{
              background: isSelectionMode ? 'linear-gradient(135deg, #2D8F5E, #1F6A44)' : undefined,
              color: isSelectionMode ? '#fff' : undefined,
              borderColor: isSelectionMode ? 'transparent' : undefined,
            }}
          >
            {isSelectionMode ? '✨ 구간 선택 활성화됨 (클릭하여 취소)' : '🎯 코드 구간 직접 선택하기'}
          </QuickActionButton>
        )}
        {showLickQuickAction && (
          <QuickActionButton
            onClick={onRequestLicks}
            disabled={disabled}
            style={{ background: 'linear-gradient(135deg, #B8860B, #996600)', color: '#fff', borderColor: 'transparent', fontWeight: 700 }}
          >
            💡 릭 추천받기
          </QuickActionButton>
        )}
      </QuickActionRow>
    )}
    <Box
      $compact={compact}
      onDragOver={onDragOver}
      onDragEnter={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept={ATTACH_ACCEPT}
        multiple
        style={{ display: 'none' }}
        onChange={(e) => { onFilesPicked(e.target.files); e.target.value = ''; }}
      />
      {/* Selected-chord chips stay INSIDE the box, above the textarea. */}
      {selectedChords.length > 0 && (
        <div style={{ padding: '0 0 8px' }}>
          <SelectedContext>
            {onClearSelectedChords && (
              <SelectedContextClose type="button" aria-label="선택한 코드 구간 지우기" onClick={onClearSelectedChords}>X</SelectedContextClose>
            )}
            <SelectedContextLabel>선택한 코드 구간 · {selectedChords.length}개</SelectedContextLabel>
            <SelectedChordRow>
              {visibleChords.map((chord, i) => (
                <SelectedChordStep key={chord.id}>
                  {i > 0 && <SelectedChordArrow />}
                  <SelectedChordChip>{formatChordsInText(chord.symbol)}</SelectedChordChip>
                </SelectedChordStep>
              ))}
              {hiddenChordCount > 0 && <SelectedMoreChip>+{hiddenChordCount}</SelectedMoreChip>}
            </SelectedChordRow>
          </SelectedContext>
        </div>
      )}
      {isDragOver && (
        <DragOverlay>
          <DragOverlayIcon>📥</DragOverlayIcon>
          <DragOverlayText>여기에 파일 놓기</DragOverlayText>
        </DragOverlay>
      )}
      {attachments.length > 0 && (
        <AttachRow>
          {attachments.map((f, i) => (
            <AttachChip key={`${f.name}-${i}`} title={f.name}>
              <AttachKindIcon>{/\.(png|jpe?g|gif|webp)$/i.test(f.name) ? '🖼' : '📄'}</AttachKindIcon>
              <AttachName>{f.name}</AttachName>
              <AttachRemoveBtn onClick={() => removeAttachment(i)} aria-label="제거">×</AttachRemoveBtn>
            </AttachChip>
          ))}
        </AttachRow>
      )}
      <TA
        ref={ref}
        $compact={compact}
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
                {/* Top group — each item followed by a divider so the menu
                 *  reads as a list of distinct actions (matches reference). */}
                {ALWAYS_ITEMS.map((item, i) => (
                  <Fragment key={item.id}>
                    <MenuItem
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        if (item.id === 'photo') openFilePicker();
                      }}
                    >
                      <MenuIcon>{item.renderIcon()}</MenuIcon>
                      <MenuLabel>{item.label}</MenuLabel>
                    </MenuItem>
                    {i < ALWAYS_ITEMS.length - 1 && <MenuDivider />}
                  </Fragment>
                ))}
                <MenuDivider />
                {!loggedIn && <MenuHint>로그인해 써 보세요…</MenuHint>}
                {LOGIN_GATED_ITEMS.map((item) => (
                  <MenuItem
                    key={item.id}
                    role="menuitem"
                    disabled={!loggedIn}
                    aria-disabled={!loggedIn}
                    onClick={loggedIn ? () => setMenuOpen(false) : undefined}
                  >
                    <MenuIcon>{item.renderIcon()}</MenuIcon>
                    <MenuLabel>{item.label}</MenuLabel>
                  </MenuItem>
                ))}
              </Menu>
            )}
          </PlusWrap>
          <ModelPill type="button" aria-label="Model">
            Sonnet 4.6
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
    <Disclaimer>Jazzify는 AI이며 실수할 수 있습니다.</Disclaimer>
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

/* ── + menu icons (line style, matches the screenshot) ────────── */

const ICON_STROKE = 1.6;

function PaperclipIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M21 11.5 12.5 20a5 5 0 0 1-7-7L14 4.5a3.5 3.5 0 1 1 5 5L10.5 18a2 2 0 0 1-3-3l7.5-7.5"
        stroke="currentColor"
        strokeWidth={ICON_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GlobeIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth={ICON_STROKE} />
      <path d="M3 12h18" stroke="currentColor" strokeWidth={ICON_STROKE} />
      <path
        d="M12 3c2.8 3 4.2 6 4.2 9s-1.4 6-4.2 9c-2.8-3-4.2-6-4.2-9s1.4-6 4.2-9z"
        stroke="currentColor"
        strokeWidth={ICON_STROKE}
        fill="none"
      />
    </svg>
  );
}

function ClipPlusIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M14.5 4.5a3.5 3.5 0 0 1 5 5L11 18a2 2 0 0 1-3-3l7-7"
        stroke="currentColor"
        strokeWidth={ICON_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="6" cy="18" r="3.5" stroke="currentColor" strokeWidth={ICON_STROKE} fill="none" />
      <path d="M6 16.5v3M4.5 18h3" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="round" />
    </svg>
  );
}

function LightbulbIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.7.5 1 1.2 1 2v1h5v-1c0-.8.3-1.5 1-2A6 6 0 0 0 12 3z"
        stroke="currentColor"
        strokeWidth={ICON_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function AtomIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" stroke="currentColor" strokeWidth={ICON_STROKE} />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" stroke="currentColor" strokeWidth={ICON_STROKE} transform="rotate(60 12 12)" />
      <ellipse cx="12" cy="12" rx="9" ry="3.5" stroke="currentColor" strokeWidth={ICON_STROKE} transform="rotate(120 12 12)" />
    </svg>
  );
}

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

const Box = styled.div<{ $compact?: boolean }>`
  width: 100%;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: ${({ $compact }) => ($compact ? '22px' : '28px')};
  box-shadow: ${({ $compact }) => ($compact ? '0 2px 8px rgba(0, 0, 0, 0.04)' : '0 10px 36px rgba(0, 0, 0, 0.06)')};
  display: flex;
  flex-direction: column;
  padding: ${({ $compact }) => ($compact ? '8px 14px 8px' : '32px 32px 20px')};
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
  position: relative;

  &:focus-within {
    border-color: rgba(0, 0, 0, 0.18);
    box-shadow: ${({ $compact }) => ($compact
      ? '0 4px 16px rgba(0, 0, 0, 0.08)'
      : '0 2px 6px rgba(0, 0, 0, 0.04), 0 22px 50px -12px rgba(0, 0, 0, 0.18)')};
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

/* ── Drag-over overlay + attachment chip styles ──────────── */

const DragOverlay = styled.div`
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: rgba(57, 120, 247, 0.08);
  border: 2px dashed #3978f7;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  color: #1a4f8a;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-weight: 600;
  pointer-events: none;
  z-index: 10;
`;
const DragOverlayIcon = styled.div`
  font-size: 28px;
`;
const DragOverlayText = styled.div`
  font-size: 14px;
`;

const AttachRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
`;
const AttachChip = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 4px 6px 4px 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.05);
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12px;
  color: #1a1a1a;
`;
const AttachKindIcon = styled.span`
  font-size: 14px;
  line-height: 1;
`;
const AttachName = styled.span`
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
`;
const AttachRemoveBtn = styled.button`
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.18);
  color: #fff;
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  &:hover { background: rgba(0, 0, 0, 0.28); }
`;

const TA = styled.textarea<{ $compact?: boolean }>`
  width: 100%;
  min-height: ${({ $compact }) => ($compact ? '36px' : '130px')};
  max-height: ${({ $compact }) => ($compact ? '180px' : '360px')};
  resize: none;
  border: none;
  outline: none;
  background: transparent;
  color: #1a1a1a;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: ${({ $compact }) => ($compact ? '15px' : '20px')};
  line-height: ${({ $compact }) => ($compact ? '1.45' : '1.55')};
  padding: ${({ $compact }) => ($compact ? '6px 2px 0' : '0')};

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

/* Small caption beneath the input — soft reminder that AI output is fallible.
 *  Centered, muted, tiny. */
const Disclaimer = styled.p`
  margin: 14px 0 0;
  text-align: center;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 11.5px;
  color: rgba(0, 0, 0, 0.4);
  line-height: 1.3;

  @media (max-width: 768px) {
    font-size: 10.5px;
    margin-top: 11px;
  }
`;

const Menu = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  min-width: 256px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 16px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.12);
  padding: 6px 4px;
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
  gap: 14px;
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
  transition: background 0.1s, color 0.1s;

  &:hover:not(:disabled),
  &:focus-visible:not(:disabled) {
    background: rgba(0, 0, 0, 0.04);
    outline: none;
  }

  &:disabled {
    color: rgba(0, 0, 0, 0.32);
    cursor: default;
  }
`;

const MenuIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  color: currentColor;
`;

const MenuLabel = styled.span`
  flex: 1;
  font-weight: 500;
`;

const MenuDivider = styled.div`
  height: 1px;
  background: rgba(0, 0, 0, 0.08);
  margin: 6px 4px;
`;

/* Small dim caption above the login-gated group. Mirrors the screenshot's
 *  "로그인해 써 보세요…" hint. */
const MenuHint = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13.5px;
  color: rgba(0, 0, 0, 0.42);
  padding: 6px 12px 4px;
`;
