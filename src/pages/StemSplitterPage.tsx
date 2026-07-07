/* 음원 분리 (Stem Splitter) — 업로드한 곡을 악기별 스템으로 분리해 믹서로
 * 듣고, 조정된 상태 그대로 내려받는 페이지.
 *
 * 현재는 프론트엔드 데모 모드: 분리 자체는 lib/stems/mockSeparate(EQ 대역
 * 근사)가 수행하고, 그 외 전부 — 업로드/디코드/믹서(볼륨·팬·뮤트·솔로)/동기
 * 재생/시크/루프/개별·전체·현재상태 다운로드(WAV) — 는 실동작한다. 실제
 * AI 분리(Demucs 급)는 GPU 백엔드 연동 시 separate() 호출부만 교체하면 된다
 * (음원분리_백엔드 요구사항.md). */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import styled, { keyframes } from 'styled-components';
import { IconSidebar } from '../components/layout/IconSidebar';
import { separate, STEM_PRESETS, type SeparatedStem, type StemPresetId } from '../lib/stems/mockSeparate';
import { audioBufferToWavBlob, downloadBlob } from '../lib/stems/wavEncode';

/* ─── 상태 모델 ─────────────────────────────────────────────────────── */

interface TrackState {
  stem: SeparatedStem;
  volume: number;   // 0..100
  pan: number;      // -1..1
  muted: boolean;
  solo: boolean;
}

type Phase = 'idle' | 'decoding' | 'separating' | 'ready' | 'error';

/** solo/mute 규칙을 반영한 실효 게인 (마스터 제외). */
function effectiveGain(t: TrackState, anySolo: boolean): number {
  if (t.muted) return 0;
  if (anySolo && !t.solo) return 0;
  return t.volume / 100;
}

function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

/* ─── 페이지 ────────────────────────────────────────────────────────── */

export default function StemSplitterPage() {
  const navigate = useNavigate();
  const location = useLocation();

  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [fileName, setFileName] = useState('');
  const [preset, setPreset] = useState<StemPresetId>('4');
  const [tracks, setTracks] = useState<TrackState[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const srcBufferRef = useRef<AudioBuffer | null>(null);

  /* ── 재생 엔진 (WebAudio, 스템 동기 재생) ──────────────────────────── */
  const ctxRef = useRef<AudioContext | null>(null);
  const gainNodesRef = useRef<Map<string, GainNode>>(new Map());
  const panNodesRef = useRef<Map<string, StereoPannerNode>>(new Map());
  const sourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const masterRef = useRef<GainNode | null>(null);
  const startedAtRef = useRef(0);   // ctx.currentTime 기준 재생 시작 시각
  const offsetRef = useRef(0);      // 곡 내 재생 위치(초)
  const loopRef = useRef(false);
  const tracksRef = useRef<TrackState[]>([]);
  tracksRef.current = tracks;

  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [master, setMaster] = useState(85);
  const [posSec, setPosSec] = useState(0);
  loopRef.current = loop;
  /* startPlayback가 state 대신 ref로 마스터를 읽는다 — 루프 재시작이 stale
   * 클로저(재생 시작 시점의 master)로 게인을 되돌리는 버그 방지. */
  const masterRef2 = useRef(master);
  masterRef2.current = master;

  const duration = srcBufferRef.current?.duration ?? 0;

  const getCtx = useCallback((): AudioContext => {
    if (!ctxRef.current) ctxRef.current = new AudioContext();
    return ctxRef.current;
  }, []);

  const stopSources = useCallback(() => {
    sourcesRef.current.forEach((s) => { try { s.onended = null; s.stop(); } catch { /* already stopped */ } });
    sourcesRef.current = [];
  }, []);

  const applyLiveGains = useCallback(() => {
    const anySolo = tracksRef.current.some((t) => t.solo);
    for (const t of tracksRef.current) {
      const g = gainNodesRef.current.get(t.stem.def.id);
      if (g) g.gain.value = effectiveGain(t, anySolo);
      const p = panNodesRef.current.get(t.stem.def.id);
      if (p) p.pan.value = t.pan;
    }
  }, []);

  const startPlayback = useCallback((fromSec: number) => {
    const ctx = getCtx();
    void ctx.resume();
    stopSources();

    if (!masterRef.current) {
      masterRef.current = ctx.createGain();
      masterRef.current.connect(ctx.destination);
    }
    masterRef.current.gain.value = masterRef2.current / 100;

    const anySolo = tracksRef.current.some((t) => t.solo);
    const sources: AudioBufferSourceNode[] = [];
    for (const t of tracksRef.current) {
      const src = ctx.createBufferSource();
      src.buffer = t.stem.buffer;
      const gain = ctx.createGain();
      gain.gain.value = effectiveGain(t, anySolo);
      const pan = ctx.createStereoPanner();
      pan.pan.value = t.pan;
      src.connect(gain); gain.connect(pan); pan.connect(masterRef.current);
      gainNodesRef.current.set(t.stem.def.id, gain);
      panNodesRef.current.set(t.stem.def.id, pan);
      src.start(0, fromSec);
      sources.push(src);
    }
    sourcesRef.current = sources;
    startedAtRef.current = ctx.currentTime;
    offsetRef.current = fromSec;
    setPlaying(true);

    // 자연 종료 감지는 첫 소스의 onended 하나로 충분(모두 같은 길이).
    if (sources[0]) {
      sources[0].onended = () => {
        // stop()/seek로 인한 강제 종료는 onended를 미리 떼어내므로 여기는 자연 종료.
        if (loopRef.current) {
          startPlayback(0);
        } else {
          setPlaying(false);
          offsetRef.current = 0;
          setPosSec(0);
        }
      };
    }
  }, [getCtx, stopSources]);

  const pausePlayback = useCallback(() => {
    const ctx = ctxRef.current;
    if (ctx) offsetRef.current += ctx.currentTime - startedAtRef.current;
    stopSources();
    setPlaying(false);
  }, [stopSources]);

  const handlePlayPause = useCallback(() => {
    if (phase !== 'ready') return;
    if (playing) pausePlayback();
    else startPlayback(Math.min(offsetRef.current, Math.max(0, duration - 0.05)));
  }, [phase, playing, pausePlayback, startPlayback, duration]);

  const handleStop = useCallback(() => {
    stopSources();
    offsetRef.current = 0;
    setPosSec(0);
    setPlaying(false);
  }, [stopSources]);

  const handleSeek = useCallback((sec: number) => {
    offsetRef.current = sec;
    setPosSec(sec);
    if (playing) startPlayback(sec);
  }, [playing, startPlayback]);

  // 재생 위치 RAF 트래킹
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const ctx = ctxRef.current;
      if (ctx) setPosSec(Math.min(duration, offsetRef.current + (ctx.currentTime - startedAtRef.current)));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, duration]);

  // 믹서 조작 → 라이브 반영
  useEffect(() => { applyLiveGains(); }, [tracks, applyLiveGains]);
  useEffect(() => { if (masterRef.current) masterRef.current.gain.value = master / 100; }, [master]);

  // 언마운트: 재생 정지 + ctx 해제. masterRef/게인 노드들도 함께 버린다 —
  // 닫힌 ctx의 노드가 남아 있으면(StrictMode 재마운트 등) 새 ctx의 소스를
  // 죽은 마스터에 connect해 무음/InvalidAccessError가 난다.
  useEffect(() => () => {
    stopSources();
    void ctxRef.current?.close().catch(() => {});
    ctxRef.current = null;
    masterRef.current = null;
    gainNodesRef.current.clear();
    panNodesRef.current.clear();
  }, [stopSources]);

  // 스페이스바 = 재생/일시정지 (입력 필드 포커스 중엔 무시)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      const tag = (e.target as HTMLElement)?.tagName;
      // BUTTON 포커스 시 스페이스는 네이티브 click을 발생시킨다 — 여기서도
      // 처리하면 이중 토글(▶ 클릭 직후 스페이스가 재생/정지를 두 번). 버튼의
      // 네이티브 동작에 맡기고 우리 핸들러는 빠진다.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || tag === 'BUTTON') return;
      e.preventDefault();
      handlePlayPause();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handlePlayPause]);

  /* ── 업로드 → 디코드 → 분리 ────────────────────────────────────────── */

  const phaseRef = useRef<Phase>('idle');
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  const processFile = useCallback(async (file: File) => {
    // 디코딩/분리 진행 중 재진입 방지(더블 드롭/더블 클릭).
    if (phaseRef.current === 'decoding' || phaseRef.current === 'separating') return;
    if (!/\.(wav|mp3|m4a|ogg|flac|aac|webm)$/i.test(file.name) && !file.type.startsWith('audio/')) {
      setError('오디오 파일이 아닙니다. wav / mp3 파일을 올려주세요.');
      setPhase('error');
      return;
    }
    if (file.size > 200 * 1024 * 1024) {
      setError('파일이 너무 큽니다 (200MB 제한).');
      setPhase('error');
      return;
    }
    handleStop();
    setError(null);
    setFileName(file.name);
    setPhase('decoding');
    setProgress(0);
    try {
      const arrayBuf = await file.arrayBuffer();
      const decoded = await getCtx().decodeAudioData(arrayBuf);
      srcBufferRef.current = decoded;
      setPhase('separating');
      const stems = await separate(decoded, preset, (r) => setProgress(r));
      setTracks(stems.map((stem) => ({ stem, volume: 85, pan: 0, muted: false, solo: false })));
      offsetRef.current = 0;
      setPosSec(0);
      setPhase('ready');
    } catch (e) {
      console.error('[stems] decode/separate failed:', e);
      setError('파일을 디코드하지 못했습니다. 손상되지 않은 wav/mp3인지 확인해주세요.');
      setPhase('error');
    }
  }, [getCtx, preset, handleStop]);

  /* 채팅 카드의 "믹서에서 열기" — route state로 넘어온 File을 마운트 시 1회
   * 자동 처리. (File은 직렬화 불가라 새로고침 시엔 없음 — 그냥 idle로 시작.) */
  const prefillDoneRef = useRef(false);
  useEffect(() => {
    if (prefillDoneRef.current) return;
    const f = (location.state as { prefillFile?: File } | null)?.prefillFile;
    if (f instanceof File) {
      prefillDoneRef.current = true;
      void processFile(f);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void processFile(f);
  }, [processFile]);

  /* 프리셋 변경: 이미 디코드된 원본이 있으면 재분리. */
  const changePreset = useCallback(async (p: StemPresetId) => {
    setPreset(p);
    const src = srcBufferRef.current;
    if (!src || phase !== 'ready') return;
    handleStop();
    setPhase('separating');
    setProgress(0);
    try {
      const stems = await separate(src, p, (r) => setProgress(r));
      setTracks(stems.map((stem) => ({ stem, volume: 85, pan: 0, muted: false, solo: false })));
      setPhase('ready');
    } catch (e) {
      console.error('[stems] preset re-separate failed:', e);
      setError('프리셋 전환 중 분리에 실패했습니다. 파일을 다시 올려주세요.');
      setPhase('error');
    }
  }, [phase, handleStop]);

  /* ── 트랙 조작 ─────────────────────────────────────────────────────── */
  const updateTrack = useCallback((id: string, patch: Partial<TrackState>) => {
    setTracks((prev) => prev.map((t) => (t.stem.def.id === id ? { ...t, ...patch } : t)));
  }, []);

  /* ── 다운로드 ──────────────────────────────────────────────────────── */

  const downloadStem = useCallback((t: TrackState) => {
    downloadBlob(audioBufferToWavBlob(t.stem.buffer), `${baseName(fileName)}_${t.stem.def.id}.wav`);
  }, [fileName]);

  const downloadAll = useCallback(() => {
    // zip 의존성 없이 순차 다운로드(브라우저 다중 다운로드 허용 필요) — 서버
    // 연동 시 zip 패키징은 백엔드가 담당(요구사항 문서 참조).
    tracksRef.current.forEach((t, i) => {
      window.setTimeout(() => downloadStem(t), i * 400);
    });
  }, [downloadStem]);

  const [mixing, setMixing] = useState(false);
  const downloadCurrentMix = useCallback(async () => {
    const src = srcBufferRef.current;
    if (!src || mixing) return;
    setMixing(true);
    try {
      const off = new OfflineAudioContext(Math.min(2, src.numberOfChannels), src.length, src.sampleRate);
      const masterG = off.createGain();
      masterG.gain.value = master / 100;
      masterG.connect(off.destination);
      const anySolo = tracksRef.current.some((t) => t.solo);
      for (const t of tracksRef.current) {
        const g = effectiveGain(t, anySolo);
        if (g <= 0) continue; // 뮤트/솔로 제외 트랙은 통째로 생략
        const s = off.createBufferSource();
        s.buffer = t.stem.buffer;
        const gain = off.createGain();
        gain.gain.value = g;
        const pan = off.createStereoPanner();
        pan.pan.value = t.pan;
        s.connect(gain); gain.connect(pan); pan.connect(masterG);
        s.start(0);
      }
      const rendered = await off.startRendering();
      downloadBlob(audioBufferToWavBlob(rendered), `${baseName(fileName)}_custom-mix.wav`);
    } finally {
      setMixing(false);
    }
  }, [fileName, master, mixing]);

  /* ── 렌더 ──────────────────────────────────────────────────────────── */

  const anySolo = tracks.some((t) => t.solo);
  const srcInfo = srcBufferRef.current;

  return (
    <Page>
      <IconSidebar />
      <PageBody>
        <TopBar>
          <BackBtn onClick={() => navigate('/')}>← Home</BackBtn>
          <Title>음원 분리 <DemoBadge>데모 모드 · EQ 근사</DemoBadge></Title>
          <Spacer />
          <PresetGroup>
            {(Object.keys(STEM_PRESETS) as StemPresetId[]).map((p) => (
              <PresetBtn
                key={p}
                $on={preset === p}
                title={STEM_PRESETS[p].desc}
                onClick={() => void changePreset(p)}
                disabled={phase === 'separating' || phase === 'decoding'}
              >
                {STEM_PRESETS[p].label}
              </PresetBtn>
            ))}
          </PresetGroup>
        </TopBar>

        <Content>
          {/* ── 업로드 존 ── */}
          {(phase === 'idle' || phase === 'error' || phase === 'decoding') && (
            <DropZone
              $active={dragOver}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              aria-label="오디오 파일 업로드"
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void processFile(f); e.target.value = ''; }}
              />
              <DropIcon>🎚️</DropIcon>
              <DropTitle>{phase === 'decoding' ? '디코딩 중…' : '오디오 파일을 끌어다 놓거나 클릭해서 선택'}</DropTitle>
              <DropSub>wav · mp3 (m4a/ogg/flac도 시도) — 최대 200MB</DropSub>
              <DropSub>분리 프리셋: {STEM_PRESETS[preset].desc}</DropSub>
              {error && <ErrorText>{error}</ErrorText>}
            </DropZone>
          )}

          {/* ── 분리 진행 ── */}
          {phase === 'separating' && (
            <ProgressWrap>
              <ProgressLabel>“{fileName}” 분리 중… {Math.round(progress * 100)}%</ProgressLabel>
              <ProgressOuter><ProgressInner style={{ width: `${progress * 100}%` }} /></ProgressOuter>
            </ProgressWrap>
          )}

          {/* ── 결과 믹서 ── */}
          {phase === 'ready' && srcInfo && (
            <>
              <FileRow>
                <FileMeta>
                  <FileName title={fileName}>{fileName}</FileName>
                  <FileInfo>
                    {fmtTime(srcInfo.duration)} · {(srcInfo.sampleRate / 1000).toFixed(1)}kHz ·
                    {srcInfo.numberOfChannels >= 2 ? ' 스테레오' : ' 모노'} · {STEM_PRESETS[preset].label}
                  </FileInfo>
                </FileMeta>
                <FileActions>
                  <GhostBtn onClick={() => { handleStop(); setPhase('idle'); setTracks([]); srcBufferRef.current = null; }}>
                    다른 파일
                  </GhostBtn>
                  <PrimaryBtn onClick={() => void downloadCurrentMix()} disabled={mixing}>
                    {mixing ? '믹스다운 중…' : '⬇ 현재 상태로 저장'}
                  </PrimaryBtn>
                  <PrimaryBtn $secondary onClick={downloadAll}>⬇ 모든 트랙 저장</PrimaryBtn>
                </FileActions>
              </FileRow>

              {/* 트랜스포트 */}
              <Transport>
                <TransBtn onClick={handlePlayPause} title={playing ? '일시정지 (Space)' : '재생 (Space)'} $primary>
                  {playing ? '❚❚' : '▶'}
                </TransBtn>
                <TransBtn onClick={handleStop} title="정지">■</TransBtn>
                <TransBtn onClick={() => setLoop((v) => !v)} title="전체 반복" $lit={loop}>⟲</TransBtn>
                <TimeLabel>{fmtTime(posSec)}</TimeLabel>
                <SeekBar
                  type="range"
                  min={0}
                  max={Math.max(0.01, duration)}
                  step={0.01}
                  value={Math.min(posSec, duration)}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                />
                <TimeLabel>{fmtTime(duration)}</TimeLabel>
                <MasterWrap>
                  <MasterLabel>마스터</MasterLabel>
                  <VolSlider type="range" min={0} max={100} value={master} onChange={(e) => setMaster(Number(e.target.value))} />
                  <VolValue>{master}</VolValue>
                </MasterWrap>
              </Transport>

              {/* 스템 스트립 */}
              <TrackList>
                {tracks.map((t) => {
                  const dimmed = effectiveGain(t, anySolo) === 0;
                  return (
                    <TrackRow key={t.stem.def.id} $dim={dimmed}>
                      <TrackHead>
                        <TrackEmoji>{t.stem.def.emoji}</TrackEmoji>
                        <TrackName $color={t.stem.def.color}>{t.stem.def.label}</TrackName>
                      </TrackHead>
                      <Waveform buffer={t.stem.buffer} color={t.stem.def.color} progress={duration > 0 ? posSec / duration : 0} />
                      <TrackControls>
                        <SmallBtn
                          $on={t.solo} $onColor="#1f9a52"
                          title="솔로 (이 트랙만 듣기)"
                          onClick={() => updateTrack(t.stem.def.id, { solo: !t.solo })}
                        >S</SmallBtn>
                        <SmallBtn
                          $on={t.muted} $onColor="#c0392b"
                          title="음소거"
                          onClick={() => updateTrack(t.stem.def.id, { muted: !t.muted })}
                        >M</SmallBtn>
                        <VolSlider
                          type="range" min={0} max={100} value={t.volume}
                          title="볼륨"
                          onChange={(e) => updateTrack(t.stem.def.id, { volume: Number(e.target.value) })}
                        />
                        <VolValue>{t.volume}</VolValue>
                        <PanWrap title="팬 (좌/우)">
                          <PanLabel>L</PanLabel>
                          <PanSlider
                            type="range" min={-1} max={1} step={0.05} value={t.pan}
                            onChange={(e) => updateTrack(t.stem.def.id, { pan: Number(e.target.value) })}
                            onDoubleClick={() => updateTrack(t.stem.def.id, { pan: 0 })}
                          />
                          <PanLabel>R</PanLabel>
                        </PanWrap>
                        <DownBtn onClick={() => downloadStem(t)} title="이 트랙만 WAV로 저장">⬇</DownBtn>
                      </TrackControls>
                    </TrackRow>
                  );
                })}
              </TrackList>

              <DemoNote>
                ⚠ 데모 모드: 분리는 EQ 대역 근사입니다. GPU 백엔드(Demucs) 연동 시 실제 AI 분리로
                교체됩니다 — <code>음원분리_백엔드 요구사항.md</code> 참조.
              </DemoNote>
            </>
          )}
        </Content>
      </PageBody>
    </Page>
  );
}

/* ─── 파형 캔버스 ───────────────────────────────────────────────────── */

function Waveform({ buffer, color, progress }: { buffer: AudioBuffer; color: string; progress: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = canvas.width = canvas.offsetWidth * 2;   // retina
    const H = canvas.height = canvas.offsetHeight * 2;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, W, H);
    const data = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(data.length / W));
    g.fillStyle = color;
    g.globalAlpha = 0.75;
    const mid = H / 2;
    for (let x = 0; x < W; x++) {
      let max = 0;
      const start = x * step;
      for (let i = start; i < start + step && i < data.length; i += 16) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      const h = Math.max(1, max * H * 0.92);
      g.fillRect(x, mid - h / 2, 1, h);
    }
  }, [buffer, color]);

  return (
    <WaveWrap>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%' }} />
      <WaveProgress style={{ width: `${Math.min(100, progress * 100)}%` }} />
    </WaveWrap>
  );
}

/* ─── styles ────────────────────────────────────────────────────────── */

const Page = styled.div`
  display: flex;
  flex-direction: row;
  height: 100vh;
  height: 100dvh;
  width: 100%;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  overflow: hidden;
`;

const PageBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
`;

const TopBar = styled.div`
  display: flex;
  align-items: center;
  gap: 14px;
  padding: calc(env(safe-area-inset-top, 0px) + 10px) 20px 10px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
`;

const BackBtn = styled.button`
  padding: 6px 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  cursor: pointer;
  &:hover { background: rgba(0, 0, 0, 0.04); }
`;

const Title = styled.h1`
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  display: flex;
  align-items: center;
  gap: 10px;
`;

const DemoBadge = styled.span`
  font-size: 0.68rem;
  font-weight: 600;
  color: #9a6b00;
  background: #fff3d6;
  border: 1px solid #eed9a0;
  padding: 3px 8px;
  border-radius: 999px;
`;

const Spacer = styled.div`flex: 1;`;

const PresetGroup = styled.div`
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.bgPrimary};
`;

const PresetBtn = styled.button<{ $on?: boolean }>`
  padding: 5px 12px;
  border: none;
  border-radius: 7px;
  background: ${({ $on }) => ($on ? '#1a1a1a' : 'transparent')};
  color: ${({ $on }) => ($on ? '#fff' : '#444')};
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  &:disabled { opacity: 0.5; cursor: default; }
`;

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 24px clamp(16px, 4vw, 48px) 48px;
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

/* ── 업로드 존 ── */
const DropZone = styled.div<{ $active?: boolean }>`
  margin: auto;
  width: min(640px, 100%);
  min-height: 300px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 2px dashed ${({ $active, theme }) => ($active ? '#1f9a52' : theme.colors.border)};
  border-radius: 20px;
  background: ${({ $active }) => ($active ? 'rgba(31, 154, 82, 0.06)' : 'rgba(0, 0, 0, 0.015)')};
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  &:hover { border-color: #1f9a52; }
`;

const DropIcon = styled.div`font-size: 44px;`;
const DropTitle = styled.div`
  font-size: 1.02rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;
const DropSub = styled.div`
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
const ErrorText = styled.div`
  margin-top: 8px;
  font-size: 0.85rem;
  color: #c0392b;
  font-weight: 600;
`;

/* ── 진행 바 ── */
const ProgressWrap = styled.div`
  margin: auto;
  width: min(560px, 100%);
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: center;
`;
const ProgressLabel = styled.div`
  font-size: 0.95rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
`;
const ProgressOuter = styled.div`
  width: 100%;
  height: 10px;
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.08);
  overflow: hidden;
`;
const shimmer = keyframes`to { background-position-x: -40px; }`;
const ProgressInner = styled.div`
  height: 100%;
  border-radius: 999px;
  background: repeating-linear-gradient(45deg, #1f9a52, #1f9a52 10px, #27b562 10px, #27b562 20px);
  background-size: 200% 100%;
  animation: ${shimmer} 0.8s linear infinite;
  transition: width 0.25s ease;
`;

/* ── 파일 헤더 ── */
const FileRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
`;
const FileMeta = styled.div`
  min-width: 0;
  flex: 1;
`;
const FileName = styled.div`
  font-size: 1.05rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;
const FileInfo = styled.div`
  font-size: 0.8rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 2px;
`;
const FileActions = styled.div`
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  flex-wrap: wrap;
`;
const PrimaryBtn = styled.button<{ $secondary?: boolean }>`
  padding: 9px 16px;
  border: none;
  border-radius: 9px;
  background: ${({ $secondary }) => ($secondary ? '#33415c' : '#1f9a52')};
  color: #fff;
  font-family: inherit;
  font-size: 0.86rem;
  font-weight: 700;
  cursor: pointer;
  transition: filter 0.12s;
  &:hover { filter: brightness(1.08); }
  &:disabled { opacity: 0.55; cursor: default; }
`;
const GhostBtn = styled.button`
  padding: 9px 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 9px;
  background: transparent;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: inherit;
  font-size: 0.86rem;
  font-weight: 600;
  cursor: pointer;
  &:hover { background: rgba(0, 0, 0, 0.04); }
`;

/* ── 트랜스포트 ── */
const Transport = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 14px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  flex-wrap: wrap;
`;
const TransBtn = styled.button<{ $primary?: boolean; $lit?: boolean }>`
  width: 40px;
  height: 40px;
  border: none;
  border-radius: 50%;
  background: ${({ $primary, $lit }) => ($primary ? '#1f9a52' : $lit ? '#33415c' : 'rgba(0,0,0,0.07)')};
  color: ${({ $primary, $lit }) => ($primary || $lit ? '#fff' : '#333')};
  font-size: 0.95rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: filter 0.12s, background 0.12s;
  &:hover { filter: brightness(1.08); }
`;
const TimeLabel = styled.span`
  font-variant-numeric: tabular-nums;
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  min-width: 40px;
  text-align: center;
`;
const SeekBar = styled.input`
  flex: 1;
  min-width: 160px;
  accent-color: #1f9a52;
`;
const MasterWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding-left: 10px;
  border-left: 1px solid ${({ theme }) => theme.colors.border};
`;
const MasterLabel = styled.span`
  font-size: 0.78rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

/* ── 트랙 스트립 ── */
const TrackList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;
const TrackRow = styled.div<{ $dim?: boolean }>`
  display: grid;
  grid-template-columns: 140px minmax(120px, 1fr) auto;
  align-items: center;
  gap: 14px;
  padding: 12px 16px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 14px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  opacity: ${({ $dim }) => ($dim ? 0.45 : 1)};
  transition: opacity 0.15s;

  @media (max-width: 860px) {
    grid-template-columns: 1fr;
    row-gap: 8px;
  }
`;
const TrackHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
`;
const TrackEmoji = styled.span`font-size: 1.35rem;`;
const TrackName = styled.span<{ $color: string }>`
  font-size: 0.95rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  border-left: 4px solid ${({ $color }) => $color};
  padding-left: 8px;
`;
const WaveWrap = styled.div`
  position: relative;
  height: 44px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.03);
`;
const WaveProgress = styled.div`
  position: absolute;
  inset: 0 auto 0 0;
  background: rgba(0, 0, 0, 0.12);
  pointer-events: none;
`;
const TrackControls = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
`;
const SmallBtn = styled.button<{ $on?: boolean; $onColor: string }>`
  width: 30px;
  height: 30px;
  border: 1px solid ${({ $on, $onColor, theme }) => ($on ? $onColor : theme.colors.border)};
  border-radius: 7px;
  background: ${({ $on, $onColor }) => ($on ? $onColor : 'transparent')};
  color: ${({ $on }) => ($on ? '#fff' : '#555')};
  font-size: 0.78rem;
  font-weight: 800;
  cursor: pointer;
  transition: background 0.12s, border-color 0.12s;
`;
const VolSlider = styled.input`
  width: 110px;
  accent-color: #1f9a52;
`;
const VolValue = styled.span`
  font-variant-numeric: tabular-nums;
  font-size: 0.8rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  width: 26px;
  text-align: right;
`;
const PanWrap = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
`;
const PanLabel = styled.span`
  font-size: 0.7rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
const PanSlider = styled.input`
  width: 70px;
  accent-color: #33415c;
`;
const DownBtn = styled.button`
  width: 32px;
  height: 32px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: transparent;
  color: #1f9a52;
  font-size: 0.95rem;
  cursor: pointer;
  &:hover { background: rgba(31, 154, 82, 0.08); }
`;

const DemoNote = styled.p`
  margin: 8px 0 0;
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  code { background: rgba(0,0,0,0.05); padding: 1px 5px; border-radius: 4px; }
`;
