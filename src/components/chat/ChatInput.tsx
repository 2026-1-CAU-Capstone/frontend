import { useState } from 'react';
import type { KeyboardEvent } from 'react';
import type { ChordOverlay } from '../../data/types';
import { formatChordsInText } from './chordFormat';
import {
  InputWrapper,
  QuickActionRow,
  QuickActionButton,
  InputContainer,
  ComposerBox,
  SelectedContext,
  SelectedContextClose,
  SelectedContextLabel,
  SelectedChordRow,
  SelectedChordStep,
  SelectedChordChip,
  SelectedChordArrow,
  SelectedMoreChip,
  ComposerInputRow,
  Input,
  SendButton,
} from './ChatInput.styles';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  isSelectionMode?: boolean;
  onToggleSelectionMode?: () => void;
  selectedChords?: ChordOverlay[];
  onClearSelectedChords?: () => void;
  onRequestLicks?: () => void;
}

export function ChatInput({
  onSend,
  disabled,
  isSelectionMode,
  onToggleSelectionMode,
  selectedChords = [],
  onClearSelectedChords,
  onRequestLicks,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const visibleChords = selectedChords.slice(0, 10);
  const hiddenChordCount = Math.max(selectedChords.length - visibleChords.length, 0);

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
        {selectedChords.length > 0 && onRequestLicks && (
          <QuickActionButton
            onClick={onRequestLicks}
            disabled={disabled}
            style={{
              background: 'linear-gradient(135deg, #B8860B, #996600)',
              color: '#fff',
              borderColor: 'transparent',
              fontWeight: 700,
            }}
          >
            💡 릭 추천받기
          </QuickActionButton>
        )}
      </QuickActionRow>
      <InputContainer>
        <ComposerBox>
          {selectedChords.length > 0 && (
            <SelectedContext>
              {onClearSelectedChords && (
                <SelectedContextClose
                  type="button"
                  aria-label="선택한 코드 구간 지우기"
                  onClick={onClearSelectedChords}
                >
                  X
                </SelectedContextClose>
              )}
              <SelectedContextLabel>선택한 코드 구간 · {selectedChords.length}개</SelectedContextLabel>
              <SelectedChordRow>
                {visibleChords.map((chord, i) => (
                  <SelectedChordStep key={chord.id}>
                    {i > 0 && <SelectedChordArrow>→</SelectedChordArrow>}
                    <SelectedChordChip>{formatChordsInText(chord.symbol)}</SelectedChordChip>
                  </SelectedChordStep>
                ))}
                {hiddenChordCount > 0 && <SelectedMoreChip>+{hiddenChordCount}</SelectedMoreChip>}
              </SelectedChordRow>
            </SelectedContext>
          )}
          <ComposerInputRow>
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
          </ComposerInputRow>
        </ComposerBox>
      </InputContainer>
    </InputWrapper>
  );
}
