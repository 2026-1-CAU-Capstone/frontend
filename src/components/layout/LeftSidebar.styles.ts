import styled from 'styled-components';

export const SidebarContainer = styled.aside<{ $open: boolean }>`
  width: ${({ $open }) => ($open ? '200px' : '0px')};
  min-width: ${({ $open }) => ($open ? '200px' : '0px')};
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-right: ${({ $open, theme }) => ($open ? `1px solid ${theme.colors.border}` : 'none')};
  overflow: hidden;
  transition: width 0.2s ease, min-width 0.2s ease;
  display: flex;
  flex-direction: column;
`;

export const SidebarSection = styled.div`
  padding: 16px 12px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

export const SidebarTitle = styled.h3`
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 8px;
  letter-spacing: 0.5px;
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
