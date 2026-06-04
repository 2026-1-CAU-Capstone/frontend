import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { login, getCachedUser } from '../api/auth';
import { BrandLogoImage } from '../components/common/BrandLogoImage';

const BG = '#f5f1e9';

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

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => usernameRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);

  const handleSocial = (name: string) => {
    setError(`${name} 로그인은 곧 지원됩니다.`);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) return;
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

  const canSubmit = !!username.trim() && !!password && !submitting;

  return (
    <Page>
      <Brand onClick={() => navigate('/')}>
        <BrandLogoImage height={34} scaleX={1.05} />
      </Brand>

      <Center>
        <Headline>
          더 깊이 듣고,
          <br />더 빠르게 배우세요
        </Headline>
        <SubHead>채팅으로 분석하고, 라이브러리로 연습하세요</SubHead>

        <Card>
          <SocialBtn type="button" onClick={() => handleSocial('Google')}>
            <GoogleIcon />
            <span>Google로 계속하기</span>
          </SocialBtn>

          <OrLabel>또는</OrLabel>

          <Form onSubmit={submit}>
            <input
              ref={usernameRef}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="아이디를 입력하세요"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={submitting}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="비밀번호를 입력하세요"
              autoComplete="current-password"
              disabled={submitting}
            />
            {error && <ErrorMsg>{error}</ErrorMsg>}
            <ContinueBtn type="submit" disabled={!canSubmit} aria-busy={submitting}>
              {submitting ? <Spinner aria-label="로딩 중" /> : '로그인'}
            </ContinueBtn>
          </Form>
        </Card>

        <HomeLink onClick={() => navigate('/')}>← 홈으로 돌아가기</HomeLink>
      </Center>
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
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Pretendard', sans-serif;
`;

const Brand = styled.button`
  position: absolute;
  top: 28px;
  left: 36px;
  display: flex;
  align-items: center;
  gap: 9px;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;

  @media (max-width: 600px) {
    top: 20px;
    left: 20px;
  }
`;

const Center = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 96px 24px 48px;
  box-sizing: border-box;
`;

const Headline = styled.h1`
  font-size: clamp(2.2rem, 4.4vw, 3.6rem);
  font-weight: 400;
  color: #1a1a1a;
  letter-spacing: -0.02em;
  line-height: 1.18;
  text-align: center;
  margin: 0 0 18px;
`;

const SubHead = styled.p`
  font-size: clamp(1rem, 1.6vw, 1.2rem);
  font-weight: 600;
  color: #1a1a1a;
  text-align: center;
  margin: 0 0 36px;
  letter-spacing: -0.01em;
`;

const Card = styled.div`
  width: 100%;
  max-width: 460px;
  background: rgba(255, 255, 255, 0.42);
  border: 1px solid rgba(0, 0, 0, 0.06);
  border-radius: 20px;
  padding: 26px 26px 28px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  box-sizing: border-box;
`;

const SocialBtn = styled.button`
  width: 100%;
  height: 54px;
  border-radius: 12px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #fff;
  color: #1a1a1a;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  transition: background 0.1s, border-color 0.1s, transform 0.06s;

  &:hover { background: rgba(0, 0, 0, 0.02); border-color: rgba(0, 0, 0, 0.2); }
  &:active { transform: scale(0.99); }
`;

const OrLabel = styled.div`
  text-align: center;
  font-size: 13.5px;
  color: rgba(0, 0, 0, 0.42);
  margin: 0;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 10px;

  input {
    width: 100%;
    height: 54px;
    border: 1px solid rgba(0, 0, 0, 0.14);
    border-radius: 12px;
    background: #fff;
    padding: 0 18px;
    font-size: 15px;
    font-family: inherit;
    color: #1a1a1a;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.12s, box-shadow 0.12s;

    &::placeholder { color: rgba(0, 0, 0, 0.4); }
    &:focus { border-color: rgba(0, 0, 0, 0.5); box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.04); }
    &:disabled { background: #fafafa; color: rgba(0, 0, 0, 0.5); }
  }
`;

const ErrorMsg = styled.div`
  padding: 0 4px;
  font-size: 12.5px;
  color: #c0392b;
`;

const ContinueBtn = styled.button`
  width: 100%;
  height: 54px;
  border-radius: 12px;
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
  &[aria-busy='true'] { background: rgba(0, 0, 0, 0.22); opacity: 1; }
  &:disabled:not([aria-busy='true']) { opacity: 0.32; }
`;

const HomeLink = styled.button`
  margin-top: 24px;
  border: none;
  background: transparent;
  font-size: 13.5px;
  color: rgba(0, 0, 0, 0.45);
  cursor: pointer;
  font-family: inherit;
  padding: 6px;
  &:hover { color: #000; }
`;
