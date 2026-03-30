import React, { useMemo, useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import type { ChatMessage as ChatMessageType } from '../../data/types';
import { formatChordsInText } from './chordFormat';
import {
  MessageRow,
  Bubble,
  MarkdownBody,
  AssistantHeader,
  AssistantIcon,
  AssistantName,
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

/** Custom markdown renderers that apply chord formatting to all text */
const mdComponents: Components = {
  p: ({ children }) => <p>{formatChildChords(children)}</p>,
  li: ({ children }) => <li>{formatChildChords(children)}</li>,
  strong: ({ children }) => <strong>{formatChildChords(children)}</strong>,
  em: ({ children }) => <em>{formatChildChords(children)}</em>,
  h3: ({ children }) => <h3>{formatChildChords(children)}</h3>,
  h4: ({ children }) => <h4>{formatChildChords(children)}</h4>,
};

export function ChatMessage({ message }: ChatMessageProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [message.content]);

  const content = useMemo(() => {
    if (message.role !== 'assistant') return null;
    return (
      <MarkdownBody>
        <ReactMarkdown components={mdComponents}>{message.content}</ReactMarkdown>
      </MarkdownBody>
    );
  }, [message.content, message.role]);

  return (
    <MessageRow $role={message.role}>
      <Bubble $role={message.role}>
        {message.role === 'assistant' && (
          <AssistantHeader>
            <AssistantIcon>J</AssistantIcon>
            <AssistantName>Jazzify</AssistantName>
          </AssistantHeader>
        )}
        {message.role === 'assistant' ? content : message.content}
        <CopyButton onClick={handleCopy} title="Copy">
          {copied ? '✓' : '⎘'}
        </CopyButton>
      </Bubble>
    </MessageRow>
  );
}
