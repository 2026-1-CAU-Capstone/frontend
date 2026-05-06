import React, { useMemo, useState, useCallback, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import type { ChatMessage as ChatMessageType } from '../../data/types';
import type { LickMatch } from '../../lib/lickMatcher';
import { formatChordsInText } from './chordFormat';
import { LickRecommendMessage, LickRecommendList, jsonToLickEntry } from './LickRecommendMessage';
import styled, { keyframes } from 'styled-components';

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
      <span>♩</span>
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

export function ChatMessage({ message }: ChatMessageProps) {
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
    const lickById = new Map<number, LickMatch>(
      (message.lickMatches ?? []).map(m => [m.lick.id, m])
    );

    // 태그로 분할
    const segments: React.ReactNode[] = [];
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    LICK_TAG_RE.lastIndex = 0;

    while ((m = LICK_TAG_RE.exec(raw)) !== null) {
      // 태그 앞 텍스트 → 마크다운 렌더
      const before = raw.slice(lastIdx, m.index);
      if (before) {
        segments.push(
          <MarkdownBody key={`txt-${lastIdx}`}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{before}</ReactMarkdown>
          </MarkdownBody>
        );
      }
      // LickCard 인라인
      const id = parseInt(m[1], 10);
      const match = lickById.get(id);
      if (match) {
        segments.push(
          <LickRecommendMessage key={`lick-${id}`} match={match} />
        );
      }
      lastIdx = m.index + m[0].length;
    }

    // 남은 텍스트
    const tail = raw.slice(lastIdx);
    if (tail) {
      segments.push(
        <MarkdownBody key={`txt-tail`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{tail}</ReactMarkdown>
        </MarkdownBody>
      );
    }

    // 태그가 없었으면 기본 렌더
    if (segments.length === 0 && raw) {
      segments.push(
        <MarkdownBody key="txt-only">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{raw}</ReactMarkdown>
        </MarkdownBody>
      );
    }

    // 💡 버튼으로 온 lickMatches (태그 없는 경우) → 탭 패널
    const hasTaggedLicks = LICK_TAG_RE.test(raw);
    LICK_TAG_RE.lastIndex = 0;
    if (!hasTaggedLicks && message.lickMatches && message.lickMatches.length > 0) {
      segments.push(
        <LickRecommendList
          key="lick-list"
          matches={message.lickMatches}
          savedMatches={message.savedLickMatches}
          progressionLabel={message.lickProgressionLabel ?? ''}
        />
      );
    }

    return <>{segments}</>;
  }, [message.content, message.role, message.lickMatches, message.savedLickMatches, message.lickProgressionLabel]);

  return (
    <MessageRow $role={message.role}>
      <Bubble $role={message.role}>
        {message.role === 'assistant' && (
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
                      {i > 0 && <UserSelectedArrow>→</UserSelectedArrow>}
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
