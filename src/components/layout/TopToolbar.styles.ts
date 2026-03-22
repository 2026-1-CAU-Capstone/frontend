import styled from 'styled-components';

export const ToolbarContainer = styled.header`
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
`;

export const ToolbarLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

export const ToolbarCenter = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const ToolbarRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const PageNav = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

export const NavButton = styled.button`
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  cursor: pointer;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  transition: background 0.1s;

  &:hover {
    background: ${({ theme }) => theme.colors.bgSecondary};
  }

  &:disabled {
    opacity: 0.4;
    cursor: default;
  }
`;

export const ZoomSelect = styled.select`
  padding: 4px 8px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.bgPrimary};
  cursor: pointer;
`;

export const ToolbarDivider = styled.div`
  width: 1px;
  height: 24px;
  background: ${({ theme }) => theme.colors.border};
  margin: 0 4px;
`;

export const ToolbarButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgPrimary};
  cursor: pointer;
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ theme }) => theme.colors.textSecondary};
  transition: all 0.15s ease;

  &:hover {
    background: ${({ theme }) => theme.colors.bgSecondary};
  }
`;
