import { useState, useEffect, useRef, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { login, signup, getCachedUser } from '../api/auth';
import { BrandLogoImage } from '../components/common/BrandLogoImage';

/* `studio` = 내부 스튜디오의 로그인. 소셜 로그인과 회원가입을 **아예 렌더하지
 * 않는다** — 스튜디오에 들어올 수 있는 계정은 서버에서 ADMIN 등급을 받은 것뿐이고
 * (AdminRoute + 백엔드 hasAnyRole), 거기서 새 계정을 만들 이유가 없다. 버튼을
 * 남겨두면 "가입하면 들어갈 수 있나" 하는 오해만 준다. */
export default function LoginPage({ studio = false }: { studio?: boolean } = {}) {
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

  /* 로그인 ↔ 회원가입 한 화면 토글. 회원가입은 name 입력이 하나 더 붙고,
   * 성공하면 api/auth 의 signup() 이 곧바로 login() 까지 태워 토큰을 받으므로
   * 여기서는 동일하게 fromPath 로 보내면 된다. */
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const usernameRef = useRef<HTMLInputElement>(null);
  /* 마운트 시 자동 포커스하지 않는다 — 로그인 화면에서 키보드가 곧바로 튀어
   * 올라오면 헤드라인/로고가 가려진다. 사용자가 입력창을 직접 탭할 때 뜬다. */

  const isSignup = mode === 'signup';

  const switchMode = (next: 'login' | 'signup') => {
    setMode(next);
    setError(null);
    setPassword('');
    setPasswordConfirm('');
    if (next === 'login') setName('');
  };

  const handleSocial = (name: string) => {
    setError(`${name} 로그인은 곧 지원됩니다.`);
  };

  /* 백엔드 SignupRequest 제약(OpenAPI)과 동일하게 클라에서도 먼저 막는다:
   * name 1~50 · username 2~10 · password 8~20 + 영문/숫자 각 1자 이상. */
  const validateSignup = (): string | null => {
    const n = name.trim();
    const u = username.trim();
    if (n.length < 1 || n.length > 50) return '이름은 1~50자로 입력해 주세요.';
    if (u.length < 2 || u.length > 10) return '아이디는 2~10자로 입력해 주세요.';
    if (password.length < 8 || password.length > 20) return '비밀번호는 8~20자로 입력해 주세요.';
    if (!/^(?=.*[A-Za-z])(?=.*\d).+$/.test(password)) return '비밀번호는 영문과 숫자를 모두 포함해야 합니다.';
    if (password !== passwordConfirm) return '비밀번호가 일치하지 않습니다.';
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!username.trim() || !password) return;
    if (isSignup) {
      const invalid = validateSignup();
      if (invalid) { setError(invalid); return; }
    }
    setSubmitting(true);
    try {
      if (isSignup) {
        await signup(name.trim(), username.trim(), password);
      } else {
        await login(username.trim(), password);
      }
      navigate(fromPath, { replace: true });
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : isSignup ? '회원가입에 실패했습니다.' : '로그인에 실패했습니다.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const canSubmit =
    !!username.trim() && !!password
    && (!isSignup || (!!name.trim() && password === passwordConfirm))
    && !submitting;

  return (
    <Page>
      <Center>
        <BrandMark onClick={() => navigate('/')}>
          <BrandLogoImage height={40} scaleX={1.05} />
        </BrandMark>
        <Headline>
          {studio ? <>Jazzify<br />Studio</> : <>더 깊이 듣고,<br />더 빠르게 배우세요</>}
        </Headline>
        <SubHead>
          {studio ? '내부 제작 스튜디오 — 관리자 계정만 들어올 수 있습니다'
                  : '채팅으로 분석하고, 라이브러리로 연습하세요'}
        </SubHead>

        <Card>
          {!studio && (
            <>
              <SocialBtn type="button" onClick={() => handleSocial('Google')}>
                <GoogleIcon />
                <span>Google로 계속하기</span>
              </SocialBtn>

              <OrLabel>또는</OrLabel>
            </>
          )}

          <Form onSubmit={submit}>
            {isSignup && (
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="이름을 입력하세요"
                autoComplete="name"
                maxLength={50}
                disabled={submitting}
              />
            )}
            <input
              ref={usernameRef}
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={isSignup ? '아이디 (2~10자)' : '아이디를 입력하세요'}
              autoComplete={isSignup ? 'off' : 'username'}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={isSignup ? 10 : undefined}
              disabled={submitting}
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignup ? '비밀번호 (8~20자, 영문+숫자)' : '비밀번호를 입력하세요'}
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              maxLength={isSignup ? 20 : undefined}
              disabled={submitting}
            />
            {isSignup && (
              <input
                type="password"
                value={passwordConfirm}
                onChange={(e) => setPasswordConfirm(e.target.value)}
                placeholder="비밀번호 확인"
                autoComplete="new-password"
                maxLength={20}
                disabled={submitting}
                aria-invalid={!!passwordConfirm && password !== passwordConfirm}
              />
            )}
            {isSignup && !!passwordConfirm && password !== passwordConfirm && (
              <FieldHint>비밀번호가 일치하지 않습니다.</FieldHint>
            )}
            {error && <ErrorMsg>{error}</ErrorMsg>}
            <ContinueBtn type="submit" disabled={!canSubmit} aria-busy={submitting}>
              {submitting ? <Spinner aria-label="로딩 중" /> : isSignup ? '회원가입' : '로그인'}
            </ContinueBtn>
          </Form>

          {!studio && (
            <SwitchRow>
              {isSignup ? '이미 계정이 있으신가요?' : '아직 계정이 없으신가요?'}
              <SwitchLink type="button" onClick={() => switchMode(isSignup ? 'login' : 'signup')} disabled={submitting}>
                {isSignup ? '로그인' : '회원가입'}
              </SwitchLink>
            </SwitchRow>
          )}
        </Card>
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
  background: ${({ theme }) => theme.colors.pageWarm};
  display: flex;
  flex-direction: column;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Pretendard', sans-serif;
`;

/* 로고 — 헤드라인 바로 위 중앙. 탭하면 홈으로. */
const BrandMark = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;
  margin-bottom: 18px;
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
  color: ${({ theme }) => theme.colors.textPrimary};
  letter-spacing: -0.02em;
  line-height: 1.18;
  text-align: center;
  margin: 0 0 18px;
`;

const SubHead = styled.p`
  font-size: clamp(1rem, 1.6vw, 1.2rem);
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  text-align: center;
  margin: 0 0 36px;
  letter-spacing: -0.01em;
`;

const Card = styled.div`
  width: 100%;
  max-width: 460px;
  background: ${({ theme }) => (theme.mode === 'dark' ? 'rgba(255, 255, 255, 0.05)' : 'rgba(255, 255, 255, 0.42)')};
  border: 1px solid ${({ theme }) => theme.colors.border};
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
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  cursor: pointer;
  font-size: 15px;
  font-weight: 600;
  font-family: inherit;
  transition: background 0.1s, border-color 0.1s, transform 0.06s;

  &:hover { background: ${({ theme }) => theme.colors.hover}; border-color: ${({ theme }) => theme.colors.border}; }
  &:active { transform: scale(0.99); }
`;

const OrLabel = styled.div`
  text-align: center;
  font-size: 13.5px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 0;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 10px;

  input {
    width: 100%;
    height: 54px;
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 12px;
    background: ${({ theme }) => theme.colors.surface};
    padding: 0 18px;
    font-size: 15px;
    font-family: inherit;
    color: ${({ theme }) => theme.colors.textPrimary};
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.12s, box-shadow 0.12s;

    &::placeholder { color: ${({ theme }) => theme.colors.textSecondary}; }
    &:focus { border-color: ${({ theme }) => theme.colors.border}; box-shadow: 0 0 0 3px rgba(0, 0, 0, 0.04); }
    &:disabled { background: ${({ theme }) => theme.colors.surfaceSunken}; color: ${({ theme }) => theme.colors.textSecondary}; }
  }
`;

const ErrorMsg = styled.div`
  padding: 0 4px;
  font-size: 12.5px;
  color: ${({ theme }) => theme.colors.danger};
`;

/* 입력 바로 아래 실시간 안내(비밀번호 불일치 등) — ErrorMsg 보다 조용한 톤. */
const FieldHint = styled.div`
  margin-top: -4px;
  padding: 0 4px;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.danger};
`;

/* 로그인 ↔ 회원가입 전환 — 카드 하단 중앙. */
const SwitchRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 13.5px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const SwitchLink = styled.button`
  border: none;
  background: transparent;
  padding: 0;
  font-size: 13.5px;
  font-weight: 700;
  font-family: inherit;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  text-decoration: underline;
  text-underline-offset: 2px;

  &:hover:not(:disabled) { opacity: 0.7; }
  &:disabled { cursor: default; opacity: 0.4; }
`;

const ContinueBtn = styled.button`
  width: 100%;
  height: 54px;
  border-radius: 12px;
  border: none;
  background: ${({ theme }) => theme.colors.inkSurface};
  color: ${({ theme }) => theme.colors.onInk};
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
  &[aria-busy='true'] { background: ${({ theme }) => theme.colors.border}; opacity: 1; }
  &:disabled:not([aria-busy='true']) { opacity: 0.32; }
`;
