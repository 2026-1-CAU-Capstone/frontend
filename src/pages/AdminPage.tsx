import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import LickInputPage from './LickInputPage';
import { YoutubeOnsetParser } from '../components/admin/YoutubeOnsetParser';
import { SymbolicJazzViewer } from '../components/admin/SymbolicJazzViewer';
import { OmnibookViewer } from '../components/admin/OmnibookViewer';

/* ─────────────────────────────────────────────────────────────────────────
 * Admin tools page — internal/test only.
 *
 * Two tabs:
 *   1. Lick JSON Tool  — embeds the existing LickInputPage as-is.
 *   2. YouTube Onset   — record start/end timestamps for a lick from a
 *                         YouTube link, persisted via localStorage so the
 *                         chat's YouTube button picks them up.
 * ──────────────────────────────────────────────────────────────────────── */

type Tab = 'youtube' | 'lickjson' | 'sjs' | 'omnibook';

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>('youtube');
  const navigate = useNavigate();

  return (
    <Page>
      <TopBar>
        <BackBtn onClick={() => navigate('/')}>&#8592; Home</BackBtn>
        <Title>Admin Tools</Title>
        <Note>테스트 단계 전용</Note>
        <TabRow>
          <TabBtn $active={tab === 'youtube'} onClick={() => setTab('youtube')}>
            YouTube Onset Parser
          </TabBtn>
          <TabBtn $active={tab === 'lickjson'} onClick={() => setTab('lickjson')}>
            Lick JSON Tool
          </TabBtn>
          <TabBtn $active={tab === 'sjs'} onClick={() => setTab('sjs')}>
            Symbolic Jazz Standards
          </TabBtn>
          <TabBtn $active={tab === 'omnibook'} onClick={() => setTab('omnibook')}>
            Charlie Parker Omnibook
          </TabBtn>
        </TabRow>
      </TopBar>

      <Content>
        {tab === 'youtube' && <YoutubeOnsetParser />}
        {tab === 'lickjson' && <LickInputPage />}
        {tab === 'sjs' && <SymbolicJazzViewer />}
        {tab === 'omnibook' && <OmnibookViewer />}
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
  padding: 10px 20px;
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
  font-family: 'DM Sans', sans-serif;
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

const Note = styled.span`
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 3px 8px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.05);
`;

const TabRow = styled.div`
  display: flex;
  gap: 4px;
  margin-left: auto;
`;

const TabBtn = styled.button<{ $active: boolean }>`
  padding: 7px 14px;
  border: 1px solid ${({ $active, theme }) => ($active ? theme.colors.gold : theme.colors.border)};
  border-radius: 6px;
  background: ${({ $active, theme }) => ($active ? theme.colors.gold : theme.colors.bgPrimary)};
  color: ${({ $active }) => ($active ? '#fff' : 'inherit')};
  font-family: 'DM Sans', sans-serif;
  font-size: 0.85rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s;
  &:hover {
    border-color: ${({ theme }) => theme.colors.gold};
  }
`;

const Content = styled.div`
  flex: 1;
  overflow: auto;
`;
