import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { InputContainer, Input, SendButton } from './ChatInput.styles';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState('');

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <InputContainer>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="이 코드 진행에 대해 질문해보세요..."
        disabled={disabled}
      />
      <SendButton onClick={handleSend} disabled={disabled || !value.trim()}>
        ↑
      </SendButton>
    </InputContainer>
  );
}
