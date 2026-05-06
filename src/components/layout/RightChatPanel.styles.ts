import styled from 'styled-components';

export const PanelContainer = styled.aside`
  width: 100%;
  min-width: 0;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-left: 1px solid ${({ theme }) => theme.colors.border};
  overflow: hidden;
`;

export const PanelHeader = styled.div`
  padding: 12px 16px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
`;

export const MessagesArea = styled.div`
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 16px 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

export const EmptyState = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 14px;
  line-height: 1.6;
`;

export const EmptyIcon = styled.img`
  width: 48px;
  height: 48px;
  border-radius: 12px;
  object-fit: cover;
  margin-bottom: 12px;
`;

export const EmptyActionGroup = styled.div`
  width: 100%;
  max-width: 280px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 36px;
`;

export const EmptyActionButton = styled.button`
  width: 100%;
  margin: 0;
  padding: 9px 14px;
  border-radius: 18px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgSecondary};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13px;
  font-weight: 600;
  line-height: 1.25;
  cursor: pointer;
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
