import type { TocEntry } from '../../data/types';
import {
  SidebarContainer,
  SidebarSection,
  SidebarTitle,
  MenuItem,
  TocList,
  TocItem,
} from './LeftSidebar.styles';

interface LeftSidebarProps {
  open: boolean;
  toc: TocEntry[];
  activePage: number;
  onPageSelect: (page: number) => void;
}

export function LeftSidebar({ open, toc, activePage, onPageSelect }: LeftSidebarProps) {
  return (
    <SidebarContainer $open={open}>
      <SidebarSection>
        <SidebarTitle>메뉴</SidebarTitle>
        <MenuItem>📚 라이브러리</MenuItem>
        <MenuItem>⭐ 라이브러리에서 제거</MenuItem>
        <MenuItem>👥 친구 추천하기</MenuItem>
      </SidebarSection>

      <SidebarSection>
        <SidebarTitle>목차</SidebarTitle>
      </SidebarSection>
      <TocList>
        {toc.map((entry) => (
          <TocItem
            key={entry.title}
            $active={activePage === entry.page}
            onClick={() => onPageSelect(entry.page)}
          >
            ▸ {entry.title} (p.{entry.page})
          </TocItem>
        ))}
      </TocList>
    </SidebarContainer>
  );
}
