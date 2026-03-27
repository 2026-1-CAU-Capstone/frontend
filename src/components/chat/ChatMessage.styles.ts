import styled from 'styled-components';

export const MessageRow = styled.div<{ $role: 'user' | 'assistant' }>`
  display: flex;
  justify-content: ${({ $role }) => ($role === 'user' ? 'flex-end' : 'flex-start')};
  padding: 4px 0;
`;

export const Bubble = styled.div<{ $role: 'user' | 'assistant' }>`
  max-width: 85%;
  padding: 10px 14px;
  border-radius: 16px;
  font-size: 14px;
  line-height: 1.5;
  background: ${({ $role, theme }) =>
    $role === 'user' ? theme.colors.highlightIiVI : theme.colors.bgSecondary};
  color: ${({ theme }) => theme.colors.textPrimary};
  border: ${({ $role, theme }) =>
    $role === 'assistant' ? `1px solid ${theme.colors.border}` : 'none'};
`;

export const AssistantHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
`;

export const AssistantIcon = styled.div`
  width: 20px;
  height: 20px;
  border-radius: 4px;
  background: linear-gradient(135deg, ${({ theme }) => theme.colors.gold}, ${({ theme }) => theme.colors.goldDark});
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
`;

export const AssistantName = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
