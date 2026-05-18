import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { mq } from '../../styles/theme';
import { getCachedUser, onAuthChange, type AuthUser } from '../../api/auth';

/* ─────────────────────────────────────────────────────────────────────────
 * AuthTopBar — fixed top-right pill button opening the LoginModal.
 *
 * Mounted only by HomePage (intro). Renders nothing when:
 *   - the user is already logged in
 *   - the viewport is mobile (HomePage has its own hamburger drawer there)
 * ──────────────────────────────────────────────────────────────────────── */

const Bar = styled.div`
  position: fixed;
  top: max(14px, env(safe-area-inset-top, 0px));
  right: 18px;
  z-index: 90;
  display: flex;
  align-items: center;
  font-family: ${({ theme }) => theme.fonts.ui};

  ${mq.mobile} {
    display: none;
  }
`;

const AuthBtn = styled.button`
  height: 36px;
  padding: 0 20px;
  border-radius: 999px;
  border: none;
  background: #1a1a1a;
  color: #fff;
  font-size: 13.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.12s;

  &:hover { opacity: 0.88; }
  &:active { transform: scale(0.97); }
`;

interface Props {
  /** Called when the button is clicked. Parent owns the LoginModal so we
   *  don't double-up on auth UI when the same parent surfaces it elsewhere. */
  onLoginClick: () => void;
}

export function AuthTopBar({ onLoginClick }: Props) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getCachedUser());

  useEffect(() => {
    const unsub = onAuthChange((loggedIn, user) => {
      setAuthUser(loggedIn ? user : null);
    });
    return unsub;
  }, []);

  if (authUser) return null;

  return (
    <Bar>
      <AuthBtn onClick={onLoginClick}>로그인 / 회원가입</AuthBtn>
    </Bar>
  );
}
