import { useCallback, useRef, useState } from 'react';
import { BackButton } from '../components/common/BackButton';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';
import { IconSidebar } from '../components/layout/IconSidebar';

/* 상단바는 다른 페이지(음원 분리·카피하기·솔로 DB 등)와 같은 규격이다 —
 * 왼쪽에 뒤로가기, 그 옆에 제목, 아래 경계선. 예전엔 상단바 없이 뒤로가기
 * 버튼까지 본문과 함께 가운데 정렬돼 제목 위에 홀로 떠 있었다. */
const Page = styled.div`
  display: flex;
  flex-direction: row;
  height: 100vh;
  height: 100dvh;
  width: 100%;
  background: ${({ theme }) => theme.colors.bgPrimary};
  overflow: hidden;
`;

const PageBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  font-family: 'Pretendard', sans-serif;
`;

const TopBar = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
  padding: calc(env(safe-area-inset-top, 0px) + 10px) 16px 10px;
  background: ${({ theme }) => theme.colors.barTop};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Title = styled.h1`
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
`;

/* 업로드 카드 영역 — 상단바 아래에서 세로 가운데. */
const Content = styled.div`
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 20px calc(env(safe-area-inset-bottom, 0px) + 32px);

  ${mq.mobile} {
    justify-content: flex-start;
    padding: 24px 16px calc(env(safe-area-inset-bottom, 0px) + 24px);
  }
`;

const Subtitle = styled.p`
  /* 제목이 상단바로 올라갔으므로 여기서는 업로드 카드 위 안내문 역할만 한다. */
  margin: 0 0 18px;
  font-size: 0.88rem;
  color: ${({ theme }) => theme.colors.textSecondary};

  ${mq.mobile} {
    font-size: 0.82rem;
    margin-bottom: 14px;
  }
`;

const DropZone = styled.div<{ $dragging: boolean; $hasFile: boolean }>`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-width: 560px;
  height: 320px;
  border: 2px dashed
    ${({ $dragging, $hasFile, theme }) =>
      $dragging
        ? theme.colors.goldDark
        : $hasFile
          ? theme.colors.tonic
          : theme.colors.border};
  border-radius: 20px;
  background: ${({ $dragging, theme }) =>
    $dragging ? 'rgba(212, 168, 67, 0.06)' : theme.colors.bgSecondary};
  cursor: pointer;
  transition: all 0.2s;

  &:hover {
    border-color: ${({ theme }) => theme.colors.goldDark};
    background: rgba(212, 168, 67, 0.04);
  }

  ${mq.mobile} {
    height: 240px;
    border-radius: 14px;
  }
`;

const UploadIcon = styled.div`
  font-size: 3.5rem;
  margin-bottom: 16px;
  color: ${({ theme }) => theme.colors.textSecondary};
  opacity: 0.6;
`;

const DropText = styled.span`
  font-size: 1.1rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: 6px;
`;

const DropHint = styled.span`
  font-size: 0.85rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const FileInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
  padding: 12px 20px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  max-width: 560px;
  width: 100%;
`;

const FileName = styled.span`
  flex: 1;
  font-size: 0.9rem;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textPrimary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const FileSize = styled.span`
  font-size: 0.8rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  flex-shrink: 0;
`;

const RemoveBtn = styled.button`
  border: none;
  background: none;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  font-size: 1.1rem;
  padding: 0 4px;
  flex-shrink: 0;

  &:hover {
    color: ${({ theme }) => theme.colors.dominant};
  }
`;

const AnalyzeBtn = styled.button`
  margin-top: 20px;
  padding: 12px 40px;
  font-family: 'Pretendard', sans-serif;
  font-size: 1rem;
  font-weight: 600;
  border: none;
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.goldDark};
  color: #fff;
  cursor: pointer;
  transition: all 0.15s;
  opacity: 0.4;
  pointer-events: none;

  &.active {
    opacity: 1;
    pointer-events: auto;

    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 14px rgba(184, 134, 11, 0.3);
    }
  }
`;

const FormatBadges = styled.div`
  display: flex;
  gap: 8px;
  margin-top: 16px;
`;

const Badge = styled.span`
  font-size: 0.72rem;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  color: ${({ theme }) => theme.colors.textSecondary};
  text-transform: uppercase;
  letter-spacing: 0.3px;
`;

const ACCEPTED = '.pdf,.png,.jpg,.jpeg';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function InputPage() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const handleFile = useCallback((f: File) => {
    const ext = f.name.split('.').pop()?.toLowerCase();
    if (['pdf', 'png', 'jpg', 'jpeg'].includes(ext ?? '')) {
      setFile(f);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(true);
  }, []);

  const onDragLeave = useCallback(() => setDragging(false), []);

  const onClickZone = useCallback(() => inputRef.current?.click(), []);

  const onFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0];
      if (f) handleFile(f);
      e.target.value = '';
    },
    [handleFile],
  );

  return (
    <Page>
      <IconSidebar />
      <PageBody>
      <TopBar>
        <BackButton onClick={() => navigate('/')} label="홈으로" />
        <Title>악보 인식 (OMR)</Title>
      </TopBar>

      <Content>
      <Subtitle>악보 이미지를 업로드하면 자동으로 분석합니다</Subtitle>

      <DropZone
        $dragging={dragging}
        $hasFile={!!file}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onClick={onClickZone}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED}
          onChange={onFileChange}
          style={{ display: 'none' }}
        />
        {file ? (
          <>
            <UploadIcon>&#10003;</UploadIcon>
            <DropText>파일이 준비되었습니다</DropText>
            <DropHint>다른 파일을 선택하려면 클릭하세요</DropHint>
          </>
        ) : (
          <>
            <UploadIcon>&#128196;</UploadIcon>
            <DropText>파일을 드래그하거나 클릭하여 업로드</DropText>
            <DropHint>PDF, PNG, JPEG 파일을 지원합니다</DropHint>
            <FormatBadges>
              <Badge>PDF</Badge>
              <Badge>PNG</Badge>
              <Badge>JPEG</Badge>
            </FormatBadges>
          </>
        )}
      </DropZone>

      {file && (
        <FileInfo>
          <FileName>{file.name}</FileName>
          <FileSize>{formatBytes(file.size)}</FileSize>
          <RemoveBtn onClick={() => setFile(null)}>&times;</RemoveBtn>
        </FileInfo>
      )}

      <AnalyzeBtn className={file ? 'active' : ''}>분석 시작</AnalyzeBtn>
      </Content>
      </PageBody>
    </Page>
  );
}
