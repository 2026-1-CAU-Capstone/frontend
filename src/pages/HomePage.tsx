import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
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

const Wrapper = styled.div`
  display: flex;
  height: 100vh;
  height: 100dvh;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  overflow: hidden;
  position: relative;
`;

/* Top-right Admin shortcut. Visible only in idle state for now —
 * remove or hide behind an env flag once the app ships publicly. */
const AdminBtn = styled.button`
  position: absolute;
  top: max(16px, env(safe-area-inset-top, 0px));
  right: max(22px, calc(env(safe-area-inset-right, 0px) + 16px));
  padding: 7px 14px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: 'DM Sans', sans-serif;
  font-size: 0.82rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  cursor: pointer;
  z-index: 50;
  transition: all 0.12s;
  &:hover {
    border-color: ${({ theme }) => theme.colors.gold};
    color: ${({ theme }) => theme.colors.textPrimary};
    background: ${({ theme }) => theme.colors.bgSecondary};
  }

  ${mq.mobile} {
    padding: 5px 10px;
    font-size: 0.74rem;
  }
`;

/* Compact-screen brand strip — replaces the desktop sidebar's BrandRow on
 * phones/tablets so the user still sees the Jazzify wordmark. */
const MobileBrandBar = styled.div`
  display: none;
  ${mq.mobile} {
    display: flex;
    align-items: center;
    gap: 8px;
    position: absolute;
    top: max(14px, env(safe-area-inset-top, 0px));
    left: max(16px, env(safe-area-inset-left, 0px));
    z-index: 40;
    pointer-events: none;
  }
`;

const MobileBrandLogo = styled.img`
  width: 28px;
  height: 28px;
  border-radius: 6px;
  object-fit: cover;
`;

const MobileBrandName = styled.span`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.98rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  letter-spacing: 0.02em;
`;

/* ── Sidebar ─────────────────────────────────────────────────── */

const Sidebar = styled.aside`
  width: 280px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  padding: 22px 16px;
  gap: 22px;
  overflow: hidden;

  ${mq.mobile} {
    display: none;
  }
`;

const BrandRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 6px;
`;

const BrandLogo = styled.img`
  width: 34px;
  height: 34px;
  border-radius: 8px;
  object-fit: cover;
`;

const BrandName = styled.span`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 1.15rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  letter-spacing: 0.02em;
`;

const SidebarSection = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const SectionLabel = styled.div`
  font-size: 0.74rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 0 8px;
  margin-bottom: 4px;
`;

const HistoryList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  overflow-y: auto;
  min-height: 0;

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background: ${({ theme }) => theme.colors.border}; border-radius: 2px; }
`;

const HistoryItem = styled.button`
  display: block;
  width: 100%;
  text-align: left;
  padding: 9px 10px;
  border: none;
  background: transparent;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.88rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  border-radius: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 0.12s;

  &:hover { background: ${({ theme }) => theme.colors.bgPrimary}; }
`;

const HistoryEmpty = styled.div`
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 8px 10px;
  opacity: 0.7;
`;

const ToolList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  padding-top: 16px;
`;

const ToolBtn = styled.button`
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  padding: 11px 14px;
  border: none;
  background: transparent;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.98rem;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  border-radius: 8px;
  transition: background 0.12s, color 0.12s;

  > span:first-child {
    font-size: 1.2em;
    width: 24px;
    text-align: center;
    color: ${({ theme }) => theme.colors.textSecondary};
  }

  &:hover {
    background: ${({ theme }) => theme.colors.bgPrimary};
    > span:first-child { color: ${({ theme }) => theme.colors.gold}; }
  }
`;

/* ── Main column ─────────────────────────────────────────────── */

const Main = styled.section`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
`;

/* ── Intro section (idle only) ────────────────────────────────── */

const Intro = styled.div<{ $phase: Phase }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 20px 22px;
  transition: max-height 0.45s ease, opacity 0.3s ease, padding 0.35s ease;

  ${({ $phase }) =>
    $phase === 'idle'
      ? css`
          max-height: 480px;
          opacity: 1;
          pointer-events: auto;
        `
      : css`
          max-height: 0;
          opacity: 0;
          pointer-events: none;
          padding: 0;
          overflow: hidden;
        `}

  ${mq.mobile} {
    padding: ${({ $phase }) => ($phase === 'idle' ? '0 14px 12px' : '0')};
  }
`;

const HeroLogo = styled.img`
  width: 96px;
  height: 96px;
  border-radius: 22px;
  margin-bottom: 22px;
  box-shadow: 0 6px 24px rgba(0,0,0,0.08);
  animation: ${fadeIn} 0.5s ease both;

  ${mq.mobile} {
    width: 72px;
    height: 72px;
    margin-bottom: 16px;
  }
`;

const Greeting = styled.h1`
  font-size: 2.4rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin: 0 0 14px;
  text-align: center;
  animation: ${fadeIn} 0.5s 0.05s ease both;

  ${mq.mobile} {
    font-size: 1.6rem;
  }
`;

const Subtitle = styled.p`
  font-size: 1.05rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 0;
  text-align: center;
  animation: ${fadeIn} 0.5s 0.1s ease both;

  ${mq.mobile} {
    font-size: 0.92rem;
  }
`;

/* ── Mobile/tablet tool grid (replaces the hidden sidebar) ────────────
 *  Desktop hides this — the sidebar still owns the tool list there.   */

const ToolGrid = styled.div<{ $phase: Phase }>`
  display: none;

  ${mq.mobile} {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 10px;
    width: 100%;
    max-width: 480px;
    margin: 22px auto 0;
    padding: 0 16px;
    animation: ${fadeIn} 0.5s 0.15s ease both;

    ${({ $phase }) =>
      $phase === 'chatting' &&
      css`
        display: none;
      `}
  }
`;

const ToolCard = styled.button`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 18px 6px 14px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 14px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  cursor: pointer;
  transition: transform 0.12s, border-color 0.15s, background 0.15s;

  &:active {
    transform: scale(0.97);
    border-color: ${({ theme }) => theme.colors.gold};
  }
`;

const ToolCardIcon = styled.span`
  font-size: 1.6rem;
  line-height: 1;
  color: ${({ theme }) => theme.colors.gold};
`;

const ToolCardLabel = styled.span`
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.01em;
  text-align: center;
  line-height: 1.2;
  color: ${({ theme }) => theme.colors.textPrimary};
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

  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-track { background: transparent; }
  &::-webkit-scrollbar-thumb { background: ${({ theme }) => theme.colors.border}; border-radius: 2px; }
`;

const MessagesInner = styled.div`
  max-width: 760px;
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
  padding: ${({ $phase }) => ($phase === 'idle' ? '0 20px 28px' : '0 20px 22px')};
  transition: padding 0.3s ease;

  ${mq.mobile} {
    padding: ${({ $phase }) =>
      $phase === 'idle'
        ? '14px 12px max(20px, env(safe-area-inset-bottom, 0px))'
        : '0 12px max(14px, env(safe-area-inset-bottom, 0px))'};
  }
`;

const InputBox = styled.div`
  width: 100%;
  max-width: 820px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 22px;
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
  align-items: center;
  padding: 14px 16px 14px 22px;
  gap: 12px;
`;

const Textarea = styled.textarea`
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 1.05rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  resize: none;
  min-height: 28px;
  max-height: 220px;
  line-height: 1.5;
  padding: 4px 0;

  &::placeholder {
    color: ${({ theme }) => theme.colors.textSecondary};
  }
`;

const SendBtn = styled.button<{ $active: boolean }>`
  flex-shrink: 0;
  width: 42px;
  height: 42px;
  border-radius: 8px;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  cursor: pointer;
  transition: background 0.15s, opacity 0.15s;
  background: ${({ $active, theme }) => $active ? theme.colors.gold : theme.colors.border};
  color: ${({ $active }) => $active ? '#fff' : '#aaa'};
  opacity: ${({ $active }) => $active ? 1 : 0.6};
  align-self: center;
`;

/* ── Spacer (idle only, vertically centers the intro+input block) ── */

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

    // Safety net: if streaming never updated content (early-return error),
    // make sure the final string lands in the bubble so the UI doesn't
    // get stuck on the "thinking" spinner.
    setMsgs(prev => prev.map(m => (m.id === aiId && !m.content?.trim() ? { ...m, content: final } : m)));

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

  /* Build a sidebar history list from the user's prompts in this session.
   * Persistence across reloads is a future feature. */
  const history = useMemo(() => msgs.filter((m) => m.role === 'user'), [msgs]);

  const scrollToMessage = useCallback((id: string) => {
    const el = document.getElementById(`msg-${id}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <Wrapper>
      <MobileBrandBar>
        <MobileBrandLogo src="/jazzifylogo.png" alt="Jazzify" />
        <MobileBrandName>Jazzify</MobileBrandName>
      </MobileBrandBar>
      <AdminBtn onClick={() => navigate('/admin')}>Admin</AdminBtn>

      {/* ── Sidebar ────────────────────────────────────────────── */}
      <Sidebar>
        <BrandRow>
          <BrandLogo src="/jazzifylogo.png" alt="Jazzify" />
          <BrandName>Jazzify</BrandName>
        </BrandRow>

        <SidebarSection style={{ flex: 1, minHeight: 0 }}>
          <SectionLabel>최근 대화</SectionLabel>
          <HistoryList>
            {history.length === 0 ? (
              <HistoryEmpty>대화를 시작하면 여기에 표시됩니다</HistoryEmpty>
            ) : (
              history.map((m) => (
                <HistoryItem
                  key={m.id}
                  title={m.content}
                  onClick={() => scrollToMessage(m.id)}
                >
                  {m.content.length > 40 ? `${m.content.slice(0, 40)}…` : m.content}
                </HistoryItem>
              ))
            )}
          </HistoryList>
        </SidebarSection>

        <ToolList>
          {TOOLS.map((t) => (
            <ToolBtn key={t.path} onClick={() => navigate(t.path)}>
              <span>{t.icon}</span>
              {t.label}
            </ToolBtn>
          ))}
        </ToolList>
      </Sidebar>

      {/* ── Main column ────────────────────────────────────────── */}
      <Main>
        {/* Top spacer — idle only, vertically centers intro+input */}
        <Spacer $phase={phase} />

        {/* Intro */}
        <Intro $phase={phase}>
          <HeroLogo src="/jazzifylogo.png" alt="Jazzify" />
          <Greeting>오늘은 무슨 이야기를 할까요?</Greeting>
          <Subtitle>화성학, 재즈 이론, 코드 진행에 대해 물어보세요</Subtitle>
        </Intro>

        {/* Mobile/tablet tool grid — desktop hides it (sidebar covers the role) */}
        <ToolGrid $phase={phase}>
          {TOOLS.map((t) => (
            <ToolCard key={t.path} onClick={() => navigate(t.path)}>
              <ToolCardIcon>{t.icon}</ToolCardIcon>
              <ToolCardLabel>{t.label}</ToolCardLabel>
            </ToolCard>
          ))}
        </ToolGrid>

        {/* Chat messages */}
        <MessagesArea $phase={phase} ref={messagesAreaRef} onScroll={handleScroll}>
          <MessagesInner>
            {msgs.map((msg) => (
              <div key={msg.id} id={`msg-${msg.id}`}>
                <ChatMessage message={msg} />
              </div>
            ))}
            <div ref={endRef} />
          </MessagesInner>
        </MessagesArea>

        {/* Input */}
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
        </Bottom>

        {/* Bottom spacer — idle only */}
        <Spacer $phase={phase} />
      </Main>
    </Wrapper>
  );
}
