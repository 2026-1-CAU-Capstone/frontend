import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { formatTime } from './amtYoutube';
import { TrimTimeline } from './TrimTimeline';
import type { TrimState } from './YoutubeTrimmer';

/* ─────────────────────────────────────────────────────────────────────────
 * AudioTrimmer — plays an uploaded audio file (wav/mp3) and lets the user set
 * precise in/out points for the AMT clip. Unlike YouTube, an uploaded file
 * COULD be cut in-browser, but for parity we only capture [startSec, endSec]
 * and leave the actual cut to the model-send step. Reports the selection to
 * the parent via onTrimChange.
 * ──────────────────────────────────────────────────────────────────────── */

interface Props {
  file: File;
  onTrimChange: (t: TrimState) => void;
}

export function AudioTrimmer({ file, onTrimChange }: Props) {
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [startSec, setStartSec] = useState<number | null>(null);
  const [endSec, setEndSec] = useState<number | null>(null);
  const [loop, setLoop] = useState(false);
  const [playing, setPlaying] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);

  /* Object URL for the file; revoke on change/unmount. The parent keys this
   * component by file, so all local state resets on a new file via remount —
   * no reset effect needed here. */
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    onTrimChange({ startSec, endSec, duration });
  }, [startSec, endSec, duration, onTrimChange]);

  const seek = (sec: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.max(0, Math.min(sec, duration || sec));
    setCurrentTime(a.currentTime);
  };
  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) void a.play(); else a.pause();
  };
  const playRegion = () => {
    const a = audioRef.current;
    if (!a || startSec == null) return;
    a.currentTime = startSec;
    void a.play();
    setLoop(true);
  };

  const trimmed = startSec != null && endSec != null && endSec > startSec;

  return (
    <Wrap>
      <audio
        ref={audioRef}
        src={url}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setCurrentTime(t);
          // Event handler closes over the latest render's state — read directly.
          if (loop && startSec != null && endSec != null && t >= endSec) {
            e.currentTarget.currentTime = startSec;
          }
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
      />

      <FileRow>
        <FileIcon>♪</FileIcon>
        <div>
          <FileName>{file.name}</FileName>
          <FileMeta>{(file.size / 1024 / 1024).toFixed(1)} MB · {formatTime(duration)}</FileMeta>
        </div>
      </FileRow>

      <TrimTimeline
        duration={duration}
        currentTime={currentTime}
        startSec={startSec}
        endSec={endSec}
        onSeek={seek}
        onChangeStart={setStartSec}
        onChangeEnd={setEndSec}
      />

      <Controls>
        <Btn onClick={togglePlay}>{playing ? '❚❚ 일시정지' : '▶ 재생'}</Btn>
        <Btn onClick={() => seek(Math.max(0, currentTime - 2))}>← 2초</Btn>
        <Btn onClick={() => seek(currentTime + 2)}>2초 →</Btn>
        <Divider />
        <Btn onClick={() => setStartSec(currentTime)}>
          IN 기록 <Mono>{startSec != null ? formatTime(startSec) : '—'}</Mono>
        </Btn>
        <Btn onClick={() => setEndSec(currentTime)}>
          OUT 기록 <Mono>{endSec != null ? formatTime(endSec) : '—'}</Mono>
        </Btn>
        <Divider />
        <Btn onClick={playRegion} disabled={!trimmed}>구간 재생</Btn>
        <Btn $active={loop} onClick={() => setLoop((v) => !v)}>🔁 반복 {loop ? 'ON' : 'OFF'}</Btn>
      </Controls>

      <Summary>
        {trimmed
          ? <>선택 구간 <b>{formatTime(startSec!)} → {formatTime(endSec!)}</b> · 길이 <b>{formatTime(endSec! - startSec!)}</b></>
          : <span style={{ opacity: 0.7 }}>재생하며 IN / OUT 지점을 기록하거나, 타임라인의 핸들을 드래그해 정확히 맞추세요.</span>}
      </Summary>
    </Wrap>
  );
}

const Wrap = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const FileRow = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  background: ${({ theme }) => theme.colors.bgSecondary};
  border: 1px solid ${({ theme }) => theme.colors.border};
`;

const FileIcon = styled.div`
  width: 38px;
  height: 38px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 1.2rem;
  background: ${({ theme }) => theme.colors.gold}22;
  color: ${({ theme }) => theme.colors.gold};
`;

const FileName = styled.div`
  font-size: 0.92rem;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const FileMeta = styled.div`
  font-size: 0.78rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
`;

const Controls = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
`;

const Btn = styled.button<{ $active?: boolean }>`
  padding: 8px 12px;
  border: 1.5px solid ${({ $active, theme }) => ($active ? theme.colors.gold : theme.colors.border)};
  border-radius: 8px;
  background: ${({ $active, theme }) => ($active ? theme.colors.gold + '22' : theme.colors.bgPrimary)};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.86rem;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  &:hover:not(:disabled) { border-color: ${({ theme }) => theme.colors.gold}; }
  &:disabled { opacity: 0.45; cursor: default; }
`;

const Divider = styled.span`
  width: 1px;
  align-self: stretch;
  background: ${({ theme }) => theme.colors.border};
  margin: 0 2px;
`;

const Mono = styled.span`
  font-family: ui-monospace, 'SF Mono', Menlo, monospace;
  font-size: 0.8em;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Summary = styled.div`
  font-size: 0.85rem;
  color: ${({ theme }) => theme.colors.textPrimary};
  b { color: ${({ theme }) => theme.colors.gold}; font-family: ui-monospace, 'SF Mono', Menlo, monospace; }
`;
