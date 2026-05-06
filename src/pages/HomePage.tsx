import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import styled, { css, keyframes } from 'styled-components';
import { streamWithRAG } from '../api/harmorag';
import type { ClaudeMessage } from '../api/claude';
import { ChatMessage } from '../components/chat/ChatMessage';
import type { ChatMessage as ChatMessageType } from '../data/types';
import { mq } from '../styles/theme';

/* ── Types ────────────────────────────────────────────────────── */

type Phase = 'idle' | 'chatting';

interface Msg extends ChatMessageType {
  id: string;
}

/* ── Animations ───────────────────────────────────────────────── */

const fadeIn = keyframes`from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); }`;

/* ── Layout ───────────────────────────────────────────────────── */

const Wrapper = styled.div<{ $phase: Phase }>`
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  overflow: hidden;
`;

/* ── Intro section (idle only) ────────────────────────────────── */

const Intro = styled.div<{ $phase: Phase }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  padding-bottom: 20px;
  transition: max-height 0.45s ease, opacity 0.3s ease, padding 0.35s ease;

  ${({ $phase }) =>
    $phase === 'idle'
      ? css`
          max-height: 420px;
          opacity: 1;
          pointer-events: auto;
        `
      : css`
          max-height: 0;
          opacity: 0;
          pointer-events: none;
          padding-bottom: 0;
          overflow: hidden;
        `}
`;

const Greeting = styled.h1`
  font-size: 1.65rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin: 0 0 8px;
  text-align: center;
  animation: ${fadeIn} 0.5s ease both;

  ${mq.mobile} {
    font-size: 1.2rem;
  }
`;

const Subtitle = styled.p`
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 0 0 28px;
  text-align: center;
  animation: ${fadeIn} 0.5s 0.1s ease both;

  ${mq.mobile} {
    font-size: 0.8rem;
  }
`;

/* ── Messages area (chatting only) ───────────────────────────── */

const MessagesArea = styled.div<{ $phase: Phase }>`
  flex: 1;
  overflow-y: auto;
  padding: 24px 0 12px;
  transition: opacity 0.3s ease;

  ${({ $phase }) =>
    $phase === 'idle'
      ? css`opacity: 0; pointer-events: none; flex: 0;`
      : css`opacity: 1; pointer-events: auto;`}

  scroll-behavior: smooth;

  /* Scrollbar */
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: ${({ theme }) => theme.colors.border}; border-radius: 2px; }
`;

const MessagesInner = styled.div`
  max-width: 720px;
  margin: 0 auto;
  padding: 0 24px;
  display: flex;
  flex-direction: column;
  gap: 4px;

  ${mq.mobile} {
    padding: 0 12px;
  }
`;

/* ── Bottom input area ───────────────────────────────────────── */

const Bottom = styled.div<{ $phase: Phase }>`
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: ${({ $phase }) => ($phase === 'idle' ? '0 20px 32px' : '0 20px 20px')};
  transition: padding 0.3s ease;

  ${mq.mobile} {
    padding: ${({ $phase }) => ($phase === 'idle' ? '0 12px 24px' : '0 12px 14px')};
  }
`;

const InputBox = styled.div`
  width: 100%;
  max-width: 720px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 16px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  transition: border-color 0.15s, box-shadow 0.15s;

  &:focus-within {
    border-color: ${({ theme }) => theme.colors.gold};
    box-shadow: 0 2px 16px rgba(212,168,67,0.15);
  }
`;

const InputRow = styled.div`
  display: flex;
  align-items: flex-end;
  padding: 12px 14px 12px 18px;
  gap: 10px;
`;

const Textarea = styled.textarea`
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.95rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  resize: none;
  min-height: 24px;
  max-height: 180px;
  line-height: 1.5;

  &::placeholder {
    color: ${({ theme }) => theme.colors.textSecondary};
  }
`;

const SendBtn = styled.button<{ $active: boolean }>`
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
  background: ${({ $active, theme }) => $active ? theme.colors.gold : theme.colors.border};
  color: ${({ $active }) => $active ? '#fff' : '#aaa'};
  opacity: ${({ $active }) => $active ? 1 : 0.6};
`;

/* ── Tool shortcuts ──────────────────────────────────────────── */

const ToolRow = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 12px;
  flex-wrap: wrap;
  justify-content: center;
  max-width: 720px;
  width: 100%;
`;

const ToolChip = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 999px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  transition: all 0.14s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.gold};
    color: ${({ theme }) => theme.colors.textPrimary};
    background: ${({ theme }) => theme.colors.bgSecondary};
  }

  ${mq.mobile} {
    font-size: 0.78rem;
    padding: 6px 10px;
  }
`;

const Disclaimer = styled.p`
  font-size: 0.72rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 10px;
  opacity: 0.6;
  text-align: center;
`;

/* ── Spacer (idle only, pushes content to center) ────────────── */

const Spacer = styled.div<{ $phase: Phase }>`
  flex: ${({ $phase }) => ($phase === 'idle' ? '1' : '0')};
  transition: flex 0.4s ease;
  min-height: 0;
`;

/* ── Component ────────────────────────────────────────────────── */

const TOOLS = [
  { label: 'Chord Analysis', icon: '𝄢', path: '/chord' },
  { label: 'Note Analysis', icon: '♪', path: '/note' },
  { label: 'Lick Database', icon: '🎷', path: '/licks' },
  { label: 'JSON Tool', icon: '{ }', path: '/lick-input' },
  { label: 'OMR', icon: '📄', path: '/input' },
] as const;

export default function HomePage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('idle');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState('');
  const historyRef = useRef<ClaudeMessage[]>([]);
  const endRef = useRef<HTMLDivElement>(null);
  const isScrolledUpRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);

  /* Auto-scroll */
  useEffect(() => {
    if (!isScrolledUpRef.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [msgs]);

  /* Textarea auto-resize */
  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, []);

  const handleScroll = useCallback(() => {
    const el = messagesAreaRef.current;
    if (!el) return;
    isScrolledUpRef.current = el.scrollHeight - el.scrollTop - el.clientHeight > 50;
  }, []);

  const handleSend = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    if (phase === 'idle') setPhase('chatting');

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    const userMsg: Msg = { id: `u-${Date.now()}`, role: 'user', content: trimmed, timestamp: Date.now() };
    const aiId = `a-${Date.now()}`;
    const aiMsg: Msg = { id: aiId, role: 'assistant', content: '', timestamp: Date.now() };

    setMsgs(prev => [...prev, userMsg, aiMsg]);
    setLoading(true);
    isScrolledUpRef.current = false;

    const final = await streamWithRAG(
      trimmed,
      historyRef.current,
      undefined,
      'Jazzify',
      (acc) => setMsgs(prev => prev.map(m => m.id === aiId ? { ...m, content: acc } : m)),
    );

    historyRef.current = [
      ...historyRef.current,
      { role: 'user', content: trimmed },
      { role: 'assistant', content: final },
    ];

    setLoading(false);
  }, [loading, phase]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(input);
    }
  }, [handleSend, input]);

  return (
    <Wrapper $phase={phase}>
      {/* Top spacer pushes intro to vertical center in idle */}
      <Spacer $phase={phase} />

      {/* Intro greeting */}
      <Intro $phase={phase}>
        <Greeting>오늘은 무슨 이야기를 할까요?</Greeting>
        <Subtitle>화성학, 재즈 이론, 코드 진행에 대해 물어보세요</Subtitle>
      </Intro>

      {/* Chat messages */}
      <MessagesArea $phase={phase} ref={messagesAreaRef} onScroll={handleScroll}>
        <MessagesInner>
          {msgs.map(msg => (
            <ChatMessage key={msg.id} message={msg} />
          ))}
          <div ref={endRef} />
        </MessagesInner>
      </MessagesArea>

      {/* Bottom: input + tools */}
      <Bottom $phase={phase}>
        <InputBox>
          <InputRow>
            <Textarea
              ref={textareaRef}
              rows={1}
              value={input}
              onChange={handleInput}
              onKeyDown={handleKeyDown}
              placeholder="무엇이든 물어보세요"
              disabled={loading}
            />
            <SendBtn $active={input.trim().length > 0 && !loading} onClick={() => handleSend(input)}>
              ↑
            </SendBtn>
          </InputRow>
        </InputBox>

        <ToolRow>
          {TOOLS.map(t => (
            <ToolChip key={t.path} onClick={() => navigate(t.path)}>
              <span>{t.icon}</span>
              {t.label}
            </ToolChip>
          ))}
        </ToolRow>

        <Disclaimer>Jazzify AI · 화성학 전문 어시스턴트</Disclaimer>
      </Bottom>
    </Wrapper>
  );
}
