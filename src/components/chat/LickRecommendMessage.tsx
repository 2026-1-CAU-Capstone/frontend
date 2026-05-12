/**
 * 채팅 메시지 안에 인라인으로 렌더링되는 릭 추천 카드
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
import {
  Renderer, Stave, StaveNote, Voice, Formatter, Beam,
  Accidental, Dot, Tuplet,
} from 'vexflow';
import type { LickEntry } from '../../data/lickData';
import { saveUserLick, deleteUserLick, loadUserLicksSync } from '../../data/lickData';
import type { LickMatch } from '../../lib/lickMatcher';
import { NotePlayer } from '../../lib/note/notePlayer';
import { useCountInIntro } from '../../hooks/useCountInIntro';
import { PATTERN_SIMPLE } from '../../lib/note/countInPatterns';
import type { NoteInfo, MeasureInfo } from '../../data/sampleMelody';
import { YoutubeEmbed } from '../common/YoutubeEmbed';
import { getLickVideo } from '../../data/lickVideos';

/* ── AI 생성 릭: glick JSON → LickEntry 변환 ────────────────────────────── */

let _genId = -1;

/**
 * LLM이 생성한 glick JSON을 LickEntry로 변환.
 * sheetData 구조는 user_licks.json과 동일하게 LLM에 생성을 요청.
 */
export function jsonToLickEntry(json: Record<string, unknown>): LickEntry {
  const measures = (json.measures as MeasureInfo[] | undefined) ?? [];
  return {
    id: _genId--,           // 음수 ID = AI 생성 표시
    performer: 'AI 생성',
    title: String(json.label ?? json.key ?? 'Generated Lick'),
    album: '',
    instrument: 'sax',
    style: 'bebop',
    tempo: Number(json.tempo) || 160,
    key: String(json.key ?? 'C-maj'),
    rhythmfeel: 'SWING',
    tag: 'ai-generated',
    chords: measures.map((m) => (m as unknown as { chord?: string }).chord ?? ''),
    nEvents: measures.reduce((s, m) => s + (m.notes?.length ?? 0), 0),
    label: String(json.label ?? ''),
    sheetData: {
      title: String(json.title ?? json.label ?? 'Lick'),
      composer: String(json.composer ?? ''),
      key: String(json.key ?? 'C'),
      timeSignature: String(json.timeSignature ?? '4/4'),
      measures,
    },
    intervals: [],
    parsons: [],
    fuzzyIntervals: [],
    durationClasses: [],
  };
}

/* ── styled ───────────────────────────────────────────────────────────────── */

const Wrapper = styled.div`
  margin: 12px 0 14px;
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 4px 0 0;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 0 6px;
`;

const PerformerName = styled.span`
  font-weight: 700;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const SongName = styled.span`
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex-shrink: 1;
  min-width: 0;
`;

const TransposeBadge = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: #f57c00;
  background: rgba(245, 124, 0, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
  white-space: nowrap;
`;

// DEV-ONLY: lick id 디버그 뱃지 — 추후 제거 요청 시 삭제
const DevIdBadge = styled.span`
  font-size: 10px;
  font-weight: 500;
  color: #888;
  background: rgba(0, 0, 0, 0.06);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
  white-space: nowrap;
  font-family: ui-monospace, monospace;
`;

const CircleBtn = styled.button<{ $color: string }>`
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: none;
  background: ${({ $color }) => $color};
  color: #fff;
  font-size: 9px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.15s;
  padding: 0;
  line-height: 1;
  &:hover { opacity: 0.8; }
  &:disabled { opacity: 0.4; cursor: default; }
`;


const ScoreBox = styled.div`
  overflow-x: hidden;
  width: 100%;
  
  svg {
    max-width: 100%;
    height: auto;
  }
`;

/* ── chord label normalization ───────────────────────────────────────────── */

function normalizeChordLabel(raw: string): string {
  if (!raw) return raw;
  let s = raw.trim();
  // Root accidental: b → ♭, # → ♯ (only after a root letter A-G)
  s = s.replace(/^([A-G])b/, '$1♭').replace(/^([A-G])#/, '$1♯');
  // Quality: half-dim h → ø
  s = s.replace(/h7/, 'ø7').replace(/h(?!\d)/, 'ø');
  // maj / j
  s = s.replace(/j7/, '△7').replace(/maj7/i, '△7').replace(/maj(?!7)/i, '△');
  // dim
  s = s.replace(/dim7/, '°7').replace(/dim(?!7)/, '°');
  // -7b5 / m7b5 forms
  s = s.replace(/-7b5|-7\(b5\)|m7b5|min7b5/, 'ø7');
  // minor - (keep the dash, already looks right)
  // Tension accidentals: b9 → ♭9 etc.
  s = s.replace(/b(\d)/g, '♭$1').replace(/#(\d)/g, '♯$1');
  return s;
}

/** Append a chord label in SVG at the given position (root larger, quality smaller) */
function addChordLabel(svg: SVGElement, x: number, y: number, raw: string) {
  const label = normalizeChordLabel(raw);
  const rootMatch = label.match(/^([A-G][♭♯]?)(.*)/);
  if (!rootMatch) return;
  const [, root, quality] = rootMatch;

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', String(Math.round(x)));
  text.setAttribute('y', String(y));
  text.setAttribute('fill', '#333');
  text.setAttribute('font-family', "'MuseJazz Text','Oswald','DM Sans',sans-serif");

  // Root span
  const rootSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
  rootSpan.setAttribute('font-size', '23');
  rootSpan.setAttribute('font-weight', '400');
  rootSpan.textContent = root;
  text.appendChild(rootSpan);

  // Quality span
  if (quality) {
    const qualSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    qualSpan.setAttribute('font-size', '17');
    qualSpan.setAttribute('font-weight', '400');
    qualSpan.setAttribute('baseline-shift', '0');
    qualSpan.textContent = quality;
    text.appendChild(qualSpan);
  }

  svg.appendChild(text);
}

/* ── vexflow constants ────────────────────────────────────────────────────── */

const PX_PER_DUR: Record<string, number> = { w: 50, h: 38, q: 30, '8': 24, '16': 20 };
const DUR_BEATS: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };
const FLAT_KEYS: Record<string, number> = { F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7, Dm: 1, Gm: 2, Cm: 3, Fm: 4, Bbm: 5, Ebm: 6 };
const SHARP_KEYS: Record<string, number> = { G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7 };
const KEY_SIG_FLATS = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
const KEY_SIG_SHARPS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];

const LINE_H = 150;
const MARGIN = { top: 32, left: 6, right: 6, bottom: 20 };

function toVexKey(key: string): string {
  const p = key.split('-');
  const root = p[0] || 'C';
  const mode = p[1] || '';
  return (mode === 'min' || mode === 'minor') ? root + 'm' : root;
}

function keySigAcc(vexKey: string): Map<string, 'b' | '#'> {
  const m = new Map<string, 'b' | '#'>();
  const nF = FLAT_KEYS[vexKey]; if (nF) for (let i = 0; i < nF; i++) m.set(KEY_SIG_FLATS[i], 'b');
  const nS = SHARP_KEYS[vexKey]; if (nS) for (let i = 0; i < nS; i++) m.set(KEY_SIG_SHARPS[i], '#');
  return m;
}

function measMinW(m: MeasureInfo): number {
  let w = 20;
  for (const n of m.notes) {
    const b = n.duration.replace(/[dr]/g, '');
    w += PX_PER_DUR[b] ?? 26;
    if (n.accidentals) w += Object.keys(n.accidentals).length * 12;
  }
  return Math.max(w, 60);
}

function buildDur(dur: string, dotted?: boolean) {
  return dotted ? (dur.endsWith('r') ? dur.slice(0, -1) + 'd' + 'r' : dur + 'd') : dur;
}

function buildVfNotes(measure: MeasureInfo, kAcc: Map<string, 'b' | '#'>): StaveNote[] {
  const active = new Map<string, 'b' | '#' | 'n'>();
  return measure.notes.map((n) => {
    const isRest = n.duration.endsWith('r');
    const note = new StaveNote({ keys: isRest ? ['b/4'] : n.keys, duration: buildDur(n.duration, n.dotted), autoStem: true });
    if (n.dotted) Dot.buildAndAttach([note]);
    if (!isRest) {
      const letter = n.keys[0].split('/')[0];
      const realAcc = n.accidentals?.[0] as 'b' | '#' | undefined;
      const cur = active.get(letter);
      const ksa = kAcc.get(letter);
      if (realAcc) { if ((cur ?? ksa) !== realAcc) note.addModifier(new Accidental(realAcc), 0); active.set(letter, realAcc); }
      else { const eff = cur ?? ksa; if (eff && eff !== 'n') { note.addModifier(new Accidental('n'), 0); active.set(letter, 'n'); } }
    }
    return note;
  });
}

function buildBeams(vfNotes: StaveNote[], notes: NoteInfo[]): Beam[] {
  const beams: Beam[] = [];
  let grp: StaveNote[] = [];
  let beatPos = 0;
  for (let i = 0; i < vfNotes.length; i++) {
    const vn = vfNotes[i]; const dur = vn.getDuration();
    const isBeamable = dur === '8' || dur === '16' || dur === '8d' || dur === '16d';
    const isRest = vn.isRest();
    let nb = DUR_BEATS[dur.replace('d', '')] ?? 1;
    if (notes[i]?.tuplet) nb *= 2 / 3;
    if (isBeamable && !isRest) {
      if (!notes[i]?.tuplet) {
        const nb2 = beatPos + nb;
        if (grp.length > 0 && Math.floor((beatPos - 0.001) / 2) !== Math.floor((nb2 - 0.001) / 2)) {
          if (grp.length >= 2) beams.push(new Beam(grp, true)); grp = [];
        }
      }
      grp.push(vn);
      if (notes[i]?.tuplet && grp.length === 3) { beams.push(new Beam(grp, true)); grp = []; }
    } else { if (grp.length >= 2) beams.push(new Beam(grp, true)); grp = []; }
    beatPos += nb;
  }
  if (grp.length >= 2) beams.push(new Beam(grp, true));
  return beams;
}

/* ── score renderer ───────────────────────────────────────────────────────── */

function renderScore(el: HTMLDivElement, lick: LickEntry, availW: number) {
  el.innerHTML = '';
  const data = lick.sheetData;
  if (!data.measures.length) return;
  const [numBeats, beatValue] = data.timeSignature.split('/').map(Number);
  const vexKey = toVexKey(lick.key);
  const kAcc = keySigAcc(vexKey);

  const CLEF_W = 30;
  const TIME_W = 26;
  const nFlats = FLAT_KEYS[vexKey] ?? 0;
  const nSharps = SHARP_KEYS[vexKey] ?? 0;
  const DECOR = CLEF_W + (nFlats + nSharps) * 10 + TIME_W + 4;

  const baseW = data.measures.map(measMinW);
  const availForMeasures = availW - MARGIN.left - DECOR - MARGIN.right;
  const stretchFactor = Math.min(2.5, Math.max(1.0, availForMeasures / Math.max(baseW.reduce((s, w) => s + w, 0), 1)));
  const measW = baseW.map(w => w * stretchFactor);

  const svgW = MARGIN.left + DECOR + measW.reduce((s, w) => s + w, 0) + MARGIN.right;
  const svgH = MARGIN.top + LINE_H + MARGIN.bottom;

  const renderer = new Renderer(el, Renderer.Backends.SVG);
  renderer.resize(svgW, svgH);
  const ctx = renderer.getContext();

  let x = MARGIN.left;

  for (let m = 0; m < data.measures.length; m++) {
    const measure = data.measures[m];
    const w = m === 0 ? measW[m] + DECOR : measW[m];
    const stave = new Stave(x, MARGIN.top, w);
    if (m === 0) {
      stave.addClef('treble');
      if (vexKey && vexKey !== 'C') stave.addKeySignature(vexKey);
      stave.addTimeSignature(data.timeSignature);
    }
    if (m === data.measures.length - 1) stave.setEndBarType(2);
    stave.setContext(ctx).draw();

    const vfNotes = buildVfNotes(measure, kAcc);
    const beams = buildBeams(vfNotes, measure.notes);
    const voice = new Voice({ numBeats, beatValue });
    voice.setStrict(false);
    voice.addTickables(vfNotes);
    new Formatter().joinVoices([voice]).formatToStave([voice], stave);
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());

    // 투플렛 — 3, 5, 6, 7 ... 모든 N-tuplet 처리
    let ti = 0;
    while (ti < measure.notes.length) {
      const n = measure.notes[ti].tuplet;
      if (n && n >= 3) {
        const g: StaveNote[] = [];
        while (ti < measure.notes.length && measure.notes[ti].tuplet === n && g.length < n) { g.push(vfNotes[ti]); ti++; }
        if (g.length >= 2) {
          const notesOccupied = Math.pow(2, Math.floor(Math.log2(n - 1)));
          const tup = new Tuplet(g, { numNotes: g.length, notesOccupied });
          if (g[0].getStemDirection() === -1) tup.setTupletLocation(-1);
          tup.setContext(ctx).draw();
        }
      } else ti++;
    }

    // 코드 라벨: 첫 비-쉼표 음표 머리 위
    if (measure.chord) {
      const svg = el.querySelector('svg') as SVGElement | null;
      if (svg) {
        // 첫 실음의 x 좌표 가져오기 (VexFlow formatToStave 완료 후 유효)
        const firstReal = vfNotes.find((_, i) => !measure.notes[i]?.duration.endsWith('r'));
        let chordX: number;
        try {
          chordX = firstReal ? firstReal.getAbsoluteX() : (m === 0 ? x + DECOR + 2 : x + 2);
        } catch {
          chordX = m === 0 ? x + DECOR + 2 : x + 2;
        }
        const chordY = MARGIN.top - 6; // 오선 위
        addChordLabel(svg, chordX, chordY, measure.chord);
      }
    }

    x += w;
  }

  // SVG viewBox로 비율 유지 축소
  const svgEl = el.querySelector('svg') as SVGElement | null;
  if (svgEl) {
    svgEl.setAttribute('viewBox', `0 0 ${svgW} ${svgH}`);
    const displayW = Math.min(svgW, availW);
    const displayH = Math.round(svgH * (displayW / svgW));
    svgEl.setAttribute('width', String(Math.round(displayW)));
    svgEl.setAttribute('height', String(displayH));
    svgEl.style.transform = '';
    el.style.width = '';
    el.style.height = '';
  }
}

/* ── component ────────────────────────────────────────────────────────────── */

interface Props {
  match: LickMatch;
  tempoOverride?: number;
}

export function LickRecommendMessage({ match, tempoOverride }: Props) {
  const { lick, originalKey } = match;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<NotePlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  // 마운트 시 localStorage 확인 — 이미 저장된 릭이면 saved 상태로 시작
  const [saved, setSaved] = useState(() =>
    loadUserLicksSync().some((l) => l.id === lick.id)
  );
  const video = lick.video ?? getLickVideo(lick.id);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const el = svgRef.current;
    if (!el || !wrapper) return;

    const doRender = () => {
      const availW = wrapper.clientWidth;
      if (availW < 60) return;
      renderScore(el, lick, Math.max(availW - 2, 100));
    };

    doRender();
    const ro = new ResizeObserver(doRender);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [lick]);

  const countIn = useCountInIntro();

  const togglePlay = useCallback(async () => {
    if (!playerRef.current) {
      const p = new NotePlayer({ lickMode: true });
      p.onDone = () => setPlaying(false);
      playerRef.current = p;
    }
    const p = playerRef.current;
    if (p.playing || countIn.active) {
      p.stop();
      countIn.cancel();
      setPlaying(false);
      return;
    }
    const bpm = tempoOverride ?? lick.tempo ?? 200;
    setPlaying(true);
    const preload = p.preload();
    // 릭 재생: BPM 무관하게 SIMPLE 카운트인.
    const cin = await countIn.run({ bpm, pattern: PATTERN_SIMPLE });
    if (!cin.ok) { setPlaying(false); return; }
    await preload;
    await p.play(lick.sheetData, bpm, { startAt: p.ctxNow() + cin.downbeatInSec });
  }, [lick, tempoOverride, countIn]);

  useEffect(() => () => { playerRef.current?.dispose(); }, []);

  const handleToggleSave = useCallback(() => {
    if (saved) {
      deleteUserLick(lick.id);
      setSaved(false);
    } else {
      saveUserLick(lick);
      setSaved(true);
    }
    window.dispatchEvent(new CustomEvent('jazzify:lickSaved'));
  }, [lick, saved]);

  return (
    <Wrapper ref={wrapperRef}>
      {countIn.overlay}
      <Header>
        {lick.performer && lick.performer !== 'AI 생성' && (
          <>
            <PerformerName>{lick.performer}</PerformerName>
            {lick.title && <SongName>{lick.title}</SongName>}
          </>
        )}
        <TransposeBadge>
          {originalKey
            ? `${originalKey} → ${lick.key.split('-')[0]}`
            : lick.key.split('-')[0]}
        </TransposeBadge>
        {/* DEV-ONLY: lick id — 추후 제거 요청 시 삭제 */}
        <DevIdBadge title="Lick ID (dev)">#{lick.id}</DevIdBadge>
        <CircleBtn
          $color={playing ? '#1b5e20' : '#2e7d32'}
          onClick={togglePlay}
          title={playing ? '정지' : '재생'}
        >
          {playing ? '■' : '▶'}
        </CircleBtn>
        <CircleBtn
          $color={saved ? '#388e3c' : '#1a1a1a'}
          onClick={handleToggleSave}
          title={saved ? '저장 취소' : '내 릭에 저장'}
        >
          {saved ? (
            /* 저장됨: 채워진 북마크 */
            <svg width="11" height="13" viewBox="0 0 24 28" fill="white">
              <path d="M4 2h16a2 2 0 0 1 2 2v22l-10-6L2 26V4a2 2 0 0 1 2-2z"/>
            </svg>
          ) : (
            /* 저장 전: 빈 북마크 */
            <svg width="11" height="13" viewBox="0 0 24 28" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 2h16a2 2 0 0 1 2 2v22l-10-6L2 26V4a2 2 0 0 1 2-2z"/>
            </svg>
          )}
        </CircleBtn>
        {video && (
          <CircleBtn
            $color={showVideo ? '#9b1c1c' : '#c4302b'}
            onClick={() => setShowVideo((v) => !v)}
            title={showVideo ? '원본 영상 닫기' : '원본 영상 보기'}
          >
            <svg width="13" height="9" viewBox="0 0 24 17" fill="white" aria-hidden>
              <path d="M23.5 2.6a3 3 0 0 0-2.1-2.1C19.5 0 12 0 12 0S4.5 0 2.6.5A3 3 0 0 0 .5 2.6 31 31 0 0 0 0 8.5c0 2 .2 4 .5 5.9a3 3 0 0 0 2.1 2.1C4.5 17 12 17 12 17s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.3-1.9.5-3.9.5-5.9 0-2-.2-4-.5-5.9z"/>
              <path d="M9.6 12.1V4.9L15.8 8.5z" fill="#c4302b"/>
            </svg>
          </CircleBtn>
        )}
      </Header>
      <ScoreBox>
        <div ref={svgRef} />
      </ScoreBox>
      {video && showVideo && (
        <YoutubeEmbed videoId={video.videoId} startSec={video.startSec} endSec={video.endSec} autoplay />
      )}
    </Wrapper>
  );
}

/* ── list wrapper ─────────────────────────────────────────────────────────── */

interface ListProps {
  matches: LickMatch[];
  savedMatches?: LickMatch[];
  progressionLabel: string;
  songTempo?: number;
}

const TabRow = styled.div`
  display: flex;
  gap: 0;
  margin-bottom: 10px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
`;

const Tab = styled.button<{ $active: boolean }>`
  padding: 5px 12px;
  font-size: 12px;
  font-weight: ${({ $active }) => $active ? 700 : 400};
  font-family: ${({ theme }) => theme.fonts.ui};
  color: ${({ $active, theme }) => $active ? theme.colors.textPrimary : theme.colors.textSecondary};
  background: transparent;
  border: none;
  border-bottom: 2px solid ${({ $active, theme }) => $active ? theme.colors.tonic : 'transparent'};
  cursor: pointer;
  transition: all 0.15s;
  margin-bottom: -1px;
  &:hover { color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const ListDivider = styled.div`
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  margin: 0 0 14px;
`;

const EmptyState = styled.div`
  padding: 20px 0;
  text-align: center;
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

export function LickRecommendList({ matches, savedMatches = [], songTempo }: ListProps) {
  const [tab, setTab] = useState<'recommend' | 'saved'>('recommend');
  const active = tab === 'recommend' ? matches : savedMatches;

  return (
    <div>
      <TabRow>
        <Tab $active={tab === 'recommend'} onClick={() => setTab('recommend')}>
          추천 릭 {matches.length}
        </Tab>
        <Tab $active={tab === 'saved'} onClick={() => setTab('saved')} title="내 저장 릭">
          <svg width="18" height="18" viewBox="0 0 24 24" fill={tab === 'saved' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ verticalAlign: 'middle', marginRight: '4px' }}>
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
          </svg>
          <span style={{ verticalAlign: 'middle' }}>{savedMatches.length}</span>
        </Tab>
      </TabRow>
      {active.length === 0 ? (
        <EmptyState>
          {tab === 'saved'
            ? '저장된 릭이 없습니다.\n릭 카드의 북마크 버튼으로 저장해보세요.'
            : '매칭되는 릭이 없습니다.'}
        </EmptyState>
      ) : (
        active.map((m, i) => (
          <div key={m.lick.id}>
            {i > 0 && <ListDivider />}
            <LickRecommendMessage match={m} tempoOverride={songTempo} />
          </div>
        ))
      )}
    </div>
  );
}
