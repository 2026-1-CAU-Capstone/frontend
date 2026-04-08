import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage as ChatMessageType, ChordOverlay } from '../../data/types';
import { ChatMessage } from '../chat/ChatMessage';
import { ChatInput } from '../chat/ChatInput';
import { AnalysisCard } from '../chat/AnalysisCard';
import { streamClaudeMessage, type ClaudeMessage } from '../../api/claude';
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
}

export function RightChatPanel({
  selectedChords,
  groupExplanation,
  songTitle,
  chordContext,
}: RightChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<ClaudeMessage[]>([]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = useCallback(async (text: string) => {
    const userMsg: ChatMessageType = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    };
    const aiMsgId = `ai-${Date.now()}`;
    const aiMsg: ChatMessageType = {
      id: aiMsgId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setLoading(true);

    const finalText = await streamClaudeMessage(
      text,
      historyRef.current,
      chordContext,
      (accumulated) => {
        setMessages((prev) =>
          prev.map((m) => (m.id === aiMsgId ? { ...m, content: accumulated } : m)),
        );
      },
    );

    // Update history for multi-turn conversation
    historyRef.current.push(
      { role: 'user', content: text },
      { role: 'assistant', content: finalText },
    );

    // Ensure final state is set
    setMessages((prev) =>
      prev.map((m) => (m.id === aiMsgId ? { ...m, content: finalText } : m)),
    );
    setLoading(false);
  }, [chordContext]);

  const hasSelection = selectedChords.length > 0;

  return (
    <PanelContainer>
      <PanelHeader>
        🎵 {songTitle || 'Jazzify AI'}
      </PanelHeader>

      <MessagesArea>
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
          <ChatMessage key={msg.id} message={msg} />
        ))}
        {loading && (
          <div style={{ padding: '8px 16px', color: '#999', fontSize: '0.82rem' }}>
            Claude thinking...
          </div>
        )}
        <div ref={messagesEndRef} />
      </MessagesArea>

      <ChatInput onSend={handleSend} disabled={loading} />
    </PanelContainer>
  );
}
