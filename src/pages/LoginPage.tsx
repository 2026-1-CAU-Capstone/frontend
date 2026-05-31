import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { login, getCachedUser } from '../api/auth';

type Step = 'username' | 'password';

const BG = '#f0ece4';

const ROTATING = [
  '나만의 재즈 라이브러리를 만들어가는',
  '화성학의 깊이를 탐구하는',
  '릭과 솔로를 저장하고 연습하는',
  '코드 진행을 분석하고 이해하는',
];

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  /* ProtectedRoute passes the page the user originally tried to visit as
   * `state.from.pathname`. Fall back to "/" when the user opened /login
   * directly (e.g., from the sidebar). */
  const fromPath =
    (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';

  useEffect(() => {
    if (getCachedUser()) navigate(fromPath, { replace: true });
  }, [navigate, fromPath]);

  const [step, setStep] = useState<Step>('username');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  const [rtIdx, setRtIdx] = useState(0);
  const [rtVisible, setRtVisible] = useState(true);

  useEffect(() => {
    const iv = setInterval(() => {
      setRtVisible(false);
      const t = setTimeout(() => {
        setRtIdx((i) => (i + 1) % ROTATING.length);
        setRtVisible(true);
      }, 420);
      return () => clearTimeout(t);
    }, 3600);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      (step === 'username' ? usernameRef : pwRef).current?.focus();
    }, 80);
    return () => clearTimeout(t);
  }, [step]);

  const handleSocial = (name: string) => {
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
      navigate(fromPath, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : '로그인에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Page>
      <Nav>
        <NavBrand onClick={() => navigate('/')}>
          <NavLogo src="/jazzifylogo.png" alt="" />
          <NavName>Jazzify</NavName>
        </NavBrand>
      </Nav>

      <Body>
        <LeftPanel>
          <LeftContent>
            <Headline>
              재즈를 더 깊이,
              <br />더 빠르게 배우세요
            </Headline>
            <HeadSub>화성학, 코드 분석, 릭 라이브러리를 모두 여기서</HeadSub>

            <Card>
              <SocialBtn type="button" onClick={() => handleSocial('Google')}>
                <GoogleIcon />
                <span>Google 계정으로 계속하기</span>
              </SocialBtn>
              <SocialBtn type="button" onClick={() => handleSocial('Apple')}>
                <AppleIcon />
                <span>Apple 계정으로 계속하기</span>
              </SocialBtn>

              <DividerRow>
                <Line />
                <DividerLabel>또는</DividerLabel>
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
                {error && <ErrorMsg>{error}</ErrorMsg>}
                <ContinueBtn
                  type="submit"
                  disabled={
                    submitting ||
                    (step === 'username' ? !username.trim() : !password)
                  }
                  aria-busy={submitting}
                >
                  {submitting ? (
                    <Spinner aria-label="로딩 중" />
                  ) : step === 'username' ? (
                    '아이디로 계속하기'
                  ) : (
                    '로그인'
                  )}
                </ContinueBtn>
                {step === 'password' && (
                  <BackLink
                    type="button"
                    onClick={() => {
                      setStep('username');
                      setPassword('');
                      setError(null);
                    }}
                  >
                    ← 아이디 다시 입력
                  </BackLink>
                )}
              </Form>
            </Card>

            <HomeLink onClick={() => navigate('/')}>← 홈으로 돌아가기</HomeLink>
          </LeftContent>
        </LeftPanel>

        <PanelDivider />

        <RightPanel>
          <RightText $visible={rtVisible}>{ROTATING[rtIdx]}</RightText>
        </RightPanel>
      </Body>
    </Page>
  );
}

/* ── icons ───────────────────────────────────────────────── */

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

/* ── animations ───────────────────────────────────────────── */

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
          x="11" y="2" width="2" height="5.5" rx="1"
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
  rect { animation: ${spokeFade} 1s linear infinite; }
`;

/* ── layout ───────────────────────────────────────────────── */

const Page = styled.div`
  min-height: 100vh;
  background: ${BG};
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
`;

const Nav = styled.nav`
  height: 60px;
  display: flex;
  align-items: center;
  padding: 0 36px;
  flex-shrink: 0;
`;

const NavBrand = styled.button`
  display: flex;
  align-items: center;
  gap: 9px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
`;

const NavLogo = styled.img`
  width: 30px;
  height: 30px;
  border-radius: 7px;
  object-fit: cover;
`;

const NavName = styled.span`
  font-size: 1.05rem;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: -0.01em;
`;

const Body = styled.div`
  flex: 1;
  display: flex;
  min-height: 0;

  @media (max-width: 768px) {
    flex-direction: column;
  }
`;

const LeftPanel = styled.div`
  width: 42%;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 48px;

  @media (max-width: 768px) {
    width: 100%;
    padding: 32px 24px 48px;
  }
`;

const LeftContent = styled.div`
  width: 100%;
  max-width: 420px;
`;

const Headline = styled.h1`
  font-size: clamp(2rem, 3.2vw, 3rem);
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: -0.025em;
  line-height: 1.12;
  margin: 0 0 14px;
`;

const HeadSub = styled.p`
  font-size: 1rem;
  color: rgba(0, 0, 0, 0.52);
  margin: 0 0 28px;
  line-height: 1.5;
`;

const Card = styled.div`
  background: #fff;
  border-radius: 18px;
  padding: 22px 22px 20px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.07);
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SocialBtn = styled.button`
  width: 100%;
  height: 50px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #fff;
  color: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 500;
  font-family: inherit;
  transition: background 0.1s, border-color 0.1s, transform 0.06s;

  &:hover { background: rgba(0, 0, 0, 0.025); border-color: rgba(0, 0, 0, 0.22); }
  &:active { transform: scale(0.99); }
`;

const DividerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 2px 0;
`;

const Line = styled.span`
  flex: 1;
  height: 1px;
  background: rgba(0, 0, 0, 0.1);
`;

const DividerLabel = styled.span`
  font-size: 13px;
  color: rgba(0, 0, 0, 0.4);
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const Field = styled.div`
  input {
    width: 100%;
    height: 50px;
    border: 1px solid rgba(0, 0, 0, 0.16);
    border-radius: 999px;
    background: #fff;
    padding: 0 22px;
    font-size: 15px;
    font-family: inherit;
    color: #1a1a1a;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.12s;

    &::placeholder { color: rgba(0, 0, 0, 0.38); }
    &:focus { border-color: rgba(0, 0, 0, 0.42); }
    &:disabled { background: #fafafa; color: rgba(0, 0, 0, 0.5); }
  }
`;

const ErrorMsg = styled.div`
  padding: 2px 12px;
  font-size: 12.5px;
  color: #c0392b;
`;

const ContinueBtn = styled.button`
  width: 100%;
  height: 50px;
  border-radius: 999px;
  border: none;
  background: #1a1a1a;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  margin-top: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s, transform 0.06s;

  &:hover:not(:disabled) { opacity: 0.88; }
  &:active:not(:disabled) { transform: scale(0.99); }
  &:disabled { cursor: default; }
  &[aria-busy='true'] { background: rgba(0, 0, 0, 0.18); opacity: 1; }
  &:disabled:not([aria-busy='true']) { opacity: 0.35; }
`;

const BackLink = styled.button`
  border: none;
  background: transparent;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.5);
  cursor: pointer;
  text-align: center;
  font-family: inherit;
  padding: 4px;
  &:hover { color: #000; }
`;

const HomeLink = styled.button`
  display: block;
  margin-top: 18px;
  border: none;
  background: transparent;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
  cursor: pointer;
  font-family: inherit;
  padding: 0;
  &:hover { color: #000; }
`;

const PanelDivider = styled.div`
  width: 1px;
  align-self: stretch;
  background: rgba(0, 0, 0, 0.1);
  flex-shrink: 0;

  @media (max-width: 768px) {
    display: none;
  }
`;

const RightPanel = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 60px 64px;

  @media (max-width: 768px) {
    display: none;
  }
`;

const textFade = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const RightText = styled.p<{ $visible: boolean }>`
  font-family: Georgia, 'Nanum Myeongjo', 'Noto Serif KR', serif;
  font-size: clamp(2.4rem, 4.2vw, 4.8rem);
  font-weight: 400;
  color: #1a1a1a;
  letter-spacing: -0.025em;
  line-height: 1.15;
  text-align: center;
  margin: 0;
  max-width: 640px;
  opacity: ${({ $visible }) => ($visible ? 1 : 0)};
  transform: ${({ $visible }) => ($visible ? 'translateY(0)' : 'translateY(10px)')};
  transition: opacity 0.42s ease, transform 0.42s ease;
  animation: ${textFade} 0.5s ease both;
`;
