/* ─────────────────────────────────────────────────────────────────────────
 * CopyPage — 카피하기: 음원을 느리게/반복 재생하며 귀카피 연습하는 화면.
 *
 * Amazing Slow Downer 의 기능 세트를 기준으로 구현:
 *   파일 모드 (wav/mp3/m4a/…): 속도 25~200%(피치 유지) · 피치 ±12반음+센트 ·
 *     A-B 루프(재생 중 Set, 파형 드래그) · 루프 반복마다 속도 자동 증감 ·
 *     루프/북마크 저장(곡별 localStorage) · EQ 저음/고음 · 채널 믹스(보컬 제거) ·
 *     밸런스 · 볼륨 · 파형 클릭 시크 · 키보드 단축키
 *   YouTube 모드: 속도 0.25×~2×(YouTube 자체 피치 유지) · A-B 루프 · 북마크
 *     (스트리밍 특성상 피치/EQ 는 불가 — ASD 도 스트리밍 소스는 동일 제약)
 *
 * 디자인은 음원 분리(StemSplitterPage)와 같은 결: IconSidebar + TopBar + Content,
 * 컨트롤 묶음 상자는 에디터 툴바 Section/BoxLegend 규격.
 * ──────────────────────────────────────────────────────────────────────── */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { AppSidebar } from '../components/layout/AppSidebar';
import { BackButton } from '../components/common/BackButton';
import { loadYTApi } from '../components/common/YoutubeEmbed';
import { CopyAudioEngine, TEMPO_MIN_PCT, TEMPO_MAX_PCT, type MixMode } from '../lib/copy/copyAudioEngine';
import {
  fileTrackKey, youtubeTrackKey, loadTrackState, saveTrackState, newId,
  type SavedLoop, type SavedBookmark,
} from '../lib/copy/copyStore';

/* ── 유틸 ───────────────────────────────────────────────────────────── */

function fmtTime(sec: number, tenths = false): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return tenths
    ? `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
    : `${m}:${String(Math.floor(s)).padStart(2, '0')}`;
}

function parseYoutubeId(input: string): string | null {
  const raw = input.trim();
  if (/^[\w-]{11}$/.test(raw)) return raw;
  try {
    const u = new URL(raw);
    const v = u.searchParams.get('v');
    if (v && /^[\w-]{11}$/.test(v)) return v;
    const m = u.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{11})/) ?? u.pathname.match(/^\/([\w-]{11})$/);
    if (m && (u.hostname.includes('youtube') || u.hostname.includes('youtu.be'))) return m[1];
  } catch { /* URL 아님 */ }
  return null;
}

/** 파형 그리기용 min/max 피크 (버킷당 2값 interleave) */
function computePeaks(buf: AudioBuffer, buckets: number): Float32Array {
  const chL = buf.getChannelData(0);
  const chR = buf.numberOfChannels > 1 ? buf.getChannelData(1) : chL;
  const out = new Float32Array(buckets * 2);
  const per = Math.max(1, Math.floor(chL.length / buckets));
  for (let i = 0; i < buckets; i++) {
    let mn = 0, mx = 0;
    const start = i * per;
    const end = Math.min(start + per, chL.length);
    for (let j = start; j < end; j += 2) { // 성능: 2샘플 간격 샘플링으로 충분
      const v = (chL[j] + chR[j]) * 0.5;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    out[i * 2] = mn;
    out[i * 2 + 1] = mx;
  }
  return out;
}

const YT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/* ── 컴포넌트 ────────────────────────────────────────────────────────── */

export default function CopyPage() {
  const navigate = useNavigate();
  const [source, setSource] = useState<'file' | 'youtube'>('file');

  /* ---------- 파일 모드 상태 ---------- */
  const engineRef = useRef<CopyAudioEngine | null>(null);
  const [phase, setPhase] = useState<'idle' | 'decoding' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [trackKey, setTrackKey] = useState('');
  const [duration, setDuration] = useState(0);
  const [posSec, setPosSec] = useState(0);
  const [playing, setPlaying] = useState(false);

  const [tempoPct, setTempoPct] = useState(100);
  const [semis, setSemis] = useState(0);
  const [cents, setCents] = useState(0);
  const [loopOn, setLoopOn] = useState(false);
  const [loopA, setLoopA] = useState(0);
  const [loopB, setLoopB] = useState(0);
  const [loopCount, setLoopCount] = useState(0);
  const [advOn, setAdvOn] = useState(false);
  const [advStep, setAdvStep] = useState(2);
  const [advLimit, setAdvLimit] = useState(100);
  const [eqLow, setEqLow] = useState(0);
  const [eqHigh, setEqHigh] = useState(0);
  const [mixMode, setMixMode] = useState<MixMode>('stereo');
  const [balance, setBalance] = useState(0);
  const [volume, setVolume] = useState(100);
  const [savedLoops, setSavedLoops] = useState<SavedLoop[]>([]);
  const [bookmarks, setBookmarks] = useState<SavedBookmark[]>([]);

  /* 위치는 오디오 블록마다(≈23ms) 오므로: 파형 재생선은 ref 로 직접 이동(리렌더 X),
   * 시간 라벨용 state 는 150ms 로 스로틀. */
  const posRef = useRef(0);
  const lastTickUpdateRef = useRef(0);
  const playheadRef = useRef<HTMLDivElement>(null);
  const durRef = useRef(0);
  useEffect(() => { durRef.current = duration; }, [duration]);

  const movePlayhead = useCallback((sec: number) => {
    const el = playheadRef.current;
    if (el && durRef.current > 0) el.style.left = `${(sec / durRef.current) * 100}%`;
  }, []);

  const ensureEngine = useCallback((): CopyAudioEngine => {
    if (!engineRef.current) {
      engineRef.current = new CopyAudioEngine({
        onTick: (sec) => {
          posRef.current = sec;
          movePlayhead(sec);
          const now = performance.now();
          if (now - lastTickUpdateRef.current > 150) {
            lastTickUpdateRef.current = now;
            setPosSec(sec);
          }
        },
        onEnded: () => { setPlaying(false); setPosSec(0); },
        onLoopWrap: (count, pct) => { setLoopCount(count); setTempoPct(pct); },
      });
    }
    return engineRef.current;
  }, [movePlayhead]);

  useEffect(() => () => { engineRef.current?.destroy(); engineRef.current = null; }, []);

  /* 파라미터 → 엔진 동기화 */
  useEffect(() => { engineRef.current?.setTempoPct(tempoPct); }, [tempoPct]);
  useEffect(() => { engineRef.current?.setPitch(semis, cents); }, [semis, cents]);
  useEffect(() => {
    engineRef.current?.setLoop({ on: loopOn, a: loopA, b: loopB });
  }, [loopOn, loopA, loopB]);
  useEffect(() => { engineRef.current?.setAdvance({ on: advOn, stepPct: advStep, limitPct: advLimit }); }, [advOn, advStep, advLimit]);
  useEffect(() => { engineRef.current?.setEq(eqLow, eqHigh); }, [eqLow, eqHigh]);
  useEffect(() => { engineRef.current?.setMixMode(mixMode); }, [mixMode]);
  useEffect(() => { engineRef.current?.setBalance(balance); }, [balance]);
  useEffect(() => { engineRef.current?.setVolume(volume / 100); }, [volume]);

  /* 곡별 저장 (루프·북마크·설정) */
  useEffect(() => {
    if (!trackKey || phase !== 'ready') return;
    saveTrackState(trackKey, {
      loops: savedLoops,
      bookmarks,
      settings: { tempoPct, semitones: semis, cents, eqLow, eqHigh, mixMode, balance },
    });
  }, [trackKey, phase, savedLoops, bookmarks, tempoPct, semis, cents, eqLow, eqHigh, mixMode, balance]);

  /* ---------- 파일 로드 ---------- */
  const peaksRef = useRef<Float32Array | null>(null);
  const [peaksVersion, setPeaksVersion] = useState(0);

  const processFile = useCallback(async (f: File) => {
    setPhase('decoding');
    setError('');
    setPlaying(false);
    try {
      const eng = ensureEngine();
      const data = await f.arrayBuffer();
      await eng.load(data);
      const key = fileTrackKey(f.name, f.size);
      setFileName(f.name);
      setTrackKey(key);
      setDuration(eng.duration);
      durRef.current = eng.duration;
      setPosSec(0);
      posRef.current = 0;
      setLoopOn(false);
      setLoopA(0);
      setLoopB(eng.duration);
      setLoopCount(0);

      // 이전에 연습하던 곡이면 루프·북마크·설정 복원 (ASD 의 곡별 기억과 동일)
      const st = loadTrackState(key);
      setSavedLoops(st.loops);
      setBookmarks(st.bookmarks);
      const s = st.settings;
      setTempoPct(s.tempoPct ?? 100);
      setSemis(s.semitones ?? 0);
      setCents(s.cents ?? 0);
      setEqLow(s.eqLow ?? 0);
      setEqHigh(s.eqHigh ?? 0);
      setMixMode((s.mixMode as MixMode) ?? 'stereo');
      setBalance(s.balance ?? 0);

      const buf = eng.getBuffer();
      peaksRef.current = buf ? computePeaks(buf, 1200) : null;
      setPeaksVersion((v) => v + 1);
      setPhase('ready');
    } catch (e) {
      setError(e instanceof Error ? e.message : '디코딩에 실패했습니다 — 지원하지 않는 형식일 수 있어요.');
      setPhase('error');
    }
  }, [ensureEngine]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) void processFile(f);
  }, [processFile]);

  /* ---------- 재생 제어 ---------- */
  const handlePlayPause = useCallback(() => {
    const eng = engineRef.current;
    if (!eng || phase !== 'ready') return;
    if (eng.playing) { eng.pause(); setPlaying(false); }
    else { eng.play(); setPlaying(true); }
  }, [phase]);

  const doSeek = useCallback((sec: number) => {
    const eng = engineRef.current;
    if (!eng) return;
    const clamped = Math.min(Math.max(0, sec), durRef.current);
    eng.seek(clamped);
    posRef.current = clamped;
    setPosSec(clamped);
    movePlayhead(clamped);
  }, [movePlayhead]);

  const seekBy = useCallback((d: number) => doSeek(posRef.current + d), [doSeek]);

  const handleStop = useCallback(() => {
    engineRef.current?.pause();
    setPlaying(false);
    doSeek(loopOn ? loopA : 0);
  }, [doSeek, loopOn, loopA]);

  const setPointA = useCallback(() => {
    const t = posRef.current;
    setLoopA(t);
    setLoopB((b) => (b <= t + 0.05 ? durRef.current : b));
  }, []);

  const setPointB = useCallback(() => {
    const t = posRef.current;
    setLoopB(t);
    setLoopA((a) => (a >= t - 0.05 ? 0 : a));
    setLoopCount(0);
    setLoopOn(true); // ASD: 재생 중 B 를 찍으면 그 즉시 루프 시작
  }, []);

  const toggleLoop = useCallback(() => {
    setLoopCount(0);
    setLoopOn((v) => !v);
  }, []);

  const addBookmark = useCallback(() => {
    const t = posRef.current;
    setBookmarks((list) => [...list, { id: newId(), name: fmtTime(t, true), t }].sort((x, y) => x.t - y.t));
  }, []);

  const saveCurrentLoop = useCallback(() => {
    if (loopB <= loopA + 0.05) return;
    const def = `${fmtTime(loopA, true)} – ${fmtTime(loopB, true)}`;
    const name = window.prompt('루프 이름', def)?.trim() || def;
    setSavedLoops((list) => [...list, { id: newId(), name, a: loopA, b: loopB }]);
  }, [loopA, loopB]);

  const applySavedLoop = useCallback((l: SavedLoop) => {
    setLoopA(l.a);
    setLoopB(l.b);
    setLoopCount(0);
    setLoopOn(true);
    doSeek(l.a);
  }, [doSeek]);

  /* ---------- 키보드 단축키 (파일 모드) ---------- */
  useEffect(() => {
    if (source !== 'file' || phase !== 'ready') return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      switch (e.key) {
        case ' ': e.preventDefault(); handlePlayPause(); break;
        case 'ArrowLeft': e.preventDefault(); seekBy(e.shiftKey ? -1 : -3); break;
        case 'ArrowRight': e.preventDefault(); seekBy(e.shiftKey ? 1 : 3); break;
        case 'ArrowUp': e.preventDefault(); setTempoPct((v) => Math.min(TEMPO_MAX_PCT, v + 2)); break;
        case 'ArrowDown': e.preventDefault(); setTempoPct((v) => Math.max(TEMPO_MIN_PCT, v - 2)); break;
        case 'a': case 'A': setPointA(); break;
        case 'b': case 'B': setPointB(); break;
        case 'l': case 'L': toggleLoop(); break;
        case 'm': case 'M': addBookmark(); break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [source, phase, handlePlayPause, seekBy, setPointA, setPointB, toggleLoop, addBookmark]);

  /* ---------- 파형 ---------- */
  const waveWrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = waveWrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas || phase !== 'ready') return;

    const draw = () => {
      const peaks = peaksRef.current;
      const w = wrap.clientWidth;
      const h = 130;
      if (!peaks || w === 0) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const c = canvas.getContext('2d');
      if (!c) return;
      c.scale(dpr, dpr);
      c.clearRect(0, 0, w, h);
      const buckets = peaks.length / 2;
      const mid = h / 2;
      c.fillStyle = '#8fb8d8';
      for (let x = 0; x < w; x++) {
        const i = Math.floor((x / w) * buckets);
        const mn = peaks[i * 2];
        const mx = peaks[i * 2 + 1];
        const y0 = mid + mn * (mid - 4);
        const y1 = mid + mx * (mid - 4);
        c.fillRect(x, Math.min(y0, y1), 1, Math.max(1, Math.abs(y1 - y0)));
      }
      c.fillStyle = 'rgba(0,0,0,0.18)';
      c.fillRect(0, mid, w, 1);
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [phase, peaksVersion]);

  /* 파형 포인터: 클릭=시크, 수평 드래그=루프 구간 지정 */
  const dragRef = useRef<{ startX: number; startT: number; dragged: boolean } | null>(null);

  const waveTimeAt = useCallback((clientX: number): number => {
    const wrap = waveWrapRef.current;
    if (!wrap || durRef.current <= 0) return 0;
    const r = wrap.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    return ratio * durRef.current;
  }, []);

  const onWavePointerDown = useCallback((e: React.PointerEvent) => {
    if (phase !== 'ready') return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startT: waveTimeAt(e.clientX), dragged: false };
  }, [phase, waveTimeAt]);

  const onWavePointerMove = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if (!d.dragged && Math.abs(e.clientX - d.startX) < 6) return;
    if (!d.dragged) setLoopCount(0);
    d.dragged = true;
    const t = waveTimeAt(e.clientX);
    setLoopA(Math.min(d.startT, t));
    setLoopB(Math.max(d.startT, t));
    setLoopOn(true);
  }, [waveTimeAt]);

  const onWavePointerUp = useCallback((e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.dragged) doSeek(waveTimeAt(e.clientX));
  }, [doSeek, waveTimeAt]);

  /* ---------- YouTube 모드 ---------- */
  const [ytUrl, setYtUrl] = useState('');
  const [ytId, setYtId] = useState('');
  const [ytError, setYtError] = useState('');
  const ytMountRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<YTPlayer | null>(null);
  const [ytReady, setYtReady] = useState(false);
  const [ytDur, setYtDur] = useState(0);
  const [ytPos, setYtPos] = useState(0);
  const [ytRate, setYtRate] = useState(1);
  const [ytLoopOn, setYtLoopOn] = useState(false);
  const [ytA, setYtA] = useState(0);
  const [ytB, setYtB] = useState(0);
  const [ytLoops, setYtLoops] = useState<SavedLoop[]>([]);
  const [ytMarks, setYtMarks] = useState<SavedBookmark[]>([]);
  const ytLoopRef = useRef({ on: false, a: 0, b: 0 });
  useEffect(() => { ytLoopRef.current = { on: ytLoopOn, a: ytA, b: ytB }; }, [ytLoopOn, ytA, ytB]);

  const loadYoutube = useCallback(() => {
    const id = parseYoutubeId(ytUrl);
    if (!id) { setYtError('유튜브 주소 또는 영상 ID를 인식하지 못했어요.'); return; }
    setYtError('');
    if (id === ytId) return; // 같은 영상 재입력 — 플레이어 유지

    setYtReady(false);
    setYtLoopOn(false);
    setYtA(0); setYtB(0); setYtPos(0); setYtDur(0); setYtRate(1);
    const st = loadTrackState(youtubeTrackKey(id));
    setYtLoops(st.loops);
    setYtMarks(st.bookmarks);
    setYtId(id);
  }, [ytUrl, ytId]);

  useEffect(() => {
    if (source !== 'youtube' || !ytId) return;
    let cancelled = false;
    let poll = 0;
    const mount = ytMountRef.current;

    loadYTApi().then((YT) => {
      if (cancelled || !mount) return;
      const inner = document.createElement('div');
      mount.appendChild(inner);
      ytPlayerRef.current = new YT.Player(inner, {
        videoId: ytId,
        playerVars: { rel: 0, modestbranding: 1, playsinline: 1, enablejsapi: 1, origin: window.location.origin },
        events: {
          onReady: (e) => {
            setYtReady(true);
            setYtDur(e.target.getDuration());
          },
        },
      });
      poll = window.setInterval(() => {
        const p = ytPlayerRef.current;
        if (!p) return;
        try {
          const t = p.getCurrentTime();
          const d = p.getDuration();
          setYtPos(t);
          if (d > 0) setYtDur(d);
          const lp = ytLoopRef.current;
          if (lp.on && lp.b > lp.a + 0.2 && t >= lp.b) p.seekTo(lp.a, true);
        } catch { /* 플레이어 전환 중 */ }
      }, 200);
    });

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      try { ytPlayerRef.current?.destroy(); } catch { /* 이미 파괴됨 */ }
      ytPlayerRef.current = null;
      if (mount) mount.innerHTML = '';
      setYtReady(false);
    };
  }, [source, ytId]);

  /* YT 곡별 저장 */
  useEffect(() => {
    if (!ytId) return;
    saveTrackState(youtubeTrackKey(ytId), { loops: ytLoops, bookmarks: ytMarks, settings: {} });
  }, [ytId, ytLoops, ytMarks]);

  const ytSetRate = useCallback((r: number) => {
    setYtRate(r);
    ytPlayerRef.current?.setPlaybackRate(r);
  }, []);

  const ytSetA = useCallback(() => {
    const t = ytPlayerRef.current?.getCurrentTime() ?? 0;
    setYtA(t);
    setYtB((b) => (b <= t + 0.2 ? (ytPlayerRef.current?.getDuration() ?? 0) : b));
  }, []);

  const ytSetB = useCallback(() => {
    const t = ytPlayerRef.current?.getCurrentTime() ?? 0;
    setYtB(t);
    setYtA((a) => (a >= t - 0.2 ? 0 : a));
    setYtLoopOn(true);
  }, []);

  const ytSaveLoop = useCallback(() => {
    if (ytB <= ytA + 0.2) return;
    const def = `${fmtTime(ytA, true)} – ${fmtTime(ytB, true)}`;
    const name = window.prompt('루프 이름', def)?.trim() || def;
    setYtLoops((list) => [...list, { id: newId(), name, a: ytA, b: ytB }]);
  }, [ytA, ytB]);

  const ytAddMark = useCallback(() => {
    const t = ytPlayerRef.current?.getCurrentTime() ?? 0;
    setYtMarks((list) => [...list, { id: newId(), name: fmtTime(t, true), t }].sort((x, y) => x.t - y.t));
  }, []);

  /* ── 렌더 ─────────────────────────────────────────────────────────── */

  const loopValid = loopB > loopA + 0.05;

  return (
    <Page>
      <AppSidebar />
      <PageBody>
        <TopBar>
          <BackButton onClick={() => navigate('/')} label="홈으로" />
          <Title>카피하기</Title>
        </TopBar>

        <Content>
          {/* 소스 선택 — 업로드 칸 바로 위, 화면을 반으로 가르는 탭. */}
          <SourceTabs role="tablist">
            <SourceTab
              type="button"
              role="tab"
              aria-selected={source === 'file'}
              $on={source === 'file'}
              onClick={() => setSource('file')}
            >
              🎧 음원 파일
            </SourceTab>
            <SourceTab
              type="button"
              role="tab"
              aria-selected={source === 'youtube'}
              $on={source === 'youtube'}
              onClick={() => setSource('youtube')}
            >
              ▶ YouTube
            </SourceTab>
          </SourceTabs>
          {/* ══════════ 파일 모드 ══════════ */}
          {source === 'file' && (phase === 'idle' || phase === 'error' || phase === 'decoding') && (
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
                accept="audio/*,video/mp4,.wav,.mp3,.m4a,.aac,.ogg,.flac,.mp4"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void processFile(f); e.target.value = ''; }}
              />
              <DropIcon>🎧</DropIcon>
              <DropTitle>{phase === 'decoding' ? '디코딩 중…' : '음원 파일을 끌어다 놓거나 클릭해서 선택'}</DropTitle>
              <DropSub>wav · mp3 · m4a · flac · ogg (mp4 영상의 소리도 시도)</DropSub>
              <DropSub>속도 25~200% 피치 유지 · A-B 루프 · 피치 이동 · 루프별 자동 속도 증가</DropSub>
              {error && <ErrorText>{error}</ErrorText>}
            </DropZone>
          )}

          {source === 'file' && phase === 'ready' && (
            <>
              <FileRow>
                <FileMeta>
                  <FileName title={fileName}>{fileName}</FileName>
                  <FileInfo>{fmtTime(duration)} · 속도 {tempoPct}% · 피치 {semis > 0 ? `+${semis}` : semis}
                    {cents !== 0 ? ` (${cents > 0 ? '+' : ''}${cents}¢)` : ''}
                    {loopOn && loopValid ? ` · 루프 ${loopCount}회` : ''}
                  </FileInfo>
                </FileMeta>
                <GhostBtn onClick={() => { engineRef.current?.pause(); setPlaying(false); setPhase('idle'); }}>
                  다른 파일
                </GhostBtn>
              </FileRow>

              {/* ── 파형 (클릭=이동 · 드래그=루프 구간) ── */}
              <WaveWrap
                ref={waveWrapRef}
                onPointerDown={onWavePointerDown}
                onPointerMove={onWavePointerMove}
                onPointerUp={onWavePointerUp}
              >
                <canvas ref={canvasRef} />
                {loopValid && duration > 0 && (
                  <LoopRegionBox
                    $dim={!loopOn}
                    style={{
                      left: `${(loopA / duration) * 100}%`,
                      width: `${((loopB - loopA) / duration) * 100}%`,
                    }}
                  />
                )}
                {bookmarks.map((b) => (
                  <MarkTick key={b.id} style={{ left: `${(b.t / duration) * 100}%` }} title={b.name} />
                ))}
                <Playhead ref={playheadRef} />
              </WaveWrap>

              {/* ── 트랜스포트 ── */}
              <Transport>
                <TransBtn onClick={handleStop} title="처음(루프 시)으로 · 정지">■</TransBtn>
                <TransBtn onClick={() => seekBy(-5)} title="5초 뒤로 (←: 3초)">−5s</TransBtn>
                <TransBtn onClick={handlePlayPause} $primary title="재생/일시정지 (Space)">
                  {playing ? '❚❚' : '▶'}
                </TransBtn>
                <TransBtn onClick={() => seekBy(5)} title="5초 앞으로 (→: 3초)">+5s</TransBtn>
                <TimeLabel>{fmtTime(posSec, true)}</TimeLabel>
                <TimeSep>/</TimeSep>
                <TimeLabel $dim>{fmtTime(duration, true)}</TimeLabel>
                <Spacer />
                <TransBtn onClick={setPointA} title="루프 시작점을 현재 위치로 (A)">A┤</TransBtn>
                <TransBtn onClick={setPointB} title="루프 끝점을 현재 위치로 — 즉시 루프 시작 (B)">├B</TransBtn>
                <TransBtn onClick={toggleLoop} $lit={loopOn && loopValid} title="A-B 루프 켜기/끄기 (L)">⟲ 루프</TransBtn>
                <TransBtn onClick={addBookmark} title="현재 위치 북마크 (M)">🔖</TransBtn>
              </Transport>

              {/* ── 컨트롤 상자들 ── */}
              <BoxGrid>
                {/* 속도 */}
                <Box>
                  <BoxTitle>속도 (피치 유지)</BoxTitle>
                  <SliderRow>
                    <StepBtn onClick={() => setTempoPct((v) => Math.max(TEMPO_MIN_PCT, v - 5))}>−5</StepBtn>
                    <StepBtn onClick={() => setTempoPct((v) => Math.max(TEMPO_MIN_PCT, v - 1))}>−1</StepBtn>
                    <Slider
                      type="range" min={TEMPO_MIN_PCT} max={TEMPO_MAX_PCT} step={1} value={tempoPct}
                      onChange={(e) => setTempoPct(Number(e.target.value))}
                    />
                    <StepBtn onClick={() => setTempoPct((v) => Math.min(TEMPO_MAX_PCT, v + 1))}>+1</StepBtn>
                    <StepBtn onClick={() => setTempoPct((v) => Math.min(TEMPO_MAX_PCT, v + 5))}>+5</StepBtn>
                  </SliderRow>
                  <ValueRow>
                    <BigValue>{tempoPct}%</BigValue>
                    <ResetBtn onClick={() => setTempoPct(100)} disabled={tempoPct === 100}>100%로</ResetBtn>
                  </ValueRow>
                  <AdvanceRow title="루프가 한 바퀴 돌 때마다 속도를 자동으로 바꿉니다 — 점점 빠르게 연습">
                    <input
                      id="adv-on" type="checkbox" checked={advOn}
                      onChange={(e) => setAdvOn(e.target.checked)}
                    />
                    <label htmlFor="adv-on">반복마다</label>
                    <MiniNum
                      type="number" min={-20} max={20} value={advStep}
                      onChange={(e) => setAdvStep(Number(e.target.value))}
                    />
                    <span>%씩,</span>
                    <MiniNum
                      type="number" min={TEMPO_MIN_PCT} max={TEMPO_MAX_PCT} value={advLimit}
                      onChange={(e) => setAdvLimit(Number(e.target.value))}
                    />
                    <span>%까지</span>
                  </AdvanceRow>
                </Box>

                {/* 피치 */}
                <Box>
                  <BoxTitle>피치 (속도와 독립)</BoxTitle>
                  <SliderRow>
                    <StepBtn onClick={() => setSemis((v) => Math.max(-12, v - 1))}>♭</StepBtn>
                    <Slider
                      type="range" min={-12} max={12} step={1} value={semis}
                      onChange={(e) => setSemis(Number(e.target.value))}
                    />
                    <StepBtn onClick={() => setSemis((v) => Math.min(12, v + 1))}>♯</StepBtn>
                  </SliderRow>
                  <ValueRow>
                    <BigValue>{semis > 0 ? `+${semis}` : semis} 반음</BigValue>
                    <ResetBtn onClick={() => { setSemis(0); setCents(0); }} disabled={semis === 0 && cents === 0}>원조로</ResetBtn>
                  </ValueRow>
                  <SliderRow title="반음 사이 미세 조율 — 튜닝이 낮은 옛 녹음 보정용">
                    <SmallLabel>센트</SmallLabel>
                    <Slider
                      type="range" min={-50} max={50} step={1} value={cents}
                      onChange={(e) => setCents(Number(e.target.value))}
                    />
                    <SmallValue>{cents > 0 ? `+${cents}` : cents}¢</SmallValue>
                  </SliderRow>
                </Box>

                {/* 루프 */}
                <Box>
                  <BoxTitle>A-B 루프</BoxTitle>
                  <LoopPointRow>
                    <LoopTag>A</LoopTag>
                    <NudgeBtn onClick={() => setLoopA((v) => Math.max(0, v - 0.1))}>−0.1</NudgeBtn>
                    <LoopTime>{fmtTime(loopA, true)}</LoopTime>
                    <NudgeBtn onClick={() => setLoopA((v) => Math.min(loopB - 0.1, v + 0.1))}>+0.1</NudgeBtn>
                  </LoopPointRow>
                  <LoopPointRow>
                    <LoopTag>B</LoopTag>
                    <NudgeBtn onClick={() => setLoopB((v) => Math.max(loopA + 0.1, v - 0.1))}>−0.1</NudgeBtn>
                    <LoopTime>{fmtTime(loopB, true)}</LoopTime>
                    <NudgeBtn onClick={() => setLoopB((v) => Math.min(duration, v + 0.1))}>+0.1</NudgeBtn>
                  </LoopPointRow>
                  <ValueRow>
                    <SmallLabel>{loopOn && loopValid ? `반복 중 · ${loopCount}회` : '꺼짐'}</SmallLabel>
                    <ResetBtn onClick={saveCurrentLoop} disabled={!loopValid}>루프 저장</ResetBtn>
                  </ValueRow>
                </Box>

                {/* 사운드 */}
                <Box>
                  <BoxTitle>사운드</BoxTitle>
                  <SliderRow>
                    <SmallLabel>저음</SmallLabel>
                    <Slider type="range" min={-15} max={15} step={1} value={eqLow} onChange={(e) => setEqLow(Number(e.target.value))} />
                    <SmallValue>{eqLow > 0 ? `+${eqLow}` : eqLow}dB</SmallValue>
                  </SliderRow>
                  <SliderRow>
                    <SmallLabel>고음</SmallLabel>
                    <Slider type="range" min={-15} max={15} step={1} value={eqHigh} onChange={(e) => setEqHigh(Number(e.target.value))} />
                    <SmallValue>{eqHigh > 0 ? `+${eqHigh}` : eqHigh}dB</SmallValue>
                  </SliderRow>
                  <SliderRow title="가운데 제거: 센터에 실린 보컬/멜로디를 상쇄합니다. 센터의 베이스·드럼도 함께 줄어드니 EQ 저음으로 보정하세요.">
                    <SmallLabel>믹스</SmallLabel>
                    <MixSelect value={mixMode} onChange={(e) => setMixMode(e.target.value as MixMode)}>
                      <option value="stereo">스테레오</option>
                      <option value="left">왼쪽 채널만</option>
                      <option value="right">오른쪽 채널만</option>
                      <option value="karaoke">가운데 제거 (보컬↓)</option>
                    </MixSelect>
                  </SliderRow>
                  <SliderRow>
                    <SmallLabel>밸런스</SmallLabel>
                    <Slider type="range" min={-100} max={100} step={5} value={balance * 100} onChange={(e) => setBalance(Number(e.target.value) / 100)} />
                    <SmallValue>{balance === 0 ? '중앙' : balance < 0 ? `L${Math.round(-balance * 100)}` : `R${Math.round(balance * 100)}`}</SmallValue>
                  </SliderRow>
                  <SliderRow>
                    <SmallLabel>볼륨</SmallLabel>
                    <Slider type="range" min={0} max={130} step={1} value={volume} onChange={(e) => setVolume(Number(e.target.value))} />
                    <SmallValue>{volume}%</SmallValue>
                  </SliderRow>
                </Box>
              </BoxGrid>

              {/* ── 저장된 루프 · 북마크 ── */}
              {(savedLoops.length > 0 || bookmarks.length > 0) && (
                <SavedWrap>
                  {savedLoops.length > 0 && (
                    <SavedGroup>
                      <SavedTitle>저장된 루프</SavedTitle>
                      <ChipRow>
                        {savedLoops.map((l) => (
                          <Chip key={l.id}>
                            <ChipBody onClick={() => applySavedLoop(l)} title={`${fmtTime(l.a, true)} – ${fmtTime(l.b, true)}`}>
                              ⟲ {l.name}
                            </ChipBody>
                            <ChipX onClick={() => setSavedLoops((list) => list.filter((x) => x.id !== l.id))}>✕</ChipX>
                          </Chip>
                        ))}
                      </ChipRow>
                    </SavedGroup>
                  )}
                  {bookmarks.length > 0 && (
                    <SavedGroup>
                      <SavedTitle>북마크</SavedTitle>
                      <ChipRow>
                        {bookmarks.map((b) => (
                          <Chip key={b.id}>
                            <ChipBody onClick={() => doSeek(b.t)}>🔖 {b.name}</ChipBody>
                            <ChipX onClick={() => setBookmarks((list) => list.filter((x) => x.id !== b.id))}>✕</ChipX>
                          </Chip>
                        ))}
                      </ChipRow>
                    </SavedGroup>
                  )}
                </SavedWrap>
              )}

              <HintText>
                단축키 — Space 재생 · ←/→ 3초 이동(Shift: 1초) · ↑/↓ 속도 ±2% · A/B 루프점 · L 루프 · M 북마크 · 파형 드래그로 루프 구간 지정
              </HintText>
            </>
          )}

          {/* ══════════ YouTube 모드 ══════════ */}
          {source === 'youtube' && (
            <>
              <YtInputRow>
                <YtInput
                  type="text"
                  placeholder="유튜브 영상 주소 붙여넣기 (https://www.youtube.com/watch?v=…)"
                  value={ytUrl}
                  onChange={(e) => setYtUrl(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') loadYoutube(); }}
                />
                <PrimaryBtn onClick={loadYoutube}>불러오기</PrimaryBtn>
              </YtInputRow>
              {ytError && <ErrorText>{ytError}</ErrorText>}

              {ytId && (
                <>
                  <YtFrame>
                    <div ref={ytMountRef} style={{ position: 'absolute', inset: 0 }} />
                  </YtFrame>

                  <Transport>
                    <TimeLabel>{fmtTime(ytPos, true)}</TimeLabel>
                    <TimeSep>/</TimeSep>
                    <TimeLabel $dim>{fmtTime(ytDur, true)}</TimeLabel>
                    <Spacer />
                    <TransBtn onClick={ytSetA} title="루프 시작점을 현재 위치로">A┤</TransBtn>
                    <TransBtn onClick={ytSetB} title="루프 끝점을 현재 위치로 — 즉시 루프 시작">├B</TransBtn>
                    <TransBtn onClick={() => setYtLoopOn((v) => !v)} $lit={ytLoopOn && ytB > ytA + 0.2} title="A-B 루프 켜기/끄기">⟲ 루프</TransBtn>
                    <TransBtn onClick={ytAddMark} title="현재 위치 북마크">🔖</TransBtn>
                  </Transport>

                  <BoxGrid>
                    <Box>
                      <BoxTitle>속도 (YouTube)</BoxTitle>
                      <RateRow>
                        {YT_RATES.map((r) => (
                          <RateBtn key={r} $on={ytRate === r} disabled={!ytReady} onClick={() => ytSetRate(r)}>
                            {r}×
                          </RateBtn>
                        ))}
                      </RateRow>
                      <YtNote>YouTube 재생은 속도(피치 유지)·A-B 루프·북마크만 지원해요. 피치 이동·EQ·가운데 제거는 파일 업로드에서 사용할 수 있어요.</YtNote>
                    </Box>
                    <Box>
                      <BoxTitle>A-B 루프</BoxTitle>
                      <LoopPointRow>
                        <LoopTag>A</LoopTag>
                        <NudgeBtn onClick={() => setYtA((v) => Math.max(0, v - 0.5))}>−0.5</NudgeBtn>
                        <LoopTime>{fmtTime(ytA, true)}</LoopTime>
                        <NudgeBtn onClick={() => setYtA((v) => v + 0.5)}>+0.5</NudgeBtn>
                      </LoopPointRow>
                      <LoopPointRow>
                        <LoopTag>B</LoopTag>
                        <NudgeBtn onClick={() => setYtB((v) => Math.max(ytA + 0.5, v - 0.5))}>−0.5</NudgeBtn>
                        <LoopTime>{fmtTime(ytB, true)}</LoopTime>
                        <NudgeBtn onClick={() => setYtB((v) => v + 0.5)}>+0.5</NudgeBtn>
                      </LoopPointRow>
                      <ValueRow>
                        <SmallLabel>{ytLoopOn && ytB > ytA + 0.2 ? '반복 중' : '꺼짐'}</SmallLabel>
                        <ResetBtn onClick={ytSaveLoop} disabled={ytB <= ytA + 0.2}>루프 저장</ResetBtn>
                      </ValueRow>
                    </Box>
                  </BoxGrid>

                  {(ytLoops.length > 0 || ytMarks.length > 0) && (
                    <SavedWrap>
                      {ytLoops.length > 0 && (
                        <SavedGroup>
                          <SavedTitle>저장된 루프</SavedTitle>
                          <ChipRow>
                            {ytLoops.map((l) => (
                              <Chip key={l.id}>
                                <ChipBody onClick={() => { setYtA(l.a); setYtB(l.b); setYtLoopOn(true); ytPlayerRef.current?.seekTo(l.a, true); }}>
                                  ⟲ {l.name}
                                </ChipBody>
                                <ChipX onClick={() => setYtLoops((list) => list.filter((x) => x.id !== l.id))}>✕</ChipX>
                              </Chip>
                            ))}
                          </ChipRow>
                        </SavedGroup>
                      )}
                      {ytMarks.length > 0 && (
                        <SavedGroup>
                          <SavedTitle>북마크</SavedTitle>
                          <ChipRow>
                            {ytMarks.map((b) => (
                              <Chip key={b.id}>
                                <ChipBody onClick={() => ytPlayerRef.current?.seekTo(b.t, true)}>🔖 {b.name}</ChipBody>
                                <ChipX onClick={() => setYtMarks((list) => list.filter((x) => x.id !== b.id))}>✕</ChipX>
                              </Chip>
                            ))}
                          </ChipRow>
                        </SavedGroup>
                      )}
                    </SavedWrap>
                  )}
                </>
              )}

              {!ytId && (
                <DropZone as="div" $active={false} style={{ cursor: 'default' }}>
                  <DropIcon>▶️</DropIcon>
                  <DropTitle>유튜브 영상으로 카피 연습</DropTitle>
                  <DropSub>주소를 붙여넣으면 속도 조절(0.25×~2×, 피치 유지)과 A-B 반복 재생을 쓸 수 있어요.</DropSub>
                  <DropSub>피치 이동 · EQ · 가운데 제거까지 쓰려면 음원 파일을 업로드하세요.</DropSub>
                </DropZone>
              )}
            </>
          )}
        </Content>
      </PageBody>
    </Page>
  );
}

/* ── styles ──────────────────────────────────────────────────────────── */

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
  padding: calc(env(safe-area-inset-top, 0px) + 10px) 16px 10px;
  background: ${({ theme }) => theme.colors.barTop};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  flex-shrink: 0;
`;

const Title = styled.h1`
  margin: 0;
  font-size: 1.05rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Spacer = styled.div`flex: 1;`;

/* 소스 탭 — 업로드 칸 바로 위에서 폭을 정확히 반으로 나눈다. */
const SourceTabs = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-bottom: 1.5px solid ${({ theme }) => theme.colors.border};
  margin-top: 2vh;
`;

const SourceTab = styled.button<{ $on?: boolean }>`
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 13px 8px;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 0.95rem;
  font-weight: 700;
  color: ${({ $on, theme }) => ($on ? theme.colors.textPrimary : theme.colors.textSecondary)};
  cursor: pointer;
  transition: color 0.15s;

  /* 선택된 탭 아래 밑줄 — 탭 바의 경계선 위에 겹쳐 그린다. */
  &::after {
    content: '';
    position: absolute;
    left: 0; right: 0; bottom: -1.5px;
    height: 2.5px;
    border-radius: 2px;
    background: ${({ $on }) => ($on ? '#1a1a1a' : 'transparent')};
  }

  &:hover { color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const Content = styled.div`
  flex: 1;
  overflow-y: auto;
  padding: 18px 20px calc(env(safe-area-inset-bottom, 0px) + 24px);
  display: flex;
  flex-direction: column;
  gap: 14px;
  max-width: 1080px;
  width: 100%;
  margin: 0 auto;
`;

/* ── 업로드 존 ── */

const DropZone = styled.div<{ $active: boolean }>`
  border: 2px dashed ${({ $active, theme }) => ($active ? '#7cb8e8' : theme.colors.border)};
  background: ${({ $active }) => ($active ? '#eef6fd' : 'transparent')};
  border-radius: 16px;
  padding: 52px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
`;

const DropIcon = styled.div`font-size: 2.4rem;`;
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
  margin-top: 6px;
  font-size: 0.85rem;
  color: ${({ theme }) => theme.colors.danger};
`;

/* ── 파일 정보 ── */

const FileRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const FileMeta = styled.div`
  flex: 1;
  min-width: 0;
`;

const FileName = styled.div`
  font-weight: 700;
  font-size: 0.98rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const FileInfo = styled.div`
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-top: 2px;
`;

const GhostBtn = styled.button`
  flex-shrink: 0;
  padding: 7px 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: transparent;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  cursor: pointer;
`;

const PrimaryBtn = styled.button`
  flex-shrink: 0;
  padding: 9px 18px;
  border: none;
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.inkSurface};
  color: ${({ theme }) => theme.colors.onInk};
  font-family: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
`;

/* ── 파형 ── */

const WaveWrap = styled.div`
  position: relative;
  height: 130px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.surface};
  overflow: hidden;
  touch-action: none;
  cursor: crosshair;
  user-select: none;

  canvas { display: block; }
`;

const LoopRegionBox = styled.div<{ $dim?: boolean }>`
  position: absolute;
  top: 0;
  bottom: 0;
  background: ${({ $dim }) => ($dim ? 'rgba(160,160,160,0.14)' : 'rgba(124,184,232,0.22)')};
  border-left: 2px solid ${({ $dim }) => ($dim ? '#b5b5b5' : '#4a90c9')};
  border-right: 2px solid ${({ $dim }) => ($dim ? '#b5b5b5' : '#4a90c9')};
  pointer-events: none;
`;

const MarkTick = styled.div`
  position: absolute;
  top: 0;
  width: 0;
  height: 0;
  transform: translateX(-6px);
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 9px solid #e8a13c;
  pointer-events: none;
`;

const Playhead = styled.div`
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0%;
  width: 2px;
  background: #d64541;
  pointer-events: none;
`;

/* ── 트랜스포트 ── */

const Transport = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
`;

const TransBtn = styled.button<{ $primary?: boolean; $lit?: boolean }>`
  min-width: 44px;
  height: 40px;
  padding: 0 12px;
  border: 1px solid ${({ $lit, theme }) => ($lit ? '#4a90c9' : theme.colors.border)};
  border-radius: 9px;
  background: ${({ $primary, $lit }) => ($primary ? '#1a1a1a' : $lit ? '#e3f2fd' : '#fff')};
  color: ${({ $primary, $lit }) => ($primary ? '#fff' : $lit ? '#20597f' : '#333')};
  font-family: inherit;
  font-size: 0.88rem;
  font-weight: 700;
  cursor: pointer;
`;

const TimeLabel = styled.span<{ $dim?: boolean }>`
  font-variant-numeric: tabular-nums;
  font-size: 0.92rem;
  font-weight: 600;
  color: ${({ $dim, theme }) => ($dim ? theme.colors.textSecondary : theme.colors.textPrimary)};
`;

const TimeSep = styled.span`
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 0.85rem;
`;

/* ── 컨트롤 상자 (에디터 Section/BoxLegend 결) ── */

const BoxGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 14px;
`;

const Box = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px 12px 10px;
  border: 2px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.surface};
`;

const BoxTitle = styled.span`
  position: absolute;
  top: -8px;
  left: 12px;
  z-index: 1;
  padding: 0 6px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-size: 0.76rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textSecondary};
  white-space: nowrap;
  line-height: 1;
`;

const SliderRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
`;

const Slider = styled.input`
  flex: 1;
  min-width: 50px;
  accent-color: #4a90c9;
`;

const StepBtn = styled.button`
  flex-shrink: 0;
  min-width: 32px;
  height: 28px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 7px;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: inherit;
  font-size: 0.76rem;
  font-weight: 700;
  cursor: pointer;
`;

const ValueRow = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
`;

const BigValue = styled.span`
  font-size: 1.15rem;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const ResetBtn = styled.button`
  padding: 4px 10px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 7px;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  &:disabled { opacity: 0.45; cursor: default; }
`;

const AdvanceRow = styled.div`
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  label { cursor: pointer; }
`;

const MiniNum = styled.input`
  width: 48px;
  padding: 3px 4px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 6px;
  font-size: 0.78rem;
  text-align: center;
`;

const SmallLabel = styled.span`
  flex-shrink: 0;
  width: 44px;
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const SmallValue = styled.span`
  flex-shrink: 0;
  width: 46px;
  text-align: right;
  font-size: 0.78rem;
  font-variant-numeric: tabular-nums;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const MixSelect = styled.select`
  flex: 1;
  min-width: 0;
  padding: 5px 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 7px;
  font-size: 0.8rem;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

/* ── 루프 박스 ── */

const LoopPointRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
`;

const LoopTag = styled.span`
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: #e3f2fd;
  color: #20597f;
  font-size: 0.72rem;
  font-weight: 800;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
`;

const LoopTime = styled.span`
  flex: 1;
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-size: 0.95rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const NudgeBtn = styled(StepBtn)`min-width: 42px;`;

/* ── 저장 목록 ── */

const SavedWrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 10px;
`;

const SavedGroup = styled.div``;

const SavedTitle = styled.div`
  font-size: 0.78rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 5px;
`;

const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
`;

const Chip = styled.span`
  display: inline-flex;
  align-items: center;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 999px;
  background: ${({ theme }) => theme.colors.surface};
  overflow: hidden;
`;

const ChipBody = styled.button`
  border: none;
  background: transparent;
  padding: 5px 4px 5px 11px;
  font-family: inherit;
  font-size: 0.78rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
`;

const ChipX = styled.button`
  border: none;
  background: transparent;
  padding: 5px 9px 5px 4px;
  font-size: 0.7rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;
  &:hover { color: ${({ theme }) => theme.colors.danger}; }
`;

const HintText = styled.div`
  font-size: 0.74rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  line-height: 1.6;
`;

/* ── YouTube ── */

const YtInputRow = styled.div`
  display: flex;
  gap: 8px;
`;

const YtInput = styled.input`
  flex: 1;
  min-width: 0;
  padding: 10px 13px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 9px;
  font-family: inherit;
  font-size: 0.86rem;
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const YtFrame = styled.div`
  position: relative;
  width: 100%;
  max-width: 760px;
  aspect-ratio: 16 / 9;
  margin: 0 auto;
  border-radius: 12px;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.inkSurface};

  iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
  }
`;

const RateRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
`;

const RateBtn = styled.button<{ $on?: boolean }>`
  min-width: 46px;
  height: 32px;
  border: 1px solid ${({ $on, theme }) => ($on ? '#4a90c9' : theme.colors.border)};
  border-radius: 8px;
  background: ${({ $on }) => ($on ? '#e3f2fd' : '#fff')};
  color: ${({ $on }) => ($on ? '#20597f' : '#333')};
  font-family: inherit;
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  &:disabled { opacity: 0.5; cursor: default; }
`;

const YtNote = styled.div`
  font-size: 0.75rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  line-height: 1.55;
`;
