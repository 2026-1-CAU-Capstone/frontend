import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { IconSidebar } from '../components/layout/IconSidebar';
import { useIsNativeUi } from '../contexts/AppPreviewContext';
import {
  Page,
  DetailBody,
  DetailHeader,
  DetailHeaderRow,
  DetailBackBtn,
  DetailTitle,
} from '../components/projects/sharedStyles';

/* 휴지통 — 삭제한 코드·악보 차트가 모이는 자리. 백엔드 소프트삭제(BR-50)가
 * 붙기 전까지는 빈 상태만 보여주는 플레이스홀더다. 서버 계약이 생기면 여기에
 * 탐색형 목록(폴더 구조 보존)·복구·영구삭제 UI를 채운다. */

const BackArrow = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
);

const EmptyWrap = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 24px;
  color: ${({ theme }) => theme.colors.textSecondary};
  text-align: center;
`;

const EmptyIcon = styled.div`
  color: ${({ theme }) => theme.colors.textSecondary};
  opacity: 0.5;
`;

const EmptyTitle = styled.div`
  font-size: 16px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const EmptyHint = styled.div`
  font-size: 13px;
  line-height: 1.5;
`;

export default function TrashPage() {
  const navigate = useNavigate();
  const isNativeUi = useIsNativeUi();

  return (
    <Page>
      {!isNativeUi && <IconSidebar />}
      <DetailBody>
        <DetailHeader>
          <DetailHeaderRow>
            <DetailBackBtn type="button" aria-label="뒤로" onClick={() => navigate(-1)}>
              <BackArrow />
            </DetailBackBtn>
            <DetailTitle>휴지통</DetailTitle>
          </DetailHeaderRow>
        </DetailHeader>

        <EmptyWrap>
          <EmptyIcon>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 7h16" />
              <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7" />
              <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
          </EmptyIcon>
          <EmptyTitle>휴지통이 비어 있어요</EmptyTitle>
          <EmptyHint>삭제한 코드·악보 차트가 여기에 30일간 보관됩니다.</EmptyHint>
        </EmptyWrap>
      </DetailBody>
    </Page>
  );
}
