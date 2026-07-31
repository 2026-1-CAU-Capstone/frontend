import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import styled from 'styled-components';
import { LeadSheet } from '../components/leadsheet/LeadSheet';
import { NoteSheet } from '../components/notesheet/NoteSheet';
import { decodeShare } from '../lib/share/chartShare';
import { displayKeyToProjectKey, leadSheetToProgression } from '../lib/leadSheetChordEdit';
import { addChordProjectChords, analyzeChordProject, createChordProject } from '../api/chordProjects';
import { getAccessToken } from '../api/auth';

/* Public read-only viewer for a shared chart.
 *
 * Unauthenticated: the chart travels in the URL hash (`#/v?d=…`), decoded
 * client-side. Anyone with the link can view; for chord charts a logged-in user
 * can clone it into their library. Note sheets are view-only — there's no
 * backend "create from raw notes" path (SheetProjects come from OMR uploads),
 * so cloning waits on the backend share/import work (BR-2). */

const Page = styled.div`
  min-height: 100vh;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  display: flex;
  flex-direction: column;
  align-items: center;
`;

const TopBar = styled.header`
  width: 100%;
  max-width: 960px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  box-sizing: border-box;
  /* 페이지 최상단 바 — 전 페이지 공통 회색(이 페이지엔 배경이 아예 없었다). */
  background: ${({ theme }) => theme.colors.barTop};
`;

const Wordmark = styled.button`
  border: none;
  background: none;
  cursor: pointer;
  font-weight: 800;
  font-size: 18px;
  letter-spacing: -0.02em;
  color: ${({ theme }) => theme.colors.textPrimary};
  span { color: ${({ theme }) => theme.colors.gold}; }
`;

const OpenAppLink = styled.button`
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 13px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
`;

const Content = styled.main<{ $padBottom: boolean }>`
  width: 100%;
  max-width: 960px;
  padding: ${({ $padBottom }) => ($padBottom ? '8px 20px 120px' : '8px 20px 40px')};
  box-sizing: border-box;
`;

const TitleBlock = styled.div`
  margin: 8px 0 20px;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.02em;
`;

const SubMeta = styled.div`
  margin-top: 6px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
`;

const ChartWrap = styled.div`
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 16px;
  padding: 16px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  box-shadow: ${({ theme }) => theme.shadows.sm};
`;

const ActionBar = styled.div`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  justify-content: center;
  gap: 12px;
  padding: 14px 20px calc(14px + env(safe-area-inset-bottom));
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.04);
`;

const CloneBtn = styled.button`
  border: none;
  border-radius: 999px;
  padding: 13px 28px;
  font-size: 15px;
  font-weight: 700;
  color: #fff;
  background: ${({ theme }) => theme.colors.gold};
  cursor: pointer;
  width: 100%;
  max-width: 420px;
  &:disabled { opacity: 0.6; cursor: default; }
`;

const ErrorText = styled.p`
  color: ${({ theme }) => theme.colors.dominant};
  font-size: 13px;
  text-align: center;
  margin: 8px 0 0;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 80px 24px;
  h2 { font-size: 20px; font-weight: 700; margin: 0 0 8px; }
  p { color: ${({ theme }) => theme.colors.textSecondary}; font-size: 14px; margin: 0 0 24px; }
`;

export default function SharedChartPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const shared = useMemo(() => decodeShare(searchParams.get('d')), [searchParams]);

  const [cloning, setCloning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClone = useCallback(async () => {
    if (!shared || shared.kind !== 'chord' || cloning) return;
    const chart = shared.data;
    if (!getAccessToken()) {
      setError('내 라이브러리에 복제하려면 로그인이 필요합니다.');
      navigate('/login');
      return;
    }
    setCloning(true);
    setError(null);
    try {
      const created = await createChordProject({
        title: chart.title?.trim() || '공유받은 코드 차트',
        key: displayKeyToProjectKey(chart.key || 'C'),
        timeSignature: chart.timeSignature || '4/4',
      });
      await addChordProjectChords(created.publicId, leadSheetToProgression(chart));
      await analyzeChordProject(created.publicId);
      navigate('/my-charts');
    } catch (err) {
      setError(err instanceof Error ? err.message : '복제에 실패했습니다.');
    } finally {
      setCloning(false);
    }
  }, [shared, cloning, navigate]);

  if (!shared) {
    return (
      <Page>
        <TopBar>
          <Wordmark onClick={() => navigate('/')}>Jazz<span>ify</span></Wordmark>
        </TopBar>
        <EmptyState>
          <h2>링크를 열 수 없어요</h2>
          <p>공유 링크가 올바르지 않거나 손상되었습니다.</p>
          <CloneBtn style={{ maxWidth: 260 }} onClick={() => navigate('/')}>Jazzify 열기</CloneBtn>
        </EmptyState>
      </Page>
    );
  }

  const meta = shared.data;
  const canClone = shared.kind === 'chord';

  return (
    <Page>
      <TopBar>
        <Wordmark onClick={() => navigate('/')}>Jazz<span>ify</span></Wordmark>
        <OpenAppLink onClick={() => navigate('/')}>Jazzify 열기</OpenAppLink>
      </TopBar>
      <Content $padBottom={canClone}>
        <TitleBlock>
          <Title>{meta.title || '제목 없는 차트'}</Title>
          <SubMeta>
            {meta.composer && <span>{meta.composer}</span>}
            {meta.key && <span>Key {meta.key}</span>}
            <span>{meta.timeSignature || '4/4'}</span>
          </SubMeta>
        </TitleBlock>
        <ChartWrap>
          {shared.kind === 'chord' ? (
            <LeadSheet data={shared.data} selectedKey={shared.data.key ?? 'C'} />
          ) : (
            <NoteSheet
              data={shared.data}
              selectedKey={shared.data.key}
              hideTransport
              noPreload
              forceAutoStem
              lineStartMeasureNumbers
            />
          )}
        </ChartWrap>
      </Content>
      {canClone && (
        <ActionBar>
          <div style={{ width: '100%', maxWidth: 420 }}>
            <CloneBtn disabled={cloning} onClick={handleClone}>
              {cloning ? '복제 중…' : '내 라이브러리에 복제'}
            </CloneBtn>
            {error && <ErrorText>{error}</ErrorText>}
          </div>
        </ActionBar>
      )}
    </Page>
  );
}
