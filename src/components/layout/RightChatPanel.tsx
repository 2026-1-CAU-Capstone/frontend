import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage as ChatMessageType, ChordOverlay } from '../../data/types';
import { ChatMessage } from '../chat/ChatMessage';
import { ChatInput } from '../chat/ChatInput';
import { AnalysisCard } from '../chat/AnalysisCard';
import { sendChatMessage } from '../../api/chat';
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
}

export function RightChatPanel({
  selectedChords,
  groupExplanation,
  songTitle,
}: RightChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    const reply = await sendChatMessage(text);

    const aiMsg: ChatMessageType = {
      id: `ai-${Date.now()}`,
      role: 'assistant',
      content: reply,
      timestamp: Date.now(),
    };
    setMessages((prev) => [...prev, aiMsg]);
    setLoading(false);
  }, []);

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
            <EmptyIcon>J</EmptyIcon>
            악보에서 코드를 클릭하거나,
            <br />
            아래에서 질문을 입력해보세요.
          </EmptyState>
        )}

        {messages.map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </MessagesArea>

      <ChatInput onSend={handleSend} disabled={loading} />
    </PanelContainer>
  );
}
