import { useNavigate } from 'react-router-dom';
import { BackButton } from '../../components/common/BackButton';
import styled from 'styled-components';
import { YoutubeOnsetParser } from '../components/YoutubeOnsetParser';
import { AppSidebar } from '../../components/layout/AppSidebar';

export default function YoutubeOnsetPage() {
  const navigate = useNavigate();
  return (
    <Page>
      <AppSidebar />
      <PageBody>
        <TopBar>
          <BackButton onClick={() => navigate(-1)} label="뒤로" />
          <Title>YouTube Onset Parser</Title>
        </TopBar>
        <Content>
          <YoutubeOnsetParser />
        </Content>
      </PageBody>
    </Page>
  );
}

const Page = styled.div`
  display: flex;
  flex-direction: row;
  height: 100vh;
  height: 100dvh;
  width: 100%;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  overflow: hidden;
`;

const PageBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
`;

const TopBar = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: calc(env(safe-area-inset-top, 0px) + 10px) 16px 10px;  /* 가로 여백 16px — Solo DB 상단바 기준으로 통일 */
  background: ${({ theme }) => theme.colors.barTop};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
`;

const Title = styled.h1`
  font-size: 1.05rem;
  font-weight: 700;
  margin: 0;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Content = styled.div`
  flex: 1;
  overflow: auto;
`;
