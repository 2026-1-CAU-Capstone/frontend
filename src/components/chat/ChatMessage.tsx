import type { ChatMessage as ChatMessageType } from '../../data/types';
import {
  MessageRow,
  Bubble,
  AssistantHeader,
  AssistantIcon,
  AssistantName,
} from './ChatMessage.styles';

interface ChatMessageProps {
  message: ChatMessageType;
}

export function ChatMessage({ message }: ChatMessageProps) {
  return (
    <MessageRow $role={message.role}>
      <Bubble $role={message.role}>
        {message.role === 'assistant' && (
          <AssistantHeader>
            <AssistantIcon>J</AssistantIcon>
            <AssistantName>Jazzify</AssistantName>
          </AssistantHeader>
        )}
        {message.content}
      </Bubble>
    </MessageRow>
  );
}
