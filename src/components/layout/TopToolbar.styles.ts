import styled from 'styled-components';
import { mq } from '../../styles/theme';

export const ToolbarContainer = styled.header`
  /* iOS notch/Dynamic Island 영역만큼 위쪽에 패딩 추가.
   * env() 값이 0이면(웹 또는 안전영역 없는 디바이스) 영향 없음. */
  height: calc(48px + env(safe-area-inset-top, 0px));
  padding: env(safe-area-inset-top, 0px) calc(16px + env(safe-area-inset-right, 0px)) 0 calc(16px + env(safe-area-inset-left, 0px));
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;

  ${mq.mobile} {
    height: calc(42px + env(safe-area-inset-top, 0px));
    padding: env(safe-area-inset-top, 0px) calc(10px + env(safe-area-inset-right, 0px)) 0 calc(10px + env(safe-area-inset-left, 0px));
  }
`;

export const ToolbarLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;

  ${mq.mobile} {
    gap: 6px;
  }
`;

export const ToolbarCenter = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  justify-content: center;

  ${mq.mobile} {
    gap: 4px;
  }
`;

export const ToolbarRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;

  ${mq.mobile} {
    gap: 4px;
  }
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

export const BackButton = styled.button`
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 5px 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  cursor: pointer;
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ theme }) => theme.colors.textSecondary};
  transition: all 0.15s ease;
  white-space: nowrap;

  &:hover {
    background: ${({ theme }) => theme.colors.border};
    color: ${({ theme }) => theme.colors.textPrimary};
  }

  ${mq.mobile} {
    padding: 4px 8px;
    font-size: 11px;
  }
`;

export const ShareButton = styled.button`
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border: none;
  border-radius: 8px;
  background: #2D6E6E;
  color: #fff;
  cursor: pointer;
  font-size: 13px;
  font-weight: 600;
  font-family: ${({ theme }) => theme.fonts.ui};
  transition: all 0.15s ease;
  white-space: nowrap;

  &:hover {
    opacity: 0.85;
  }

  ${mq.mobile} {
    padding: 5px 10px;
    font-size: 11px;
  }
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

  ${mq.mobile} {
    padding: 4px 6px;
    font-size: 11px;
  }
`;
