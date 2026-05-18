import { useState, useEffect, useRef, type FormEvent } from 'react';
import styled, { keyframes } from 'styled-components';
import { login } from '../../api/auth';

/* Centered overlay modal — replaces the full-page LoginScreen with a Claude /
 * ChatGPT-style "로그인 또는 회원가입" card.
 *
 * Flow:
 *   - Step 1: enter email → 계속
 *   - Step 2: enter password → 계속 (calls login())
 * Social buttons are placeholders for now — wire to OAuth later.
 */

interface Props {
  onLogin: () => void;
  onClose: () => void;
}

/* Two-step flow: username entry → password entry → POST /v1/auth/login.
 *  Backend currently keys accounts on username (not email). Once the email
 *  migration ships, swap the field type/autocomplete back to "email" — the
 *  rest of the form stays identical. */
type Step = 'username' | 'password';

export function LoginModal({ onLogin, onClose }: Props) {
  const [step, setStep] = useState<Step>('username');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  /* Autofocus the visible input on mount + when stepping to password. */
  useEffect(() => {
    const t = setTimeout(() => {
      (step === 'username' ? usernameRef.current : pwRef.current)?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [step]);

  /* Esc key closes. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSocial = (name: string) => () => {
    setError(`${name} 로그인은 곧 지원됩니다.`);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (step === 'username') {
      if (!username.trim()) return;
      setStep('password');
      return;
    }
    if (!password) return;
    setSubmitting(true);
    try {
      await login(username.trim(), password);
      onLogin();
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Backdrop onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <CloseBtn onClick={onClose} aria-label="닫기">
          <CloseIcon />
        </CloseBtn>

        <Title>로그인 또는 회원가입</Title>
        <Subtitle>나만의 릭·솔로 라이브러리, 개인화된 코드 분석과 추천을 받아보세요.</Subtitle>

        <SocialList>
          <SocialBtn type="button" onClick={handleSocial('Google')}>
            <GoogleIcon />
            <span>Google 계정으로 계속하기</span>
          </SocialBtn>
          <SocialBtn type="button" onClick={handleSocial('Apple')}>
            <AppleIcon />
            <span>Apple 계정으로 계속하기</span>
          </SocialBtn>
          <SocialBtn type="button" onClick={handleSocial('전화번호')}>
            <PhoneIcon />
            <span>휴대 전화 번호로 계속하기</span>
          </SocialBtn>
        </SocialList>

        <DividerRow>
          <Line />
          <span>또는</span>
          <Line />
        </DividerRow>

        <Form onSubmit={submit}>
          <Field>
            <input
              ref={usernameRef}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="아이디 (username)"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={submitting || step === 'password'}
            />
          </Field>
          {step === 'password' && (
            <Field>
              <input
                ref={pwRef}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="비밀번호"
                autoComplete="current-password"
                disabled={submitting}
              />
            </Field>
          )}
          {error && <ErrorRow>{error}</ErrorRow>}
          <ContinueBtn
            type="submit"
            disabled={submitting || (step === 'username' ? !username.trim() : !password)}
            aria-busy={submitting}
          >
            {submitting ? <Spinner aria-label="로딩 중" /> : '계속'}
          </ContinueBtn>
          {step === 'password' && (
            <BackLink type="button" onClick={() => { setStep('username'); setPassword(''); setError(null); }}>
              ← 아이디 다시 입력
            </BackLink>
          )}
        </Form>
      </Card>
    </Backdrop>
  );
}

/* ── icons ───────────────────────────────────────────────── */

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
    <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84c-.21 1.13-.84 2.08-1.79 2.72v2.26h2.9c1.7-1.56 2.69-3.86 2.69-6.62z" />
    <path fill="#34A853" d="M9 18c2.43 0 4.46-.81 5.95-2.18l-2.9-2.26c-.81.54-1.83.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33C2.44 15.98 5.48 18 9 18z" />
    <path fill="#FBBC05" d="M3.96 10.71c-.18-.54-.28-1.12-.28-1.71s.1-1.17.28-1.71V4.96H.96A8.997 8.997 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z" />
    <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0 5.48 0 2.44 2.02.96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z" />
  </svg>
);

const AppleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <path
      fill="currentColor"
      d="M17.5 12.6c0-2.4 2-3.5 2.1-3.6-1.2-1.7-3-1.9-3.6-1.9-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3 0 1.8-.8 3.3-.8 1.6 0 2 .8 3.3.8 1.4 0 2.2-1.2 3-2.5.5-.8.9-1.6 1.2-2.5-2-.7-2.5-3.4-2.5-4.8zM15.3 4.6c.7-.8 1.1-2 1-3.2-1 0-2.3.7-3 1.5-.7.8-1.2 2-1.1 3.1 1.1.1 2.3-.6 3.1-1.4z"
    />
  </svg>
);

const PhoneIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <path
      d="M5 4.5 a1.5 1.5 0 0 1 1.5-1.5 h2.7 a1 1 0 0 1 1 .8 l.8 3.5 a1 1 0 0 1-.3 1 l-1.6 1.4 a14 14 0 0 0 6.2 6.2 l1.4-1.6 a1 1 0 0 1 1-.3 l3.5.8 a1 1 0 0 1 .8 1 v2.7 a1.5 1.5 0 0 1-1.5 1.5 C10 20 4 14 4 6 z"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  </svg>
);

/* ── animations ─────────────────────────────────────────── */

const fadeIn = keyframes`from { opacity: 0; } to { opacity: 1; }`;
const popIn = keyframes`
  from { opacity: 0; transform: translateY(8px) scale(0.98); }
  to   { opacity: 1; transform: translateY(0) scale(1); }
`;

/* ── styles ──────────────────────────────────────────────── */

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: rgba(20, 20, 20, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  animation: ${fadeIn} 0.15s ease both;
`;

const Card = styled.div`
  width: 100%;
  max-width: 460px;
  background: #fff;
  border-radius: 24px;
  padding: 36px 32px 32px;
  position: relative;
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.2);
  font-family: ${({ theme }) => theme.fonts.ui};
  animation: ${popIn} 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) both;

  @media (max-width: 480px) {
    padding: 28px 22px 24px;
    border-radius: 20px;
  }
`;

const CloseBtn = styled.button`
  position: absolute;
  top: 14px;
  right: 14px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: rgba(0, 0, 0, 0.55);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
  &:hover { background: rgba(0, 0, 0, 0.05); color: #000; }
`;

const Title = styled.h1`
  margin: 0 0 12px;
  font-size: 26px;
  font-weight: 700;
  color: #1a1a1a;
  text-align: center;
  letter-spacing: -0.015em;
`;

const Subtitle = styled.p`
  margin: 0 0 24px;
  font-size: 14.5px;
  line-height: 1.55;
  color: rgba(0, 0, 0, 0.55);
  text-align: center;
`;

const SocialList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SocialBtn = styled.button`
  width: 100%;
  height: 48px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.16);
  background: #fff;
  color: #1a1a1a;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  cursor: pointer;
  font-family: inherit;
  font-size: 15px;
  font-weight: 500;
  transition: background 0.1s, border-color 0.1s, transform 0.06s;
  &:hover { background: rgba(0, 0, 0, 0.025); border-color: rgba(0, 0, 0, 0.24); }
  &:active { transform: scale(0.99); }
`;

const DividerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 18px 0 14px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
`;

const Line = styled.span`
  flex: 1;
  height: 1px;
  background: rgba(0, 0, 0, 0.1);
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Field = styled.div`
  input {
    width: 100%;
    height: 48px;
    border: 1px solid rgba(0, 0, 0, 0.16);
    border-radius: 999px;
    background: #fff;
    padding: 0 22px;
    font-family: inherit;
    font-size: 15px;
    color: #1a1a1a;
    outline: none;
    transition: border-color 0.12s;
    &::placeholder { color: rgba(0, 0, 0, 0.4); }
    &:focus { border-color: rgba(0, 0, 0, 0.45); }
    &:disabled { background: #fafafa; color: rgba(0, 0, 0, 0.55); }
  }
`;

const ErrorRow = styled.div`
  padding: 2px 12px 0;
  font-size: 12.5px;
  color: #c0392b;
`;

const ContinueBtn = styled.button`
  width: 100%;
  height: 48px;
  border-radius: 999px;
  border: none;
  background: #1a1a1a;
  color: #fff;
  font-family: inherit;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  margin-top: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, opacity 0.15s, transform 0.06s;
  &:hover:not(:disabled) { opacity: 0.9; }
  &:active:not(:disabled) { transform: scale(0.99); }
  &:disabled { cursor: default; }
  /* While submitting, the button stays full-width but takes a neutral gray
   *  fill so the spinner reads as the active visual — not a "blocked" CTA. */
  &[aria-busy='true'] {
    background: rgba(0, 0, 0, 0.18);
    opacity: 1;
  }
  &:disabled:not([aria-busy='true']) { opacity: 0.35; }
`;

/* iOS-style 12-spoke spinner — discrete pills around a circle with staggered
 *  opacity animation so it reads as smooth rotation. Matches the screenshot's
 *  starburst feel exactly. */
const spokeFade = keyframes`
  0%, 39%, 100% { opacity: 0.18; }
  40%           { opacity: 1; }
`;

function Spinner({ 'aria-label': ariaLabel }: { 'aria-label'?: string }) {
  return (
    <SpinnerSvg viewBox="0 0 24 24" aria-label={ariaLabel} role="img">
      {Array.from({ length: 12 }).map((_, i) => (
        <rect
          key={i}
          x="11"
          y="2"
          width="2"
          height="5.5"
          rx="1"
          fill="#fff"
          transform={`rotate(${i * 30} 12 12)`}
          style={{ animationDelay: `${(i / 12) * -1}s` }}
        />
      ))}
    </SpinnerSvg>
  );
}

const SpinnerSvg = styled.svg`
  width: 22px;
  height: 22px;
  rect {
    animation: ${spokeFade} 1s linear infinite;
  }
`;

const BackLink = styled.button`
  margin-top: 6px;
  padding: 6px 4px;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.55);
  cursor: pointer;
  text-align: center;
  &:hover { color: #000; }
`;
