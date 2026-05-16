import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { YoutubeOnsetParser } from '../components/common/YoutubeOnsetParser';

export default function YoutubeOnsetPage() {
  const navigate = useNavigate();
  return (
    <Page>
      <TopBar>
        <BackBtn onClick={() => navigate(-1)}>← Back</BackBtn>
        <Title>YouTube Onset Parser</Title>
      </TopBar>
      <Content>
        <YoutubeOnsetParser />
      </Content>
    </Page>
  );
}

const Page = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  height: 100dvh;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  overflow: hidden;
`;

const TopBar = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: calc(env(safe-area-inset-top, 0px) + 10px) 20px 10px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
`;

const BackBtn = styled.button`
  padding: 6px 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  cursor: pointer;
  &:hover { border-color: ${({ theme }) => theme.colors.gold}; }
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
