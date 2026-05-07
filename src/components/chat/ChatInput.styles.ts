import styled from 'styled-components';
import { ProgressionArrow } from './ProgressionArrow';

export const InputWrapper = styled.div`
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgPrimary};
  min-width: 0;
`;

export const QuickActionRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 8px 12px 0;
  min-width: 0;
`;

export const QuickActionButton = styled.button`
  flex: 1 1 160px;
  min-width: 0;
  padding: 6px 14px;
  border-radius: 16px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgSecondary};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12.5px;
  font-weight: 500;
  cursor: pointer;
  white-space: normal;
  line-height: 1.25;
  text-align: center;
  transition: background 0.15s, border-color 0.15s;

  &:hover:not(:disabled) {
    background: ${({ theme }) => theme.colors.border};
    border-color: ${({ theme }) => theme.colors.textSecondary};
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;

export const InputContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 12px;
  min-width: 0;
`;

export const ComposerBox = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 20px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  overflow: hidden;
  transition: border-color 0.15s;

  &:focus-within {
    border-color: ${({ theme }) => theme.colors.gold};
  }
`;

export const SelectedContext = styled.div`
  position: relative;
  margin: 8px 10px 0;
  padding: 6px 24px 6px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

export const SelectedContextClose = styled.button`
  position: absolute;
  top: 6px;
  right: 6px;
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 50%;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 9px;
  font-weight: 400;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.border};
    border-color: ${({ theme }) => theme.colors.textSecondary};
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

export const SelectedContextLabel = styled.div`
  font-size: 10px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 4px;
`;

export const SelectedChordRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  min-width: 0;
`;

export const SelectedChordStep = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
`;

export const SelectedChordChip = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  min-width: 0;
  padding: 0;
  border: none;
  border-radius: 0;
  font-size: 1.02rem;
  font-weight: 600;
  font-family: 'MuseJazz Text', 'Oswald', 'DM Sans', sans-serif;
  line-height: 1;
  background: transparent;
  color: ${({ theme }) => theme.colors.textPrimary};

  span {
    font-family: 'MuseJazz Text', 'Oswald', 'DM Sans', sans-serif !important;
    font-size: inherit !important;
    letter-spacing: 0 !important;
  }
`;

export const SelectedChordArrow = styled(ProgressionArrow)`
  flex: 0 0 auto;
  width: 18px;
  height: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  transform: translateY(1px);
`;

export const SelectedMoreChip = styled.span`
  display: inline-flex;
  align-items: center;
  padding: 4px 8px;
  border-radius: 0;
  background: transparent;
  border: none;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 12px;
  font-weight: 600;
`;

export const ComposerInputRow = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 8px;
  min-width: 0;
`;

export const Input = styled.textarea`
  flex: 1;
  min-width: 0;
  padding: 12px 14px;
  min-height: 56px;
  max-height: 150px;
  resize: vertical;
  border: none;
  font-size: 14px;
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ theme }) => theme.colors.textPrimary};
  background: transparent;
  outline: none;
  box-sizing: border-box;

  &::placeholder {
    color: ${({ theme }) => theme.colors.textSecondary};
  }

`;

export const SendButton = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, ${({ theme }) => theme.colors.gold}, ${({ theme }) => theme.colors.goldDark});
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  margin: 0 10px 10px 0;
  transition: opacity 0.15s;

  &:hover {
    opacity: 0.85;
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;
