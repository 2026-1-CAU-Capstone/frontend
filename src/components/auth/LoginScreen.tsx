import { useState, type FormEvent } from 'react';
import styled from 'styled-components';
import { login, signup } from '../../api/auth';
import { BrandLogoImage } from '../common/BrandLogoImage';

/* Two-step auth flow:
 *   step='form' — username + password (and name for signup)
 *   step='code' — "받은 편지함을 확인하세요" verification screen mirroring the
 *                 OpenAI/ChatGPT magic-code pattern. The actual backend call
 *                 happens on this step's submit (Jazzify backend doesn't have
 *                 a real OTP endpoint yet, so the code field is UI-only and
 *                 any non-empty value advances).
 *
 * On final success onLogin() fires so the parent swaps to the logged-in UI. */

interface Props {
  onLogin: () => void;
  onClose?: () => void;
}

type Mode = 'login' | 'signup';
type Step = 'form' | 'code';

export function LoginScreen({ onLogin, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [step, setStep] = useState<Step>('form');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = !submitting && username.trim().length > 0 && password.length > 0
    && (mode === 'login' || name.trim().length > 0);

  const canVerify = !submitting && code.trim().length > 0;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    // Move to the verification step — backend call happens after the code
    // is "confirmed" so the flow visually matches the inbox-check pattern.
    setStep('code');
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (!canVerify) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === 'login') {
        await login(username.trim(), password);
      } else {
        await signup(name.trim(), username.trim(), password);
      }
      onLogin();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '인증에 실패했습니다.';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const goBackToForm = () => {
    setStep('form');
    setCode('');
    setError(null);
  };

  return (
    <Wrapper>
      <TopBar>
        <CircleBtn
          aria-label={step === 'code' ? '뒤로' : '닫기'}
          onClick={step === 'code' ? goBackToForm : onClose}
        >
          {step === 'code' ? <BackIcon /> : <CloseIcon />}
        </CircleBtn>
        <UrlText>jazzify.app</UrlText>
        <CircleBtn aria-label="reader">
          <ReaderIcon />
        </CircleBtn>
      </TopBar>

      <Content>
        <BrandLogoImage height={110} onClick={onClose} />

        {step === 'form' ? (
          <>
            <Heading>{mode === 'login' ? '로그인' : '회원 가입'}</Heading>
            <Subhead>
              개인화된 코드 분석, 릭 추천, 솔로 생성 등<br />Jazzify의 모든 기능을 이용할 수 있습니다.
            </Subhead>

            <Form onSubmit={submit}>
              {mode === 'signup' && (
                <FloatField>
                  <FieldLabel>이름</FieldLabel>
                  <FieldInput
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoComplete="name"
                    disabled={submitting}
                  />
                </FloatField>
              )}
              <FloatField>
                <FieldLabel>아이디 (username)</FieldLabel>
                <FieldInput
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  disabled={submitting}
                />
              </FloatField>
              <FloatField>
                <FieldLabel>비밀번호</FieldLabel>
                <FieldInput
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  disabled={submitting}
                />
              </FloatField>
              {error && <ErrorMsg>{error}</ErrorMsg>}
              <PrimaryBtn type="submit" disabled={!canSubmit}>
                {mode === 'login' ? '로그인' : '계속'}
              </PrimaryBtn>
            </Form>

            <DividerRow>
              <DividerLine />
              <DividerText>또는</DividerText>
              <DividerLine />
            </DividerRow>

            <SocialBtn type="button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
              {mode === 'login' ? '계정이 없으신가요? 회원 가입' : '이미 계정이 있으신가요? 로그인'}
            </SocialBtn>
          </>
        ) : (
          <>
            <Heading>받은 편지함을 확인하세요</Heading>
            <Subhead>
              {username} 주소로 받은<br />인증 코드를 입력하세요
            </Subhead>

            <Form onSubmit={verify}>
              <FloatField>
                <FieldLabel>코드</FieldLabel>
                <FieldInput
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  autoFocus
                  disabled={submitting}
                />
              </FloatField>
              {error && <ErrorMsg>{error}</ErrorMsg>}
              <PrimaryBtn type="submit" disabled={!canVerify}>
                {submitting ? '확인 중…' : '계속'}
              </PrimaryBtn>
            </Form>

            <ResendBtn type="button" onClick={() => { /* no-op until backend OTP exists */ }}>
              이메일 다시 보내기
            </ResendBtn>
          </>
        )}

        <Footer>
          <a href="#terms">이용약관</a>
          <FooterSep />
          <a href="#privacy">개인정보 보호 정책</a>
        </Footer>
      </Content>
    </Wrapper>
  );
}

/* ── icons ───────────────────────────────────────────────── */

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

const BackIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <path d="M15 5 L8 12 L15 19" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const ReaderIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <line x1="5" y1="9" x2="19" y2="9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="5" y1="13" x2="19" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="5" y1="17" x2="14" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

/* ── styles ──────────────────────────────────────────────── */

const Wrapper = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1000;
  background: #fff;
  font-family: ${({ theme }) => theme.fonts.ui};
  display: flex;
  flex-direction: column;
  overflow-y: auto;
`;

const TopBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: max(14px, calc(env(safe-area-inset-top, 0px) + 8px)) 16px 14px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
`;

const CircleBtn = styled.button`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.06);
  color: rgba(0, 0, 0, 0.75);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
`;

const UrlText = styled.div`
  font-size: 14px;
  color: rgba(0, 0, 0, 0.7);
  font-weight: 500;
`;

const Content = styled.div`
  flex: 1;
  padding: 32px 24px 32px;
  display: flex;
  flex-direction: column;
`;

/* Brand text replaced by <BrandLogoImage> — kept as a comment so the styled
 * import block remains a clean diff. */

const Heading = styled.h1`
  text-align: center;
  font-size: 32px;
  font-weight: 800;
  color: #1a1a1a;
  margin: 0 0 16px;
  letter-spacing: -0.015em;
  line-height: 1.2;
`;

const Subhead = styled.p`
  text-align: center;
  font-size: 15px;
  line-height: 1.55;
  color: rgba(0, 0, 0, 0.55);
  margin: 0 0 36px;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 14px;
`;

const FloatField = styled.div`
  position: relative;
  border: 1.5px solid #3978f7;
  border-radius: 999px;
  padding: 18px 22px 12px;
  transition: border-color 0.15s;
`;

const FieldLabel = styled.label`
  position: absolute;
  top: -9px;
  left: 22px;
  background: #fff;
  padding: 0 6px;
  font-size: 12px;
  color: #3978f7;
  font-weight: 500;
`;

const FieldInput = styled.input`
  width: 100%;
  border: none;
  outline: none;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 16px;
  color: #1a1a1a;
  background: transparent;
`;

const ErrorMsg = styled.div`
  font-size: 13px;
  color: #c0392b;
  padding: 4px 10px 0;
`;

const PrimaryBtn = styled.button`
  width: 100%;
  padding: 18px;
  border-radius: 999px;
  border: none;
  background: #1a1a1a;
  color: #fff;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 16px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s, transform 0.1s;
  &:hover:not(:disabled) { opacity: 0.9; }
  &:active:not(:disabled) { transform: scale(0.98); }
  &:disabled { opacity: 0.4; cursor: default; }
`;

const DividerRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 28px 0 18px;
`;

const DividerLine = styled.hr`
  flex: 1;
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.12);
`;

const DividerText = styled.div`
  font-size: 14px;
  color: rgba(0, 0, 0, 0.5);
`;

const ResendBtn = styled.button`
  align-self: center;
  margin-top: 20px;
  background: transparent;
  border: none;
  color: #1a1a1a;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 15px;
  font-weight: 500;
  cursor: pointer;
  padding: 8px 12px;
  transition: opacity 0.15s;
  &:hover { opacity: 0.7; }
`;

const SocialBtn = styled.button`
  width: 100%;
  padding: 16px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  background: #fff;
  color: #1a1a1a;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 16px;
  font-weight: 500;
  cursor: pointer;
  margin-bottom: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  transition: background 0.12s, transform 0.1s;
  &:hover { background: rgba(0, 0, 0, 0.02); }
  &:active { transform: scale(0.99); }
`;

const Footer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: auto;
  padding-top: 32px;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.55);

  a {
    color: inherit;
    text-decoration: underline;
  }
`;

const FooterSep = styled.span`
  width: 1px;
  height: 12px;
  background: rgba(0, 0, 0, 0.25);
`;
