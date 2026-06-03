import React, { useMemo, useState, useCallback, useEffect, useContext } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { ChatMessage as ChatMessageType } from '../../data/types';
import type { RagChunk } from '../../api/harmorag';
import type { LickMatch } from '../../lib/lickMatcher';
import { formatChordsInText } from './chordFormat';
import { LickRecommendMessage, LickRecommendList, jsonToLickEntry } from './LickRecommendMessage';
import { ChatChartCard } from './ChatChartCard';
import { parseChatChart, splitChordTables } from '../../lib/chatChartParser';
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
  width: 1.32em;
  height: 1.32em;
  box-sizing: border-box;
  background: #000;
  color: #fff;
  font-family: 'Pretendard', 'Pretendard', sans-serif;
  font-size: 0.7em;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
  border-radius: 2px;
  margin: 0 0.28em;
  padding-bottom: 0.04em;
  vertical-align: -0.16em;
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
  background: #e9f1fb;
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
  color: #1f1f1f;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 999px;
  text-decoration: none;
  vertical-align: baseline;
  white-space: nowrap;
  transition: background 0.12s, border-color 0.12s, box-shadow 0.12s;
  &:hover {
    background: #fafafa;
    border-color: rgba(0, 0, 0, 0.22);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  }
`;

const CiteVideoTime = styled.span`
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.01em;
  color: #404040;
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
    const url = chunk.video_url
      || `https://www.youtube.com/watch?v=${chunk.video_id}&t=${ts}s`;
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
} from './ChatMessage.styles';

const ICON_STROKE = 1.7;

const CopyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="9" y="9" width="13" height="13" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const ThumbUpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M7 10v12" />
    <path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H7a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L15 0a3 3 0 0 1 3 3z" />
  </svg>
);

const ThumbDownIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M17 14V2" />
    <path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H17a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L9 24a3 3 0 0 1-3-3z" />
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
  /** RAG source chunks for THIS message (message.ragDebug?.chunks), used to
   *  resolve inline [n] citation chips to their source / video timestamp. */
  citations?: RagChunk[];
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

const SaxFrameImg = styled.img`
  width: 44px;
  height: 44px;
  flex-shrink: 0;
  display: block;
  object-fit: contain;
`;

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
    <SaxFrameImg
      src={`/dynamic/sax-${frame}.png`}
      alt="Jazzify 생각중"
      draggable={false}
    />
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

export function ChatMessage({ message, suppressChart = false, songTempo, citations }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const selectedChords = message.role === 'user' ? message.selectedChords ?? [] : [];
  const userImages = message.role === 'user' ? message.images ?? [] : [];

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

      while ((lm = LICK_INLINE_RE.exec(text)) !== null) {
        flushMarkdown(text.slice(textIdx, lm.index), String(textIdx));
        // id 는 UUID 문자열 또는 숫자. 문자열 그대로 먼저, 안 되면 숫자로 재시도.
        const rawId = lm[1].trim();
        let match = lickById.get(rawId);
        if (!match) {
          const numId = Number(rawId);
          if (Number.isFinite(numId)) match = lickById.get(numId);
        }
        if (match) {
          out.push(<LickRecommendMessage key={`${keyPrefix}-lick-${rawId}-${lm.index}`} match={match} tempoOverride={songTempo} />);
        }
        textIdx = lm.index + lm[0].length;
      }
      flushMarkdown(text.slice(textIdx), 'tail');
      return out;
    };

    /* Step 1: split by ```chart blocks. Each complete chart block becomes
     * a ChatChartCard; everything else flows through renderTextWithLicks. */
    const CHART_RE = /```\s*chart[ \t]*\n([\s\S]*?)\n```/g;
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

      const parsed = parseChatChart(cm[1]);
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

    return <>{segments}</>;
  }, [message.content, message.role, message.lickMatches, message.savedLickMatches, message.lickProgressionLabel, suppressChart]);

  const isThinking = message.role === 'assistant' && !(message.content ?? '').trim();

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
            <UserQuestionText>{message.content}</UserQuestionText>
          </>
        )}
        {/* Assistant-only action row sits below the message body — copy /
         *  thumbs up/down / regenerate, transparent icon buttons (ChatGPT style).
         *  Thumbs and regenerate are visual-only for now; copy works. */}
        {message.role === 'assistant' && !isThinking && (
          <MessageActions>
            <ActionBtn onClick={handleCopy} title={copied ? '복사됨' : '복사'} aria-label="복사">
              {copied ? <CheckIcon /> : <CopyIcon />}
            </ActionBtn>
            <ActionBtn title="좋아요" aria-label="좋아요">
              <ThumbUpIcon />
            </ActionBtn>
            <ActionBtn title="별로예요" aria-label="별로예요">
              <ThumbDownIcon />
            </ActionBtn>
            <ActionBtn title="다시 생성" aria-label="다시 생성">
              <RegenerateIcon />
            </ActionBtn>
          </MessageActions>
        )}
      </Bubble>
    </MessageRow>
  );
}
