import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useIsNativeUi } from '../../contexts/AppPreviewContext';
import { IconSidebar } from '../../components/layout/IconSidebar';
import {
  Page, DetailBody, DetailHeader, DetailHeaderRow, DetailBackBtn, DetailTitle,
} from '../../components/projects/sharedStyles';
import {
  subscribeOmrQueue, getOmrQueueState, type OmrQueueItem,
} from '../../lib/soloOmrQueue';
import {
  listQueueLog, effectiveStatus, type QueueLogEntry,
} from '../../lib/soloOmrQueueLog';
import { getSoloOmrStatus, getSolo } from '../../api/solos';
import { getOmrStatus, getSheetProject } from '../../api/sheetProjects';
import { getChordProjectOmrStatus, getChordProject } from '../../api/chordProjects';
import { getLickRaw } from '../../api/licks';

/* ─────────────────────────────────────────────────────────────────────────
 * OmrAdminPage (/admin/omr) — admin 전용 OMR 모니터링.
 *
 * 프론트가 볼 수 있는 것만 모은다. 백엔드는 리소스별 omr-status 폴링만
 * 노출하고(전역 job 목록·job_id·콜백 로그 엔드포인트 없음), OMR→Spring
 * 콜백은 서버 내부라 프론트에서 관측 불가하다. 그래서 이 페이지는:
 *
 *   [실행 중]  soloOmrQueue 전역 큐 — 지금 이 탭이 돌리는 대량 OMR 진행률
 *   [기록]     soloOmrQueueLog localStorage — 세션 넘어 살아남는 처리 이력
 *   [조회]     publicId 를 직접 넣어 4개 리소스의 omr-status + 결과 JSON 확인
 *
 * 상태 enum 은 백엔드 OmrProcessingStatus 와 동일: PENDING/PROCESSING/
 * COMPLETED/FAILED (DB 영속 계약이라 이름 그대로 쓴다).
 * ──────────────────────────────────────────────────────────────────────── */

type TabKey = 'live' | 'log' | 'probe';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'live', label: '실행 중' },
  { key: 'log', label: '처리 기록' },
  { key: 'probe', label: 'publicId 조회' },
];

/** 조회 탭에서 고를 수 있는 리소스 — 각각 상태/결과 조회 방식이 다르다. */
type ProbeKind = 'solo' | 'sheet' | 'chord' | 'lick';

const PROBE_KINDS: { key: ProbeKind; label: string; endpoint: string }[] = [
  { key: 'solo', label: '솔로', endpoint: 'GET /v1/solos/{id}/omr-status' },
  { key: 'sheet', label: '악보 프로젝트', endpoint: 'GET /v1/sheet-projects/{id}/omr-status' },
  { key: 'chord', label: '코드 프로젝트', endpoint: 'GET /v1/chord-projects/{id}/omr-status' },
  { key: 'lick', label: '릭', endpoint: 'GET /v1/licks/{id} (omrStatus 필드)' },
];

const PROBE_POLL_MS = 5000;

interface ProbeStatus {
  status: string;
  progress: number | null;
  totalPages: number | null;
  completedPages: number | null;
  failureReason: string | null;
}

/** 리소스별 omr-status 조회를 하나의 모양으로 정규화. 릭은 전용 status
 *  엔드포인트가 없어 엔티티의 omrStatus 필드를 읽는다. */
async function fetchProbeStatus(kind: ProbeKind, publicId: string): Promise<ProbeStatus> {
  if (kind === 'solo') {
    const s = await getSoloOmrStatus(publicId);
    return {
      status: s.status, progress: s.progress,
      totalPages: s.totalPages, completedPages: s.completedPages,
      failureReason: s.failureReason,
    };
  }
  /* sheet/chord 는 생성된 스키마에 페이지 진행 필드가 없다(솔로만 제공). */
  if (kind === 'sheet') {
    const s = await getOmrStatus(publicId);
    return {
      status: s.status, progress: s.progress ?? null,
      totalPages: null, completedPages: null,
      failureReason: s.failureReason,
    };
  }
  if (kind === 'chord') {
    const s = await getChordProjectOmrStatus(publicId);
    return {
      status: s.status, progress: s.progress ?? null,
      totalPages: null, completedPages: null,
      failureReason: s.failureReason ?? null,
    };
  }
  const lick = await getLickRaw(publicId);
  return {
    status: lick.omrStatus ?? '(omrStatus 없음)',
    progress: lick.omrProgress ?? null,
    totalPages: null, completedPages: null,
    failureReason: lick.omrFailureReason ?? null,
  };
}

/** 완료된 리소스의 원본 응답 — 받은 JSON 을 그대로 보여주기 위해. */
async function fetchProbeEntity(kind: ProbeKind, publicId: string): Promise<unknown> {
  if (kind === 'solo') return getSolo(publicId);
  if (kind === 'sheet') return getSheetProject(publicId);
  if (kind === 'chord') return getChordProject(publicId);
  return getLickRaw(publicId);
}

function isTerminal(status: string): boolean {
  return status === 'COMPLETED' || status === 'FAILED';
}

function fmtTime(ms?: number): string {
  if (!ms) return '—';
  return new Date(ms).toLocaleString('ko-KR', { hour12: false });
}

function fmtDuration(from?: number, to?: number): string {
  if (!from || !to) return '—';
  const sec = Math.max(0, Math.round((to - from) / 1000));
  if (sec < 60) return `${sec}초`;
  return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

export default function OmrAdminPage() {
  const navigate = useNavigate();
  const isNativeUi = useIsNativeUi();
  const [tabKey, setTabKey] = useState<TabKey>('live');
  const [toast, setToast] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  /* 전역 큐 구독 — 페이지 밖(모듈)에서 도는 러너의 실시간 상태. */
  const queue = useSyncExternalStore(subscribeOmrQueue, getOmrQueueState);

  const copy = useCallback((text: string, label: string) => {
    navigator.clipboard?.writeText(text).then(
      () => flash(`${label} 복사됨`),
      () => flash('복사에 실패했습니다.'),
    );
  }, [flash]);

  return (
    <Page>
      {!isNativeUi && <IconSidebar />}
      <DetailBody>
        <DetailHeader>
          <DetailHeaderRow>
            <DetailBackBtn type="button" aria-label="뒤로" onClick={() => navigate(-1)}>
              <BackArrow />
            </DetailBackBtn>
            <DetailTitle>OMR 모니터링</DetailTitle>
            <HeaderRight>
              <RunPill $on={queue.running}>
                {queue.running ? (queue.paused ? '일시정지' : '실행 중') : '대기'}
              </RunPill>
            </HeaderRight>
          </DetailHeaderRow>
        </DetailHeader>

        <Body>
          <Tabs role="tablist">
            {TABS.map((t) => (
              <Tab key={t.key} $on={tabKey === t.key} onClick={() => setTabKey(t.key)}>
                {t.label}
              </Tab>
            ))}
          </Tabs>

          {tabKey === 'live' && <LivePane items={queue.items} onCopy={copy} />}
          {tabKey === 'log' && <LogPane onCopy={copy} />}
          {tabKey === 'probe' && <ProbePane onCopy={copy} flash={flash} />}
        </Body>
      </DetailBody>
      {toast && <Toast>{toast}</Toast>}
    </Page>
  );
}

/* ── 실행 중 — 전역 큐 실시간 진행률 ───────────────────────────────────── */
function LivePane({ items, onCopy }: { items: OmrQueueItem[]; onCopy: (t: string, l: string) => void }) {
  if (items.length === 0) {
    return (
      <Empty>
        지금 이 탭에서 처리 중인 OMR 작업이 없습니다.
        <EmptySub>솔로 대량 업로드(Solo Database)를 시작하면 여기에 실시간 진행률이 표시됩니다.</EmptySub>
      </Empty>
    );
  }
  return (
    <CardList>
      {items.map((it) => (
        <JobCard key={it.id}>
          <CardTop>
            <StatusBadge $status={it.status}>{it.status}</StatusBadge>
            <CardTitle>{it.title}</CardTitle>
            {it.publicId && (
              <IdChip type="button" title="publicId 복사" onClick={() => onCopy(it.publicId!, 'publicId')}>
                {it.publicId.slice(0, 8)}…
              </IdChip>
            )}
          </CardTop>
          <BarTrack>
            <BarFill $pct={it.progress} $status={it.status} />
          </BarTrack>
          <CardMeta>
            <span>{it.progress}%</span>
            {it.totalPages != null && (
              <span>페이지 {it.completedPages ?? 0}/{it.totalPages}</span>
            )}
            <MonoSpan>job {it.id}</MonoSpan>
          </CardMeta>
          {it.failureReason && <FailNote>{it.failureReason}</FailNote>}
        </JobCard>
      ))}
    </CardList>
  );
}

/* ── 처리 기록 — localStorage 영속 로그 ────────────────────────────────── */
function LogPane({ onCopy }: { onCopy: (t: string, l: string) => void }) {
  const [entries, setEntries] = useState<QueueLogEntry[]>([]);
  const [filter, setFilter] = useState<'ALL' | 'COMPLETED' | 'FAILED' | 'INTERRUPTED'>('ALL');

  /* 로그는 localStorage 라 이벤트가 없다 — 이 탭이 열려 있는 동안만 주기 갱신. */
  useEffect(() => {
    const load = () => setEntries(listQueueLog());
    load();
    const t = window.setInterval(load, 3000);
    return () => window.clearInterval(t);
  }, []);

  const rows = useMemo(
    () => entries
      .map((e) => ({ e, eff: effectiveStatus(e) }))
      .filter(({ eff }) => filter === 'ALL' || eff === filter),
    [entries, filter],
  );

  const counts = useMemo(() => {
    const c = { COMPLETED: 0, FAILED: 0, INTERRUPTED: 0 };
    for (const e of entries) {
      const eff = effectiveStatus(e);
      if (eff === 'COMPLETED' || eff === 'FAILED' || eff === 'INTERRUPTED') c[eff] += 1;
    }
    return c;
  }, [entries]);

  return (
    <>
      <SubBar>
        <SubTabs>
          {(['ALL', 'COMPLETED', 'FAILED', 'INTERRUPTED'] as const).map((f) => (
            <SubTab key={f} $on={filter === f} onClick={() => setFilter(f)}>
              {f === 'ALL' ? `전체 ${entries.length}` : `${f} ${counts[f]}`}
            </SubTab>
          ))}
        </SubTabs>
        <HintText>브라우저 localStorage 기록 — 이 기기·이 브라우저 기준입니다.</HintText>
      </SubBar>

      {rows.length === 0 ? (
        <Empty>기록이 없습니다.</Empty>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>상태</Th><Th>제목</Th><Th>publicId</Th><Th>등록</Th><Th>소요</Th><Th>실패 사유</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ e, eff }) => (
                <tr key={e.id}>
                  <Td><StatusBadge $status={eff}>{eff}</StatusBadge></Td>
                  <Td>{e.title}</Td>
                  <Td>
                    {e.publicId ? (
                      <IdChip type="button" title="publicId 복사" onClick={() => onCopy(e.publicId!, 'publicId')}>
                        {e.publicId.slice(0, 8)}…
                      </IdChip>
                    ) : <Dim>—</Dim>}
                  </Td>
                  <Td><Dim>{fmtTime(e.queuedAt)}</Dim></Td>
                  <Td><Dim>{fmtDuration(e.startedAt, e.endedAt)}</Dim></Td>
                  <Td>{e.failureReason ? <FailText>{e.failureReason}</FailText> : <Dim>—</Dim>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </>
  );
}

/* ── publicId 조회 — 서버 omr-status 폴링 + 결과 JSON ──────────────────── */
function ProbePane({
  onCopy, flash,
}: { onCopy: (t: string, l: string) => void; flash: (m: string) => void }) {
  const [kind, setKind] = useState<ProbeKind>('sheet');
  const [input, setInput] = useState('');
  /** 폴링 대상 — 조회 버튼을 눌러야 세팅된다(타이핑 중 매번 요청하지 않도록). */
  const [target, setTarget] = useState<{ kind: ProbeKind; publicId: string } | null>(null);
  const [status, setStatus] = useState<ProbeStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [entity, setEntity] = useState<unknown>(null);
  const [entityLoading, setEntityLoading] = useState(false);

  /* 대상이 정해지면 터미널 상태가 될 때까지 폴링. */
  useEffect(() => {
    if (!target) return;
    let alive = true;
    let timer = 0;

    const tick = async () => {
      try {
        const s = await fetchProbeStatus(target.kind, target.publicId);
        if (!alive) return;
        setStatus(s);
        setError(null);
        if (!isTerminal(s.status)) timer = window.setTimeout(tick, PROBE_POLL_MS);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : '상태 조회에 실패했습니다.');
      } finally {
        if (alive) setLoading(false);
      }
    };

    setLoading(true);
    setStatus(null);
    setEntity(null);
    setError(null);
    void tick();
    return () => { alive = false; window.clearTimeout(timer); };
  }, [target]);

  const submit = useCallback(() => {
    const id = input.trim();
    if (!id) return;
    setTarget({ kind, publicId: id });
  }, [input, kind]);

  const loadEntity = useCallback(async () => {
    if (!target) return;
    setEntityLoading(true);
    try {
      setEntity(await fetchProbeEntity(target.kind, target.publicId));
    } catch (e) {
      flash(e instanceof Error ? e.message : '결과를 불러오지 못했습니다.');
    } finally {
      setEntityLoading(false);
    }
  }, [target, flash]);

  const endpoint = PROBE_KINDS.find((k) => k.key === kind)!.endpoint;
  const entityJson = entity ? JSON.stringify(entity, null, 2) : '';

  return (
    <>
      <ProbeForm onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Segmented>
          {PROBE_KINDS.map((k) => (
            <SegBtn key={k.key} type="button" $on={kind === k.key} onClick={() => setKind(k.key)}>
              {k.label}
            </SegBtn>
          ))}
        </Segmented>
        <ProbeRow>
          <TextInput
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="publicId (UUID) 붙여넣기"
            spellCheck={false}
          />
          <PrimaryBtn type="submit" disabled={!input.trim()}>조회</PrimaryBtn>
        </ProbeRow>
        <EndpointHint>{endpoint}</EndpointHint>
      </ProbeForm>

      {error && <ErrorBar>{error}</ErrorBar>}
      {loading && !status && <Empty>조회 중…</Empty>}

      {status && target && (
        <ResultBox>
          <CardTop>
            <StatusBadge $status={status.status}>{status.status}</StatusBadge>
            <IdChip type="button" title="publicId 복사" onClick={() => onCopy(target.publicId, 'publicId')}>
              {target.publicId}
            </IdChip>
            {!isTerminal(status.status) && <PollingDot>폴링 중 · {PROBE_POLL_MS / 1000}s</PollingDot>}
          </CardTop>

          {status.progress != null && (
            <>
              <BarTrack>
                <BarFill $pct={status.progress} $status={status.status} />
              </BarTrack>
              <CardMeta>
                <span>{status.progress}%</span>
                {status.totalPages != null && (
                  <span>페이지 {status.completedPages ?? 0}/{status.totalPages}</span>
                )}
              </CardMeta>
            </>
          )}

          {status.failureReason && <FailNote>{status.failureReason}</FailNote>}

          <ResultActions>
            <ActBtn type="button" disabled={entityLoading} onClick={() => void loadEntity()}>
              {entityLoading ? '불러오는 중…' : '받은 JSON 보기'}
            </ActBtn>
            {entityJson && (
              <ActBtn type="button" onClick={() => onCopy(entityJson, 'JSON')}>📋 JSON 복사</ActBtn>
            )}
          </ResultActions>

          {entityJson && <JsonBox>{entityJson}</JsonBox>}
        </ResultBox>
      )}

      <NoteBox>
        <NoteTitle>이 페이지가 보여줄 수 없는 것</NoteTitle>
        전체 사용자의 OMR 작업 목록, OMR 워커의 <code>job_id</code>, OMR→백엔드 콜백 로그,
        OMR 서버 설정은 백엔드가 API로 노출하지 않아 프론트에서 볼 수 없습니다.
        (콜백은 OMR 서버 → Spring 내부 통신입니다.)
      </NoteBox>
    </>
  );
}

/* ── icons ──────────────────────────────────────────────────────────────── */
const BackArrow = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);

/* ── styled ─────────────────────────────────────────────────────────────── */
const GOLD = '#B8860B';
const GOLD_TINT = 'rgba(184,134,11,0.10)';

function statusColor(s: string): string {
  if (s === 'COMPLETED') return '#2d8f5e';
  if (s === 'FAILED') return '#c04c4c';
  if (s === 'INTERRUPTED') return '#8a6d3b';
  if (s === 'PROCESSING') return GOLD;
  return '#888';
}
function statusTint(s: string): string {
  if (s === 'COMPLETED') return 'rgba(45,143,94,0.12)';
  if (s === 'FAILED') return 'rgba(196,92,92,0.12)';
  if (s === 'INTERRUPTED') return 'rgba(138,109,59,0.14)';
  if (s === 'PROCESSING') return GOLD_TINT;
  return '#eeeeee';
}

const HeaderRight = styled.div` display: flex; align-items: center; gap: 10px; margin-left: auto; `;
const RunPill = styled.span<{ $on: boolean }>`
  font-size: 12.5px; font-weight: 700; padding: 5px 12px; border-radius: 999px; white-space: nowrap;
  color: ${({ $on }) => ($on ? '#fff' : '#8a7a52')};
  background: ${({ $on }) => ($on ? GOLD : GOLD_TINT)};
`;

const Body = styled.div`
  flex: 1; min-height: 0; overflow-y: auto; background: ${({ theme }) => theme.colors.barBelow};
  padding: 16px 24px calc(24px + env(safe-area-inset-bottom, 0px));
  font-family: ${({ theme }) => theme.fonts.ui};
`;
const Tabs = styled.div` display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; `;
const Tab = styled.button<{ $on: boolean }>`
  padding: 7px 15px; border: none; border-radius: 999px; cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui}; font-size: 13.5px;
  font-weight: ${({ $on }) => ($on ? 700 : 500)};
  color: ${({ $on }) => ($on ? '#fff' : '#666')};
  background: ${({ $on }) => ($on ? GOLD : '#ececeb')};
  &:hover { background: ${({ $on }) => ($on ? '#a5790a' : '#e2e2e0')}; }
`;

const CardList = styled.div` display: flex; flex-direction: column; gap: 12px; `;
const JobCard = styled.div`
  background: ${({ theme }) => theme.colors.surface}; border: 1px solid ${({ theme }) => theme.colors.border}; border-radius: 12px; padding: 14px 16px;
  display: flex; flex-direction: column; gap: 9px;
`;
const CardTop = styled.div` display: flex; align-items: center; gap: 9px; flex-wrap: wrap; min-width: 0; `;
const CardTitle = styled.span`
  flex: 1; min-width: 0; font-size: 14px; font-weight: 600; color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const StatusBadge = styled.span<{ $status: string }>`
  flex: 0 0 auto; font-size: 10.5px; font-weight: 700; padding: 3px 9px; border-radius: 6px;
  color: ${({ $status }) => statusColor($status)};
  background: ${({ $status }) => statusTint($status)};
`;
const IdChip = styled.button`
  flex: 0 0 auto; border: 1px solid ${({ theme }) => theme.colors.border}; background: ${({ theme }) => theme.colors.surfaceSunken}; border-radius: 6px;
  padding: 3px 8px; cursor: pointer; color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.fonts.chord}; font-size: 11px;
  &:hover { background: ${({ theme }) => theme.colors.surfaceSunken}; }
`;
const BarTrack = styled.div` height: 7px; border-radius: 999px; background: ${({ theme }) => theme.colors.surfaceSunken}; overflow: hidden; `;
const BarFill = styled.div<{ $pct: number; $status: string }>`
  height: 100%; border-radius: 999px; transition: width 0.4s ease;
  width: ${({ $pct }) => Math.max(0, Math.min(100, $pct))}%;
  background: ${({ $status }) => statusColor($status)};
`;
const CardMeta = styled.div` display: flex; gap: 14px; flex-wrap: wrap; font-size: 12px; color: ${({ theme }) => theme.colors.textSecondary}; `;
const MonoSpan = styled.span` font-family: ${({ theme }) => theme.fonts.chord}; font-size: 11px; color: ${({ theme }) => theme.colors.textSecondary}; `;
const FailNote = styled.div`
  font-size: 12.5px; line-height: 1.55; color: ${({ theme }) => theme.colors.danger};
  background: rgba(160,48,34,0.07); padding: 8px 11px; border-radius: 8px;
`;

const SubBar = styled.div` display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; `;
const SubTabs = styled.div` display: flex; gap: 6px; flex-wrap: wrap; `;
const SubTab = styled.button<{ $on: boolean }>`
  padding: 5px 12px; border-radius: 8px; cursor: pointer; font-size: 12.5px;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-weight: ${({ $on }) => ($on ? 700 : 500)};
  border: 1px solid ${({ $on }) => ($on ? GOLD : '#e2e2e2')};
  color: ${({ $on }) => ($on ? GOLD : '#777')};
  background: ${({ $on }) => ($on ? GOLD_TINT : '#fff')};
`;
const HintText = styled.div` font-size: 11.5px; color: ${({ theme }) => theme.colors.textSecondary}; `;

const TableWrap = styled.div` background: ${({ theme }) => theme.colors.surface}; border: 1px solid ${({ theme }) => theme.colors.border}; border-radius: 12px; overflow-x: auto; `;
const Table = styled.table` width: 100%; border-collapse: collapse; font-size: 13px; `;
const Th = styled.th`
  text-align: left; padding: 11px 14px; font-size: 11.5px; font-weight: 700; color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.surfaceSunken}; border-bottom: 1px solid ${({ theme }) => theme.colors.border}; white-space: nowrap;
`;
const Td = styled.td` padding: 10px 14px; border-bottom: 1px solid ${({ theme }) => theme.colors.border}; color: ${({ theme }) => theme.colors.textPrimary}; vertical-align: middle; `;
const Dim = styled.span` color: ${({ theme }) => theme.colors.textSecondary}; font-size: 12px; `;
const FailText = styled.span` color: ${({ theme }) => theme.colors.danger}; font-size: 12px; `;

const ProbeForm = styled.form` display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px; `;
const ProbeRow = styled.div` display: flex; gap: 10px; align-items: center; `;
const Segmented = styled.div` display: inline-flex; background: ${({ theme }) => theme.colors.surfaceSunken}; border-radius: 9px; padding: 3px; align-self: flex-start; flex-wrap: wrap; `;
const SegBtn = styled.button<{ $on: boolean }>`
  border: none; border-radius: 7px; padding: 7px 14px; cursor: pointer; font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.ui}; font-weight: ${({ $on }) => ($on ? 700 : 500)};
  color: ${({ $on }) => ($on ? '#fff' : '#777')}; background: ${({ $on }) => ($on ? GOLD : 'transparent')};
`;
const TextInput = styled.input`
  flex: 1; min-width: 0; height: 40px; padding: 0 13px; border: 1px solid ${({ theme }) => theme.colors.border}; border-radius: 9px; outline: none;
  font-family: ${({ theme }) => theme.fonts.chord}; font-size: 13.5px; color: ${({ theme }) => theme.colors.textPrimary}; background: ${({ theme }) => theme.colors.surface};
  &:focus { border-color: ${GOLD}; }
`;
const PrimaryBtn = styled.button`
  border: none; background: ${GOLD}; color: #fff; cursor: pointer; padding: 0 22px; height: 40px; border-radius: 9px;
  font-family: ${({ theme }) => theme.fonts.ui}; font-size: 13.5px; font-weight: 700;
  &:hover { background: #a5790a; } &:disabled { opacity: 0.45; cursor: not-allowed; }
`;
const EndpointHint = styled.div`
  font-family: ${({ theme }) => theme.fonts.chord}; font-size: 11.5px; color: ${({ theme }) => theme.colors.textSecondary};
`;

const ResultBox = styled.div`
  background: ${({ theme }) => theme.colors.surface}; border: 1px solid ${({ theme }) => theme.colors.border}; border-radius: 12px; padding: 16px;
  display: flex; flex-direction: column; gap: 10px; margin-bottom: 16px;
`;
const PollingDot = styled.span` font-size: 11.5px; color: ${GOLD}; font-weight: 600; `;
const ResultActions = styled.div` display: flex; gap: 8px; flex-wrap: wrap; `;
const ActBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 9px; cursor: pointer;
  border: 1px solid ${({ theme }) => theme.colors.border}; background: ${({ theme }) => theme.colors.surface}; color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ${({ theme }) => theme.fonts.ui}; font-size: 12.5px; font-weight: 600;
  &:hover { background: ${({ theme }) => theme.colors.surfaceSunken}; } &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const JsonBox = styled.pre`
  margin: 0; max-height: 460px; overflow: auto; background: ${({ theme }) => theme.colors.surfaceSunken}; border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px; padding: 14px; font-family: ${({ theme }) => theme.fonts.chord};
  font-size: 12px; line-height: 1.6; color: ${({ theme }) => theme.colors.textPrimary}; white-space: pre-wrap; word-break: break-word;
`;
const NoteBox = styled.div`
  font-size: 12.5px; line-height: 1.65; color: #8a7a52; background: ${GOLD_TINT};
  padding: 12px 14px; border-radius: 10px;
  code { background: ${({ theme }) => theme.colors.activeFill}; padding: 1px 5px; border-radius: 4px; font-family: ${({ theme }) => theme.fonts.chord}; }
`;
const NoteTitle = styled.div` font-weight: 700; margin-bottom: 4px; `;

const Empty = styled.div` padding: 40px 14px; font-size: 13.5px; color: ${({ theme }) => theme.colors.textSecondary}; text-align: center; `;
const EmptySub = styled.div` margin-top: 8px; font-size: 12.5px; color: ${({ theme }) => theme.colors.textSecondary}; `;
const ErrorBar = styled.div`
  margin-bottom: 14px; padding: 10px 13px; border-radius: 9px;
  background: rgba(160,48,34,0.08); color: ${({ theme }) => theme.colors.danger}; font-size: 12.5px;
`;
const Toast = styled.div`
  position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); z-index: ${({ theme }) => theme.zIndex.toast};
  background: ${({ theme }) => theme.colors.inkSurface}; color: ${({ theme }) => theme.colors.onInk}; font-size: 13px; font-weight: 500; padding: 11px 18px; border-radius: 10px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.25); font-family: ${({ theme }) => theme.fonts.ui}; max-width: 90vw;
`;
