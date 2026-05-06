import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage as ChatMessageType, ChordOverlay } from '../../data/types';
import { ChatMessage } from '../chat/ChatMessage';
import { ChatInput } from '../chat/ChatInput';
import { AnalysisCard } from '../chat/AnalysisCard';
import { RagDebugPanel } from '../chat/RagDebugPanel';
import { type ClaudeMessage } from '../../api/claude';
import { streamWithRAG, type RagDebugInfo } from '../../api/harmorag';
import {
  PanelContainer,
  PanelHeader,
  MessagesArea,
  EmptyState,
  EmptyIcon,
} from './RightChatPanel.styles';

interface RightChatPanelProps {
  selectedChords: ChordOverlay[];
  groupExplanation: string | null;
  songTitle: string;
  chordContext?: string;
  isSelectionMode?: boolean;
  onToggleSelectionMode?: () => void;
}

interface MessageWithDebug extends ChatMessageType {
  ragDebug?: RagDebugInfo;
}

export function RightChatPanel({
  selectedChords,
  groupExplanation,
  songTitle,
  chordContext,
  isSelectionMode = false,
  onToggleSelectionMode,
}: RightChatPanelProps) {
  const [messages, setMessages] = useState<MessageWithDebug[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesAreaRef = useRef<HTMLDivElement>(null);
  const isScrolledUpRef = useRef(false);
  const historyRef = useRef<ClaudeMessage[]>([]);

  const handleScroll = useCallback(() => {
    if (!messagesAreaRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesAreaRef.current;
    // 50px 이상 위로 올렸으면 자동스크롤 중지
    isScrolledUpRef.current = scrollHeight - scrollTop - clientHeight > 50;
  }, []);

  useEffect(() => {
    if (!isScrolledUpRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages]);

  useEffect(() => {
    // 곡이 변경될 때만 초기화
    setMessages([]);
    historyRef.current = [];
  }, [songTitle]);

  const handleSend = useCallback(async (text: string) => {
    isScrolledUpRef.current = false; // 새로운 질문 시 무조건 하단 스크롤 활성화

    const userMsg: MessageWithDebug = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    const aiMsgId = `ai-${Date.now()}`;
    const aiMsg: MessageWithDebug = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setLoading(true);

    const finalText = await streamWithRAG(
      text,
      historyRef.current,
      chordContext,
      songTitle,
      (accumulated) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, content: accumulated } : m)),
        );
      },
      // RAG 디버그 정보 수신 → 해당 메시지에 attach
      (debugInfo) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, ragDebug: debugInfo } : m)),
        );
      },
    );

    historyRef.current.push(
      { role: 'user', content: text },
      { role: 'assistant', content: finalText },
    );

    setMessages((prev) =>
      prev.map((m) => (m.id === aiMsgId ? { ...m, content: finalText } : m)),
    );
    setLoading(false);
  }, [chordContext, songTitle]);

  const hasSelection = selectedChords.length > 0;

  return (
    <PanelContainer>
      <PanelHeader>
        🎵 {songTitle || 'Jazzify AI'}
      </PanelHeader>

      <MessagesArea ref={messagesAreaRef} onScroll={handleScroll}>
        {hasSelection && groupExplanation && (
          <AnalysisCard chords={selectedChords} explanation={groupExplanation} />
        )}

        {!hasSelection && messages.length === 0 && (
          <EmptyState>
            <EmptyIcon src="/jazzifylogo.png" alt="Jazzify" />
            악보에서 코드를 클릭하거나,
            <br />
            아래에서 질문을 입력해보세요.
          </EmptyState>
        )}

        {messages.map((msg) => (
          <div key={msg.id}>
            {/* AI 메시지 위에 RAG 디버그 패널 표시 */}
            {msg.role === 'assistant' && msg.ragDebug && (
              <RagDebugPanel info={msg.ragDebug} />
            )}
            <ChatMessage message={msg} />
          </div>
        ))}

        {loading && (
          <div style={{ padding: '8px 16px', color: '#999', fontSize: '0.82rem' }}>
            🔍 HarmoRAG 검색 중...
          </div>
        )}
        <div ref={messagesEndRef} />
      </MessagesArea>

      <ChatInput 
        onSend={handleSend} 
        disabled={loading} 
        isSelectionMode={isSelectionMode}
        onToggleSelectionMode={onToggleSelectionMode}
      />
    </PanelContainer>
  );
}
