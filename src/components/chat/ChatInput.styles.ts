import styled from 'styled-components';

export const InputContainer = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgPrimary};
`;

export const Input = styled.input`
  flex: 1;
  padding: 10px 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 20px;
  font-size: 14px;
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ theme }) => theme.colors.textPrimary};
  background: ${({ theme }) => theme.colors.bgSecondary};
  outline: none;
  transition: border-color 0.15s;

  &::placeholder {
    color: ${({ theme }) => theme.colors.textSecondary};
  }

  &:focus {
    border-color: ${({ theme }) => theme.colors.gold};
  }
`;

export const SendButton = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: linear-gradient(135deg, ${({ theme }) => theme.colors.gold}, ${({ theme }) => theme.colors.goldDark});
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  flex-shrink: 0;
  transition: opacity 0.15s;

  &:hover {
    opacity: 0.85;
  }

  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
`;
