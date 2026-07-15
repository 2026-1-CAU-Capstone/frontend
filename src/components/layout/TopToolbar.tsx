import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import {
  ToolbarContainer,
  ToolbarLeft,
  ToolbarCenter,
  ToolbarRight,
  BackButton,
} from './TopToolbar.styles';

const TitleText = styled.span`
  font-weight: 600;
  font-size: 16px;
`;

const SubtitleText = styled.span`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

interface TopToolbarProps {
  title?: string;
  subtitle?: string;
  /** Rendered right after the back button (e.g. a song picker). */
  leftExtra?: ReactNode;
}

export function TopToolbar({ title, subtitle, leftExtra }: TopToolbarProps) {
  const navigate = useNavigate();

  return (
    <ToolbarContainer>
      <ToolbarLeft>
        <BackButton onClick={() => navigate(-1)}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 2L4 7l5 5" />
          </svg>
          돌아가기
        </BackButton>
        {leftExtra}
      </ToolbarLeft>

      <ToolbarCenter>
        {title && <TitleText>{title}</TitleText>}
        {subtitle && <SubtitleText>{subtitle}</SubtitleText>}
      </ToolbarCenter>

      <ToolbarRight />
    </ToolbarContainer>
  );
}
