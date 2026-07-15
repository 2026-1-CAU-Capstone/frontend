import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { isComposingEvent } from '../lib/ime';
import { parseYoutubeId } from '../data/lickVideos';
import { getSong, getSongIndex, type SongEntry } from '../lib/ireal/irealLoader';
import type { LeadSheetData, LeadSheetChord } from '../data/leadSheetTypes';
import { leadSheetToChart } from '../lib/backing';
import { useGlobalPlayer, type ChartInput } from '../lib/player';
import { getPlayerSettings, inferGenre, inferPlayStyle, setPlayerSetting } from '../lib/note/playerSettings';
import { useCountInIntro } from '../hooks/useCountInIntro';
import { LeadSheet } from '../components/leadsheet/LeadSheet';
import { NoteSheet } from '../components/notesheet/NoteSheet';
import type { NoteSheetData } from '../data/sampleMelody';
import { MixerButton, BpmControl, TransportButtons } from '../components/backing/BackingPlayerBar';
import { YoutubeTrimmer, type TrimState } from '../components/amt/YoutubeTrimmer';
import { AudioTrimmer } from '../components/amt/AudioTrimmer';
import { SongPicker } from '../components/amt/SongPicker';
import { fetchYoutubeTitle, formatTime } from '../components/amt/amtYoutube';
import { transcribeFileToSheet } from '../lib/amt/basicPitch';
import { notesToMidi } from '../lib/amt/notesToMidi';
import type { TimedNote } from '../lib/amt/notesToNoteSheet';

/* ─────────────────────────────────────────────────────────────────────────
 * AMT (Automatic Music Transcription) 실험 페이지 — admin 전용.
 *
 * 흐름: (1) 소스 입력 — YouTube 링크 또는 오디오 파일(wav/mp3). (2) 구간 트림 —
 * 재생기 위에서 IN/OUT 지점을 정밀하게 맞춤 (YouTube는 마커만; 실제 컷은 전송 시
 * 서버). (3) 메타데이터 — iReal Pro 1460곡에서 곡을 검색해 코드 진행을 확정하고
 * BPM을 지정. (4) AMT 모델로 전송(현재 스텁) → 결과(채보 악보)는 기존 VexFlow
 * NoteSheet로 렌더링될 자리.
 *
 * 재사용: 코드 진행 표시는 LeadSheet, 반주 재생/믹서는 GlobalPlayer +
 * BackingPlayerBar(MixerButton/BpmControl/TransportButtons)를 그대로 import.
 * ──────────────────────────────────────────────────────────────────────── */

type SourceMode = 'youtube' | 'file';
type SendState = 'idle' | 'pending' | 'sent';

const AUDIO_ACCEPT = '.wav,.mp3,audio/wav,audio/mpeg,audio/x-wav';

/** iReal-style chord label from a LeadSheetChord (root+accidental+quality+/bass). */
function fmtChord(c: LeadSheetChord): string {
  if (c.isRepeat || !c.root) return '';
  const bass = c.bass ? `/${c.bass.root}${c.bass.accidental ?? ''}` : '';
  return `${c.root}${c.accidental ?? ''}${c.quality ?? ''}${bass}`;
}

/** Flatten a lead sheet to one chord label per bar (multi-chord bars joined). */
function flattenBarChords(sheet: LeadSheetData): string[] {
  const out: string[] = [];
  let prev = '';
  for (const sys of sheet.systems) {
    for (const bar of sys.bars) {
      const syms = (bar.chords ?? []).map(fmtChord).filter(Boolean);
      const s = syms.join(' ');
      if (s) { out.push(s); prev = s; }
      else out.push(prev); // repeat / empty bar carries the previous chord
    }
  }
  return out;
}

export default function AmtPage() {
  const { player } = useGlobalPlayer();
  const countIn = useCountInIntro();

  const [sourceMode, setSourceMode] = useState<SourceMode>('youtube');

  // YouTube source
  const [urlInput, setUrlInput] = useState('');
  const [videoId, setVideoId] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState<string | null>(null);

  // File source
  const [audioFile, setAudioFile] = useState<File | null>(null);

  // Trim selection (shared shape for both sources)
  const [trim, setTrim] = useState<TrimState>({ startSec: null, endSec: null, duration: 0 });

  // Metadata
  const [song, setSong] = useState<SongEntry | null>(null);
  const [sheet, setSheet] = useState<LeadSheetData | null>(null);
  const [bpm, setBpm] = useState(120);

  // Playback
  const [isPlaying, setIsPlaying] = useState(false);
  const [activeBar, setActiveBar] = useState(-1);

  // Send / transcription
  const [sendState, setSendState] = useState<SendState>('idle');
  const [payloadPreview, setPayloadPreview] = useState<string>('');
  const [result, setResult] = useState<NoteSheetData | null>(null);
  const [rawNotes, setRawNotes] = useState<TimedNote[] | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [amtError, setAmtError] = useState<string | null>(null);

  // Transcription tuning
  const [bassFocus, setBassFocus] = useState(true);
  const [showChords, setShowChords] = useState(true);
  const [onsetThreshold, setOnsetThreshold] = useState(0.5);
  const [minNoteLen, setMinNoteLen] = useState(11);

  const tapTimes = useRef<number[]>([]);

  /* ── playback (chord chart backing track) ─────────────────── */
  const chartInput = useMemo<ChartInput | null>(() => (sheet ? { kind: 'chart', data: sheet } : null), [sheet]);

  useEffect(() => {
    const offBar = player.on('bar', (bar) => {
      if (player.currentInput?.kind !== 'chart') return;
      setActiveBar(bar);
    });
    const offDone = player.on('done', () => {
      if (player.currentInput && player.currentInput.kind !== 'chart') return;
      setIsPlaying(false);
    });
    return () => { offBar(); offDone(); };
  }, [player]);

  const handlePlayPause = useCallback(async () => {
    if (!chartInput) return;
    if (isPlaying || countIn.active) {
      if (isPlaying) player.pause();
      countIn.cancel();
      setIsPlaying(false);
      return;
    }
    setIsPlaying(true);
    player.unlock(chartInput);
    try {
      const cin = await countIn.run({
        bpm,
        ready: player.isReady(chartInput),
        prepare: player.preload(chartInput).catch(() => {}),
      });
      if (!cin.ok) { setIsPlaying(false); return; }
      await player.play(chartInput, { downbeatInSec: cin.downbeatInSec });
    } catch (err) {
      console.error('[amt] play failed:', err);
      setIsPlaying(false);
    }
  }, [player, chartInput, isPlaying, bpm, countIn]);

  const handleStop = useCallback(() => {
    player.stop();
    countIn.cancel();
    setIsPlaying(false);
    setActiveBar(-1);
  }, [player, countIn]);

  /* ── metadata: song → lock chord progression ─────────────── */
  const pickSong = useCallback(async (entry: SongEntry) => {
    setSong(entry);
    setSendState('idle');
    const data = await getSong(entry.index);
    if (!data) return;
    setSheet(data);
    // BPM 기본값 + 반주 스타일/장르를 차트에서 추론 (ChordPage 와 동일 경로).
    const chart = leadSheetToChart(data);
    setBpm(chart.bpm);
    const inferredStyle = inferPlayStyle(chart.defaultStyle ?? data.style);
    if (inferredStyle && inferredStyle !== getPlayerSettings().style) setPlayerSetting('style', inferredStyle);
    const inferredGenre = inferGenre(data.style ?? chart.defaultStyle);
    if (inferredGenre && inferredGenre !== getPlayerSettings().genre) setPlayerSetting('genre', inferredGenre);
  }, []);

  const clearSong = () => { setSong(null); setSheet(null); setActiveBar(-1); handleStop(); };

  /* ── BPM tap tempo ───────────────────────────────────────── */
  const handleTap = () => {
    const now = performance.now();
    const times = tapTimes.current.filter((t) => now - t < 2500);
    times.push(now);
    tapTimes.current = times;
    if (times.length >= 2) {
      const intervals = times.slice(1).map((t, i) => t - times[i]);
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const next = Math.round(60000 / avg);
      if (next >= 30 && next <= 320) setBpm(next);
    }
  };

  /* Switching source resets the trim selection so a stale range from the other
   * source can't satisfy the send checklist. */
  const switchMode = (m: SourceMode) => {
    setSourceMode(m);
    setTrim({ startSec: null, endSec: null, duration: 0 });
    setSendState('idle');
  };

  /* ── source: YouTube ─────────────────────────────────────── */
  const handleLoadUrl = useCallback(async () => {
    const id = parseYoutubeId(urlInput);
    if (!id) { setVideoId(null); setVideoTitle(null); return; }
    setVideoId(id);
    setVideoTitle(null);
    setSendState('idle');
    const title = await fetchYoutubeTitle(id);
    setVideoTitle(title);
    // "분석" — 영상 제목으로 카탈로그에서 곡을 자동 추정해 미리 선택(변경 가능).
    if (title && !song) {
      try {
        const idx = await getSongIndex();
        const t = title.toLowerCase();
        const match = idx.find((s) => {
          const st = s.title.toLowerCase();
          return t.includes(st) || st.includes(t.split(/[-–—|(]/)[0].trim());
        });
        if (match) void pickSong(match);
      } catch { /* best-effort */ }
    }
  }, [urlInput, song, pickSong]);

  /* ── source: file ────────────────────────────────────────── */
  const handleFile = (f: File | null) => {
    if (!f) return;
    setAudioFile(f);
    setSendState('idle');
  };

  /* ── send to AMT (stub) ──────────────────────────────────── */
  const sourceReady = sourceMode === 'youtube' ? !!videoId : !!audioFile;
  const trimReady = trim.startSec != null && trim.endSec != null && trim.endSec > trim.startSec;
  const canSend = sourceReady && trimReady && !!song && !!sheet;

  const handleSend = async () => {
    if (!canSend || !song || !sheet) return;
    setAmtError(null);
    setResult(null);
    const timeSignature = sheet.timeSignature ?? '4/4';

    // File path — real in-browser transcription via Basic Pitch.
    if (sourceMode === 'file' && audioFile) {
      setTranscribing(true);
      setProgress(0);
      setRawNotes(null);
      setSendState('pending');
      try {
        const { noteCount, sheet: resultSheet, notes } = await transcribeFileToSheet(
          audioFile, trim.startSec!, trim.endSec!,
          {
            bpm, timeSignature, title: song.title, key: song.key,
            bassFocus, onsetThreshold, minNoteLenFrames: minNoteLen,
            barChords: showChords ? flattenBarChords(sheet) : undefined,
          },
          (p) => setProgress(p),
        );
        if (noteCount === 0) setAmtError('베이스 음을 찾지 못했습니다 — 구간이 맞는지, 베이스가 들리는 음원인지, 감도를 낮춰볼지 확인하세요.');
        setResult(resultSheet);
        setRawNotes(notes);
        setSendState('sent');
      } catch (e) {
        console.error('[AMT] transcription failed', e);
        setAmtError(e instanceof Error ? e.message : '채보 실패');
        setSendState('idle');
      } finally {
        setTranscribing(false);
      }
      return;
    }

    // YouTube path — browsers can't fetch YouTube audio; needs a server
    // (yt-dlp) before a model can run. Show the payload that WOULD be sent.
    const payload = {
      source: { type: 'youtube', url: urlInput, videoId },
      clip: { startSec: Number(trim.startSec!.toFixed(3)), endSec: Number(trim.endSec!.toFixed(3)) },
      song: { index: song.index, title: song.title, composer: song.composer, key: song.key, style: song.style },
      bpm,
    };
    setPayloadPreview(JSON.stringify(payload, null, 2));
    setSendState('sent');
    console.log('[AMT] youtube payload (needs server) →', payload);
  };

  const handleDownloadMidi = () => {
    if (!rawNotes || rawNotes.length === 0) return;
    const bytes = notesToMidi(rawNotes, bpm);
    const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/midi' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(song?.title ?? 'amt-bass').replace(/[^\w가-힣-]+/g, '_')}_bass.mid`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Page>
      <Header>
        <H1>AMT · 자동 채보 실험실</H1>
        <Sub>영상/오디오에서 구간을 잘라 코드 진행과 함께 AMT 모델에 보내고, 채보 결과를 확인합니다.</Sub>
      </Header>

      {/* STEP 1 — 소스 */}
      <Card>
        <StepHead><StepNo>1</StepNo><StepTitle>소스 입력</StepTitle></StepHead>
        <Tabs>
          <Tab $on={sourceMode === 'youtube'} onClick={() => switchMode('youtube')}>YouTube 링크</Tab>
          <Tab $on={sourceMode === 'file'} onClick={() => switchMode('file')}>오디오 파일</Tab>
        </Tabs>

        {sourceMode === 'youtube' ? (
          <>
            <Row>
              <TextInput
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="YouTube URL 또는 11자 ID"
                onKeyDown={(e) => { if (e.key === 'Enter' && !isComposingEvent(e)) void handleLoadUrl(); }}
              />
              <PrimaryBtn onClick={() => void handleLoadUrl()}>불러오기</PrimaryBtn>
            </Row>
            {videoTitle && <VideoTitle>🎬 {videoTitle}</VideoTitle>}
            {videoId && <YoutubeTrimmer key={videoId} videoId={videoId} onTrimChange={setTrim} />}
          </>
        ) : (
          <>
            {!audioFile ? (
              <Dropzone
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files?.[0] ?? null); }}
              >
                <input
                  type="file"
                  accept={AUDIO_ACCEPT}
                  id="amt-file"
                  style={{ display: 'none' }}
                  onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                />
                <label htmlFor="amt-file">
                  <DzIcon>⬆</DzIcon>
                  <DzText>wav / mp3 파일을 끌어다 놓거나 클릭해서 선택</DzText>
                </label>
              </Dropzone>
            ) : (
              <>
                <AudioTrimmer key={`${audioFile.name}:${audioFile.size}`} file={audioFile} onTrimChange={setTrim} />
                <TextBtn onClick={() => setAudioFile(null)}>파일 변경</TextBtn>
              </>
            )}
          </>
        )}
      </Card>

      {/* STEP 2 — 메타데이터 */}
      <Card>
        <StepHead><StepNo>2</StepNo><StepTitle>메타데이터</StepTitle></StepHead>

        <FieldLabel>곡 (코드 진행 확정)</FieldLabel>
        <SongPicker selected={song} onPick={(e) => void pickSong(e)} onClear={clearSong} />

        <FieldLabel style={{ marginTop: 16 }}>BPM</FieldLabel>
        <Row>
          <NumInput
            type="number"
            min={30}
            max={320}
            value={bpm}
            onChange={(e) => setBpm(Number(e.target.value) || 0)}
          />
          <TextBtn onClick={handleTap}>탭 템포</TextBtn>
          <Hint>기본값은 곡 스타일에서 추론됩니다. 실제 영상 템포에 맞게 조정하세요.</Hint>
        </Row>

        {sheet ? (
          <>
            <FieldLabel style={{ marginTop: 16 }}>코드 진행 · {song?.title}</FieldLabel>
            <Transport>
              <BpmControl tempo={bpm} onTempoChange={setBpm} disabled={!sheet} />
              <TransportButtons playing={isPlaying} onPlayPause={handlePlayPause} onStop={handleStop} disabled={!sheet} />
              <MixerButton />
            </Transport>
            <SheetBox>
              <LeadSheet data={sheet} activeBar={activeBar} bpm={bpm} />
            </SheetBox>
          </>
        ) : (
          <ChordEmpty>곡을 검색·선택하면 iReal Pro 코드 진행이 여기 표시되고 반주로 재생할 수 있습니다.</ChordEmpty>
        )}
      </Card>

      {/* STEP 3 — 전송 & 결과 */}
      <Card>
        <StepHead><StepNo>3</StepNo><StepTitle>AMT 모델 전송 · 결과</StepTitle></StepHead>

        <Checklist>
          <Check $ok={sourceReady}>소스 {sourceReady ? '✓' : '—'}</Check>
          <Check $ok={trimReady}>구간 {trimReady ? `✓ ${formatTime(trim.startSec!)}–${formatTime(trim.endSec!)}` : '—'}</Check>
          <Check $ok={!!song}>곡/코드 {song ? '✓' : '—'}</Check>
          <Check $ok={bpm >= 30}>BPM {bpm >= 30 ? `✓ ${bpm}` : '—'}</Check>
        </Checklist>

        {sourceMode === 'file' && (
          <AdvBox>
            <AdvToggle>
              <input type="checkbox" checked={bassFocus} onChange={(e) => setBassFocus(e.target.checked)} />
              베이스 대역 강조 (풀믹스 정확도 ↑)
            </AdvToggle>
            <AdvToggle>
              <input type="checkbox" checked={showChords} onChange={(e) => setShowChords(e.target.checked)} />
              결과 악보에 코드 표기
            </AdvToggle>
            <AdvSlider>
              <span>감도 <Mono2>{onsetThreshold.toFixed(2)}</Mono2></span>
              <input type="range" min={0.1} max={0.9} step={0.05} value={onsetThreshold}
                onChange={(e) => setOnsetThreshold(Number(e.target.value))} />
              <SmallHint>낮을수록 음을 더 많이 잡음</SmallHint>
            </AdvSlider>
            <AdvSlider>
              <span>최소 음길이 <Mono2>{minNoteLen}</Mono2></span>
              <input type="range" min={3} max={30} step={1} value={minNoteLen}
                onChange={(e) => setMinNoteLen(Number(e.target.value))} />
              <SmallHint>높을수록 짧은 잡음 제거</SmallHint>
            </AdvSlider>
          </AdvBox>
        )}

        <Row style={{ marginTop: 12 }}>
          <PrimaryBtn onClick={() => void handleSend()} disabled={!canSend || transcribing || sendState === 'pending'}>
            {sourceMode === 'file'
              ? (transcribing ? `채보 중… ${Math.round(progress)}%` : '베이스 채보 실행 (Basic Pitch)')
              : (sendState === 'pending' ? '전송 중…' : 'AMT 모델로 보내기')}
          </PrimaryBtn>
          {!canSend && <Hint>소스 · 구간 · 곡 · BPM 을 모두 채우면 실행할 수 있습니다.</Hint>}
          {canSend && sourceMode === 'youtube' && <Hint>YouTube는 브라우저에서 오디오를 못 받아 서버 필요 — 지금은 전송 payload만 표시됩니다.</Hint>}
        </Row>

        <ResultFrame>
          <ResultHead>채보 결과 (VexFlow · Basic Pitch)</ResultHead>
          {transcribing ? (
            <ResultBody>
              <ProgressBar><ProgressFill style={{ width: `${Math.round(progress)}%` }} /></ProgressBar>
              <StubNote>Basic Pitch 모델로 베이스를 채보하는 중입니다… {Math.round(progress)}%</StubNote>
            </ResultBody>
          ) : result ? (
            <ResultBody>
              {amtError && <StubNote>⚠ {amtError}</StubNote>}
              <ResultActions>
                <ResultCount>♪ {rawNotes?.length ?? 0}개 음 채보됨 · {result.measures.length}마디</ResultCount>
                <TextBtn onClick={handleDownloadMidi} disabled={!rawNotes?.length}>MIDI 다운로드</TextBtn>
              </ResultActions>
              <ResultSheetBox><NoteSheet data={result} /></ResultSheetBox>
            </ResultBody>
          ) : sendState === 'sent' ? (
            <ResultBody>
              <StubNote>
                ⓘ YouTube 경로는 브라우저에서 오디오를 받을 수 없어 서버(yt-dlp)가 필요합니다.
                아래는 서버 연결 시 보낼 payload입니다. 지금 바로 채보하려면 <b>오디오 파일</b> 탭을 쓰세요.
              </StubNote>
              <PayloadPre>{payloadPreview}</PayloadPre>
            </ResultBody>
          ) : (
            <ResultPlaceholder>실행하면 AMT 채보 결과(악보)가 여기에 표시되고, 바로 재생할 수 있습니다.</ResultPlaceholder>
          )}
        </ResultFrame>
      </Card>
    </Page>
  );
}

/* ─── styled ─────────────────────────────────────────────────────────── */

const Page = styled.div`
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 24px 96px;
  display: flex;
  flex-direction: column;
  gap: 18px;
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Header = styled.div``;
const H1 = styled.h1`
  margin: 0 0 4px;
  font-size: 1.5rem;
  font-weight: 700;
`;
const Sub = styled.p`
  margin: 0;
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Card = styled.section`
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 14px;
  padding: 20px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const StepHead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;
const StepNo = styled.span`
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.gold};
  color: #fff;
  font-size: 0.85rem;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
`;
const StepTitle = styled.h2`
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
`;

const Tabs = styled.div`
  display: flex;
  gap: 6px;
`;
const Tab = styled.button<{ $on?: boolean }>`
  padding: 8px 16px;
  border-radius: 8px;
  border: 1.5px solid ${({ $on, theme }) => ($on ? theme.colors.gold : theme.colors.border)};
  background: ${({ $on, theme }) => ($on ? theme.colors.gold + '18' : theme.colors.bgPrimary)};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.88rem;
  font-weight: ${({ $on }) => ($on ? 600 : 400)};
  cursor: pointer;
`;

const Row = styled.div`
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
`;

const TextInput = styled.input`
  flex: 1;
  min-width: 220px;
  padding: 10px 14px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.92rem;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.gold}; }
`;

const NumInput = styled(TextInput)`
  flex: 0 0 auto;
  width: 110px;
  min-width: 0;
`;

const PrimaryBtn = styled.button`
  padding: 10px 18px;
  border: 1.5px solid ${({ theme }) => theme.colors.gold};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.gold};
  color: #fff;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  &:hover:not(:disabled) { background: ${({ theme }) => theme.colors.goldDark}; border-color: ${({ theme }) => theme.colors.goldDark}; }
  &:disabled { opacity: 0.45; cursor: default; }
`;

const TextBtn = styled.button`
  padding: 9px 14px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.86rem;
  cursor: pointer;
  white-space: nowrap;
  align-self: flex-start;
  &:hover:not(:disabled) { border-color: ${({ theme }) => theme.colors.gold}; }
  &:disabled { opacity: 0.45; cursor: default; }
`;

const VideoTitle = styled.div`
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Dropzone = styled.div`
  border: 2px dashed ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  padding: 32px;
  text-align: center;
  label { cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 10px; }
  &:hover { border-color: ${({ theme }) => theme.colors.gold}; }
`;
const DzIcon = styled.div`
  font-size: 1.8rem;
  color: ${({ theme }) => theme.colors.gold};
`;
const DzText = styled.div`
  font-size: 0.9rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const FieldLabel = styled.div`
  font-size: 0.82rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: 6px;
`;

const Hint = styled.span`
  font-size: 0.8rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Transport = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 10px;
`;

const SheetBox = styled.div`
  display: flex;
  height: 380px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  overflow: hidden;
`;

const ChordEmpty = styled.div`
  padding: 24px;
  text-align: center;
  font-size: 0.88rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-radius: 10px;
`;

const Checklist = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
`;
const Check = styled.span<{ $ok?: boolean }>`
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  border: 1px solid ${({ $ok, theme }) => ($ok ? theme.colors.gold : theme.colors.border)};
  background: ${({ $ok, theme }) => ($ok ? theme.colors.gold + '18' : theme.colors.bgSecondary)};
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const ResultFrame = styled.div`
  margin-top: 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  overflow: hidden;
`;
const ResultHead = styled.div`
  padding: 10px 14px;
  font-size: 0.85rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;
const ResultBody = styled.div`
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
`;
const ResultPlaceholder = styled.div`
  padding: 40px 16px;
  text-align: center;
  font-size: 0.88rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
const StubNote = styled.div`
  font-size: 0.85rem;
  line-height: 1.5;
  color: ${({ theme }) => theme.colors.textPrimary};
  background: ${({ theme }) => theme.colors.bgSecondary};
  border-radius: 8px;
  padding: 12px 14px;
  b { color: ${({ theme }) => theme.colors.gold}; }
`;

const ResultSheetBox = styled.div`
  display: flex;
  flex-direction: column;
  min-height: 420px;
  max-height: 620px;
  overflow: auto;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 10px;
`;

const ProgressBar = styled.div`
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  overflow: hidden;
`;
const ProgressFill = styled.div`
  height: 100%;
  background: ${({ theme }) => theme.colors.gold};
  transition: width 120ms linear;
`;

const AdvBox = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px 20px;
  padding: 12px 14px;
  margin-top: 4px;
  border: 1px dashed ${({ theme }) => theme.colors.border};
  border-radius: 10px;
`;
const AdvToggle = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
`;
const AdvSlider = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.82rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  input[type='range'] { width: 100%; accent-color: ${({ theme }) => theme.colors.gold}; }
`;
const SmallHint = styled.span`
  font-size: 0.72rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
const Mono2 = styled.span`
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  color: ${({ theme }) => theme.colors.gold};
`;

const ResultActions = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
`;
const ResultCount = styled.div`
  font-size: 0.85rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
const PayloadPre = styled.pre`
  margin: 0;
  padding: 14px;
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.76rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  overflow-x: auto;
  white-space: pre;
`;
