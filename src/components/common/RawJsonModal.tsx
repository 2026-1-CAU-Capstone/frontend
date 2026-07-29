/* 응답값 받기 (admin 전용 디버깅) — 백엔드 GET 응답 원문을 그대로 보여주는 모달.
 *
 * 왜 api 클라이언트를 안 쓰나: 클라이언트들은 `{ data: … }` 봉투를 벗기고 타입에
 * 맞춰 가공한다. 여기서는 "서버가 실제로 뭘 내려줬나"를 확인하는 게 목적이라
 * authFetch 로 직접 때려 응답 본문을 손대지 않고 출력한다(상태코드 포함).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styled from 'styled-components';
import { authFetch } from '../../api/auth';

export interface RawJsonSource {
  /** 탭 이름 (예: 'project', 'analysis') */
  label: string;
  /** `/v1/...` 경로 */
  path: string;
}

interface Props {
  open: boolean;
  title: string;
  sources: RawJsonSource[];
  onClose: () => void;
}

interface Fetched {
  status: number | null;
  body: string;
  error: string | null;
}

export function RawJsonModal({ open, title, sources, onClose }: Props) {
  const [active, setActive] = useState(0);
  const [results, setResults] = useState<Record<string, Fetched>>({});
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const current = sources[active];
  const path = current?.path;
  const shown = path ? results[path] : undefined;
  /* 이미 요청을 건 경로. sources 는 호출부에서 인라인 배열로 넘어와 매 렌더 새
   * 참조라, 이 가드가 없으면 응답이 오기 전에 effect 가 계속 재실행되며 같은 요청을
   * 무한히 쏜다(모달이 아예 안 그려지던 원인). */
  const requestedRef = useRef<Set<string>>(new Set());

  const load = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const res = await authFetch(p);
      const text = await res.text();
      let body = text;
      try { body = JSON.stringify(JSON.parse(text), null, 2); } catch { /* JSON 이 아니면 원문 그대로 */ }
      // 실패 응답(4xx/5xx)도 그대로 보여준다 — 그게 확인하려는 값이다.
      setResults((prev) => ({ ...prev, [p]: { status: res.status, body, error: null } }));
    } catch (e) {
      setResults((prev) => ({
        ...prev,
        [p]: { status: null, body: '', error: e instanceof Error ? e.message : '요청 실패' },
      }));
    } finally {
      setLoading(false);
    }
  }, []);

  // 열릴 때/탭을 옮길 때 아직 안 받아온 것만 한 번씩 요청한다.
  useEffect(() => {
    if (!open || !path) return;
    if (requestedRef.current.has(path)) return;
    requestedRef.current.add(path);
    void load(path);
  }, [open, path, load]);

  // 닫으면 상태를 비워 다음에 열 때 항상 최신 응답을 받는다.
  useEffect(() => {
    if (!open) {
      setResults({});
      setActive(0);
      setCopied(false);
      requestedRef.current.clear();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  /* document.body 로 포털 — 페이지 어딘가의 조상이 transform/overflow 를 갖고 있으면
   * position:fixed 가 뷰포트가 아니라 그 조상 기준이 되어 화면 밖으로 밀리거나 잘린다.
   * (모달을 열어도 아무것도 안 보이던 증상) 포털이면 그런 영향을 받지 않는다. */
  return createPortal(
    <Backdrop onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()} role="dialog" aria-label="응답값">
        <Head>
          <div>
            <Title>응답값 <Badge>admin</Badge></Title>
            <Sub title={title}>{title}</Sub>
          </div>
          <HeadBtns>
            <SmallBtn
              type="button"
              onClick={() => {
                if (!shown?.body) return;
                void navigator.clipboard?.writeText(shown.body).then(() => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1200);
                });
              }}
            >{copied ? '복사됨' : '복사'}</SmallBtn>
            <SmallBtn type="button" onClick={() => { if (path) { requestedRef.current.add(path); void load(path); } }}>다시 받기</SmallBtn>
            <SmallBtn type="button" onClick={onClose}>닫기</SmallBtn>
          </HeadBtns>
        </Head>

        {sources.length > 1 && (
          <Tabs>
            {sources.map((s, i) => (
              <Tab key={s.path} type="button" $on={i === active} onClick={() => setActive(i)}>
                {s.label}
              </Tab>
            ))}
          </Tabs>
        )}

        <PathLine>
          <code>GET {current?.path}</code>
          {shown?.status != null && <Status $ok={shown.status >= 200 && shown.status < 300}>{shown.status}</Status>}
        </PathLine>

        <Pre>
          {loading && !shown ? '불러오는 중…'
            : shown?.error ? `요청 실패: ${shown.error}`
            : shown?.body || ''}
        </Pre>
      </Card>
    </Backdrop>,
    document.body,
  );
}

/* ── styles ──────────────────────────────────────────────────────────────── */

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  /* 최상위 — admin 디버깅 도구라 어떤 오버레이보다 위에 떠야 확인이 된다. */
  z-index: ${({ theme }) => theme.zIndex.max};
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const Card = styled.div`
  width: min(860px, 100%);
  max-height: 82vh;
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  border-radius: 14px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  padding: 18px 20px 20px;
  font-family: 'Pretendard', sans-serif;
`;

const Head = styled.div`
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
`;

const Title = styled.div`
  font-size: 1.05rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  display: flex;
  align-items: center;
  gap: 6px;
`;

const Badge = styled.span`
  font-size: 0.66rem;
  font-weight: 700;
  padding: 2px 6px;
  border-radius: 4px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Sub = styled.div`
  margin-top: 2px;
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  max-width: 520px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const HeadBtns = styled.div`
  display: flex;
  gap: 6px;
  flex-shrink: 0;
`;

const SmallBtn = styled.button`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.78rem;
  font-weight: 600;
  padding: 6px 11px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  &:hover { background: ${({ theme }) => theme.colors.bgSecondary}; }
`;

const Tabs = styled.div`
  display: flex;
  gap: 4px;
`;

const Tab = styled.button<{ $on?: boolean }>`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.8rem;
  font-weight: 700;
  padding: 5px 12px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid ${({ $on, theme }) => ($on ? 'transparent' : theme.colors.border)};
  background: ${({ $on, theme }) => ($on ? theme.colors.textPrimary : theme.colors.bgPrimary)};
  color: ${({ $on, theme }) => ($on ? theme.colors.bgPrimary : theme.colors.textPrimary)};
`;

const PathLine = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
`;

const Status = styled.span<{ $ok?: boolean }>`
  font-weight: 700;
  color: ${({ $ok }) => ($ok ? '#1f9a52' : '#c0392b')};
`;

const Pre = styled.pre`
  flex: 1;
  min-height: 160px;
  overflow: auto;
  margin: 0;
  padding: 12px 14px;
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  line-height: 1.5;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: pre-wrap;
  word-break: break-word;
`;
