import styled from 'styled-components';
import { ProgressionArrow } from './ProgressionArrow';

export const MessageRow = styled.div<{ $role: 'user' | 'assistant' }>`
  display: flex;
  padding: ${({ $role }) => ($role === 'assistant' ? '10px 0' : '4px 0')};
  ${({ $role }) => ($role === 'assistant'
    ? 'width: 100%; justify-content: flex-start;'
    /* User column: image thumbnails stack ABOVE the text bubble, both
     * right-aligned (Claude style). */
    : 'flex-direction: column; align-items: flex-end;')}
`;

/* Attached-image thumbnails shown above the user bubble. */
export const UserImageRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-bottom: 8px;
  max-width: 78%;
`;

export const UserImageThumb = styled.img`
  width: 132px;
  max-height: 200px;
  object-fit: contain;
  object-position: top right;
  border-radius: 14px;
  border: 1px solid rgba(0, 0, 0, 0.1);
  background: #fff;
  display: block;
`;

export const Bubble = styled.div<{ $role: 'user' | 'assistant' }>`
  position: relative;

  ${({ $role }) =>
    $role === 'user'
      ? `
    max-width: 78%;
    padding: 14px 18px;
    border-radius: 18px;
    /* Neutral gray bubble — clearly distinct from the warm bgChat canvas. */
    background: rgba(0, 0, 0, 0.06);
    border: none;
    font-size: 15.5px;
    line-height: 1.55;
  `
      : `
    width: 100%;
    padding: 0;
    border-radius: 0;
    background: transparent;
    border: none;
    font-size: 14px;
    line-height: 1.5;
  `}

  color: ${({ theme }) => theme.colors.textPrimary};

  /* Hover-only edit pencil + timestamp on user bubbles. Hidden by
   * default; opacity:1 when the bubble itself is hovered. The
   * .user-edit-pencil / .user-timestamp classes are set on the JSX
   * sites below. */
  &:hover .user-edit-pencil,
  &:hover .user-timestamp { opacity: 1; }
`;

/* ── Edit user message (inline) ──────────────────────────────────────
 * Replaces the bubble's question text when the user clicks the pencil.
 * Layout: vertically stacked textarea + actions row. Sits inside Bubble
 * so the surrounding rounded-rect frame stays — the bubble grows to fit
 * the textarea, matching Claude's inline-edit look. */
export const EditUserRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  min-width: 280px;
`;

export const EditUserTextarea = styled.textarea`
  width: 100%;
  border: 1px solid rgba(0, 0, 0, 0.18);
  border-radius: 12px;
  padding: 10px 12px;
  font-family: inherit;
  font-size: 15.5px;
  line-height: 1.55;
  background: #fff;
  color: ${({ theme }) => theme.colors.textPrimary};
  resize: vertical;
  outline: none;
  &:focus { border-color: rgba(0, 0, 0, 0.35); }
`;

export const EditUserActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 6px;
`;

export const EditUserGhostBtn = styled.button`
  border: 1px solid rgba(0, 0, 0, 0.16);
  background: #fff;
  border-radius: 999px;
  padding: 6px 14px;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  color: rgba(0, 0, 0, 0.75);
  cursor: pointer;
  &:hover { background: rgba(0, 0, 0, 0.04); }
`;

export const EditUserPrimaryBtn = styled.button`
  border: none;
  background: #1a1a1a;
  color: #fff;
  border-radius: 999px;
  padding: 6px 14px;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.12s;
  &:hover:not(:disabled) { opacity: 0.9; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

/* Pencil button — absolutely positioned just OUTSIDE the user bubble's
 * left edge so it doesn't disturb the bubble's text. Becomes visible
 * via Bubble:hover (see above). */
export const EditUserPencilBtn = styled.button`
  position: absolute;
  top: 50%;
  right: calc(100% + 6px);
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.04);
  color: rgba(0, 0, 0, 0.55);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s, background 0.12s, color 0.12s;
  &:hover { background: rgba(0, 0, 0, 0.08); color: ${({ theme }) => theme.colors.textPrimary}; }
  &:focus-visible { opacity: 1; outline: 2px solid rgba(43, 138, 239, 0.5); outline-offset: 2px; }
`;

/* Hover-only timestamp chip below the user bubble — small grey text,
 * fades in with the pencil so the bubble stays clean at rest. */
export const TimestampHint = styled.div`
  /* Absolutely positioned just BELOW the bubble so the hidden (opacity:0)
   * timestamp doesn't reserve in-flow height — otherwise an empty ~18px gap
   * sits under the user's question text. On hover it fades in below-right. */
  position: absolute;
  top: 100%;
  right: 4px;
  margin-top: 3px;
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textSecondary};
  opacity: 0;
  transition: opacity 0.15s;
  text-align: right;
  pointer-events: none;
  white-space: nowrap;
`;

/* Assistant message action row — sits BELOW the message body as a transparent
 * strip of small icon buttons (copy / thumbs / regenerate), mirroring the
 * ChatGPT/Claude pattern. Replaces the old absolute-positioned hover-only
 * copy button. */
export const MessageActions = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 6px;
  padding-left: 2px;
`;

export const ActionBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
  padding: 0;

  &:hover {
    background: rgba(0, 0, 0, 0.05);
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

/* Legacy export retained so any other place that still imports CopyButton
 * keeps compiling. New code should use ActionBtn inside MessageActions. */
export const CopyButton = ActionBtn;

/* ── Error / aborted state ────────────────────────────────────────────
 * Inline banners that replace the empty assistant bubble when the stream
 * fails or is interrupted. ErrorBanner is for hard failures (with retry
 * affordance); AbortedBadge is the subtler "user pressed Stop" hint. */
export const ErrorBanner = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 6px;
  padding: 10px 12px;
  background: #fdeeec;
  border: 1px solid #f5c4be;
  border-radius: 10px;
  color: #8a2a1f;
  font-size: 13.5px;
  line-height: 1.4;
`;

export const ErrorText = styled.span`
  flex: 1;
  min-width: 0;
  font-weight: 500;
  word-break: break-word;
`;

export const RetryBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  border: 1px solid #d96e62;
  background: #fff;
  color: #8a2a1f;
  border-radius: 999px;
  padding: 5px 11px;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.12s;
  &:hover { background: #fbe4e0; }
  svg { width: 14px; height: 14px; }
`;

/* Fenced-code-block chrome — small header strip with the detected
 * language on the left and a hover-revealed copy chip on the right.
 * The inner <pre> from ReactMarkdown keeps its native styling; we just
 * wrap it in a rounded container with the header. */
export const CodeBlockShell = styled.div`
  position: relative;
  margin: 8px 0;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 10px;
  overflow: hidden;
  background: #f6f6f8;
  & > pre {
    margin: 0;
    padding: 12px 14px;
    background: transparent;
    overflow-x: auto;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 13.5px;
    line-height: 1.55;
  }
  & > pre > code { background: transparent; border: none; padding: 0; }
`;

export const CodeBlockHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px;
  background: rgba(0, 0, 0, 0.035);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
`;

export const CodeBlockLang = styled.span`
  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(0, 0, 0, 0.5);
  text-transform: uppercase;
`;

export const CodeBlockCopy = styled.button`
  border: none;
  background: transparent;
  color: rgba(0, 0, 0, 0.55);
  padding: 3px 8px;
  border-radius: 6px;
  font-family: inherit;
  font-size: 11.5px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  &:hover { background: rgba(0, 0, 0, 0.06); color: ${({ theme }) => theme.colors.textPrimary}; }
  &[data-copied="1"] > span::after { content: '됨'; margin-left: 2px; }
`;

export const AbortedBadge = styled.div`
  margin-top: 6px;
  font-size: 12.5px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textSecondary};
  opacity: 0.75;
  font-style: italic;
`;

export const AssistantHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
`;

export const AssistantIcon = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
  display: block;
`;

export const AssistantName = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

export const UserSelectedContext = styled.div`
  margin: 0 0 8px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.45);
`;

export const UserSelectedLabel = styled.div`
  margin-bottom: 5px;
  color: rgba(0, 0, 0, 0.58);
  font-size: 10.5px;
  font-weight: 700;
  line-height: 1.2;
`;

export const UserSelectedChordRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
`;

export const UserSelectedChordStep = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
`;

export const UserSelectedChord = styled.span`
  display: inline-flex;
  align-items: center;
  font-family: 'MuseJazz Text', 'Oswald', 'Pretendard', sans-serif;
  font-size: 1rem;
  font-weight: 600;
  line-height: 1;
  color: #000;

  span {
    font-family: 'MuseJazz Text', 'Oswald', 'Pretendard', sans-serif !important;
    font-size: inherit !important;
    letter-spacing: 0 !important;
  }
`;

export const UserSelectedArrow = styled(ProgressionArrow)`
  flex: 0 0 auto;
  width: 17px;
  height: 9px;
  color: rgba(0, 0, 0, 0.44);
  transform: translateY(1px);
`;

export const UserQuestionText = styled.div`
  white-space: pre-wrap;
`;

export const MarkdownBody = styled.div`
  font-size: 15px; /* Increased from 13.5px */
  line-height: 1.65;
  color: ${({ theme }) => theme.colors.textPrimary};

  > *:first-child { margin-top: 0; }
  > *:last-child { margin-bottom: 0; }

  h3, h4 {
    margin: 14px 0 6px;
    font-size: 16px;
    font-weight: 700;
  }

  h3 { font-size: 17px; }

  p { margin: 6px 0; }

  strong { font-weight: 700; }

  ul, ol {
    margin: 6px 0;
    padding-left: 18px;
  }

  li { margin: 4px 0; }

  li > ul, li > ol { margin: 2px 0; }

  code {
    background: ${({ theme }) => theme.colors.bgSecondary};
    border: 1px solid ${({ theme }) => theme.colors.border};
    padding: 1px 5px;
    border-radius: 4px;
    font-family: 'JetBrains Mono', 'Fira Code', monospace;
    font-size: 14px; /* Increased from 12.5px */
  }

  pre {
    background: ${({ theme }) => theme.colors.bgSecondary};
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 8px;
    padding: 10px 12px;
    overflow-x: auto;
    margin: 8px 0;

    &:has(.glick-container) {
      background: none;
      border: none;
      padding: 0;
      overflow: visible;
    }

    code {
      background: none;
      border: none;
      padding: 0;
    }
  }

  hr {
    border: none;
    border-top: 1px solid ${({ theme }) => theme.colors.border};
    margin: 12px 0;
  }

  blockquote {
    border-left: 3px solid ${({ theme }) => theme.colors.border};
    margin: 8px 0;
    padding: 4px 12px;
    color: ${({ theme }) => theme.colors.textSecondary};
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0;
    font-size: 13px;
  }

  th, td {
    border: 1px solid ${({ theme }) => theme.colors.border};
    padding: 8px;
    text-align: left;
  }

  th {
    background-color: ${({ theme }) => theme.colors.bgSecondary};
    font-weight: 600;
  }

  tr:nth-child(even) {
    background-color: ${({ theme }) => theme.colors.bgSecondary};
  }
`;
