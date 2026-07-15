import styled from 'styled-components';

/* ─────────────────────────────────────────────────────────────────────────
 * AMT (자동 채보) — 목업 (mock-up).
 *
 * 실제 채보 구현(브라우저 Basic Pitch: 소스 트림 → 코드진행 확정 → 채보 →
 * VexFlow/MIDI)은 앱에서 분리되어 별도 저장소 `jazzify/AMT/` 로 이관됐다.
 * 이 페이지는 흐름을 보여주는 정적 목업이며 실제 로직·모델·의존성(tfjs 등)을
 * 포함하지 않는다. admin 전용(App.tsx의 AdminRoute).
 * ──────────────────────────────────────────────────────────────────────── */

export default function AmtPage() {
  return (
    <Page>
      <Header>
        <H1>AMT · 자동 채보 실험실 <MockTag>MOCK-UP</MockTag></H1>
        <Sub>영상/오디오에서 구간을 잘라 코드 진행과 함께 베이스를 채보하는 흐름의 목업입니다.</Sub>
      </Header>

      <Banner>
        ⓘ 실제 채보 구현(Basic Pitch)은 별도 저장소 <code>jazzify/AMT/</code> 로 이관됐습니다.
        이 화면은 UI 흐름만 보여주는 목업이며 동작하지 않습니다.
      </Banner>

      {/* STEP 1 — 소스 */}
      <Card>
        <StepHead><StepNo>1</StepNo><StepTitle>소스 입력</StepTitle></StepHead>
        <Tabs>
          <Tab $on>YouTube 링크</Tab>
          <Tab>오디오 파일</Tab>
        </Tabs>
        <Row>
          <FakeInput>YouTube URL 또는 11자 ID</FakeInput>
          <FakeBtn>불러오기</FakeBtn>
        </Row>
        <Placeholder $ratio="16 / 9">▶ 영상 미리보기</Placeholder>
        <Placeholder $ratio="auto" style={{ minHeight: 44 }}>│◀ IN ──────── 트림 타임라인 ──────── OUT ▶│</Placeholder>
      </Card>

      {/* STEP 2 — 메타데이터 */}
      <Card>
        <StepHead><StepNo>2</StepNo><StepTitle>메타데이터</StepTitle></StepHead>
        <FieldLabel>곡 (코드 진행 확정)</FieldLabel>
        <FakeInput $full>iReal Pro 1460곡 검색…</FakeInput>
        <FieldLabel style={{ marginTop: 14 }}>BPM</FieldLabel>
        <Row>
          <FakeInput style={{ width: 110, flex: '0 0 auto' }}>120</FakeInput>
          <FakeBtn>탭 템포</FakeBtn>
        </Row>
        <FieldLabel style={{ marginTop: 14 }}>코드 진행</FieldLabel>
        <Placeholder $ratio="auto" style={{ minHeight: 120 }}>│ CΔ7 │ A-7 │ D-7 │ G7 │ … 코드 차트 (LeadSheet)</Placeholder>
      </Card>

      {/* STEP 3 — 채보 & 결과 */}
      <Card>
        <StepHead><StepNo>3</StepNo><StepTitle>베이스 채보 · 결과</StepTitle></StepHead>
        <Checklist>
          <Check>소스 —</Check><Check>구간 —</Check><Check>곡/코드 —</Check><Check>BPM —</Check>
        </Checklist>
        <Row style={{ marginTop: 10 }}>
          <FakeBtn $primary>베이스 채보 실행</FakeBtn>
          <FakeBtn>MIDI 다운로드</FakeBtn>
        </Row>
        <Placeholder $ratio="auto" style={{ minHeight: 160 }}>♪ 채보 결과 악보 (VexFlow)</Placeholder>
      </Card>
    </Page>
  );
}

/* ─── styled ─────────────────────────────────────────────────────────── */

const Page = styled.div`
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 24px 96px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ theme }) => theme.colors.textPrimary};
`;
const Header = styled.div``;
const H1 = styled.h1`
  margin: 0 0 4px;
  font-size: 1.5rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 10px;
`;
const MockTag = styled.span`
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 3px 8px;
  border-radius: 999px;
  color: ${({ theme }) => theme.colors.gold};
  border: 1px solid ${({ theme }) => theme.colors.gold};
`;
const Sub = styled.p`
  margin: 0;
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
const Banner = styled.div`
  font-size: 0.85rem;
  line-height: 1.5;
  padding: 12px 14px;
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border: 1px dashed ${({ theme }) => theme.colors.border};
  code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; color: ${({ theme }) => theme.colors.gold}; }
`;
const Card = styled.section`
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 14px;
  padding: 20px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  display: flex;
  flex-direction: column;
  gap: 12px;
  opacity: 0.92;
`;
const StepHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;
const StepNo = styled.span`
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.gold};
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
`;
const StepTitle = styled.h2`
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
`;
const Tabs = styled.div`
  display: flex;
  gap: 6px;
`;
const Tab = styled.span<{ $on?: boolean }>`
  padding: 8px 16px;
  border-radius: 8px;
  border: 1.5px solid ${({ $on, theme }) => ($on ? theme.colors.gold : theme.colors.border)};
  background: ${({ $on, theme }) => ($on ? theme.colors.gold + '18' : theme.colors.bgPrimary)};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.88rem;
  font-weight: ${({ $on }) => ($on ? 600 : 400)};
`;
const Row = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
`;
const FieldLabel = styled.div`
  font-size: 0.82rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
const FakeInput = styled.div<{ $full?: boolean }>`
  ${({ $full }) => ($full ? 'width: 100%;' : 'flex: 1; min-width: 200px;')}
  padding: 10px 14px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.bgPrimary};
`;
const FakeBtn = styled.span<{ $primary?: boolean }>`
  padding: 10px 16px;
  border-radius: 8px;
  border: 1.5px solid ${({ $primary, theme }) => ($primary ? theme.colors.gold : theme.colors.border)};
  background: ${({ $primary, theme }) => ($primary ? theme.colors.gold : theme.colors.bgPrimary)};
  color: ${({ $primary, theme }) => ($primary ? '#fff' : theme.colors.textSecondary)};
  font-size: 0.88rem;
  font-weight: ${({ $primary }) => ($primary ? 600 : 400)};
  white-space: nowrap;
`;
const Placeholder = styled.div<{ $ratio?: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  ${({ $ratio }) => ($ratio && $ratio !== 'auto' ? `aspect-ratio: ${$ratio};` : '')}
  border: 1.5px dashed ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.85rem;
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
`;
const Checklist = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;
const Check = styled.span`
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  border: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.bgSecondary};
  color: ${({ theme }) => theme.colors.textSecondary};
`;
