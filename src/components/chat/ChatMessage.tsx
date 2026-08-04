import React, { useMemo, useState, useCallback, useEffect, useContext, useRef } from 'react';
import { safeVideoUrl } from '../../lib/safeVideoUrl';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { ChatMessage as ChatMessageType } from '../../data/types';
import type { RagChunk } from '../../api/harmorag';
import type { LickMatch } from '../../lib/lickMatcher';
import { formatChordsInText } from './chordFormat';
import { LickRecommendMessage, LickRecommendList, jsonToLickEntry } from './LickRecommendMessage';
import { StemSplitMessage } from './StemSplitMessage';
import type { LickEntry } from '../../data/lickData';
import { ChatChartCard } from './ChatChartCard';
import { parseChatChart, splitChordTables, type ChatChart } from '../../lib/chatChartParser';
import styled, { keyframes } from 'styled-components';

/* Inline section label — small black filled SQUARE sized to the surrounding
 * text's cap-height so it reads as part of the sentence, not an oversized
 * badge. Sizing math:
 *   font-size 0.7em  → the inner letter
 *   width/height 1.32em (of that 0.7em) ≈ 0.92em of the parent → ~cap height
 *   vertical-align -0.16em drops the box so its centre sits on the text's
 *   cap-region centre instead of floating above the baseline.
 * The letter is optically centred with a hair of padding-bottom because
 * uppercase glyphs sit slightly low in their line box. */
const InlineSectionTag = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* em-based so the square scales with its context — bigger inside an h3,
   * smaller inside body text — automatically. */
  width: 1.42em;
  height: 1.42em;
  box-sizing: border-box;
  background: ${({ theme }) => theme.colors.inkSurface};
  color: ${({ theme }) => theme.colors.onInk};
  /* ALWAYS gothic. !important + the descendant rule below defeat the recursive
   * markdown formatter, which can otherwise wrap the section letter in a
   * chord-typography (MuseJazz) span and flip the badge's font. */
  font-family: 'Pretendard', sans-serif !important;
  font-size: 0.92em;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
  border-radius: 3px;
  margin: 0 0.26em;
  padding-bottom: 0.04em;
  /* Raised vs the old -0.26em — the badge sat too low in the line. */
  vertical-align: -0.13em;

  & * {
    font-family: 'Pretendard', sans-serif !important;
    font-size: inherit !important;
    letter-spacing: 0 !important;
  }
`;

/* Pattern + helper used by the markdown component override below to inline
 * [SEC:X] tags inside the same <p> as adjacent text — keeping them on the
 * same line as opposed to forcing a paragraph break. */
const SEC_TAG_RE = /\[SEC:([^\]]+)\]/g;

function inlineSectionTags(text: string, keyPrefix = 'sec'): React.ReactNode[] {
  if (!SEC_TAG_RE.test(text)) {
    SEC_TAG_RE.lastIndex = 0;
    return [text];
  }
  SEC_TAG_RE.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let lastIdx = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = SEC_TAG_RE.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(text.slice(lastIdx, m.index));
    out.push(<InlineSectionTag key={`${keyPrefix}-${i++}`}>{m[1]}</InlineSectionTag>);
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx));
  return out;
}

/* ── Inline source citations ([1], [2], …) ────────────────────────────────
 * The RAG server numbers the retrieved sources ([1], [2], …) in the injected
 * context and instructs the LLM to append the matching [n] after any sentence
 * built on a source. We render each [n] as a small superscript chip that
 * resolves to message.ragDebug.chunks[n-1] (provided via CitationsContext).
 * For YouTube-sourced chunks the chip becomes a deep-link to the exact moment
 * (video_url / video_id + start_sec) and shows mm:ss. */
const CitationsContext = React.createContext<RagChunk[] | undefined>(undefined);

// Bare [n] not immediately followed by '(' (so markdown links [t](url) are left alone).
const CITE_RE = /\[(\d{1,2})\](?!\()/g;

const fmtMMSS = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const CiteBadge = styled.sup`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.05em;
  height: 1.05em;
  padding: 0 0.28em;
  margin: 0 0.12em;
  font-size: 0.62em;
  font-weight: 700;
  line-height: 1;
  color: #2b6cb0;
  background: ${({ theme }) => theme.colors.surfaceSunken};
  border: 1px solid #cfe0f5;
  border-radius: 999px;
  vertical-align: super;
  cursor: help;
  user-select: none;
`;

/* YouTube-source citation pill. White pill chrome with the official YouTube
 * red rounded-rectangle logo on the left, monospace timestamp on the right.
 * The logo is rendered as inline SVG so it scales crisply with em-based
 * sizing (the citation lives inside chat body text). */
const CiteVideoLink = styled.a`
  display: inline-flex;
  align-items: center;
  gap: 0.42em;
  padding: 0.18em 0.6em 0.18em 0.45em;
  margin: 0 0.14em;
  font-size: 0.78em;
  font-weight: 600;
  line-height: 1;
  color: ${({ theme }) => theme.colors.textPrimary};
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 999px;
  text-decoration: none;
  vertical-align: baseline;
  white-space: nowrap;
  transition: background 0.12s, border-color 0.12s, box-shadow 0.12s;
  &:hover {
    background: ${({ theme }) => theme.colors.surfaceSunken};
    border-color: ${({ theme }) => theme.colors.border};
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  }
`;

const CiteVideoTime = styled.span`
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

/* Official YouTube-style logo glyph: red rounded rectangle with a white
 * play triangle. Sized in em so it sits nicely next to the timestamp text. */
function YoutubeLogo() {
  return (
    <svg
      width="1.45em"
      height="1em"
      viewBox="0 0 28 20"
      fill="none"
      aria-hidden
      style={{ display: 'block', flex: 'none' }}
    >
      <rect width="28" height="20" rx="5.5" fill="#FF0000" />
      <path d="M11.5 6 L11.5 14 L18 10 Z" fill="#fff" />
    </svg>
  );
}

/** A single [n] citation. Resolves the source from context; falls back to the
 *  literal "[n]" text when no matching source exists (so content is preserved). */
function CitationChip({ n }: { n: number }) {
  const chunks = useContext(CitationsContext);
  const chunk = chunks?.[n - 1];
  if (!chunk) return <>{`[${n}]`}</>;

  const label = chunk.song ? `${chunk.song} — ${chunk.title}` : chunk.title;
  const isVideo = !!(chunk.video_id || chunk.video_url) && chunk.start_sec != null;

  if (isVideo) {
    const ts = Math.floor(chunk.start_sec ?? 0);
    const url = safeVideoUrl(chunk.video_url, chunk.video_id, ts);
    if (!url) return <CiteBadge title={label}>{n}</CiteBadge>;
    const mmss = fmtMMSS(ts);
    const title = `${chunk.channel ? chunk.channel + ' · ' : ''}${label} · ${mmss}`;
    return (
      <CiteVideoLink href={url} target="_blank" rel="noopener noreferrer" title={title}>
        <YoutubeLogo />
        <CiteVideoTime>{mmss}</CiteVideoTime>
      </CiteVideoLink>
    );
  }
  return <CiteBadge title={label}>{n}</CiteBadge>;
}

/** Split a plain-text fragment on [n] citations, chord-formatting the text
 *  between them and replacing each [n] with a CitationChip. */
function renderCitationFragment(text: string, keyHint: string): React.ReactNode {
  CITE_RE.lastIndex = 0;
  if (!CITE_RE.test(text)) {
    CITE_RE.lastIndex = 0;
    return <>{formatChordsInText(text)}</>;
  }
  CITE_RE.lastIndex = 0;
  const out: React.ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = CITE_RE.exec(text)) !== null) {
    if (m.index > last) {
      out.push(<React.Fragment key={`ct-${keyHint}-${i}`}>{formatChordsInText(text.slice(last, m.index))}</React.Fragment>);
    }
    out.push(<CitationChip key={`cc-${keyHint}-${i}`} n={parseInt(m[1], 10)} />);
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) {
    out.push(<React.Fragment key={`ct-${keyHint}-tail`}>{formatChordsInText(text.slice(last))}</React.Fragment>);
  }
  return <>{out}</>;
}

// Lick ids can be numeric (legacy frontend JSON) OR UUID strings (backend
// /v1/licks). Match anything that isn't a closing bracket so both work.
const LICK_TAG_RE = /\[LICK:([^\]]+)\]/g;
import {
  MessageRow,
  Bubble,
  UserImageRow,
  UserImageThumb,
  MarkdownBody,
  AssistantHeader,
  AssistantIcon,
  UserSelectedContext,
  UserSelectedLabel,
  UserSelectedChordRow,
  UserSelectedChordStep,
  UserSelectedChord,
  UserSelectedArrow,
  UserQuestionText,
  MessageActions,
  ActionBtn,
  ErrorBanner,
  ErrorText,
  RetryBtn,
  AbortedBadge,
  EditUserRow,
  EditUserTextarea,
  EditUserActions,
  EditUserGhostBtn,
  EditUserPrimaryBtn,
  EditUserPencilBtn,
  TimestampHint,
  CodeBlockShell,
  CodeBlockHeader,
  CodeBlockLang,
  CodeBlockCopy,
} from './ChatMessage.styles';

const ICON_STROKE = 1.7;

/* Relative-time hint shown under user messages on hover. Buckets:
 *   < 60s  → "방금"
 *   < 60m  → "N분 전"
 *   < 24h  → "N시간 전"
 *   < 7d   → "N일 전"
 *   else   → "YYYY. M. D."   (full locale string sits in the title attr).
 * Kept short on purpose — the chip is small + only visible on hover. */
function formatTimestamp(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return '방금';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}분 전`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}시간 전`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}일 전`;
  const d = new Date(ts);
  return `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
}

const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

/* Pencil — hover-only edit affordance on user messages. */
const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 20h4l10-10-4-4L4 16v4z" />
    <path d="M14 6l4 4" />
  </svg>
);

/* Inline error/warning triangle for the ErrorBanner. */
const ErrorIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
  </svg>
);

const RegenerateIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
    <path d="M3 21v-5h5" />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M5 12l5 5L20 7" />
  </svg>
);

interface ChatMessageProps {
  message: ChatMessageType;
  /**
   * When true, suppress inline ```chart rendering. Used on the ChordPage
   * RightChatPanel where the user is already viewing a chord chart and
   * regenerating it inside the assistant's reply would be redundant.
   */
  suppressChart?: boolean;
  songTempo?: number;
  /** ChordPage 전용 — 추천 릭을 좌측 코드 차트에 핀(▼ 버튼). 없으면 카드의
   *  ▼ 버튼이 숨겨진다(코드 진행이 없는 곳에선 끼울 데가 없으므로). */
  onLickShowInline?: (lick: LickEntry) => void;
  /** 현재 차트에 핀된 릭 id — 해당 카드의 ▼ 를 활성색으로. */
  activeInlineLickId?: string | number;
  /** RAG source chunks for THIS message (message.ragDebug?.chunks), used to
   *  resolve inline [n] citation chips to their source / video timestamp. */
  citations?: RagChunk[];
  /** Optional retry handler — when set on an errored assistant message,
   *  ChatMessage renders an inline "다시 시도" button next to the error
   *  banner. RightChatPanel wires this to re-run handleSend with the
   *  original prompt + images. */
  onRetry?: () => void;
  /** Optional regenerate handler — when set on a successful assistant
   *  message (no error, not streaming), ChatMessage shows the "다시 생성"
   *  icon in the action row. Removed when omitted so we don't render a
   *  fake/no-op button. */
  onRegenerate?: () => void;
  /** Edit-and-resend handler for user messages. When set, hover over a
   *  user bubble exposes a pencil — clicking flips the bubble into an
   *  inline textarea; saving forks the chat at that point (drops the
   *  message + everything after, then re-sends the new content). */
  onEditUserMessage?: (newContent: string) => void;
  /** True while THIS message is the one currently streaming. Used to hold the
   *  deterministic inline-lick fallback until the stream finishes (so DB lick
   *  cards don't flicker as the model's [LICK:id] tags arrive mid-stream). */
  isStreaming?: boolean;
}

/** Format a single string: [SEC:X] → square tag, [n] → citation chip, chord
 *  symbols → typography. */
function formatStringNode(text: string, keyHint = 'k'): React.ReactNode {
  // First inline any [SEC:X] tags, then within each remaining text fragment
  // replace [n] citations and format chord symbols. Section tags stay as JSX.
  const parts = inlineSectionTags(text, keyHint);
  return (
    <>
      {parts.map((p, i) =>
        typeof p === 'string'
          ? <span key={`s-${keyHint}-${i}`}>{renderCitationFragment(p, `${keyHint}-${i}`)}</span>
          : p,
      )}
    </>
  );
}

/** Recursively walk React children and format chord symbols + section tags
 *  in text nodes. Block-level children are recursed-into; everything stays
 *  inline within its enclosing element. */
function formatChildChords(children: React.ReactNode, keyHint = 'r'): React.ReactNode {
  return React.Children.map(children, (child, idx) => {
    if (typeof child === 'string') {
      return formatStringNode(child, `${keyHint}-${idx}`);
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.props.children) {
      return React.cloneElement(child, {}, formatChildChords(child.props.children, `${keyHint}-${idx}`));
    }
    return child;
  });
}

/* ── 로딩 / 생성 중 애니메이션 ─────────────────────────────────────────────── */

const fadeInOut = keyframes`
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
`;

const pulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 0.7; }
  50% { transform: scale(1.04); opacity: 1; }
`;

const ThinkingWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 0 4px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.fonts.ui};
  animation: ${fadeInOut} 2s ease-in-out infinite;
`;

/* Six pre-split frames at /public/dynamic/sax-{0..5}.png. We cycle through
 * them via setInterval (see SaxFrame component below) instead of moving a
 * sprite background — that way each frame is shown in-place and only the
 * image src changes, exactly as a flipbook would. */
const SAX_FRAME_COUNT = 6;
const SAX_FRAME_MS = 140;     // ~7fps cycle; tweak for faster/slower swing

/* Fixed 44×44 stage; all six frames are stacked absolutely inside it and we
 * toggle which one is visible via opacity. Swapping a single <img>'s `src` at
 * 7fps made the ~200KB PNGs re-fetch/re-decode each tick, so on the first (or
 * a fast) "thinking" window the flipbook stuttered or appeared frozen on
 * frame 0. Mounting all six up-front (and preloading at module load) means the
 * cycle is just a CSS opacity flip — no network, no decode, always smooth. */
const SaxStage = styled.div`
  position: relative;
  width: 44px;
  height: 44px;
  flex-shrink: 0;
`;

const SaxFrameImg = styled.img<{ $active: boolean }>`
  position: absolute;
  inset: 0;
  width: 44px;
  height: 44px;
  display: block;
  object-fit: contain;
  opacity: ${({ $active }) => ($active ? 1 : 0)};
`;

const SAX_FRAME_SRCS = Array.from(
  { length: SAX_FRAME_COUNT },
  (_, i) => `/dynamic/sax-${i}.png`,
);

/* Preload all frames once at module load so they're decoded before the first
 * thinking bubble ever mounts. */
if (typeof Image !== 'undefined') {
  SAX_FRAME_SRCS.forEach((src) => { const img = new Image(); img.src = src; });
}

function SaxFrame() {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setFrame((f) => (f + 1) % SAX_FRAME_COUNT),
      SAX_FRAME_MS,
    );
    return () => clearInterval(t);
  }, []);
  return (
    <SaxStage aria-label="Jazzify 생각중" role="img">
      {SAX_FRAME_SRCS.map((src, i) => (
        <SaxFrameImg key={i} src={src} $active={i === frame} alt="" draggable={false} />
      ))}
    </SaxStage>
  );
}

const GeneratingWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 10px 0;
  padding: 12px 14px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.fonts.ui};
  animation: ${pulse} 1.8s ease-in-out infinite;
`;

const THINKING_MESSAGES = [
  '생각하는 중',
  '음악적 영감을 떠올리는 중',
  '화성을 분석하는 중',
  '악보를 구상하는 중',
  '재즈 이론을 떠올리는 중',
];

function ThinkingMessage() {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((i) => (i + 1) % THINKING_MESSAGES.length), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <ThinkingWrap>
      <SaxFrame />
      <span>{THINKING_MESSAGES[idx]}...</span>
    </ThinkingWrap>
  );
}

function GeneratingScoreMessage() {
  const [dots, setDots] = useState('');
  useEffect(() => {
    const t = setInterval(() => setDots((d) => d.length >= 3 ? '' : d + '.'), 500);
    return () => clearInterval(t);
  }, []);
  return (
    <GeneratingWrap>
      <span>🎼</span>
      <span>악보를 생성하는 중{dots}</span>
    </GeneratingWrap>
  );
}

/** Custom markdown renderers that apply chord formatting to all text */
/* Block-code renderer with a header strip (language label + copy button) —
 * matches the Claude / ChatGPT pattern where each fenced ```python block
 * has its own hover-revealed copy chip. Inline code (no class) keeps the
 * default <code> rendering since wrapping it in a chrome row breaks
 * flow-of-text. */
function CodeBlockWrapper({ children }: { children: React.ReactNode }) {
  /* Extract the <code> child's text + language. ReactMarkdown emits
   * <pre><code class="language-X">…</code></pre> for fenced blocks. */
  const child = React.Children.toArray(children).find(
    (c) => React.isValidElement(c) && (c.type === 'code' || (c.props as { className?: string })?.className?.startsWith('language-')),
  ) as React.ReactElement<{ children?: React.ReactNode; className?: string }> | undefined;
  const className = child?.props.className ?? '';
  const langMatch = className.match(/language-([\w-]+)/);
  const lang = langMatch ? langMatch[1] : 'text';
  /* Skip the chrome for `glick` blocks — they're handled below as embedded
   * VexFlow lick cards, not source code. */
  if (lang === 'glick') return <>{children}</>;
  const codeText = React.Children.toArray(child?.props.children ?? '')
    .map((n) => (typeof n === 'string' ? n : ''))
    .join('');
  return (
    <CodeBlockShell>
      <CodeBlockHeader>
        <CodeBlockLang>{lang}</CodeBlockLang>
        <CodeBlockCopy
          type="button"
          title="복사"
          aria-label="코드 블록 복사"
          onClick={(e) => {
            const btn = e.currentTarget;
            void navigator.clipboard.writeText(codeText).then(() => {
              btn.dataset.copied = '1';
              window.setTimeout(() => { delete btn.dataset.copied; }, 1500);
            });
          }}
        >
          <span>복사</span>
        </CodeBlockCopy>
      </CodeBlockHeader>
      {children}
    </CodeBlockShell>
  );
}

const mdComponents: Components = {
  p: ({ children }) => <p>{formatChildChords(children)}</p>,
  li: ({ children }) => <li>{formatChildChords(children)}</li>,
  strong: ({ children }) => <strong>{formatChildChords(children)}</strong>,
  em: ({ children }) => <em>{formatChildChords(children)}</em>,
  h1: ({ children }) => <h1>{formatChildChords(children)}</h1>,
  h2: ({ children }) => <h2>{formatChildChords(children)}</h2>,
  h3: ({ children }) => <h3>{formatChildChords(children)}</h3>,
  h4: ({ children }) => <h4>{formatChildChords(children)}</h4>,
  h5: ({ children }) => <h5>{formatChildChords(children)}</h5>,
  h6: ({ children }) => <h6>{formatChildChords(children)}</h6>,
  th: ({ children }) => <th>{formatChildChords(children)}</th>,
  td: ({ children }) => <td>{formatChildChords(children)}</td>,
  pre: ({ children }) => <CodeBlockWrapper>{children}</CodeBlockWrapper>,
  code: ({ children, className }) => {
    // glick 코드 블록 → AI 생성 릭 악보로 렌더링
    if (className === 'language-glick') {
      try {
        const json = JSON.parse(String(children).trim()) as Record<string, unknown>;
        const lick = jsonToLickEntry(json);
        const match: LickMatch = { lick, tier: 1 };
        return <div className="glick-container"><LickRecommendMessage match={match} /></div>;
      } catch {
        // JSON 파싱 실패 시 일반 코드 블록으로 표시
        return <code className={className}>{children}</code>;
      }
    }
    return <code className={className}>{formatChildChords(children)}</code>;
  },
};

function ChatMessageImpl({
  message,
  suppressChart = false,
  songTempo,
  onLickShowInline,
  activeInlineLickId,
  citations,
  onRetry,
  onRegenerate,
  onEditUserMessage,
  isStreaming = false,
}: ChatMessageProps) {
  /* User-message edit state — toggled by the pencil button rendered on
   * hover. Initial value mirrors message.content; save calls
   * onEditUserMessage(next) which forks the conversation. */
  const [isEditingUser, setIsEditingUser] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const beginEdit = () => {
    setEditDraft(message.content);
    setIsEditingUser(true);
  };
  const cancelEdit = () => setIsEditingUser(false);
  const saveEdit = () => {
    setIsEditingUser(false);
    onEditUserMessage?.(editDraft);
  };
  const [copied, setCopied] = useState(false);
  const selectedChords = message.role === 'user' ? message.selectedChords ?? [] : [];
  const userImages = message.role === 'user' ? message.images ?? [] : [];

  /* ```chart JSON → ChatChart cache, keyed by the exact fenced JSON text.
   * Once a chart block finishes streaming its JSON never changes again, but
   * `content` below recomputes on every subsequent token (more text keeps
   * streaming after it) — without this cache we'd re-parse AND re-create a
   * fresh chart object every token, forcing ChatChartCard's memo-wrapped
   * VexFlow render to redo the full lead-sheet layout dozens of times per
   * message. On memory-constrained mobile WebViews this repeated churn was
   * crashing the whole app to a blank white screen mid-answer. */
  const chartCacheRef = useRef<Map<string, ChatChart | null>>(new Map());

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [message.content]);

  const content = useMemo(() => {
    if (message.role !== 'assistant') return null;

    // 1. 빈 content = 스트리밍 대기 중 → Thinking 애니메이션
    const raw = message.content ?? '';
    if (!raw) return <ThinkingMessage />;

    // 2. glick 블록 감지 — 열렸지만 닫히지 않음 = 생성 중
    const GLICK_OPEN_RE = /```\s*glick/i;
    const GLICK_COMPLETE_RE = /```\s*glick[\s\S]*?```/i;
    const hasCompleteGlick = GLICK_COMPLETE_RE.test(raw);
    const hasOpenGlick = GLICK_OPEN_RE.test(raw) && !hasCompleteGlick;
    if (hasOpenGlick) {
      const glickIdx = raw.search(GLICK_OPEN_RE);
      const beforeGlick = glickIdx > 0 ? raw.slice(0, glickIdx).trimEnd() : '';
      return (
        <>
          {beforeGlick && (
            <MarkdownBody>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{beforeGlick}</ReactMarkdown>
            </MarkdownBody>
          )}
          <GeneratingScoreMessage />
        </>
      );
    }


    // [LICK:id] 태그를 파싱해 인라인 LickCard로 교체.
    // id 는 숫자(레거시 프론트 JSON) 또는 UUID 문자열(백엔드 /v1/licks) 둘 다
    // 가능하므로, 문자열 키와 숫자 키를 모두 등록해 두고 lookup 시 양쪽을 시도한다.
    const lickById = new Map<number | string, LickMatch>();
    for (const m of message.lickMatches ?? []) {
      lickById.set(m.lick.id, m);
      lickById.set(String(m.lick.id), m);
    }

    /* Helper: take a plain text segment and emit markdown + inlined
     * [LICK:id] cards. [SEC:X] is NOT split here — the markdown component
     * override (formatChildChords) replaces them inline so they stay in the
     * same <p> as the surrounding text. */
    const LICK_INLINE_RE = /\[LICK:([^\]]+)\]/g;

    const renderTextWithLicks = (text: string, keyPrefix: string): React.ReactNode[] => {
      const out: React.ReactNode[] = [];
      let textIdx = 0;
      let lm: RegExpExecArray | null;
      LICK_INLINE_RE.lastIndex = 0;

      const flushMarkdown = (md: string, suffix: string) => {
        if (!md) return;
        // Safety net: a markdown chord-progression table → clean lead-sheet
        // card. Non-chord tables and prose stay as normal markdown. Skipped
        // when suppressChart is on (ChordPage already shows the chart).
        const segs = suppressChart ? [md] : splitChordTables(md);
        segs.forEach((seg, k) => {
          if (typeof seg === 'string') {
            if (!seg.trim()) return;
            out.push(
              <MarkdownBody key={`${keyPrefix}-md-${suffix}-${k}`}>
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{seg}</ReactMarkdown>
              </MarkdownBody>
            );
          } else {
            out.push(<ChatChartCard key={`${keyPrefix}-tblchart-${suffix}-${k}`} chart={seg} />);
          }
        });
      };

      /* React key uses each lick's APPEARANCE ORDER (per id), NOT lm.index.
       * lm.index is the tag's character offset, which shifts every stream tick
       * as earlier text grows → the key changed each tick → the card remounted
       * constantly, and a remount that lands on a 0-width frame left the score
       * un-rendered ("sometimes the vexflow doesn't draw"). */
      const lickOcc = new Map<string, number>();
      while ((lm = LICK_INLINE_RE.exec(text)) !== null) {
        flushMarkdown(text.slice(textIdx, lm.index), String(textIdx));
        // id 는 UUID 문자열 또는 숫자. 문자열 그대로 먼저, 안 되면 숫자로 재시도.
        const rawId = lm[1].trim();
        const occ = lickOcc.get(rawId) ?? 0;
        lickOcc.set(rawId, occ + 1);
        let match = lickById.get(rawId);
        if (!match) {
          const numId = Number(rawId);
          if (Number.isFinite(numId)) match = lickById.get(numId);
        }
        if (match) {
          out.push(
            <LickRecommendMessage
              key={`${keyPrefix}-lick-${rawId}-${occ}`}
              match={match}
              tempoOverride={songTempo}
              onShowInline={onLickShowInline}
              inlineActive={activeInlineLickId != null && activeInlineLickId === match.lick.id}
            />,
          );
        }
        textIdx = lm.index + lm[0].length;
      }
      flushMarkdown(text.slice(textIdx), 'tail');
      return out;
    };

    /* Step 1: split by ```chart blocks. Each complete chart block becomes
     * a ChatChartCard; everything else flows through renderTextWithLicks.
     *
     * Lenient fence matching: the model doesn't always put the JSON on its
     * own line — it may emit ```chart {…}``` on one line, omit the newline
     * after "chart", or close with `}```  ` on the same line. The old strict
     * `chart[ \t]*\n … \n``` ` form silently failed on all of those (the
     * chart just vanished). Now: `chart` word-boundary, optional whitespace/
     * newline before the body, body is non-greedy up to the next ``` (chart
     * JSON never contains backticks, so the first fence is the real close). */
    const CHART_RE = /```[ \t]*chart\b[ \t]*\n?([\s\S]*?)```/g;
    const segments: React.ReactNode[] = [];
    let lastIdx = 0;
    let cm: RegExpExecArray | null;
    CHART_RE.lastIndex = 0;

    while ((cm = CHART_RE.exec(raw)) !== null) {
      const before = raw.slice(lastIdx, cm.index);
      if (before) segments.push(...renderTextWithLicks(before, `pre-${lastIdx}`));

      if (suppressChart) {
        // Caller wants charts hidden (e.g. ChordPage already shows the chart).
        // Skip the block entirely — don't render it as a code block either.
        lastIdx = cm.index + cm[0].length;
        continue;
      }

      const cache = chartCacheRef.current;
      if (!cache.has(cm[1])) cache.set(cm[1], parseChatChart(cm[1]));
      const parsed = cache.get(cm[1]) ?? null;
      if (parsed) {
        segments.push(<ChatChartCard key={`chart-${cm.index}`} chart={parsed} />);
      } else {
        // Malformed JSON — fall through to original code-block rendering
        segments.push(
          <MarkdownBody key={`chart-raw-${cm.index}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
              {`\`\`\`chart\n${cm[1]}\n\`\`\``}
            </ReactMarkdown>
          </MarkdownBody>
        );
      }
      lastIdx = cm.index + cm[0].length;
    }

    /* Step 2: trailing text after the last chart block (or whole message
     * if no chart blocks were found). */
    const trail = raw.slice(lastIdx);
    if (trail) segments.push(...renderTextWithLicks(trail, `tail`));

    // Empty message → render whole thing as markdown
    if (segments.length === 0 && raw) {
      segments.push(
        <MarkdownBody key="txt-only">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{raw}</ReactMarkdown>
        </MarkdownBody>
      );
    }

    // 💡 버튼으로 온 lickMatches (lickProgressionLabel이 설정된 경우)만 탭 패널로 표시.
    // LLM 스트리밍 응답에서는 lickMatches가 [LICK:id] 태그 매핑용으로만 쓰이므로,
    // 태그가 아직 안 나온 초반에 모든 릭이 뭉텅이로 뜨지 않도록 fallback을 막는다.
    const hasTaggedLicks = LICK_TAG_RE.test(raw);
    LICK_TAG_RE.lastIndex = 0;

    // 채팅 타이핑 경로(lickInline) 안전망. LLM 이 [LICK:id] 태그로 소개한 릭은 위에서
    // 이미 설명과 함께 인라인 렌더됐다. 여기서는 태그를 못 받은 릭만 — 스트림이 끝난
    // 뒤(!isStreaming) — "연주자 — 곡 · 키 · 진행" 소개줄 + 카드로 보충한다. 이렇게:
    //   (a) LLM 설명이 릭 사이사이에 들어가고,
    //   (b) LLM 이 일부/전부를 빠뜨려도 카드는 무조건 표시되며,
    //   (c) 스트리밍 중엔 보충을 미뤄 카드가 하단→인라인으로 튀는 깜빡임이 없다.
    if (
      message.lickInline &&
      !isStreaming &&
      message.lickMatches &&
      message.lickMatches.length > 0
    ) {
      const taggedIds = new Set<string>();
      let tm: RegExpExecArray | null;
      LICK_TAG_RE.lastIndex = 0;
      while ((tm = LICK_TAG_RE.exec(raw)) !== null) taggedIds.add(tm[1].trim());
      LICK_TAG_RE.lastIndex = 0;

      const untagged = message.lickMatches.filter((m) => !taggedIds.has(String(m.lick.id)));
      if (untagged.length > 0) {
        // LLM 이 일부라도 태그를 달았으면 자연스럽게 잇는 안내 한 줄.
        if (taggedIds.size > 0) {
          segments.push(
            <MarkdownBody key="lick-more-head">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{'이런 라인들도 함께 참고해보세요 👇'}</ReactMarkdown>
            </MarkdownBody>,
          );
        }
        untagged.forEach((m, i) => {
          const l = m.lick;
          const meta = [l.key, message.lickInlineLabel].filter(Boolean).join(' · ');
          const introMd = `**${l.performer} — ${l.title}**${meta ? `  ·  ${meta}` : ''}`;
          segments.push(
            <MarkdownBody key={`lick-intro-${l.id}-${i}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{introMd}</ReactMarkdown>
            </MarkdownBody>,
          );
          segments.push(
            <LickRecommendMessage
              key={`lick-inline-${l.id}-${i}`}
              match={m}
              tempoOverride={songTempo}
              onShowInline={onLickShowInline}
              inlineActive={activeInlineLickId != null && activeInlineLickId === m.lick.id}
            />,
          );
        });
      }
    }

    // 💡 버튼으로 온 lickMatches (lickProgressionLabel이 설정된 경우)만 탭 패널로 표시.
    // LLM 스트리밍 응답에서는 lickMatches가 [LICK:id] 태그 매핑용으로만 쓰이므로,
    // 태그가 아직 안 나온 초반에 모든 릭이 뭉텅이로 뜨지 않도록 fallback을 막는다.
    if (
      !hasTaggedLicks &&
      message.lickMatches &&
      message.lickMatches.length > 0 &&
      message.lickProgressionLabel // 💡 버튼 경로에서만 설정됨
    ) {
      segments.push(
        <LickRecommendList
          key="lick-list"
          matches={message.lickMatches}
          savedMatches={message.savedLickMatches}
          progressionLabel={message.lickProgressionLabel}
          songTempo={songTempo}
        />
      );
    }

    // 스템 분리 카드 — 오디오 첨부 턴(message.stemRequest). 안내 문장 뒤에 붙는다.
    if (message.stemRequest) {
      segments.push(<StemSplitMessage key="stem-card" request={message.stemRequest} />);
    }

    return <>{segments}</>;
  }, [message.content, message.role, message.lickMatches, message.savedLickMatches, message.lickProgressionLabel, message.lickInline, message.lickInlineLabel, message.stemRequest, isStreaming, suppressChart, onLickShowInline, activeInlineLickId]);

  /* Thinking placeholder (saxophone flipbook) only shows for assistant
   * bubbles that are STILL streaming — empty content alone isn't enough:
   * an aborted-with-zero-tokens turn or an errored turn also has empty
   * content but should never display the spinner. Those cases render
   * AbortedBadge / ErrorBanner instead. */
  const isThinking =
    message.role === 'assistant'
    && !(message.content ?? '').trim()
    && !(message as { aborted?: boolean }).aborted
    && !(message as { error?: string }).error;

  return (
    <MessageRow $role={message.role}>
      {userImages.length > 0 && (
        <UserImageRow>
          {userImages.map((im, i) => (
            <UserImageThumb
              key={i}
              src={`data:${im.mediaType};base64,${im.data}`}
              alt="첨부 이미지"
            />
          ))}
        </UserImageRow>
      )}
      <Bubble $role={message.role}>
        {message.role === 'assistant' && !isThinking && (
          <AssistantHeader>
            <AssistantIcon>
              <img
                src="/jazzifylogo.png"
                alt="Jazzify"
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
              />
            </AssistantIcon>
          </AssistantHeader>
        )}
        {message.role === 'assistant' ? (
          <CitationsContext.Provider value={citations}>{content}</CitationsContext.Provider>
        ) : (
          <>
            {selectedChords.length > 0 && (
              <UserSelectedContext>
                <UserSelectedLabel>선택한 코드 구간 · {selectedChords.length}개</UserSelectedLabel>
                <UserSelectedChordRow>
                  {selectedChords.map((chord, i) => (
                    <UserSelectedChordStep key={chord.id}>
                      {i > 0 && <UserSelectedArrow />}
                      <UserSelectedChord>{formatChordsInText(chord.symbol)}</UserSelectedChord>
                    </UserSelectedChordStep>
                  ))}
                </UserSelectedChordRow>
              </UserSelectedContext>
            )}
            {isEditingUser ? (
              /* Inline edit mode — replaces the bubble text with a
               * textarea + Save/Cancel. Saving forks the conversation
               * at this turn (handled by the parent's onEditUserMessage,
               * which slices the message list and re-runs handleSend). */
              <EditUserRow>
                <EditUserTextarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  autoFocus
                  rows={Math.min(8, Math.max(2, editDraft.split('\n').length))}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                    /* Cmd/Ctrl+Enter saves — newline-only Enter keeps
                     * multiline editing working for long prompts. */
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault(); saveEdit();
                    }
                  }}
                />
                <EditUserActions>
                  <EditUserGhostBtn type="button" onClick={cancelEdit}>취소</EditUserGhostBtn>
                  <EditUserPrimaryBtn type="button" onClick={saveEdit} disabled={!editDraft.trim()}>
                    저장 후 전송
                  </EditUserPrimaryBtn>
                </EditUserActions>
              </EditUserRow>
            ) : (
              <UserQuestionText>{message.content}</UserQuestionText>
            )}
            {/* Hover-only pencil — rendered absolutely just outside the
             * bubble's right edge (see styles). Only when the parent
             * supplied onEditUserMessage AND we're not already editing. */}
            {onEditUserMessage && !isEditingUser && (
              <EditUserPencilBtn
                type="button"
                className="user-edit-pencil"
                aria-label="메시지 편집"
                title="편집"
                onClick={beginEdit}
              >
                <PencilIcon />
              </EditUserPencilBtn>
            )}
            {/* Hover-only timestamp under the user bubble. Native locale
             *  full string in the title attribute (browser tooltip) so a
             *  long-hover reveals the absolute time, while the inline text
             *  stays compact ("5분 전" / "방금" / "어제 오후 2:31"). */}
            {message.timestamp && !isEditingUser && (
              <TimestampHint className="user-timestamp" title={new Date(message.timestamp).toLocaleString('ko-KR')}>
                {formatTimestamp(message.timestamp)}
              </TimestampHint>
            )}
          </>
        )}
        {/* Error banner — replaces the empty bubble when the stream
         *  failed before producing any text. Inline retry button re-runs
         *  the same turn (parent wires onRetry → handleSend with the
         *  cached prompt + images). */}
        {message.role === 'assistant' && (message as { error?: string }).error && (
          <ErrorBanner>
            <ErrorIcon />
            <ErrorText>{(message as { error?: string }).error}</ErrorText>
            {onRetry && (
              <RetryBtn type="button" onClick={onRetry}>
                <RegenerateIcon /> 다시 시도
              </RetryBtn>
            )}
          </ErrorBanner>
        )}

        {/* "중단됨" badge — user pressed Stop. The partial reply (whatever
         *  streamed in before .abort()) stays visible above. */}
        {message.role === 'assistant' && (message as { aborted?: boolean }).aborted && (
          <AbortedBadge>응답이 중단되었습니다.</AbortedBadge>
        )}

        {/* Assistant-only action row: copy is always shown. Regenerate
         *  ONLY appears when the parent passes onRegenerate (no fake
         *  no-op buttons). Thumbs up/down removed entirely until a real
         *  feedback endpoint exists. */}
        {message.role === 'assistant'
          && !isThinking
          && !(message as { error?: string }).error
          && (
          <MessageActions>
            <ActionBtn onClick={handleCopy} title={copied ? '복사됨' : '복사'} aria-label="복사">
              {copied ? <CheckIcon /> : <CopyIcon />}
            </ActionBtn>
            {onRegenerate && (
              <ActionBtn onClick={onRegenerate} title="다시 생성" aria-label="다시 생성">
                <RegenerateIcon />
              </ActionBtn>
            )}
          </MessageActions>
        )}
      </Bubble>
    </MessageRow>
  );
}

/* React.memo skips re-renders when message identity (object reference) is
 * unchanged — critical for long conversations because setMessages re-emits
 * a fresh array on every streaming tick but the unchanged messages keep
 * their original references. For 50+ turn chats this turns N²-ish render
 * work into N. Callback props (onRetry / onRegenerate / onEditUserMessage)
 * may still differ per render; the parent passes `undefined` for inactive
 * rows so most messages still hit the memo cache cleanly. */
export const ChatMessage = React.memo(ChatMessageImpl);
