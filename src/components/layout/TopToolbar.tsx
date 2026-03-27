import { Logo } from '../common/Logo';
import { Toggle } from '../common/Toggle';
import {
  ToolbarContainer,
  ToolbarLeft,
  ToolbarCenter,
  ToolbarRight,
  ToolbarButton,
} from './TopToolbar.styles';

interface TopToolbarProps {
  autoHighlight: boolean;
  onToggleHighlight: () => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
}

export function TopToolbar({
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
        <Toggle
          label="분석 보기"
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
