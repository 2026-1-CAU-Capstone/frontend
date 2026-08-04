import styled, { keyframes } from 'styled-components';

/* iOS-style account / settings full-screen sheet modeled on the ChatGPT
 * iOS app. Triggered by tapping the avatar in the drawer header. All
 * data here is mock for now — wire to a real account/auth backend later. */

interface Props {
  open: boolean;
  onClose: () => void;
  onLogout?: () => void;
}

const USER = {
  name: 'YoungHyun Choi',
  initials: 'YC',
  email: 'hi20021120@gmail.com',
  phone: '+821027156621',
  plan: 'Free',
};

export function AccountModal({ open, onClose, onLogout }: Props) {
  if (!open) return null;
  return (
    <>
      <Backdrop onClick={onClose} />
      <Sheet onClick={(e) => e.stopPropagation()}>
        <TopBar>
          <CloseBtn onClick={onClose} aria-label="닫기">
            <CloseIcon />
          </CloseBtn>
        </TopBar>

        <AvatarBlock>
          <BigAvatar>
            {USER.initials}
            <AvatarEditBadge>
              <EditIcon />
            </AvatarEditBadge>
          </BigAvatar>
          <Name>{USER.name}</Name>
        </AvatarBlock>

        <SectionLabel>Jazzify 맞춤 설정</SectionLabel>
        <Card>
          <SettingRow>
            <RowIcon><SmileIcon /></RowIcon>
            <RowLabel>개인 맞춤 설정</RowLabel>
            <Chev />
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon><MemoryIcon /></RowIcon>
            <RowLabel>메모리</RowLabel>
            <Chev />
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon><AppsIcon /></RowIcon>
            <RowLabel>앱</RowLabel>
            <Chev />
          </SettingRow>
        </Card>

        <SectionLabel>계정</SectionLabel>
        <Card>
          <SettingRow>
            <RowIcon><MailIcon /></RowIcon>
            <RowLabel>이메일</RowLabel>
            <RowValue>{USER.email}</RowValue>
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon><PhoneIcon /></RowIcon>
            <RowLabel>전화번호</RowLabel>
            <RowValue>{USER.phone}</RowValue>
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon><PlusBoxIcon /></RowIcon>
            <RowLabel>구독</RowLabel>
            <RowValue>{USER.plan}</RowValue>
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon><RestoreIcon /></RowIcon>
            <RowLabel>이전 구매 복원</RowLabel>
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon $color="#7e5cf0"><SparkleIcon /></RowIcon>
            <RowLabel style={{ color: '#7e5cf0' }}>Jazzify Pro로 업그레이드</RowLabel>
          </SettingRow>
        </Card>

        <SectionLabel>테마</SectionLabel>
        <Card>
          <SettingRow>
            <RowIcon><SunIcon /></RowIcon>
            <RowLabel>보기</RowLabel>
            <RowValue>시스템 ⌃⌄</RowValue>
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon><PaletteIcon /></RowIcon>
            <RowLabel>강조 컬러</RowLabel>
            <RowValue>
              <ColorDot $color="#888" /> 기본
            </RowValue>
          </SettingRow>
        </Card>

        <SectionLabel>앱 설정</SectionLabel>
        <Card>
          <SettingRow>
            <RowIcon><GearIcon /></RowIcon>
            <RowLabel>일반</RowLabel>
            <Chev />
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon><BellIcon /></RowIcon>
            <RowLabel>알림</RowLabel>
            <Chev />
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon><VoiceIcon /></RowIcon>
            <RowLabel>음성</RowLabel>
            <Chev />
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon><LockIcon /></RowIcon>
            <RowLabel>안전 및 보안</RowLabel>
            <Chev />
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon><DataIcon /></RowIcon>
            <RowLabel>데이터 제어</RowLabel>
            <Chev />
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon><FamilyIcon /></RowIcon>
            <RowLabel>자녀 보호</RowLabel>
            <Chev />
          </SettingRow>
        </Card>

        <SectionLabel>도움말</SectionLabel>
        <Card>
          <SettingRow>
            <RowIcon><FlagIcon /></RowIcon>
            <RowLabel>앱 문제 신고하기</RowLabel>
            <Chev />
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon><HelpIcon /></RowIcon>
            <RowLabel>도움말 센터</RowLabel>
            <Chev />
          </SettingRow>
          <Divider />
          <SettingRow>
            <RowIcon><InfoIcon /></RowIcon>
            <RowLabel>정보</RowLabel>
            <Chev />
          </SettingRow>
        </Card>

        <Card style={{ marginTop: 16 }}>
          <SettingRow onClick={onLogout}>
            <RowIcon $color="#d32f2f"><LogoutIcon /></RowIcon>
            <RowLabel style={{ color: '#d32f2f', fontWeight: 600 }}>로그아웃</RowLabel>
          </SettingRow>
        </Card>
      </Sheet>
    </>
  );
}

/* ── icons ───────────────────────────────────────────────── */

const CloseIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
    <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
  </svg>
);

const EditIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden>
    <path d="M4 17 L4 20 L7 20 L17 10 L14 7 L4 17 Z M14 7 L17 10 L19 8 L16 5 L14 7 Z" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
  </svg>
);

const SmileIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <circle cx="9" cy="10" r="1.2" fill="currentColor" />
    <circle cx="15" cy="10" r="1.2" fill="currentColor" />
    <path d="M8 14 Q12 17 16 14" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
  </svg>
);

const MemoryIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <path d="M8 4 V2 M12 4 V2 M16 4 V2 M8 22 V20 M12 22 V20 M16 22 V20 M4 8 H2 M4 12 H2 M4 16 H2 M22 8 H20 M22 12 H20 M22 16 H20" stroke="currentColor" strokeWidth="1.4" />
    <path d="M8 9 L10 11 L8 13 M12 9 H16" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const AppsIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    {[5, 12, 19].flatMap((cx) => [5, 12, 19].map((cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" fill="currentColor" />))}
  </svg>
);

const MailIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <path d="M3 7 L12 13 L21 7" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
  </svg>
);

const PhoneIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <path d="M5 4 Q5 3 6 3 H9 L11 8 L9 10 Q11 14 15 16 L17 14 L22 16 V19 Q22 20 21 20 Q12 20 5 13 Q5 12 5 4 Z" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
  </svg>
);

const PlusBoxIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <rect x="4" y="4" width="16" height="16" rx="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <line x1="12" y1="8" x2="12" y2="16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
  </svg>
);

const RestoreIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <path d="M4 12 a8 8 0 1 0 3-6" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    <path d="M4 3 V8 H9" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SparkleIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <path d="M12 3 L13.5 9 L19 10.5 L13.5 12 L12 18 L10.5 12 L5 10.5 L10.5 9 Z" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinejoin="round" />
  </svg>
);

const SunIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <line x1="12" y1="2" x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2" y1="12" x2="5" y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="5" y1="5" x2="7" y2="7" />
      <line x1="17" y1="17" x2="19" y2="19" />
      <line x1="5" y1="19" x2="7" y2="17" />
      <line x1="17" y1="7" x2="19" y2="5" />
    </g>
  </svg>
);

const PaletteIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <path d="M12 3 a9 9 0 0 0 0 18 c1.5 0 2.5-1 2.5-2 c0-1-0.5-1.5-0.5-2.5 c0-1 1-2 2-2 H18 a3 3 0 0 0 3-3 c0-4.5-4-8.5-9-8.5z" stroke="currentColor" strokeWidth="1.7" fill="none" />
    <circle cx="7.5" cy="11" r="1.2" fill="currentColor" />
    <circle cx="11" cy="7" r="1.2" fill="currentColor" />
    <circle cx="15.5" cy="9" r="1.2" fill="currentColor" />
  </svg>
);

const GearIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <path d="M12 1.5 L13 4 L15.5 3 L15 5.5 L17.5 6 L16 8 L18 9.5 L15.5 10 L16 12.5 L13.5 12 L13 14.5 L11 13 L9 14.5 L8.5 12 L6 12.5 L6.5 10 L4 9.5 L6 8 L4.5 6 L7 5.5 L6.5 3 L9 4 L10 1.5 L12 1.5 Z" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinejoin="round" />
  </svg>
);

const BellIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <path d="M6 9 a6 6 0 0 1 12 0 v4 l2 3 H4 l2-3 z" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
    <path d="M10 19 a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
  </svg>
);

const VoiceIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    {[4, 8, 12, 16, 20].map((x, i) => {
      const h = [6, 14, 18, 12, 8][i];
      return <line key={x} x1={x} y1={12 - h / 2} x2={x} y2={12 + h / 2} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />;
    })}
  </svg>
);

const LockIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <rect x="5" y="11" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <path d="M8 11 V7 a4 4 0 0 1 8 0 V11" stroke="currentColor" strokeWidth="1.8" fill="none" />
  </svg>
);

const DataIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <path d="M4 21 a8 8 0 0 1 16 0" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
  </svg>
);

const FamilyIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <circle cx="9" cy="8" r="3" stroke="currentColor" strokeWidth="1.7" fill="none" />
    <circle cx="17" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.7" fill="none" />
    <path d="M3 20 a6 6 0 0 1 12 0" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" />
    <path d="M14 20 a4 4 0 0 1 8 0" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" />
  </svg>
);

const FlagIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <line x1="5" y1="3" x2="5" y2="22" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M5 4 H18 L15 8 L18 12 H5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" />
  </svg>
);

const HelpIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <path d="M9 9 a3 3 0 0 1 6 0 c0 1.5-1.5 2-2 2.5-0.5 0.5-1 1-1 2" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    <circle cx="12" cy="17" r="0.8" fill="currentColor" />
  </svg>
);

const InfoIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" fill="none" />
    <line x1="12" y1="11" x2="12" y2="17" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="7.5" r="0.9" fill="currentColor" />
  </svg>
);

const LogoutIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden>
    <path d="M9 4 H5 a2 2 0 0 0-2 2 v12 a2 2 0 0 0 2 2 h4" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" strokeLinecap="round" />
    <path d="M16 7 L21 12 L16 17 M21 12 H9" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinejoin="round" strokeLinecap="round" />
  </svg>
);

const ColorDot = styled.span<{ $color: string }>`
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: ${({ $color }) => $color};
  margin-right: 6px;
  vertical-align: middle;
`;

const Chev = styled.span`
  width: 9px;
  height: 9px;
  border-right: 1.7px solid ${({ theme }) => theme.colors.border};
  border-bottom: 1.7px solid ${({ theme }) => theme.colors.border};
  transform: rotate(-45deg);
  margin-left: 6px;
  flex-shrink: 0;
`;

/* ── styles ──────────────────────────────────────────────── */

const fadeBg = keyframes`from { opacity: 0 } to { opacity: 1 }`;
const slideUp = keyframes`from { transform: translateY(100%) } to { transform: translateY(0) }`;

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: ${({ theme }) => theme.colors.scrim};
  z-index: 300;
  animation: ${fadeBg} 0.18s ease both;
`;

const Sheet = styled.div`
  position: fixed;
  left: 0;
  right: 0;
  /* Lower the sheet — leaves more of the drawer visible above. Avatar
   *  block + 3 sections still fit comfortably; internal overflow-y handles
   *  smaller phones / longer content. */
  top: max(120px, calc(env(safe-area-inset-top, 0px) + 80px));
  bottom: 0;
  z-index: 301;
  background: ${({ theme }) => theme.colors.surfaceSunken};
  border-radius: 22px 22px 0 0;
  padding: 12px 16px calc(20px + env(safe-area-inset-bottom, 0px));
  overflow-y: auto;
  animation: ${slideUp} 0.26s cubic-bezier(0.2, 0.8, 0.2, 1) both;
`;

const TopBar = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-bottom: 6px;
`;

const CloseBtn = styled.button`
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: none;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  &:active { transform: scale(0.94); }
`;

const AvatarBlock = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin: 8px 0 28px;
`;

const BigAvatar = styled.div`
  position: relative;
  width: 92px;
  height: 92px;
  border-radius: 50%;
  background: linear-gradient(135deg, #d2a35a, #b8860b);
  color: #fff;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 34px;
  font-weight: 600;
  letter-spacing: 0.02em;
`;

const AvatarEditBadge = styled.span`
  position: absolute;
  bottom: 0;
  right: 0;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.surface};
  border: 2px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textPrimary};
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

const Name = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 22px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SectionLabel = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 16px 6px 6px;
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 14px;
  overflow: hidden;
`;

const SettingRow = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 14px;
  cursor: pointer;
  transition: background 0.1s;
  &:active { background: ${({ theme }) => theme.colors.hover}; }
`;

const RowIcon = styled.div<{ $color?: string }>`
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${({ $color }) => $color || 'rgba(0, 0, 0, 0.75)'};
  flex-shrink: 0;
`;

const RowLabel = styled.div`
  flex: 1;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 16px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const RowValue = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 15px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Divider = styled.hr`
  margin: 0 0 0 52px;
  border: none;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
`;
