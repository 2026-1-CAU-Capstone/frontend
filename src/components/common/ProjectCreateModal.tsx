import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import styled from 'styled-components';
import { KeyPicker } from './KeyPicker';

/* ─────────────────────────────────────────────────────────────────────────
 * ProjectCreateModal — shared "새 프로젝트 생성" onboarding modal used by both
 * 내 코드 차트 (MyChordChartsPage) and 내 악보 차트 (MySheetProjectsPage).
 *
 * Collects { title, key, type, file } and hands it to the parent via
 * onCreate — list state + the actual API call (OMR for chord, storage+sheet
 * for sheet) live in each page so this stays presentational and reusable.
 *
 * Features:
 *  - Type selector ("어떤 종류의 악보인가요?") — 코드차트(iRealPro류) vs 악보(채보).
 *  - "직접 입력하기" button above the upload (migrated from the old dropdown).
 *  - Drag-and-drop upload (image/PDF only — OMR unifies the rest).
 *  - Title auto-fills from the file name when left blank.
 *  - `initialFile` opens the modal with a dropped file already loaded.
 * ──────────────────────────────────────────────────────────────────────── */

export type ProjectType = 'chord' | 'sheet';

export interface ProjectCreatePayload {
  title: string;
  key: string;
  type: ProjectType;
  file: File;
}

interface Props {
  open: boolean;
  /** Default type for this entry point — each page sets its own:
   *  내 코드 차트 → 'chord', 내 악보 차트 → 'sheet'. */
  defaultType?: ProjectType;
  /** Pre-loaded file (e.g. dropped onto the page) — opens with it attached. */
  initialFile?: File | null;
  creating?: boolean;
  error?: string | null;
  /** "직접 입력하기" — parent navigates to the empty editor. */
  onManualEntry?: () => void;
  onClose: () => void;
  onCreate: (payload: ProjectCreatePayload) => void;
}

const ACCEPT = 'image/png,image/jpeg,image/jpg,application/pdf';

function isAccepted(f: File): boolean {
  return /^image\/(png|jpe?g)$/i.test(f.type) || f.type === 'application/pdf'
    || /\.(png|jpe?g|pdf)$/i.test(f.name);
}
function titleFromFile(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(0, dot) : name;
}

export function ProjectCreateModal({
  open, defaultType = 'sheet', initialFile = null, creating = false, error = null,
  onManualEntry, onClose, onCreate,
}: Props) {
  const [title, setTitle] = useState('');
  const [key, setKey] = useState<string>('C_MAJOR');
  const [type, setType] = useState<ProjectType>(defaultType);
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset/seed the form each time the modal opens (and adopt a dropped file).
  useEffect(() => {
    if (!open) return;
    setType(defaultType);
    setKey('C_MAJOR');
    setDragOver(false);
    // Always start the title input EMPTY — the file name shows as a gray
    // placeholder instead, and effectiveTitle falls back to it on submit.
    setFile(initialFile ?? null);
    setTitle('');
  }, [open, initialFile, defaultType]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const acceptFile = (f: File | null) => {
    if (!f || !isAccepted(f)) return;
    setFile(f);
    // Leave the title input empty — file name shows as the gray placeholder
    // (see the Input's placeholder) and effectiveTitle uses it if left blank.
  };
  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => acceptFile(e.target.files?.[0] ?? null);
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    acceptFile(e.dataTransfer.files?.[0] ?? null);
  };
  const onDragOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = (e: DragEvent) => { e.preventDefault(); setDragOver(false); };

  const effectiveTitle = title.trim() || (file ? titleFromFile(file.name) : '');
  const canCreate = !!file && !!effectiveTitle && !creating;

  const submit = () => {
    if (!file || !effectiveTitle) return;
    onCreate({ title: effectiveTitle, key, type, file });
  };

  return (
    <Backdrop onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <CardTitle>새 프로젝트 생성</CardTitle>

        <Field>
          <Label>제목</Label>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={file ? titleFromFile(file.name) : '예: Autumn Leaves'}
          />
        </Field>

        <Field>
          <Label>조성</Label>
          <KeyPicker value={key} onChange={setKey} />
        </Field>

        <Field>
          <Label>어떤 종류의 악보인가요?</Label>
          <Segmented>
            <SegBtn type="button" $on={type === 'chord'} onClick={() => setType('chord')}>
              코드 차트<small>iRealPro 같은 코드 진행</small>
            </SegBtn>
            <SegBtn type="button" $on={type === 'sheet'} onClick={() => setType('sheet')}>
              악보<small>멜로디 채보</small>
            </SegBtn>
          </Segmented>
        </Field>

        <DropZone
          $over={dragOver}
          $has={!!file}
          onClick={() => inputRef.current?.click()}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragEnter={onDragOver}
          onDragLeave={onDragLeave}
        >
          <FileIcon />
          <span>{file ? file.name : '여기로 파일을 드래그하거나 클릭해 선택 (이미지 · PDF)'}</span>
          <input ref={inputRef} type="file" accept={ACCEPT} onChange={onFileChange} hidden />
        </DropZone>

        {error && <ErrorMsg>{error}</ErrorMsg>}

        <Actions>
          {onManualEntry ? (
            <ManualRow type="button" onClick={() => onManualEntry()}>
              <PencilIcon /> 직접 입력하기
            </ManualRow>
          ) : <span />}
          <ActionsRight>
            <Btn $variant="ghost" type="button" onClick={onClose} disabled={creating}>취소</Btn>
            <Btn $variant="primary" type="button" onClick={submit} disabled={!canCreate}>
              {creating ? '생성 중…' : '생성'}
            </Btn>
          </ActionsRight>
        </Actions>
      </Card>
    </Backdrop>
  );
}

/* ── icons ───────────────────────────────────────────────────────────── */
const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
);
const FileIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" />
  </svg>
);

/* ── styles ──────────────────────────────────────────────────────────── */
const Backdrop = styled.div`
  position: fixed; inset: 0; background: rgba(0,0,0,.55);
  z-index: 9999; display: flex; align-items: center; justify-content: center; padding: 24px;
`;
const Card = styled.div`
  background: #fff; border-radius: 14px; width: min(460px, 100%);
  padding: 22px 22px 18px; box-shadow: 0 16px 48px rgba(0,0,0,.3);
  display: flex; flex-direction: column; gap: 14px;
`;
const CardTitle = styled.h2`
  margin: 0; font-size: 18px; font-weight: 800; color: #16161d;
`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px;`;
const Label = styled.label`font-size: 12.5px; font-weight: 600; color: #55555f;`;
const Input = styled.input`
  height: 38px; border: 1px solid #e0e0e6; border-radius: 9px; padding: 0 12px;
  font-size: 14px; outline: none; &:focus { border-color: #B8860B; }
`;
const Segmented = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 8px;`;
const SegBtn = styled.button<{ $on: boolean }>`
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 10px 12px; border-radius: 10px; cursor: pointer; text-align: left;
  font-size: 14px; font-weight: 700;
  border: 1.5px solid ${({ $on }) => $on ? '#B8860B' : '#e6e6ec'};
  background: ${({ $on }) => $on ? '#fdf6e7' : '#fff'};
  color: ${({ $on }) => $on ? '#7a5b00' : '#33333c'};
  small { font-size: 11px; font-weight: 500; color: #9a9aa3; }
`;
const ManualRow = styled.button`
  display: inline-flex; align-items: center; gap: 7px;
  border: 1px dashed #d8d8de; background: #fafafa; color: #444;
  border-radius: 9px; padding: 0 14px; height: 38px; font-size: 13px; font-weight: 600; cursor: pointer;
  &:hover { background: #f2f2f5; border-color: #c8c8d0; }
`;
const DropZone = styled.div<{ $over: boolean; $has: boolean }>`
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;
  min-height: 96px; padding: 16px; border-radius: 11px; cursor: pointer; text-align: center;
  border: 1.5px dashed ${({ $over, $has }) => $over ? '#B8860B' : $has ? '#bfe6cf' : '#d6d6dc'};
  background: ${({ $over, $has }) => $over ? '#fdf6e7' : $has ? '#f3fbf6' : '#fafafa'};
  color: ${({ $has }) => $has ? '#0f7a4d' : '#888'};
  font-size: 13px; transition: border-color .12s, background .12s;
`;
const ErrorMsg = styled.div`font-size: 12.5px; color: #c0392b;`;
const Actions = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px;
`;
const ActionsRight = styled.div`display: flex; gap: 8px;`;
const Btn = styled.button<{ $variant: 'ghost' | 'primary' }>`
  height: 38px; padding: 0 18px; border-radius: 9px; font-size: 14px; font-weight: 700; cursor: pointer;
  border: ${({ $variant }) => $variant === 'ghost' ? '1px solid #e0e0e6' : 'none'};
  background: ${({ $variant }) => $variant === 'primary' ? '#B8860B' : '#fff'};
  color: ${({ $variant }) => $variant === 'primary' ? '#fff' : '#55555f'};
  &:disabled { opacity: .5; cursor: not-allowed; }
  &:not(:disabled):hover { filter: brightness(.97); }
`;
