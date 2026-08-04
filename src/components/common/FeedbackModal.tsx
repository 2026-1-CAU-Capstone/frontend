import { useState, useRef, type ChangeEvent, type DragEvent } from 'react';
import styled from 'styled-components';

/**
 * Feedback modal — pixel-matched to the reference design.
 *
 * Fields: related-file dropdown, required message textarea, optional contact
 * info, optional file attachment (drag/drop or click, max 25MB), and a
 * refund-page notice. Submit is disabled until the message is non-empty.
 *
 * Submission is wired to `onSubmit` (caller decides backend). If none is
 * given it falls back to a console log so the UI is testable standalone.
 */

export interface FeedbackPayload {
  relatedFile: string;
  message: string;
  contact: string;
  attachment: File | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** Options for the "관련 파일" dropdown. Defaults to a single placeholder. */
  fileOptions?: string[];
  onSubmit?: (payload: FeedbackPayload) => void | Promise<void>;
}

const MAX_BYTES = 25 * 1024 * 1024;

export function FeedbackModal({ open, onClose, fileOptions, onSubmit }: Props) {
  const [relatedFile, setRelatedFile] = useState('');
  const [message, setMessage] = useState('');
  const [contact, setContact] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const options = fileOptions && fileOptions.length > 0 ? fileOptions : [];
  const canSubmit = message.trim().length > 0 && !submitting;

  function handleFile(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      alert('파일이 너무 큽니다 (최대 25MB).');
      return;
    }
    setAttachment(file);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    const payload: FeedbackPayload = { relatedFile, message: message.trim(), contact, attachment };
    try {
      if (onSubmit) await onSubmit(payload);
      else console.log('[feedback]', payload);
      // reset + close
      setMessage(''); setContact(''); setAttachment(null); setRelatedFile('');
      onClose();
    } catch (err) {
      console.error('feedback submit failed', err);
      alert('제출에 실패했습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Overlay onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <Header>
          <IconBox>
            <SendIcon />
          </IconBox>
          <div>
            <Title>피드백 남기기</Title>
            <Subtitle>서비스 개선 방법에 대해 피드백을 남겨주시면 빠르게 반영하겠습니다.</Subtitle>
          </div>
        </Header>

        <Field>
          <Label>관련 파일:</Label>
          <Select value={relatedFile} onChange={(e: ChangeEvent<HTMLSelectElement>) => setRelatedFile(e.target.value)}>
            <option value="">선택 안 함</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
          </Select>
        </Field>

        <Field>
          <Label>문의사항 (필수) <Req>*</Req></Label>
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="문의사항, 제안사항 또는 문제점을 자세히 설명해주세요..."
            rows={5}
          />
        </Field>

        <Field>
          <Label>연락처 정보</Label>
          <Input
            value={contact}
            onChange={(e) => setContact(e.target.value)}
            placeholder="카카오톡, 인스타그램 아이디, 이메일 등 답장드릴 수 있는 연락처를 입력해주세요"
          />
        </Field>

        <Field>
          <Label>첨부 파일 (화면캡쳐, 동영상 등)</Label>
          <DropZone
            $dragOver={dragOver}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            {attachment ? (
              <DropText>{attachment.name}</DropText>
            ) : (
              <DropText><UpIcon /> 클릭하여 업로드하거나 파일을 드래그하세요</DropText>
            )}
          </DropZone>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={(e) => { handleFile(e.target.files?.[0]); e.target.value = ''; }}
          />
          <Hint>최대 25MB. 대부분의 파일 형식을 지원합니다.</Hint>
        </Field>

        <RefundNotice>
          환불 관련 문의는 <strong>환불 페이지</strong> 를 이용해 주세요.
        </RefundNotice>

        <Footer>
          <CancelBtn onClick={onClose}>취소</CancelBtn>
          <SubmitBtn $enabled={canSubmit} disabled={!canSubmit} onClick={submit}>
            {submitting ? '제출 중…' : '피드백 제출'}
          </SubmitBtn>
        </Footer>
      </Card>
    </Overlay>
  );
}

/* ─── icons ──────────────────────────────────────────────────────────── */

const SendIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1a1a1a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <line x1="22" y1="2" x2="11" y2="13" />
    <polygon points="22 2 15 22 11 13 2 9 22 2" />
  </svg>
);

const UpIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 8, verticalAlign: 'middle' }}>
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

/* ─── styled ─────────────────────────────────────────────────────────── */

const Overlay = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${({ theme }) => theme.zIndex.toast};
  background: ${({ theme }) => theme.colors.scrim};
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const Card = styled.div`
  width: 100%;
  max-width: 560px;
  max-height: 90vh;
  overflow-y: auto;
  background: ${({ theme }) => theme.colors.surface};
  border-radius: 20px;
  padding: 28px 28px 22px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  font-family: ${({ theme }) => theme.fonts.ui};
`;

const Header = styled.div`
  display: flex;
  gap: 14px;
  align-items: flex-start;
  margin-bottom: 22px;
`;

const IconBox = styled.div`
  width: 48px;
  height: 48px;
  flex-shrink: 0;
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.surfaceSunken};
  display: flex;
  align-items: center;
  justify-content: center;
`;

const Title = styled.h2`
  font-size: 1.3rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin: 0 0 4px;
`;

const Subtitle = styled.p`
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 0;
  line-height: 1.4;
`;

const Field = styled.div`
  margin-bottom: 18px;
`;

const Label = styled.label`
  display: block;
  font-size: 0.92rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: 8px;
`;

const Req = styled.span`
  color: #e0563f;
`;

const Select = styled.select`
  width: 100%;
  height: 52px;
  padding: 0 16px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.surfaceSunken};
  font-family: inherit;
  font-size: 1rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
`;

const Textarea = styled.textarea`
  width: 100%;
  padding: 14px 16px;
  border: 2px solid ${({ theme }) => theme.colors.textPrimary};
  border-radius: 14px;
  background: ${({ theme }) => theme.colors.surface};
  font-family: inherit;
  font-size: 1rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  resize: vertical;
  min-height: 140px;
  line-height: 1.5;

  &::placeholder { color: ${({ theme }) => theme.colors.textSecondary}; }
  &:focus { outline: none; border-color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const Input = styled.input`
  width: 100%;
  height: 60px;
  padding: 0 16px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.surfaceSunken};
  font-family: inherit;
  font-size: 0.95rem;
  color: ${({ theme }) => theme.colors.textPrimary};

  &::placeholder { color: ${({ theme }) => theme.colors.textSecondary}; }
  &:focus { outline: none; border-color: ${({ theme }) => theme.colors.border}; }
`;

const DropZone = styled.div<{ $dragOver: boolean }>`
  width: 100%;
  min-height: 64px;
  border: 1.5px dashed ${({ $dragOver }) => ($dragOver ? '#1a1a1a' : '#cfcfcf')};
  border-radius: 12px;
  background: ${({ $dragOver }) => ($dragOver ? '#f5f5f5' : '#fafafa')};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
`;

const DropText = styled.span`
  font-size: 0.92rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  display: inline-flex;
  align-items: center;
`;

const Hint = styled.p`
  font-size: 0.8rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin: 8px 2px 0;
`;

const RefundNotice = styled.div`
  background: ${({ theme }) => theme.colors.surfaceSunken};
  border-radius: 12px;
  padding: 14px 16px;
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 20px;

  strong { color: ${({ theme }) => theme.colors.textPrimary}; font-weight: 700; }
`;

const Footer = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 10px;
`;

const CancelBtn = styled.button`
  height: 48px;
  padding: 0 26px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 999px;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.12s;
  &:hover { background: ${({ theme }) => theme.colors.surfaceSunken}; }
`;

const SubmitBtn = styled.button<{ $enabled: boolean }>`
  height: 48px;
  padding: 0 26px;
  border: none;
  border-radius: 999px;
  background: ${({ $enabled }) => ($enabled ? '#1a1a1a' : '#e3e3e0')};
  color: ${({ $enabled }) => ($enabled ? '#fff' : '#999')};
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 700;
  cursor: ${({ $enabled }) => ($enabled ? 'pointer' : 'not-allowed')};
  transition: background 0.12s;
`;
