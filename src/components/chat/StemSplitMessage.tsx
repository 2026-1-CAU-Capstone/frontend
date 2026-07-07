/* 채팅 인라인 스템 분리 카드.
 *
 * 오디오 첨부 + "스템 분리해줘 / 피아노만 빼줘 / MR 만들어줘" 류 메시지가
 * rule-based 인텐트로 감지되면 어시스턴트 메시지에 이 카드가 붙는다
 * (RightChatPanel.handleSend → message.stemRequest).
 *
 * /stems 페이지와 동일한 파이프라인(mockSeparate — 데모 EQ 근사)을 카드 안에서
 * 직접 돌리고, 인텐트에 따라:
 *   - split   → 스템별 미니 믹서(볼륨/뮤트/솔로/개별 다운) + 전체/현재상태 저장
 *   - extract → 대상 스템 한 트랙 재생 + 다운로드
 *   - remove  → 대상 제외 믹스다운 한 트랙 재생 + 다운로드 (보컬 제거 = MR)
 * "믹서에서 열기"는 /stems로 파일을 넘겨(route state) 풀 믹서를 연다.
 * File 객체 기반이라 새로고침 후에는 카드가 남지 않는다(비영속). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { separate, type SeparatedStem } from '../../lib/stems/mockSeparate';
import { describeStemIntent, type StemIntent } from '../../lib/stems/intent';
import { audioBufferToWavBlob, downloadBlob } from '../../lib/stems/wavEncode';

export interface StemChatRequest {
  file: File;
  intent: StemIntent;
}

interface CardTrack {
  stem: SeparatedStem;
  volume: number;
  muted: boolean;
  solo: boolean;
}

/* 카드 공용 AudioContext — 카드마다 new AudioContext를 만들면 StrictMode
 * 이중 마운트/여러 카드에서 브라우저 컨텍스트 한도(≈6개)에 걸리고 닫기
 * 타이밍도 꼬인다. 하나를 lazy 생성해 모든 카드가 공유하고 닫지 않는다. */
let sharedCtx: AudioContext | null = null;
function getSharedCtx(): AudioContext {
  if (!sharedCtx || sharedCtx.state === 'closed') sharedCtx = new AudioContext();
  return sharedCtx;
}

type Phase = 'working' | 'ready' | 'error';

function effGain(t: CardTrack, anySolo: boolean): number {
  if (t.muted) return 0;
  if (anySolo && !t.solo) return 0;
  return t.volume / 100;
}

function baseName(name: string): string { return name.replace(/\.[^.]+$/, ''); }

/** 대상 제외 합성(remove 모드) — 동일 게인 믹스다운. */
async function renderWithout(stems: SeparatedStem[], targetId: string): Promise<AudioBuffer> {
  const keep = stems.filter((s) => s.def.id !== targetId);
  const ref = keep[0].buffer;
  const off = new OfflineAudioContext(ref.numberOfChannels, ref.length, ref.sampleRate);
  for (const s of keep) {
    const src = off.createBufferSource();
    src.buffer = s.buffer;
    src.connect(off.destination);
    src.start(0);
  }
  return off.startRendering();
}

export function StemSplitMessage({ request }: { request: StemChatRequest }) {
  const navigate = useNavigate();
  const { file, intent } = request;

  const [phase, setPhase] = useState<Phase>('working');
  const [progress, setProgress] = useState(0);
  const [tracks, setTracks] = useState<CardTrack[]>([]);
  /** extract/remove 모드의 단일 결과 버퍼. */
  const [single, setSingle] = useState<AudioBuffer | null>(null);
  const [playing, setPlaying] = useState(false);

  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const gainsRef = useRef<Map<string, GainNode>>(new Map());
  const tracksRef = useRef<CardTrack[]>([]);
  tracksRef.current = tracks;

  /* ── 분리 실행 ────────────────────────────────────────────────────────
   * StrictMode는 마운트-언마운트-재마운트로 이펙트를 두 번 돌린다. ref로
   * "1회만" 가드하면 첫 실행은 cancelled로 죽고 두 번째는 가드에 막혀
   * 카드가 0%에 영구 고착됐다 — 가드 없이 cancelled 플래그만 쓴다(첫
   * 실행의 상태 갱신만 무시되고 살아남은 실행이 정상 완료). */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const ab = await file.arrayBuffer();
        if (cancelled) return;
        const decoded = await getSharedCtx().decodeAudioData(ab);
        if (cancelled) return;
        const stems = await separate(decoded, intent.preset, (r) => { if (!cancelled) setProgress(r); });
        if (cancelled) return;

        if (intent.kind === 'extract' && intent.target) {
          const hit = stems.find((s) => s.def.id === intent.target) ?? stems[0];
          setSingle(hit.buffer);
          setTracks([{ stem: hit, volume: 90, muted: false, solo: false }]);
        } else if (intent.kind === 'remove' && intent.target) {
          const mixed = await renderWithout(stems, intent.target);
          // 단일 트랙 카드로 표시 — def는 라벨/색만 차용.
          const label = intent.target === 'vocals' ? '반주 (MR)' : `${describeStemIntent(intent)} 결과`;
          setSingle(mixed);
          setTracks([{
            stem: { def: { id: 'result', label, emoji: '🎼', color: '#33415c', chains: [] }, buffer: mixed },
            volume: 90, muted: false, solo: false,
          }]);
        } else {
          setTracks(stems.map((stem) => ({ stem, volume: 85, muted: false, solo: false })));
        }
        setPhase('ready');
      } catch (e) {
        console.error('[stem-chat] failed:', e);
        if (!cancelled) setPhase('error');
      }
    })();
    return () => { cancelled = true; };
  }, [file, intent]);

  /* ── 재생 (카드 내 단순 재생/정지 — 시크/루프는 /stems에서) ─────────── */
  const stopAll = useCallback(() => {
    sourcesRef.current.forEach((s) => { try { s.onended = null; s.stop(); } catch { /* noop */ } });
    sourcesRef.current = [];
    setPlaying(false);
  }, []);

  const togglePlay = useCallback(() => {
    if (phase !== 'ready') return;
    if (playing) { stopAll(); return; }
    const ctx = getSharedCtx();
    void ctx.resume();
    const anySolo = tracksRef.current.some((t) => t.solo);
    const list: AudioBufferSourceNode[] = [];
    for (const t of tracksRef.current) {
      const src = ctx.createBufferSource();
      src.buffer = t.stem.buffer;
      const g = ctx.createGain();
      g.gain.value = effGain(t, anySolo);
      src.connect(g); g.connect(ctx.destination);
      gainsRef.current.set(t.stem.def.id, g);
      src.start(0);
      list.push(src);
    }
    sourcesRef.current = list;
    setPlaying(true);
    if (list[0]) list[0].onended = () => setPlaying(false);
  }, [phase, playing, stopAll]);

  // 믹서 조작 라이브 반영
  useEffect(() => {
    const anySolo = tracks.some((t) => t.solo);
    for (const t of tracks) {
      const g = gainsRef.current.get(t.stem.def.id);
      if (g) g.gain.value = effGain(t, anySolo);
    }
  }, [tracks]);

  // 언마운트 정리 — 공유 ctx는 닫지 않고 이 카드의 소스만 정지.
  useEffect(() => () => {
    sourcesRef.current.forEach((s) => { try { s.stop(); } catch { /* noop */ } });
  }, []);

  const update = useCallback((id: string, patch: Partial<CardTrack>) => {
    setTracks((prev) => prev.map((t) => (t.stem.def.id === id ? { ...t, ...patch } : t)));
  }, []);

  /* ── 다운로드 ─────────────────────────────────────────────────────── */
  const dlStem = useCallback((t: CardTrack) => {
    const suffix = intent.kind === 'remove'
      ? (intent.target === 'vocals' ? 'MR' : `no-${intent.target}`)
      : t.stem.def.id;
    downloadBlob(audioBufferToWavBlob(t.stem.buffer), `${baseName(file.name)}_${suffix}.wav`);
  }, [file.name, intent]);

  const dlAll = useCallback(() => {
    tracksRef.current.forEach((t, i) => window.setTimeout(() => dlStem(t), i * 400));
  }, [dlStem]);

  const dlCurrentMix = useCallback(async () => {
    const list = tracksRef.current;
    if (!list.length) return;
    const ref = list[0].stem.buffer;
    const off = new OfflineAudioContext(ref.numberOfChannels, ref.length, ref.sampleRate);
    const anySolo = list.some((t) => t.solo);
    for (const t of list) {
      const g = effGain(t, anySolo);
      if (g <= 0) continue;
      const src = off.createBufferSource();
      src.buffer = t.stem.buffer;
      const gain = off.createGain();
      gain.gain.value = g;
      src.connect(gain); gain.connect(off.destination);
      src.start(0);
    }
    const rendered = await off.startRendering();
    downloadBlob(audioBufferToWavBlob(rendered), `${baseName(file.name)}_custom-mix.wav`);
  }, [file.name]);

  /* ── 렌더 ─────────────────────────────────────────────────────────── */
  const anySolo = tracks.some((t) => t.solo);
  const isSplit = intent.kind === 'split';

  return (
    <Card>
      <Head>
        <HeadIcon>🎚️</HeadIcon>
        <HeadText>
          <HeadTitle>{describeStemIntent(intent)}</HeadTitle>
          <HeadFile title={file.name}>{file.name}</HeadFile>
        </HeadText>
        <DemoTag>데모 · EQ 근사</DemoTag>
      </Head>

      {phase === 'working' && (
        <Working>
          분리 중… {Math.round(progress * 100)}%
          <Bar><BarFill style={{ width: `${progress * 100}%` }} /></Bar>
        </Working>
      )}

      {phase === 'error' && <ErrorLine>파일을 처리하지 못했습니다. wav/mp3인지 확인해주세요.</ErrorLine>}

      {phase === 'ready' && (
        <>
          <Rows>
            {tracks.map((t) => (
              <Row key={t.stem.def.id} $dim={effGain(t, anySolo) === 0}>
                <RowEmoji>{t.stem.def.emoji}</RowEmoji>
                <RowName $color={t.stem.def.color}>{t.stem.def.label}</RowName>
                {isSplit && (
                  <>
                    <MiniBtn $on={t.solo} $c="#1f9a52" onClick={() => update(t.stem.def.id, { solo: !t.solo })}>S</MiniBtn>
                    <MiniBtn $on={t.muted} $c="#c0392b" onClick={() => update(t.stem.def.id, { muted: !t.muted })}>M</MiniBtn>
                  </>
                )}
                <Vol
                  type="range" min={0} max={100} value={t.volume}
                  onChange={(e) => update(t.stem.def.id, { volume: Number(e.target.value) })}
                />
                <Dl onClick={() => dlStem(t)} title="WAV로 저장">⬇</Dl>
              </Row>
            ))}
          </Rows>

          <Actions>
            <ActBtn $primary onClick={togglePlay}>{playing ? '■ 정지' : '▶ 미리듣기'}</ActBtn>
            {isSplit && (
              <>
                <ActBtn onClick={() => void dlCurrentMix()}>⬇ 현재 상태로 저장</ActBtn>
                <ActBtn onClick={dlAll}>⬇ 모든 트랙</ActBtn>
              </>
            )}
            {!isSplit && single && tracks[0] && (
              <ActBtn onClick={() => dlStem(tracks[0])}>⬇ 결과 저장</ActBtn>
            )}
            <ActBtn $ghost onClick={() => navigate('/stems', { state: { prefillFile: file } })}>
              믹서에서 열기 →
            </ActBtn>
          </Actions>
        </>
      )}
    </Card>
  );
}

/* ── styles ─────────────────────────────────────────────────────────── */

const Card = styled.div`
  margin: 10px 0 4px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 14px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  padding: 14px;
  max-width: 520px;
`;
const Head = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;
const HeadIcon = styled.span`font-size: 1.4rem;`;
const HeadText = styled.div`flex: 1; min-width: 0;`;
const HeadTitle = styled.div`
  font-weight: 700;
  font-size: 0.92rem;
  color: ${({ theme }) => theme.colors.textPrimary};
`;
const HeadFile = styled.div`
  font-size: 0.75rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const DemoTag = styled.span`
  flex-shrink: 0;
  font-size: 0.65rem;
  font-weight: 600;
  color: #9a6b00;
  background: #fff3d6;
  border: 1px solid #eed9a0;
  padding: 2px 7px;
  border-radius: 999px;
`;
const Working = styled.div`
  margin-top: 12px;
  font-size: 0.85rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
const Bar = styled.div`
  margin-top: 6px;
  height: 7px;
  border-radius: 999px;
  background: rgba(0,0,0,0.08);
  overflow: hidden;
`;
const BarFill = styled.div`
  height: 100%;
  background: #1f9a52;
  border-radius: 999px;
  transition: width 0.25s ease;
`;
const ErrorLine = styled.div`
  margin-top: 12px;
  font-size: 0.85rem;
  color: #c0392b;
`;
const Rows = styled.div`
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
`;
const Row = styled.div<{ $dim?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  opacity: ${({ $dim }) => ($dim ? 0.45 : 1)};
  transition: opacity 0.15s;
`;
const RowEmoji = styled.span`font-size: 1.05rem;`;
const RowName = styled.span<{ $color: string }>`
  width: 84px;
  font-size: 0.82rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  border-left: 3px solid ${({ $color }) => $color};
  padding-left: 6px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
`;
const MiniBtn = styled.button<{ $on?: boolean; $c: string }>`
  width: 24px; height: 24px;
  border: 1px solid ${({ $on, $c, theme }) => ($on ? $c : theme.colors.border)};
  border-radius: 6px;
  background: ${({ $on, $c }) => ($on ? $c : 'transparent')};
  color: ${({ $on }) => ($on ? '#fff' : '#555')};
  font-size: 0.68rem; font-weight: 800;
  cursor: pointer;
`;
const Vol = styled.input`
  flex: 1;
  min-width: 60px;
  accent-color: #1f9a52;
`;
const Dl = styled.button`
  width: 26px; height: 26px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 7px;
  background: transparent;
  color: #1f9a52;
  cursor: pointer;
  font-size: 0.8rem;
  &:hover { background: rgba(31,154,82,0.08); }
`;
const Actions = styled.div`
  margin-top: 12px;
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
`;
const ActBtn = styled.button<{ $primary?: boolean; $ghost?: boolean }>`
  padding: 7px 12px;
  border: 1px solid ${({ $primary, theme }) => ($primary ? '#1f9a52' : theme.colors.border)};
  border-radius: 8px;
  background: ${({ $primary }) => ($primary ? '#1f9a52' : 'transparent')};
  color: ${({ $primary, $ghost, theme }) => ($primary ? '#fff' : $ghost ? theme.colors.textSecondary : theme.colors.textPrimary)};
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  &:hover { filter: brightness(0.97); background: ${({ $primary }) => ($primary ? '#1a8747' : 'rgba(0,0,0,0.03)')}; }
`;
