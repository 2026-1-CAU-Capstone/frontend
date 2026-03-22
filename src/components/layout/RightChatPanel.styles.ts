import styled from 'styled-components';

export const PanelContainer = styled.aside`
  width: 360px;
  min-width: 360px;
  display: flex;
  flex-direction: column;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-left: 1px solid ${({ theme }) => theme.colors.border};
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
`;

export const MessagesArea = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
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

export const EmptyIcon = styled.div`
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, ${({ theme }) => theme.colors.gold}, ${({ theme }) => theme.colors.goldDark});
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 22px;
  font-weight: 700;
  margin-bottom: 12px;
`;
