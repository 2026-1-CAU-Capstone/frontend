import { useState } from 'react';
import styled from 'styled-components';

/* Copy-link fallback shown when the native share sheet (navigator.share) isn't
 * available — e.g. desktop browsers. Presentational: the caller owns open/close
 * and supplies the already-built share URL. */

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: ${({ theme }) => theme.colors.scrim};
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: ${({ theme }) => theme.zIndex.modalHigh};
  padding: 20px;
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-radius: 16px;
  padding: 24px;
  width: 100%;
  max-width: 440px;
  box-shadow: ${({ theme }) => theme.shadows.xl};
  font-family: ${({ theme }) => theme.fonts.ui};
`;

const Title = styled.h3`
  margin: 0 0 6px;
  font-size: 17px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Sub = styled.p`
  margin: 0 0 16px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const UrlInput = styled.input`
  width: 100%;
  box-sizing: border-box;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  padding: 11px 12px;
  font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.chord};
  color: ${({ theme }) => theme.colors.textPrimary};
  background: ${({ theme }) => theme.colors.bgSecondary};
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
`;

const Button = styled.button<{ $primary?: boolean }>`
  border: ${({ $primary, theme }) => ($primary ? 'none' : `1px solid ${theme.colors.border}`)};
  background: ${({ $primary, theme }) => ($primary ? theme.colors.gold : theme.colors.bgSecondary)};
  color: ${({ $primary, theme }) => ($primary ? '#fff' : theme.colors.textSecondary)};
  border-radius: 999px;
  padding: 10px 20px;
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
`;

interface ShareLinkModalProps {
  url: string;
  onClose: () => void;
}

export function ShareLinkModal({ url, onClose }: ShareLinkModalProps) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      /* clipboard blocked — the input stays selectable for manual copy */
    }
  };

  return (
    <Overlay onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <Title>공유 링크</Title>
        <Sub>링크가 있는 누구나 이 차트를 열람할 수 있어요.</Sub>
        <UrlInput value={url} readOnly onFocus={(e) => e.currentTarget.select()} />
        <Actions>
          <Button type="button" onClick={onClose}>닫기</Button>
          <Button type="button" $primary onClick={copy}>{copied ? '복사됨' : '링크 복사'}</Button>
        </Actions>
      </Card>
    </Overlay>
  );
}
