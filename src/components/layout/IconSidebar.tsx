import { useLocation, useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../../styles/theme';
import { Logo } from '../common/Logo';

const Rail = styled.nav`
  width: 52px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 0;
  gap: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-right: 1px solid ${({ theme }) => theme.colors.border};

  ${mq.mobile} {
    width: 36px;
    padding: 6px 0;
    gap: 4px;
  }
`;

const NavBtn = styled.button<{ $active?: boolean }>`
  width: 38px;
  height: 38px;

  ${mq.mobile} {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    svg { width: 16px; height: 16px; }
  }
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 10px;
  background: ${({ $active, theme }) => ($active ? theme.colors.bgSecondary : 'transparent')};
  color: ${({ $active, theme }) => ($active ? theme.colors.textPrimary : theme.colors.textSecondary)};
  cursor: pointer;
  transition: background 0.15s;

  &:hover {
    background: ${({ theme }) => theme.colors.bgSecondary};
  }
`;

const Divider = styled.div`
  width: 28px;
  height: 1px;
  background: ${({ theme }) => theme.colors.border};
  margin: 4px 0;

  ${mq.mobile} {
    width: 20px;
    margin: 2px 0;
  }
`;

/* simple inline SVG icons */
const ChordIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18V5l12-2v13" />
    <circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
  </svg>
);

const NoteIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H8v-7l8-4v7" />
    <circle cx="6.5" cy="19.5" r="2.5" /><circle cx="18.5" cy="15.5" r="2.5" />
    <path d="M16 13V3l-8 4" />
  </svg>
);

const LickIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 3v18" /><path d="M8 7l4-4 4 4" />
    <path d="M5 12h14" /><path d="M7 17h10" />
  </svg>
);

const NAV = [
  { path: '/chord', icon: ChordIcon, label: 'Chord' },
  { path: '/note', icon: NoteIcon, label: 'Note' },
  { path: '/licks', icon: LickIcon, label: 'Licks' },
] as const;

export function IconSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();

  return (
    <Rail>
      <Logo />
      <Divider />
      {NAV.map(({ path, icon: Icon, label }) => (
        <NavBtn
          key={path}
          $active={pathname.startsWith(path)}
          onClick={() => navigate(path)}
          title={label}
        >
          <Icon />
        </NavBtn>
      ))}
    </Rail>
  );
}
