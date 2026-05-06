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
import { saveUserLick } from '../../data/lickData';
import type { LickMatch } from '../../lib/lickMatcher';
import { NotePlayer } from '../../lib/note/notePlayer';
import type { NoteInfo, MeasureInfo } from '../../data/sampleMelody';

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
  background: ${({ theme }) => theme.colors.bgPrimary};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  padding: 12px 10px 8px;
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
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

    // 투플렛
    let ti = 0;
    while (ti < measure.notes.length) {
      if (measure.notes[ti].tuplet === 3) {
        const g: StaveNote[] = [];
        while (ti < measure.notes.length && measure.notes[ti].tuplet === 3 && g.length < 3) { g.push(vfNotes[ti]); ti++; }
        if (g.length >= 2) {
          const tup = new Tuplet(g, { numNotes: g.length, notesOccupied: 2 });
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
}

export function LickRecommendMessage({ match }: Props) {
  const { lick, originalKey } = match;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<NotePlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [saved, setSaved] = useState(false);

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

  const togglePlay = useCallback(async () => {
    if (!playerRef.current) {
      const p = new NotePlayer();
      p.drumEnabled = false;
      p.onDone = () => setPlaying(false);
      playerRef.current = p;
    }
    const p = playerRef.current;
    if (p.playing) { p.stop(); setPlaying(false); }
    else { setPlaying(true); await p.play(lick.sheetData, lick.tempo ?? 200); }
  }, [lick]);

  useEffect(() => () => { playerRef.current?.dispose(); }, []);

  const handleSave = useCallback(() => {
    saveUserLick(lick);
    setSaved(true);
    window.dispatchEvent(new CustomEvent('jazzify:lickSaved'));
  }, [lick]);

  return (
    <Wrapper ref={wrapperRef}>
      <Header>
        {lick.performer && lick.performer !== 'AI 생성' && (
          <>
            <PerformerName>{lick.performer}</PerformerName>
            {lick.title && <SongName>{lick.title}</SongName>}
          </>
        )}
        <CircleBtn
          $color={playing ? '#1b5e20' : '#2e7d32'}
          onClick={togglePlay}
          title={playing ? '정지' : '재생'}
        >
          {playing ? '■' : '▶'}
        </CircleBtn>
        <CircleBtn
          $color={saved ? '#388e3c' : '#1a1a1a'}
          onClick={saved ? undefined : handleSave}
          title={saved ? '저장됨' : '내 릭에 저장'}
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
        {originalKey && (
          <span style={{ fontSize: 10, color: '#f57c00', flexShrink: 0, marginLeft: 2 }}>
            {originalKey}→이조
          </span>
        )}
      </Header>
      <ScoreBox>
        <div ref={svgRef} />
      </ScoreBox>
    </Wrapper>
  );
}

/* ── list wrapper ─────────────────────────────────────────────────────────── */

interface ListProps {
  matches: LickMatch[];
  savedMatches?: LickMatch[];
  progressionLabel: string;
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

export function LickRecommendList({ matches, savedMatches = [] }: ListProps) {
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
            <LickRecommendMessage match={m} />
          </div>
        ))
      )}
    </div>
  );
}
