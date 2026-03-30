import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import { ANALYSIS_CATEGORIES, type AnalysisCategory } from '../../api/gemini';
import {
  InputWrapper,
  ChipsRow,
  Chip,
  InputContainer,
  Input,
  SendButton,
} from './ChatInput.styles';

interface ChatInputProps {
  onSend: (message: string, category?: AnalysisCategory) => void;
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

  const handleChip = (cat: typeof ANALYSIS_CATEGORIES[number]) => {
    onSend(cat.label, cat.id);
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <InputWrapper>
      <ChipsRow>
        {ANALYSIS_CATEGORIES.map((cat) => (
          <Chip key={cat.id} onClick={() => handleChip(cat)} disabled={disabled}>
            {cat.emoji} {cat.label}
          </Chip>
        ))}
      </ChipsRow>
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
