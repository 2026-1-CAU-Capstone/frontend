import { useState, useEffect } from 'react';
import { BackButton } from '../components/common/BackButton';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { getCachedUser, logout as apiLogout } from '../api/auth';
import { listChordProjects } from '../api/chordProjects';
import { listSheetProjects } from '../api/sheetProjects';
import { loadUserLicksSync } from '../data/lickData';

export default function UserProfilePage() {
  const navigate = useNavigate();
  const authUser = getCachedUser();

  const [chordCount, setChordCount] = useState(0);
  const [sheetCount, setSheetCount] = useState(0);
  const lickCount = loadUserLicksSync().length;

  useEffect(() => {
    Promise.all([
      listChordProjects({ size: 1 }).then(p => setChordCount(p.totalElements || 0)).catch(() => {}),
      listSheetProjects({ size: 1 }).then(p => setSheetCount(p.totalElements || 0)).catch(() => {}),
    ]);
  }, []);

  const handleLogout = async () => {
    await apiLogout();
    navigate('/login', { replace: true });
  };

  return (
    <Page>
      <Header>
        <HeaderTopRow>
          <BackButton onClick={() => navigate(-1)} label="뒤로" />
          <HeaderTitle>프로필</HeaderTitle>
        </HeaderTopRow>
      </Header>

      <Content>
        {/* ── Profile Header ── */}
        <ProfileHeader>
          <ProfileInfo>
            <UserName>{authUser?.name ?? authUser?.username ?? '사용자'}</UserName>
            <Greeting>오늘도 재즈를 즐기고 있나요!</Greeting>
            <EditProfile type="button" onClick={() => navigate('/edit-profile')}>
              정보 수정
            </EditProfile>
          </ProfileInfo>
          <AvatarBox>
            {(authUser?.name ?? authUser?.username ?? '?').charAt(0).toUpperCase()}
          </AvatarBox>
        </ProfileHeader>

        {/* ── Subscription Card ── */}
        <SubCard>
          <SubInfo>
            <SubLogo>♪</SubLogo>
            <SubText>프리미엄</SubText>
          </SubInfo>
          <UpgradeBtn type="button">업그레이드</UpgradeBtn>
        </SubCard>

        {/* ── Stats ── */}
        <StatsGrid>
          <StatItem>
            <StatValue>{chordCount}</StatValue>
            <StatLabel>코드 차트</StatLabel>
          </StatItem>
          <StatItem>
            <StatValue>{sheetCount}</StatValue>
            <StatLabel>악보</StatLabel>
          </StatItem>
          <StatItem>
            <StatValue>{lickCount}</StatValue>
            <StatLabel>릭</StatLabel>
          </StatItem>
        </StatsGrid>

        {/* ── Menu Tabs ── */}
        <MenuTabs>
          <MenuTab type="button">내 차트</MenuTab>
          <Divider />
          <MenuTab type="button">내 악보</MenuTab>
          <Divider />
          <MenuTab type="button">내 릭</MenuTab>
        </MenuTabs>

        {/* ── Quick Actions ── */}
        <ActionSection>
          <ActionHeading>
            <ActionTitle>즐겨찾기</ActionTitle>
            <ActionMore type="button">0개 →</ActionMore>
          </ActionHeading>
          <ActionDesc>자주 사용하는 차트를 저장해보세요.</ActionDesc>
        </ActionSection>

        {/* ── Footer Tabs ── */}
        <FooterTabs>
          <FooterTab type="button">♡ 좋아요</FooterTab>
          <Divider />
          <FooterTab type="button">💬 피드백</FooterTab>
          <Divider />
          <FooterTab type="button">❓ Q&A</FooterTab>
        </FooterTabs>

        {/* ── Logout ── */}
        <LogoutSection>
          <LogoutBtn type="button" onClick={handleLogout}>로그아웃</LogoutBtn>
        </LogoutSection>
      </Content>
    </Page>
  );
}

const Page = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.barBelow};
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Pretendard', sans-serif;
`;

/* 헤더 레이아웃은 "내 코드 차트"(MyChordChartsPage) 와 동일 패턴 —
 * safe-area-inset-top 을 더해야 노치/다이나믹 아일랜드 기기에서 뒤로가기
 * 버튼이 상태바에 바짝 붙지 않는다. */
const Header = styled.div`
  padding: calc(env(safe-area-inset-top, 0px) + 12px) 16px 14px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.barTop};
`;

const HeaderTopRow = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

const HeaderTitle = styled.h1`
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  padding-left: 12px;
  font-size: 20px;
  font-weight: 800;
  letter-spacing: -0.01em;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Content = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 20px 16px 40px;
`;

const ProfileHeader = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
`;

const ProfileInfo = styled.div`
  flex: 1;
`;

const UserName = styled.div`
  font-size: 18px;
  font-weight: 700;
  color: #5b3afd;
  margin-bottom: 2px;
`;

const Greeting = styled.div`
  font-size: 16px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: 8px;
`;

const EditProfile = styled.button`
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;

  &:active { opacity: 0.6; }
`;

const AvatarBox = styled.div`
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: linear-gradient(135deg, #ffd89b 0%, #19547b 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
`;

const SubCard = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  background: ${({ theme }) => theme.colors.surfaceSunken};
  border-radius: 12px;
`;

const SubInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const SubLogo = styled.div`
  font-size: 18px;
`;

const SubText = styled.div`
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const UpgradeBtn = styled.button`
  padding: 8px 18px;
  background: #5b3afd;
  color: #fff;
  border: none;
  border-radius: 20px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;

  &:active { opacity: 0.8; }
`;

const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0;
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  padding: 20px 0;
`;

const StatItem = styled.div`
  text-align: center;
  padding: 0 8px;

  &:not(:last-child) {
    border-right: 1px solid ${({ theme }) => theme.colors.border};
  }
`;

const StatValue = styled.div`
  font-size: 22px;
  font-weight: 700;
  color: #5b3afd;
  margin-bottom: 4px;
`;

const StatLabel = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const MenuTabs = styled.div`
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 12px;
  padding: 12px 0;
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const MenuTab = styled.button`
  flex: 1;
  padding: 8px 12px;
  border: none;
  background: transparent;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;

  &:active { opacity: 0.6; }
`;

const Divider = styled.div`
  width: 1px;
  height: 20px;
  background: ${({ theme }) => theme.colors.surfaceSunken};
`;

const ActionSection = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 12px;
  padding: 16px;
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const ActionHeading = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
`;

const ActionTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const ActionMore = styled.button`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  border: none;
  background: transparent;
  cursor: pointer;
  padding: 0;

  &:active { opacity: 0.6; }
`;

const ActionDesc = styled.div`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const FooterTabs = styled.div`
  display: flex;
  justify-content: space-around;
  align-items: center;
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 12px;
  padding: 12px 0;
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const FooterTab = styled.button`
  flex: 1;
  padding: 8px 12px;
  border: none;
  background: transparent;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;

  &:active { opacity: 0.6; }
`;

const LogoutSection = styled.div`
  padding-top: 12px;
`;

const LogoutBtn = styled.button`
  width: 100%;
  padding: 12px;
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  font-size: 14px;
  color: #e74c3c;
  font-weight: 600;
  cursor: pointer;

  &:active { opacity: 0.7; }
`;
