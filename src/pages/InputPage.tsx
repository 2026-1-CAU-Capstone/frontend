import { useCallback, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { mq } from '../styles/theme';

const PageContainer = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100vh;
  height: 100dvh;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: 'Pretendard', sans-serif;
  padding: 40px 20px;

  ${mq.mobile} {
    padding: 24px 16px;
    justify-content: flex-start;
    padding-top: 48px;
  }
`;

const BackBtn = styled.button`
  position: absolute;
  top: calc(env(safe-area-inset-top, 0px) + 24px);
  left: calc(env(safe-area-inset-left, 0px) + 24px);
  display: flex;
  align-items: center;
  gap: 6px;
  font-family: 'Pretendard', sans-serif;
  font-size: 0.85rem;
  padding: 8px 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    color: ${({ theme }) => theme.colors.textPrimary};
    border-color: ${({ theme }) => theme.colors.goldDark};
  }
`;

const Title = styled.h1`
  font-size: 1.8rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: 8px;

  ${mq.mobile} {
    font-size: 1.4rem;
  }
`;

const Subtitle = styled.p`
  font-size: 1rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 40px;

  ${mq.mobile} {
    font-size: 0.9rem;
    margin-bottom: 28px;
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
    <PageContainer>
      <BackBtn onClick={() => navigate('/')}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 2L4 7l5 5" />
        </svg>
        홈으로
      </BackBtn>

      <Title>악보 인식 (OMR)</Title>
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
    </PageContainer>
  );
}
