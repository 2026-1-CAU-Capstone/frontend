import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import styled, { keyframes } from 'styled-components';
import { createLickViaOMR, type OMRMetadata } from '../../api/licks';
import type { LickEntry } from '../../data/lickData';

/* Modal: upload a sheet image → backend OMR (POST /v1/licks/omr) → saved
 * Lick. On success, parent receives the entry via onCreated() and is
 * expected to navigate to the editor. All metadata fields are optional;
 * the backend extracts whatever it can from the resulting MusicXML. */

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (lick: LickEntry) => void;
}

const INSTRUMENT_OPTIONS: { value: string; label: string }[] = [
  { value: '',   label: '(자동 감지)' },
  { value: 'as', label: 'Alto Sax' },
  { value: 'ts', label: 'Tenor Sax' },
  { value: 'tp', label: 'Trumpet' },
  { value: 'p',  label: 'Piano' },
  { value: 'g',  label: 'Guitar' },
  { value: 'b',  label: 'Bass' },
  { value: 'voc', label: 'Vocal' },
  { value: 'cl', label: 'Clarinet' },
];

const STYLE_OPTIONS = ['', 'SWING', 'BEBOP', 'HARDBOP', 'COOL', 'MODAL', 'FUSION'];
const RHYTHM_OPTIONS = ['', 'SWING', 'STRAIGHT', 'BOSSA', 'LATIN'];

export function LickOMRModal({ open, onClose, onCreated }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [meta, setMeta] = useState<OMRMetadata>({ source: 'user' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Accepts a single image File (PNG/JPG/JPEG) and wires it into modal
   *  state. Shared by both click-select and drop paths. */
  const acceptFile = (f: File): boolean => {
    if (!/^image\/(png|jpe?g)$/i.test(f.type) && !/\.(png|jpe?g)$/i.test(f.name)) {
      setError('PNG · JPG · JPEG 파일만 지원합니다.');
      return false;
    }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setError(null);
    return true;
  };

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) setIsDragOver(true);
  };
  const onDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
  };
  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) acceptFile(f);
  };

  if (!open) return null;

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setMeta({ source: 'user' });
    setError(null);
    setSubmitting(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const handleFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) acceptFile(f);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file) {
      setError('악보 이미지를 선택해주세요.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      /* Strip empty string metadata fields → backend ignores undefined.
       * Coerce tempo to number. */
      const cleaned: OMRMetadata = {};
      (Object.keys(meta) as (keyof OMRMetadata)[]).forEach((k) => {
        const v = meta[k];
        if (v == null || v === '' || (typeof v === 'number' && Number.isNaN(v))) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cleaned as any)[k] = v;
      });
      const lick = await createLickViaOMR(file, cleaned);
      reset();
      onCreated(lick);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'OMR 인식 실패';
      setError(msg);
      setSubmitting(false);
    }
  };

  return (
    <Backdrop onClick={handleClose}>
      <Modal onClick={(e) => e.stopPropagation()}>
        <Header>
          <Title>OMR로 릭 생성</Title>
          <CloseBtn onClick={handleClose} aria-label="닫기" disabled={submitting}>
            ×
          </CloseBtn>
        </Header>

        <Form onSubmit={submit}>
          <FileDropZone
            $dragging={isDragOver}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={onDragOver}
            onDragEnter={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
          >
            {previewUrl ? (
              <PreviewImg src={previewUrl} alt="악보 미리보기" />
            ) : (
              <DropHint>
                <DropIcon>📄</DropIcon>
                <DropText>{isDragOver ? '여기에 놓기' : '클릭 또는 드래그해서 악보 이미지 선택'}</DropText>
                <DropSub>PNG · JPG · JPEG</DropSub>
              </DropHint>
            )}
            <HiddenFileInput
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              onChange={handleFile}
            />
          </FileDropZone>

          <SectionTitle>메타데이터 (선택)</SectionTitle>
          <Grid>
            <Field>
              <Label>제목</Label>
              <Input
                value={meta.title ?? ''}
                onChange={(e) => setMeta({ ...meta, title: e.target.value })}
                placeholder="(MusicXML에서 자동)"
              />
            </Field>
            <Field>
              <Label>연주자</Label>
              <Input
                value={meta.performer ?? ''}
                onChange={(e) => setMeta({ ...meta, performer: e.target.value })}
                placeholder="예: Charlie Parker"
              />
            </Field>
            <Field>
              <Label>앨범</Label>
              <Input
                value={meta.album ?? ''}
                onChange={(e) => setMeta({ ...meta, album: e.target.value })}
              />
            </Field>
            <Field>
              <Label>악기</Label>
              <Select
                value={meta.instrument ?? ''}
                onChange={(e) => setMeta({ ...meta, instrument: e.target.value || undefined })}
              >
                {INSTRUMENT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>스타일</Label>
              <Select
                value={meta.style ?? ''}
                onChange={(e) => setMeta({ ...meta, style: e.target.value || undefined })}
              >
                {STYLE_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s || '(자동)'}</option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>리듬감</Label>
              <Select
                value={meta.rhythmFeel ?? ''}
                onChange={(e) =>
                  setMeta({ ...meta, rhythmFeel: (e.target.value || undefined) as OMRMetadata['rhythmFeel'] })
                }
              >
                {RHYTHM_OPTIONS.map((s) => (
                  <option key={s} value={s}>{s || '(자동)'}</option>
                ))}
              </Select>
            </Field>
            <Field>
              <Label>템포 (BPM)</Label>
              <Input
                type="number"
                min={1}
                max={500}
                value={meta.tempo ?? ''}
                onChange={(e) => setMeta({ ...meta, tempo: e.target.value ? Number(e.target.value) : undefined })}
                placeholder="(자동)"
              />
            </Field>
            <Field>
              <Label>조성</Label>
              <Input
                value={meta.key ?? ''}
                onChange={(e) => setMeta({ ...meta, key: e.target.value })}
                placeholder="예: Bb-maj"
              />
            </Field>
          </Grid>

          {error && <ErrorBox>{error}</ErrorBox>}

          <Actions>
            <CancelBtn type="button" onClick={handleClose} disabled={submitting}>
              취소
            </CancelBtn>
            <SubmitBtn type="submit" disabled={submitting || !file}>
              {submitting ? <Spinner /> : '인식 후 에디터로 열기'}
            </SubmitBtn>
          </Actions>
        </Form>
      </Modal>
    </Backdrop>
  );
}

/* ── styles ──────────────────────────────────────────────── */

const fadeBg = keyframes`from { opacity: 0 } to { opacity: 1 }`;
const popUp = keyframes`from { transform: translateY(20px) scale(0.97); opacity: 0 } to { transform: translateY(0) scale(1); opacity: 1 }`;

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 500;
  padding: 24px;
  animation: ${fadeBg} 0.15s ease both;
`;

const Modal = styled.div`
  width: 100%;
  max-width: 560px;
  max-height: 92vh;
  background: #fff;
  border-radius: 18px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: ${popUp} 0.2s cubic-bezier(0.2, 0.8, 0.2, 1) both;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
`;

const Title = styled.h2`
  margin: 0;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 17px;
  font-weight: 700;
  color: #1a1a1a;
`;

const CloseBtn = styled.button`
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: none;
  background: rgba(0, 0, 0, 0.05);
  color: #555;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  &:hover:not(:disabled) { background: rgba(0, 0, 0, 0.08); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 16px 20px 20px;
  overflow-y: auto;
`;

const FileDropZone = styled.div<{ $dragging?: boolean }>`
  border: 2px dashed ${({ $dragging }) => ($dragging ? '#3978f7' : 'rgba(0, 0, 0, 0.15)')};
  border-radius: 14px;
  background: ${({ $dragging }) => ($dragging ? 'rgba(57, 120, 247, 0.06)' : 'rgba(0, 0, 0, 0.02)')};
  min-height: 180px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.15s, background 0.15s;
  &:hover { border-color: rgba(0, 0, 0, 0.3); background: rgba(0, 0, 0, 0.04); }
`;

const HiddenFileInput = styled.input`
  display: none;
`;

const DropHint = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #555;
  padding: 24px;
`;
const DropIcon = styled.span` font-size: 32px; `;
const DropText = styled.span`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 15px;
  font-weight: 600;
`;
const DropSub = styled.span`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12px;
  color: #888;
`;

const PreviewImg = styled.img`
  max-width: 100%;
  max-height: 240px;
  object-fit: contain;
`;

const SectionTitle = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12px;
  font-weight: 700;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  margin-top: 4px;
`;

const Grid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 12px;
  @media (max-width: 480px) {
    grid-template-columns: 1fr;
  }
`;

const Field = styled.label`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Label = styled.span`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 11px;
  color: #666;
  font-weight: 600;
`;

const Input = styled.input`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  background: #fff;
  outline: none;
  &:focus { border-color: #3978f7; }
`;

const Select = styled.select`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 8px;
  background: #fff;
  outline: none;
  &:focus { border-color: #3978f7; }
`;

const ErrorBox = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13px;
  color: #c0392b;
  background: rgba(192, 57, 43, 0.08);
  padding: 8px 12px;
  border-radius: 8px;
  white-space: pre-wrap;
`;

const Actions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
`;

const CancelBtn = styled.button`
  padding: 10px 16px;
  border-radius: 8px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  color: #333;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  &:hover:not(:disabled) { background: rgba(0, 0, 0, 0.04); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const SubmitBtn = styled.button`
  padding: 10px 18px;
  border-radius: 8px;
  border: none;
  background: #1a1a1a;
  color: #fff;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  min-width: 160px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  &:hover:not(:disabled) { opacity: 0.9; }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

const spin = keyframes`to { transform: rotate(360deg); }`;
const Spinner = styled.span`
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: ${spin} 0.7s linear infinite;
`;
