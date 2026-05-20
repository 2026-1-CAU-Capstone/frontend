import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import {
  ToolbarContainer,
  ToolbarLeft,
  ToolbarCenter,
  ToolbarRight,
  BackButton,
  ShareButton,
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
  /** Rendered just before the share button (e.g. a search box). */
  rightExtra?: ReactNode;
}

export function TopToolbar({ title, subtitle, leftExtra, rightExtra }: TopToolbarProps) {
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

      <ToolbarRight>
        {rightExtra}
        <ShareButton>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="18" cy="5" r="3" />
            <circle cx="6" cy="12" r="3" />
            <circle cx="18" cy="19" r="3" />
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
            <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
          </svg>
          공유
        </ShareButton>
      </ToolbarRight>
    </ToolbarContainer>
  );
}
