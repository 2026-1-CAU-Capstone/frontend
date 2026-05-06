import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  InputWrapper,
  QuickActionRow,
  QuickActionButton,
  InputContainer,
  Input,
  SendButton,
} from './ChatInput.styles';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  isSelectionMode?: boolean;
  onToggleSelectionMode?: () => void;
}

export function ChatInput({ onSend, disabled, isSelectionMode, onToggleSelectionMode }: ChatInputProps) {
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
    <InputWrapper>
      <QuickActionRow>
        <QuickActionButton
          onClick={onToggleSelectionMode}
          disabled={disabled}
          style={{
            background: isSelectionMode ? 'linear-gradient(135deg, #2D8F5E, #1F6A44)' : undefined,
            color: isSelectionMode ? '#fff' : undefined,
            borderColor: isSelectionMode ? 'transparent' : undefined,
          }}
        >
          {isSelectionMode ? '✨ 구간 선택 활성화됨 (클릭하여 취소)' : '🎯 코드 구간 직접 선택하기'}
        </QuickActionButton>
        <QuickActionButton
          onClick={() => onSend('이 코드 진행 분석해줘')}
          disabled={disabled}
        >
          🎼 이 코드 진행 분석해줘
        </QuickActionButton>
      </QuickActionRow>
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
    </InputWrapper>
  );
}
