import { useMemo, useState } from 'react';
import styled from 'styled-components';
import { tint } from '../../styles/theme';
import { KeyPicker } from './KeyPicker';
import { isValidTimeSignature } from '../../api/projectPreprocessRules';
import type {
  ConfirmPreprocessBody,
  ConfirmableDocumentType,
  ProjectPreprocess,
  PreprocessWarning,
} from '../../api/projectPreprocess';

/* ─────────────────────────────────────────────────────────────────────────
 * PreprocessReviewModal — 전처리(자동 인식) 결과를 사용자가 확인·정정하는 폼.
 * 문서서버 #32 §3 "전처리 응답 UI 규칙"을 그대로 구현한다:
 *
 *  1. documentType=unknown 이면 유형 선택을 필수로 표시
 *  2. 감지된 유형도 사용자가 바꿀 수 있어야 함
 *  3. metadata 는 제안일 뿐이므로 모든 입력이 편집 가능
 *  4. confidence 가 null 이어도 오류로 처리하지 않음
 *  5. warnings 가 있어도 READY 면 직접 입력해 확정 가능(실패 화면이 아님)
 *  6. 경고 분기는 message 가 아니라 code 로
 * ──────────────────────────────────────────────────────────────────────── */

interface Props {
  open: boolean;
  preprocess: ProjectPreprocess | null;
  /** confirm 진행 중 — 버튼 비활성화(중복 클릭 방지, 체크리스트 §10). */
  confirming?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (body: ConfirmPreprocessBody) => void;
}

/** 신뢰도 배지 문구. null 이면 배지를 아예 그리지 않는다(규칙 4). */
function confidenceLabel(c: number | null): string | null {
  if (c == null) return null;
  return `${Math.round(c * 100)}%`;
}

/** 낮은 신뢰도는 사용자가 더 유심히 보도록 색으로 구분한다. */
function confidenceTone(c: number | null): 'high' | 'low' {
  return c != null && c >= 0.8 ? 'high' : 'low';
}

/** 경고 코드 → 사용자 안내. 알 수 없는 코드는 서버 message 를 그대로 보여준다. */
function warningText(w: PreprocessWarning): string {
  switch (w.code) {
    case 'CLASSIFICATION_UNAVAILABLE':
      return '문서 유형을 자동으로 인식하지 못했어요. 아래에서 직접 선택해 주세요.';
    case 'METADATA_UNAVAILABLE':
      return '제목·작곡가를 자동으로 읽지 못했어요. 직접 입력해 주세요.';
    default:
      return w.message;
  }
}

export function PreprocessReviewModal({
  open, preprocess, confirming = false, error = null, onCancel, onConfirm,
}: Props) {
  if (!open || !preprocess) return null;
  /* 세션이 바뀌면 폼을 통째로 새로 만든다 — props 를 effect 로 state 에 복사하면
   * 계단식 렌더가 생기고, 편집 중 부모 리렌더에 입력이 되돌아갈 위험도 있다.
   * key 로 리마운트하면 초기값을 useState 초기화자 하나로 끝낼 수 있다. */
  return (
    <ReviewForm
      key={preprocess.preprocessId}
      preprocess={preprocess}
      confirming={confirming}
      error={error}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

interface FormProps {
  preprocess: ProjectPreprocess;
  confirming: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (body: ConfirmPreprocessBody) => void;
}

function ReviewForm({ preprocess, confirming, error, onCancel, onConfirm }: FormProps) {
  // unknown 이면 선택을 강제하기 위해 비워 둔다(규칙 1).
  const [documentType, setDocumentType] = useState<ConfirmableDocumentType | null>(
    preprocess.documentType === 'unknown' ? null : preprocess.documentType,
  );
  // 제목 제안이 없으면 파일명(확장자 제외)으로 시작 — 빈 폼보다 낫다.
  const [title, setTitle] = useState(
    () => preprocess.metadata.title?.trim() || preprocess.originalFilename.replace(/\.[^.]+$/, ''),
  );
  const [composer, setComposer] = useState(preprocess.metadata.composer ?? '');
  const [performer, setPerformer] = useState(preprocess.metadata.performer ?? '');
  const [key, setKey] = useState(() => preprocess.metadata.key?.trim() || 'C');
  const [timeSignature, setTimeSignature] = useState(
    () => preprocess.metadata.timeSignature?.trim() || '4/4',
  );
  const [touchedTitle, setTouchedTitle] = useState(false);

  const warnings = preprocess.warnings;
  const titleInvalid = touchedTitle && !title.trim();
  const canConfirm = !!documentType && !!title.trim() && !confirming;

  /* 박자표는 백엔드가 "양의 정수/양의 정수"만 받는다(PROJECT_PREPROCESS_005).
   * 서버 왕복 전에 걸러 사용자가 바로 고칠 수 있게 한다. */
  const timeSignatureInvalid = useMemo(
    () => !isValidTimeSignature(timeSignature),
    [timeSignature],
  );

  const submit = () => {
    if (!documentType || !title.trim() || timeSignatureInvalid) {
      setTouchedTitle(true);
      return;
    }
    onConfirm({
      documentType,
      title: title.trim(),
      // 빈 문자열 대신 null — 백엔드 @Nullable 계약에 맞춘다.
      composer: composer.trim() || null,
      performer: performer.trim() || null,
      key: key.trim() || null,
      timeSignature: timeSignature.trim() || null,
    });
  };

  return (
    <Backdrop onMouseDown={(e) => { if (e.target === e.currentTarget && !confirming) onCancel(); }}>
      <Card onMouseDown={(e) => e.stopPropagation()}>
        <CardTitle>인식 결과 확인</CardTitle>
        <SubText>
          {preprocess.originalFilename}
          {preprocess.pageCount > 1 && ` · ${preprocess.pageCount}페이지`}
        </SubText>

        {warnings.length > 0 && (
          <WarnBox>
            {warnings.map((w, i) => <div key={`${w.code}-${i}`}>{warningText(w)}</div>)}
          </WarnBox>
        )}

        <Field>
          <Label>
            문서 유형
            {preprocess.documentType === 'unknown' && <Req> · 직접 선택해 주세요</Req>}
            {preprocess.documentType !== 'unknown'
              && confidenceLabel(preprocess.documentTypeConfidence)
              && <Conf $tone={confidenceTone(preprocess.documentTypeConfidence)}>
                   자동 인식 {confidenceLabel(preprocess.documentTypeConfidence)}
                 </Conf>}
          </Label>
          <Segmented>
            <SegBtn
              type="button"
              $on={documentType === 'chord_chart'}
              onClick={() => setDocumentType('chord_chart')}
            >
              코드 차트<small>iReal Pro 류 · 코드만</small>
            </SegBtn>
            <SegBtn
              type="button"
              $on={documentType === 'sheet_music'}
              onClick={() => setDocumentType('sheet_music')}
            >
              악보<small>음표까지 채보</small>
            </SegBtn>
          </Segmented>
        </Field>

        <Field>
          <Label>
            제목
            {confidenceLabel(preprocess.confidence.title)
              && <Conf $tone={confidenceTone(preprocess.confidence.title)}>
                   {confidenceLabel(preprocess.confidence.title)}
                 </Conf>}
          </Label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => setTouchedTitle(true)}
            placeholder="예: Autumn Leaves"
            $invalid={titleInvalid}
            maxLength={255}
          />
          {titleInvalid && <ErrorMsg>제목을 입력해 주세요.</ErrorMsg>}
        </Field>

        <Row>
          <Field>
            <Label>
              작곡가
              {confidenceLabel(preprocess.confidence.composer)
                && <Conf $tone={confidenceTone(preprocess.confidence.composer)}>
                     {confidenceLabel(preprocess.confidence.composer)}
                   </Conf>}
            </Label>
            <Input
              value={composer}
              onChange={(e) => setComposer(e.target.value)}
              placeholder="선택"
              maxLength={255}
            />
          </Field>
          <Field>
            <Label>
              연주자
              {confidenceLabel(preprocess.confidence.performer)
                && <Conf $tone={confidenceTone(preprocess.confidence.performer)}>
                     {confidenceLabel(preprocess.confidence.performer)}
                   </Conf>}
            </Label>
            <Input
              value={performer}
              onChange={(e) => setPerformer(e.target.value)}
              placeholder="선택"
              maxLength={255}
            />
          </Field>
        </Row>

        <Row>
          <Field>
            <Label>조성</Label>
            <KeyPicker value={key} onChange={setKey} />
          </Field>
          <Field>
            <Label>박자표</Label>
            <Input
              value={timeSignature}
              onChange={(e) => setTimeSignature(e.target.value)}
              placeholder="4/4"
              $invalid={timeSignatureInvalid}
              maxLength={10}
            />
            {timeSignatureInvalid && <ErrorMsg>4/4 처럼 숫자/숫자 형식이어야 해요.</ErrorMsg>}
          </Field>
        </Row>

        {error && <ErrorMsg>{error}</ErrorMsg>}

        <Actions>
          <Btn type="button" $variant="ghost" onClick={onCancel} disabled={confirming}>취소</Btn>
          <Btn type="button" $variant="primary" onClick={submit} disabled={!canConfirm || timeSignatureInvalid}>
            {confirming ? '생성 중…' : '확정하고 생성'}
          </Btn>
        </Actions>
      </Card>
    </Backdrop>
  );
}

/* ── styles — ProjectCreateModal 과 동일 토큰을 쓴다 ────────────────────── */

const Backdrop = styled.div`
  position: fixed; inset: 0; background: ${({ theme }) => theme.colors.scrim};
  z-index: ${({ theme }) => theme.zIndex.max}; display: flex; align-items: center; justify-content: center; padding: 24px;
`;
const Card = styled.div`
  background: ${({ theme }) => theme.colors.surface}; border-radius: 14px; width: min(520px, 100%);
  padding: 22px 22px 18px; box-shadow: 0 16px 48px rgba(0,0,0,.3);
  display: flex; flex-direction: column; gap: 13px;
  max-height: calc(100vh - 48px); overflow-y: auto;
`;
const CardTitle = styled.h2`margin: 0; font-size: 18px; font-weight: 800; color: ${({ theme }) => theme.colors.textPrimary};`;
const SubText = styled.div`font-size: 12.5px; color: ${({ theme }) => theme.colors.textSecondary}; margin-top: -8px;`;
const Field = styled.div`display: flex; flex-direction: column; gap: 6px; min-width: 0; flex: 1;`;
const Row = styled.div`display: flex; gap: 10px;`;
const Label = styled.label`
  font-size: 12.5px; font-weight: 600; color: ${({ theme }) => theme.colors.textSecondary};
  display: flex; align-items: center; gap: 6px;
`;
const Req = styled.span`font-size: 11.5px; font-weight: 600; color: ${({ theme }) => theme.colors.danger};`;
const Conf = styled.span<{ $tone: 'high' | 'low' }>`
  font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 999px;
  background: ${({ $tone }) => ($tone === 'high' ? '#eef7f1' : '#fdf4e7')};
  color: ${({ $tone }) => ($tone === 'high' ? '#0f7a4d' : '#9a6b00')};
`;
const Input = styled.input<{ $invalid?: boolean }>`
  height: 38px; border: 1px solid ${({ $invalid }) => ($invalid ? '#e2a09a' : '#e0e0e6')};
  border-radius: 9px; padding: 0 12px; font-size: 14px; outline: none;
  &:focus { border-color: ${({ $invalid }) => ($invalid ? '#c0392b' : '#B8860B')}; }
`;
const Segmented = styled.div`display: grid; grid-template-columns: 1fr 1fr; gap: 8px;`;
const SegBtn = styled.button<{ $on: boolean }>`
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  padding: 10px 12px; border-radius: 10px; cursor: pointer; text-align: left;
  font-size: 14px; font-weight: 700;
  border: 1.5px solid ${({ $on }) => ($on ? '#B8860B' : '#e6e6ec')};
  background: ${({ $on }) => ($on ? '#fdf6e7' : '#fff')};
  color: ${({ $on }) => ($on ? '#7a5b00' : '#33333c')};
  small { font-size: 11px; font-weight: 500; color: ${({ theme }) => theme.colors.textSecondary}; }
`;
const WarnBox = styled.div`
  display: flex; flex-direction: column; gap: 4px;
  background: ${tint('#fdf6e7', 'rgba(224, 184, 88, 0.12)')}; border: 1px solid #f0e0bb; border-radius: 9px;
  padding: 9px 11px; font-size: 12.5px; color: #7a5b00; line-height: 1.45;
`;
const ErrorMsg = styled.div`font-size: 12.5px; color: ${({ theme }) => theme.colors.danger};`;
const Actions = styled.div`
  display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 2px;
`;
const Btn = styled.button<{ $variant: 'ghost' | 'primary' }>`
  height: 38px; padding: 0 18px; border-radius: 9px; font-size: 14px; font-weight: 700; cursor: pointer;
  border: ${({ $variant }) => ($variant === 'ghost' ? '1px solid #e0e0e6' : 'none')};
  background: ${({ $variant }) => ($variant === 'primary' ? '#B8860B' : '#fff')};
  color: ${({ $variant }) => ($variant === 'primary' ? '#fff' : '#55555f')};
  &:disabled { opacity: .5; cursor: not-allowed; }
  &:not(:disabled):hover { filter: brightness(.97); }
`;
