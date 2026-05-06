import styled from 'styled-components';
import { mq } from '../../styles/theme';

export const SidebarWrapper = styled.div<{ $width: number }>`
  position: relative;
  width: ${({ $width }) => $width}px;
  min-width: 0;
  flex-shrink: 0;
  display: flex;
  overflow: visible;
  border-right: ${({ $width, theme }) => ($width > 0 ? `1px solid ${theme.colors.border}` : 'none')};

  ${mq.compactLayout} {
    width: 0;
    border-right: none;
  }
`;

export const SidebarContainer = styled.aside`
  width: 100%;
  background: ${({ theme }) => theme.colors.bgPrimary};
  overflow: hidden;
  display: flex;
  flex-direction: column;

  ${mq.compactLayout} {
    position: fixed;
    top: 48px;
    left: 52px;
    bottom: 0;
    width: min(260px, calc(100vw - 52px));
    z-index: 1000;
    box-shadow: 4px 0 20px rgba(0, 0, 0, 0.12);
  }

  ${mq.mobile} {
    top: 42px;
    left: 36px;
    width: min(260px, calc(100vw - 36px));
  }
`;

export const SidebarOverlay = styled.div<{ $open: boolean }>`
  display: none;

  ${mq.compactLayout} {
    display: ${({ $open }) => ($open ? 'block' : 'none')};
    position: fixed;
    inset: 48px 0 0 52px;
    z-index: 990;
    background: rgba(0, 0, 0, 0.3);
  }

  ${mq.mobile} {
    inset: 42px 0 0 36px;
  }
`;

export const ResizeHandle = styled.div`
  position: absolute;
  top: 0;
  right: -3px;
  bottom: 0;
  width: 6px;
  cursor: col-resize;
  z-index: 10;
  background: transparent;
  transition: background 0.15s;

  &:hover,
  &.dragging {
    background: ${({ theme }) => theme.colors.border};
  }

  ${mq.compactLayout} {
    display: none;
  }
`;

export const ReopenTab = styled.button`
  position: absolute;
  top: 50%;
  left: 0;
  transform: translateY(-50%);
  width: 20px;
  height: 56px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-left: none;
  border-radius: 0 8px 8px 0;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  z-index: 50;
  box-shadow: 2px 0 6px rgba(0, 0, 0, 0.08);
  transition: all 0.15s;

  &:hover {
    width: 20px;
    background: ${({ theme }) => theme.colors.bgSecondary};
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

export const SidebarSection = styled.div`
  padding: 16px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

export const SidebarTitleRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
`;

export const SidebarTitle = styled.h3`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 0;
  letter-spacing: 0.5px;
`;

export const CollapseButton = styled.button`
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  line-height: 1;

  &:hover {
    background: ${({ theme }) => theme.colors.bgSecondary};
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

export const MenuItem = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 6px;
  background: ${({ $active, theme }) => ($active ? theme.colors.bgSecondary : 'transparent')};
  cursor: pointer;
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ theme }) => theme.colors.textPrimary};
  text-align: left;
  transition: background 0.1s;

  &:hover {
    background: ${({ theme }) => theme.colors.bgSecondary};
  }
`;

export const TocList = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 12px;
`;

export const TocItem = styled.button<{ $active?: boolean; $depth?: number }>`
  display: block;
  width: 100%;
  padding: 6px 8px 6px ${({ $depth = 0 }) => 8 + $depth * 16}px;
  border: none;
  border-radius: 4px;
  background: ${({ $active, theme }) => ($active ? theme.colors.highlightSelected : 'transparent')};
  cursor: pointer;
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ $active, theme }) => ($active ? theme.colors.goldDark : theme.colors.textPrimary)};
  text-align: left;
  transition: background 0.1s;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;

  &:hover {
    background: ${({ theme }) => theme.colors.bgSecondary};
  }
`;
