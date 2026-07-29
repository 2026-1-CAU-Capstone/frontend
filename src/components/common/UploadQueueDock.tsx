/* 업로드 큐 독 — 우측 상단에 떠 있는 진행 상황 칩 목록.
 *
 * 전체 화면 모달을 대신한다: 분석이 도는 동안에도 화면이 막히지 않고, 다른
 * 메뉴로 이동해도 그대로 따라다닌다(앱 루트에 마운트되므로).
 * "확인 필요" 칩을 눌러야 리뷰 폼(모달)이 열린다 — 자동으로 띄우면 다시 화면을
 * 막는 셈이라서.
 */
import styled, { keyframes } from 'styled-components';
import { useNavigate } from 'react-router-dom';
import { useUploadQueue, type UploadItem } from '../../contexts/UploadQueueContext';
import { PreprocessReviewModal } from './PreprocessReviewModal';

export function UploadQueueDock() {
  const q = useUploadQueue();
  const navigate = useNavigate();
  const reviewing = q.items.find((it) => it.id === q.reviewingId) ?? null;

  return (
    <>
      {q.items.length > 0 && (
        <Dock aria-label="업로드 진행 상황">
          {q.items.map((it) => (
            <Chip key={it.id} $phase={it.phase}>
              <Row>
                <Name title={it.fileName}>{it.fileName}</Name>
                <Close type="button" aria-label="닫기" onClick={() => (it.phase === 'uploading' || it.phase === 'confirming' ? q.cancel(it.id) : q.dismiss(it.id))}>×</Close>
              </Row>
              <Status>
                {it.phase === 'uploading' && <><Spinner aria-hidden /> 악보 분석 중…</>}
                {it.phase === 'review' && '확인이 필요해요'}
                {it.phase === 'confirming' && <><Spinner aria-hidden /> 프로젝트 만드는 중…</>}
                {it.phase === 'done' && '만들어졌어요'}
                {it.phase === 'error' && (it.error ?? '실패했어요')}
              </Status>
              {(it.phase === 'review' || it.phase === 'done') && (
                <Actions>
                  {it.phase === 'review' && (
                    <ActionBtn type="button" $primary onClick={() => q.openReview(it.id)}>확인하기</ActionBtn>
                  )}
                  {it.phase === 'done' && it.created && (
                    <ActionBtn
                      type="button"
                      $primary
                      onClick={() => {
                        const { created } = it as UploadItem & { created: NonNullable<UploadItem['created']> };
                        q.dismiss(it.id);
                        navigate(created.projectType === 'sheet_project'
                          ? `/my-sheets?project=${encodeURIComponent(created.projectPublicId)}`
                          : `/my-charts`);
                      }}
                    >열기</ActionBtn>
                  )}
                  {it.phase === 'review' && (
                    <ActionBtn type="button" onClick={() => q.cancel(it.id)}>취소</ActionBtn>
                  )}
                </Actions>
              )}
            </Chip>
          ))}
        </Dock>
      )}

      {/* 확인 폼 — 칩의 "확인하기" 를 눌렀을 때만 열린다. */}
      <PreprocessReviewModal
        open={!!reviewing}
        preprocess={reviewing?.preprocess ?? null}
        confirming={reviewing?.phase === 'confirming'}
        error={reviewing?.error ?? null}
        onCancel={q.closeReview}
        onConfirm={(body) => { if (reviewing) q.confirm(reviewing.id, body); }}
      />
    </>
  );
}

/* ── styles ──────────────────────────────────────────────────────────────── */

const spin = keyframes`to { transform: rotate(360deg); }`;

const Dock = styled.div`
  position: fixed;
  top: 14px;
  right: 14px;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 300px;
  max-width: calc(100vw - 28px);
  pointer-events: none;   /* 칩만 클릭 대상 — 빈 영역은 아래 화면에 양보 */
`;

const Chip = styled.div<{ $phase: UploadItem['phase'] }>`
  pointer-events: auto;
  font-family: 'Pretendard', sans-serif;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ $phase, theme }) => ($phase === 'error' ? '#e0b4b4' : theme.colors.border)};
  border-left: 3px solid ${({ $phase, theme }) => (
    $phase === 'error' ? '#c0392b'
      : $phase === 'done' ? '#1f9a52'
      : $phase === 'review' ? theme.colors.gold
      : theme.colors.textSecondary
  )};
  border-radius: 10px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.14);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 5px;
`;

const Row = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const Name = styled.span`
  flex: 1;
  min-width: 0;
  font-size: 0.86rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const Close = styled.button`
  flex-shrink: 0;
  border: none;
  background: none;
  cursor: pointer;
  font-size: 1.1rem;
  line-height: 1;
  color: ${({ theme }) => theme.colors.textSecondary};
  padding: 0 2px;
  &:hover { color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const Status = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.78rem;
  line-height: 1.4;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Spinner = styled.span`
  width: 11px;
  height: 11px;
  flex-shrink: 0;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-top-color: ${({ theme }) => theme.colors.textSecondary};
  border-radius: 50%;
  animation: ${spin} 0.8s linear infinite;
`;

const Actions = styled.div`
  display: flex;
  gap: 6px;
  margin-top: 2px;
`;

const ActionBtn = styled.button<{ $primary?: boolean }>`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  font-weight: 700;
  padding: 5px 11px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid ${({ $primary, theme }) => ($primary ? 'transparent' : theme.colors.border)};
  background: ${({ $primary, theme }) => ($primary ? theme.colors.textPrimary : theme.colors.bgPrimary)};
  color: ${({ $primary, theme }) => ($primary ? theme.colors.bgPrimary : theme.colors.textPrimary)};
  &:hover { opacity: 0.88; }
`;
