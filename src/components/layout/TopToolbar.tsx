import { Logo } from '../common/Logo';
import { Toggle } from '../common/Toggle';
import {
  ToolbarContainer,
  ToolbarLeft,
  ToolbarCenter,
  ToolbarRight,
  PageNav,
  NavButton,
  ZoomSelect,
  ToolbarDivider,
  ToolbarButton,
} from './TopToolbar.styles';

interface TopToolbarProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  autoHighlight: boolean;
  onToggleHighlight: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function TopToolbar({
  currentPage,
  totalPages,
  onPageChange,
  autoHighlight,
  onToggleHighlight,
  sidebarOpen,
  onToggleSidebar,
}: TopToolbarProps) {
  return (
    <ToolbarContainer>
      <ToolbarLeft>
        <Logo />
      </ToolbarLeft>

      <ToolbarCenter>
        <PageNav>
          <NavButton
            disabled={currentPage <= 1}
            onClick={() => onPageChange(currentPage - 1)}
          >
            −
          </NavButton>
          <span>
            {currentPage} / {totalPages}
          </span>
          <NavButton
            disabled={currentPage >= totalPages}
            onClick={() => onPageChange(currentPage + 1)}
          >
            +
          </NavButton>
        </PageNav>

        <ZoomSelect defaultValue="auto">
          <option value="auto">자동</option>
          <option value="50">50%</option>
          <option value="75">75%</option>
          <option value="100">100%</option>
          <option value="150">150%</option>
        </ZoomSelect>

        <ToolbarDivider />

        <Toggle
          label="오토 하이라이트"
          active={autoHighlight}
          onToggle={onToggleHighlight}
        />

        <ToolbarButton>이미지 설명</ToolbarButton>
        <ToolbarButton>자동 번역</ToolbarButton>
      </ToolbarCenter>

      <ToolbarRight>
        <ToolbarButton onClick={onToggleSidebar}>
          {sidebarOpen ? '◁' : '▷'} 사이드바
        </ToolbarButton>
      </ToolbarRight>
    </ToolbarContainer>
  );
}
