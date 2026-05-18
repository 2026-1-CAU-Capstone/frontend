import { useEffect, useRef, useState } from 'react';
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

/** Matches IntroChatInput.ArrowUpIcon so the send button looks identical. */
const SendArrowIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <path
      d="M12 19 L12 5 M5 12 L12 5 L19 12"
      stroke="currentColor"
      strokeWidth="2.2"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  isSelectionMode?: boolean;
  onToggleSelectionMode?: () => void;
  selectedChords?: ChordOverlay[];
  onClearSelectedChords?: () => void;
  onRequestLicks?: () => void;
  hideSelectionQuickAction?: boolean;
  placeholder?: string;
  /** Focus the input on mount. Used by HomePage on native so the iOS
   *  keyboard pops up as soon as the app opens (ChatGPT / Claude pattern). */
  autoFocus?: boolean;
}

export function ChatInput({
  onSend,
  disabled,
  isSelectionMode,
  onToggleSelectionMode,
  selectedChords = [],
  onClearSelectedChords,
  onRequestLicks,
  hideSelectionQuickAction = false,
  placeholder = '이 코드 진행에 대해 질문해보세요...',
  autoFocus = false,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    // Defer one tick so the DOM is fully painted before focus → keyboard
    // request lands properly in iOS WKWebView.
    const id = setTimeout(() => inputRef.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [autoFocus]);
  const visibleChords = selectedChords.slice(0, 10);
  const hiddenChordCount = Math.max(selectedChords.length - visibleChords.length, 0);
  const showSelectionQuickAction = !hideSelectionQuickAction;
  const showLickQuickAction = selectedChords.length > 0 && !!onRequestLicks;

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
      {(showSelectionQuickAction || showLickQuickAction) && (
        <QuickActionRow>
          {showSelectionQuickAction && (
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
          )}
          {showLickQuickAction && (
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
      )}
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
                    {i > 0 && <SelectedChordArrow />}
                    <SelectedChordChip>{formatChordsInText(chord.symbol)}</SelectedChordChip>
                  </SelectedChordStep>
                ))}
                {hiddenChordCount > 0 && <SelectedMoreChip>+{hiddenChordCount}</SelectedMoreChip>}
              </SelectedChordRow>
            </SelectedContext>
          )}
          <ComposerInputRow>
            <Input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
            />
            <SendButton onClick={handleSend} disabled={disabled || !value.trim()} aria-label="Send">
              <SendArrowIcon />
            </SendButton>
          </ComposerInputRow>
        </ComposerBox>
      </InputContainer>
    </InputWrapper>
  );
}
