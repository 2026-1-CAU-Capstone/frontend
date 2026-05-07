import React, { useMemo, useState, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { ChatMessage as ChatMessageType } from '../../data/types';
import type { LickMatch } from '../../lib/lickMatcher';
import { formatChordsInText } from './chordFormat';
import { LickRecommendMessage, LickRecommendList, jsonToLickEntry } from './LickRecommendMessage';
import { ChatChartCard } from './ChatChartCard';
import { parseChatChart } from '../../lib/chatChartParser';
import styled, { keyframes } from 'styled-components';

/* Inline section label — black filled square with the letter, matches the
 * LeadSheet SectionLabel style so the chat reads like the same chart. */
const InlineSectionTag = styled.span`
  display: inline-block;
  background: #000;
  color: #fff;
  font-family: 'DM Sans', 'Pretendard', sans-serif;
  font-size: 0.82em;
  font-weight: 800;
  line-height: 1;
  letter-spacing: 0.02em;
  padding: 4px 8px;
  border-radius: 2px;
  margin: 0 2px;
  vertical-align: baseline;
`;

const LICK_TAG_RE = /\[LICK:(\d+)\]/g;
import {
  MessageRow,
  Bubble,
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
  CopyButton,
} from './ChatMessage.styles';

interface ChatMessageProps {
  message: ChatMessageType;
  /**
   * When true, suppress inline ```chart rendering. Used on the ChordPage
   * RightChatPanel where the user is already viewing a chord chart and
   * regenerating it inside the assistant's reply would be redundant.
   */
  suppressChart?: boolean;
  songTempo?: number;
}

/** Recursively walk React children and format chord symbols in text nodes */
function formatChildChords(children: React.ReactNode): React.ReactNode {
  return React.Children.map(children, (child) => {
    if (typeof child === 'string') {
      return <>{formatChordsInText(child)}</>;
    }
    if (React.isValidElement<{ children?: React.ReactNode }>(child) && child.props.children) {
      return React.cloneElement(child, {}, formatChildChords(child.props.children));
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
      <img
        src="/jazzifylogo.png"
        alt="Jazzify"
        style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'cover', display: 'block' }}
      />
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

export function ChatMessage({ message, suppressChart = false, songTempo }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);
  const selectedChords = message.role === 'user' ? message.selectedChords ?? [] : [];

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


    // [LICK:id] 태그를 파싱해 인라인 LickCard로 교체
    const lickById = new Map<number | string, LickMatch>(
      (message.lickMatches ?? []).map(m => [m.lick.id, m])
    );

    /* Helper: take a plain text segment and emit markdown + inlined
     * [LICK:id] cards + [SEC:label] section tags. Used as a sub-pass
     * after chart-block splitting. */
    const INLINE_TAG_RE = /\[(LICK|SEC):([^\]]+)\]/g;

    const renderTextWithLicks = (text: string, keyPrefix: string): React.ReactNode[] => {
      const out: React.ReactNode[] = [];
      let textIdx = 0;
      let lm: RegExpExecArray | null;
      INLINE_TAG_RE.lastIndex = 0;

      const flushMarkdown = (md: string, suffix: string) => {
        if (!md) return;
        out.push(
          <MarkdownBody key={`${keyPrefix}-md-${suffix}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{md}</ReactMarkdown>
          </MarkdownBody>
        );
      };

      while ((lm = INLINE_TAG_RE.exec(text)) !== null) {
        flushMarkdown(text.slice(textIdx, lm.index), String(textIdx));
        const kind = lm[1]; // "LICK" | "SEC"
        const value = lm[2];

        if (kind === 'LICK') {
          const id = parseInt(value, 10);
          const match = lickById.get(id);
          if (match) {
            out.push(<LickRecommendMessage key={`${keyPrefix}-lick-${id}-${lm.index}`} match={match} tempoOverride={songTempo} />);
          }
        } else if (kind === 'SEC') {
          out.push(
            <InlineSectionTag key={`${keyPrefix}-sec-${lm.index}`}>{value}</InlineSectionTag>
          );
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
      <Bubble $role={message.role}>
        {message.role === 'assistant' && !isThinking && (
          <AssistantHeader>
            <AssistantIcon>
              <img
                src="/jazzifylogo.png"
                alt="Jazzify"
                style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px', display: 'block' }}
              />
            </AssistantIcon>
          </AssistantHeader>
        )}
        {message.role === 'assistant' ? content : (
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
        <CopyButton onClick={handleCopy} title="Copy">
          {copied ? '✓' : '⎘'}
        </CopyButton>
      </Bubble>
    </MessageRow>
  );
}
