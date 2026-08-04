import { useEffect } from 'react';
import styled, { keyframes } from 'styled-components';

/* Small confirmation prompt shown when the user clicks "새 채팅" while a
 *  conversation is in progress AND they're signed out. Logged-in users get
 *  the chat auto-saved server-side (once that's wired) so they skip this. */

interface Props {
  open: boolean;
  onClose: () => void;
  /** Confirm — wipe current chat and start fresh. */
  onConfirm: () => void;
  /** Switch to the login flow instead of wiping. */
  onLogin: () => void;
}

export function ConfirmNewChatModal({ open, onClose, onConfirm, onLogin }: Props) {
  /* Esc to close. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Backdrop onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <CloseBtn onClick={onClose} aria-label="닫기">
          <CloseIcon />
        </CloseBtn>

        <Title>현재 채팅을 지울까요?</Title>
        <Subtitle>
          새 채팅을 시작하면 현재 대화는 사라집니다. 채팅을 저장하려면{' '}
          <Bold onClick={onLogin}>회원 가입</Bold>하거나{' '}
          <Bold onClick={onLogin}>로그인</Bold>하세요.
        </Subtitle>

        <PrimaryBtn type="button" onClick={() => { onConfirm(); onClose(); }}>
          채팅 지우기
        </PrimaryBtn>
        <SecondaryBtn type="button" onClick={() => { onLogin(); onClose(); }}>
          로그인
        </SecondaryBtn>
      </Card>
    </Backdrop>
  );
}

/* ── icons ──────────────────────────────────────────────── */

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/* ── animations + styles ────────────────────────────────── */

const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;
const popIn = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
`;

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${({ theme }) => theme.zIndex.modal};
  background: rgba(20, 20, 20, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  animation: ${fadeIn} 0.15s ease both;
`;

const Card = styled.div`
  width: 100%;
  max-width: 420px;
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 22px;
  padding: 28px 28px 22px;
  position: relative;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.2);
  font-family: ${({ theme }) => theme.fonts.ui};
  display: flex;
  flex-direction: column;
  gap: 12px;
  animation: ${popIn} 0.18s cubic-bezier(0.2, 0.8, 0.2, 1) both;

  @media (max-width: 480px) {
    padding: 22px 20px 18px;
    border-radius: 18px;
  }
`;

const CloseBtn = styled.button`
  position: absolute;
  top: 12px;
  right: 12px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  &:hover { background: ${({ theme }) => theme.colors.hover}; color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const Title = styled.h2`
  margin: 4px 0 0;
  font-size: 19px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  text-align: center;
  letter-spacing: -0.01em;
`;

const Subtitle = styled.p`
  margin: 0 0 8px;
  font-size: 14px;
  line-height: 1.55;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
`;

/* The bold "회원 가입" / "로그인" inline words double as text links. */
const Bold = styled.span`
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  &:hover { text-decoration: underline; }
`;

const PrimaryBtn = styled.button`
  width: 100%;
  height: 48px;
  border-radius: 999px;
  border: none;
  background: ${({ theme }) => theme.colors.inkSurface};
  color: ${({ theme }) => theme.colors.onInk};
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.08s;
  &:hover { opacity: 0.9; }
  &:active { transform: scale(0.99); }
`;

const SecondaryBtn = styled.button`
  width: 100%;
  height: 48px;
  border-radius: 999px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s, transform 0.08s;
  &:hover { background: ${({ theme }) => theme.colors.hover}; border-color: ${({ theme }) => theme.colors.border}; }
  &:active { transform: scale(0.99); }
`;
