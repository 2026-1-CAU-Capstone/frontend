/**
 * 채팅 메시지 안에 인라인으로 렌더링되는 릭 추천 카드
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { ghostHead } from '../../lib/note/ghostNote';
import type { MutableRefObject } from 'react';
import styled from 'styled-components';
import {
  Renderer, Stave, StaveNote, Voice, Formatter, Beam,
  Accidental, Dot, Tuplet,
} from 'vexflow';
import type { LickEntry } from '../../data/lickData';
import { saveUserLick, deleteUserLick, loadUserLicksSync } from '../../data/lickData';
import type { LickMatch } from '../../lib/lickMatcher';
import { useGlobalPlayer } from '../../lib/player/GlobalPlayerContext';
import { warmupPlayerOnce } from '../../lib/player';
import { useCountInIntro } from '../../hooks/useCountInIntro';
import { prepareLickIntro } from '../../lib/note/anacrusis';
import { claimPlaybackUi, releasePlaybackUi } from '../../lib/player/playbackClaim';
import type { NoteInfo, MeasureInfo } from '../../data/sampleMelody';
import { resolveMeasureAccidental, type RenderAcc } from '../../lib/note/measureAccidentals';
import { normalizeChordTypeset as normalizeChordLabel } from '../../lib/jazz-harmony';
import { YoutubeEmbed } from '../common/YoutubeEmbed';
import { getLickVideo } from '../../data/lickVideos';
import { computeBeamBreaks } from '../../lib/note/beamPolicy';
import { chordBaselineY } from '../../lib/note/chordClearance';
import { useNoteNameStyle } from '../../hooks/useNoteNameStyle';
import { drawNoteNameLabels, type NoteNameStyle } from '../../lib/note/noteNameLabels';

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
  position: relative; /* anchors the scoped count-in overlay to THIS card */
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
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.activeFill};
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

/* normalizeChordLabel now imported as alias of normalizeChordTypeset from
 * src/lib/jazz-harmony. See import at top of file. */

/** Append a chord label in SVG at the given position (root larger, quality smaller) */
function addChordLabel(svg: SVGElement, x: number, y: number, raw: string) {
  const label = normalizeChordLabel(raw);
  // Accept ASCII b/# too — normalizeChordTypeset only converts tension
  // accidentals to Unicode, the root flat ("Eb") stays ASCII.
  const rootMatch = label.match(/^([A-G][b#♭♯]?)(.*)/);
  if (!rootMatch) return;
  const [, root, quality] = rootMatch;

  const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  text.setAttribute('x', String(Math.round(x)));
  text.setAttribute('y', String(y));
  text.setAttribute('fill', '#333');
  text.setAttribute('font-family', "'MuseJazz Text','Oswald','Pretendard',sans-serif");

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
const FLAT_KEYS: Record<string, number> = { F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7, Dm: 1, Gm: 2, Cm: 3, Fm: 4, Bbm: 5, Ebm: 6 };
const SHARP_KEYS: Record<string, number> = { G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7 };
const KEY_SIG_FLATS = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
const KEY_SIG_SHARPS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];

const LINE_H = 150;
const MARGIN = { top: 32, left: 6, right: 6, bottom: 20 };
const MEASURE_HL_COLOR = 'rgba(100, 181, 246, 0.13)';
const BLUE_NOTE = '#1565c0';

export function toVexKey(key: string): string {
  const p = key.split('-');
  const root = p[0] || 'C';
  const mode = p[1] || '';
  return (mode === 'min' || mode === 'minor') ? root + 'm' : root;
}

export function keySigAcc(vexKey: string): Map<string, 'b' | '#'> {
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

export function buildVfNotes(measure: MeasureInfo, kAcc: Map<string, 'b' | '#'>): StaveNote[] {
  // Octave-aware accidental memory (standard engraving rule) — see
  // resolveMeasureAccidental. An accidental persists only for the same pitch at
  // the SAME octave within the measure; a different octave neither inherits a
  // flat/sharp nor needs a cautionary natural, and re-prints its own accidental
  // when altered, so the glyph always matches the played pitch. Shared by the
  // chat lick cards (this file) and the chord-chart inline licks (InlineLickRow).
  const active = new Map<string, RenderAcc>();
  return measure.notes.map((n) => {
    const isRest = n.duration.endsWith('r');
    const note = new StaveNote({ keys: isRest ? ['b/4'] : n.keys, duration: buildDur(n.duration, n.dotted), autoStem: true, ...ghostHead(n) });
    if (n.dotted) Dot.buildAndAttach([note]);
    if (!isRest) {
      const realAcc = n.accidentals?.[0] as 'b' | '#' | undefined;
      const glyph = resolveMeasureAccidental(active, kAcc, n.keys[0], realAcc);
      if (glyph) note.addModifier(new Accidental(glyph), 0);
    }
    return note;
  });
}

/** 직선 음의 분할 위치는 beamPolicy(절대 박 위치 조판 규칙)가 결정한다 —
 *  쉼표 뒤 오프비트 런은 박 단위로, 정박 8분 4개는 통짜로 묶인다. */
export function buildBeams(vfNotes: StaveNote[], notes: NoteInfo[], timeSignature?: string): Beam[] {
  const beams: Beam[] = [];
  const beamBreaks = computeBeamBreaks(notes, timeSignature);
  let grp: StaveNote[] = [];
  for (let i = 0; i < vfNotes.length; i++) {
    const vn = vfNotes[i]; const dur = vn.getDuration();
    const isBeamable = dur === '8' || dur === '16' || dur === '8d' || dur === '16d';
    const isRest = vn.isRest();
    if (isBeamable && !isRest) {
      if (!notes[i]?.tuplet && grp.length > 0 && beamBreaks.has(i)) {
        if (grp.length >= 2) beams.push(new Beam(grp, true)); grp = [];
      }
      grp.push(vn);
      if (notes[i]?.tuplet && grp.length === 3) { beams.push(new Beam(grp, true)); grp = []; }
    } else { if (grp.length >= 2) beams.push(new Beam(grp, true)); grp = []; }
  }
  if (grp.length >= 2) beams.push(new Beam(grp, true));
  return beams;
}

/** Build VexFlow Tuplet objects for any N-tuplet groups (3,5,6,7…). Critically,
 *  the Tuplet constructor applies each note's tick multiplier — so constructing
 *  these BEFORE Formatter.formatToStave() corrects the bar's tick total (a 16th-
 *  triplet then counts as 1/3, not a full 16th). Without it the formatter sees
 *  "too many ticks" and the notes overflow / spill past their measure. Returns
 *  the tuplets so the caller can `.setContext(ctx).draw()` them after the notes. */
export function buildTuplets(vfNotes: StaveNote[], notes: NoteInfo[]): Tuplet[] {
  const out: Tuplet[] = [];
  let ti = 0;
  while (ti < notes.length) {
    const n = notes[ti]?.tuplet;
    if (n && n >= 3) {
      const g: StaveNote[] = [];
      while (ti < notes.length && notes[ti]?.tuplet === n && g.length < n) { g.push(vfNotes[ti]); ti++; }
      if (g.length >= 2) {
        const notesOccupied = Math.pow(2, Math.floor(Math.log2(n - 1)));
        const tup = new Tuplet(g, { numNotes: g.length, notesOccupied });
        if (g[0].getStemDirection() === -1) tup.setTupletLocation(-1);
        out.push(tup);
      }
    } else ti++;
  }
  return out;
}

/* ── score renderer ───────────────────────────────────────────────────────── */

function renderScore(
  el: HTMLDivElement,
  lick: LickEntry,
  availW: number,
  measureRectsRef: MutableRefObject<{ x: number; y: number; w: number }[]>,
  noteElMapRef: MutableRefObject<Map<string, SVGElement>>,
  /* 음이름 라벨 — 모듈 함수라 훅을 못 쓴다. 호출부가 넘긴다. */
  noteNameStyle: NoteNameStyle,
) {
  el.innerHTML = '';
  measureRectsRef.current = [];
  noteElMapRef.current = new Map();
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
  const rects: { x: number; y: number; w: number }[] = [];
  const noteMap = new Map<string, SVGElement>();

  for (let m = 0; m < data.measures.length; m++) {
    const measure = data.measures[m];
    const w = m === 0 ? measW[m] + DECOR : measW[m];
    rects[m] = { x, y: MARGIN.top, w };
    const stave = new Stave(x, MARGIN.top, w);
    if (m === 0) {
      stave.addClef('treble');
      if (vexKey && vexKey !== 'C') stave.addKeySignature(vexKey);
      stave.addTimeSignature(data.timeSignature);
    }
    if (m === data.measures.length - 1) stave.setEndBarType(2);
    stave.setContext(ctx).draw();

    const vfNotes = buildVfNotes(measure, kAcc);
    const beams = buildBeams(vfNotes, measure.notes, data.timeSignature);
    const voice = new Voice({ numBeats, beatValue });
    voice.setStrict(false);
    voice.addTickables(vfNotes);
    new Formatter().joinVoices([voice]).formatToStave([voice], stave);
    voice.draw(ctx, stave);
    beams.forEach((b) => b.setContext(ctx).draw());
    drawNoteNameLabels(el.querySelector('svg'), vfNotes.map((vf, ni) => (
      { vfNote: vf, keys: measure.notes[ni]?.keys ?? [] }
    )), noteNameStyle);

    for (let ni = 0; ni < vfNotes.length; ni++) {
      const svgNode = vfNotes[ni].getSVGElement?.() as SVGElement | undefined;
      if (svgNode) noteMap.set(`${m}-${ni}`, svgNode);
    }

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
        // 덧줄 고음이 코드 글자를 뚫지 않도록 baseline 을 위로 밀어 올린다.
        const chordY = chordBaselineY(
          measure.notes, (line) => stave.getYForLine(line), MARGIN.top - 6,
          { gap: 4, minY: 12 },
        );
        addChordLabel(svg, chordX, chordY, measure.chord);
      }
    }

    x += w;
  }

  measureRectsRef.current = rects;
  noteElMapRef.current = noteMap;

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
  /** When provided, an extra "↓" button renders the lick inline under the chord
   *  chart (measure-aligned). Receives the (already transpose-matched) lick. */
  onShowInline?: (lick: LickEntry) => void;
  /** True when this lick is the one currently shown inline — flips the ↓ button
   *  into an active/collapse state (the toggle is one-at-a-time). */
  inlineActive?: boolean;
  /** Deletes this lick from the browser's saved-lick storage only. */
  onDeleteLocal?: (lick: LickEntry) => void;
}

export function LickRecommendMessage({ match, tempoOverride, onShowInline, inlineActive, onDeleteLocal }: Props) {
  const { lick, originalKey } = match;
  const wrapperRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<HTMLDivElement>(null);
  const measureRectsRef = useRef<{ x: number; y: number; w: number }[]>([]);
  const noteElMapRef = useRef<Map<string, SVGElement>>(new Map());
  const prevNoteKeyRef = useRef<string | null>(null);
  const playUnsubsRef = useRef<Array<() => void>>([]);
  const { player } = useGlobalPlayer();

  /* Eager warmup: a recommended lick warms the audio engine on mount (no
   * sound — the context stays suspended) so pressing Play is instant. */
  useEffect(() => {
    warmupPlayerOnce(player, { kind: 'lick', data: lick.sheetData });
  }, [player, lick.sheetData]);

  const [playing, setPlaying] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  // 마운트 시 localStorage 확인 — 이미 저장된 릭이면 saved 상태로 시작
  const [saved, setSaved] = useState(() =>
    loadUserLicksSync().some((l) => l.id === lick.id)
  );
  const video = lick.video ?? getLickVideo(lick.id);
  const noteNameStyle = useNoteNameStyle();

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const el = svgRef.current;
    if (!el || !wrapper) return;

    let cancelled = false;
    const render = (): boolean => {
      if (cancelled) return false;
      const availW = wrapper.clientWidth;
      if (availW < 60) return false; // 폭 아직 미정 — rAF 루프/ResizeObserver 가 재시도
      renderScore(el, lick, Math.max(availW - 2, 100), measureRectsRef, noteElMapRef, noteNameStyle);
      prevNoteKeyRef.current = null;
      return true;
    };

    /* 마운트(특히 스트리밍 중 [LICK:id] 카드 remount) 직후엔 컨테이너 폭이 0인
     * 프레임이 있어 render() 가 일찍 빠진다. 폭이 생길 때까지 몇 프레임 재시도 —
     * 안 그러면 ResizeObserver 초기 콜백이 다음 remount 로 취소될 때 악보가 영영
     * 안 그려진다("가끔 vexflow 미출력"). */
    let tries = 0;
    const pump = () => {
      if (cancelled || render() || tries++ > 30) return;
      requestAnimationFrame(pump);
    };
    pump();

    const ro = new ResizeObserver(() => render());
    ro.observe(wrapper);
    return () => { cancelled = true; ro.disconnect(); };
  }, [lick, noteNameStyle]);

  const colorNote = useCallback((key: string, color: string) => {
    const el = noteElMapRef.current.get(key);
    if (!el) return;
    const apply = (e: Element) => { (e as SVGElement).style.fill = color; };
    apply(el);
    el.querySelectorAll('*').forEach(apply);
    let parent = el.parentElement;
    while (parent && parent.tagName !== 'svg') {
      const cls = parent.getAttribute('class') || '';
      if (cls.includes('vf-stavenote') || cls.includes('vf-stemmablenote')) {
        apply(parent);
        parent.querySelectorAll('*').forEach(apply);
        break;
      }
      parent = parent.parentElement;
    }
  }, []);

  const clearNoteHighlight = useCallback(() => {
    const prev = prevNoteKeyRef.current;
    if (prev) colorNote(prev, '');
    prevNoteKeyRef.current = null;
  }, [colorNote]);

  const highlightNote = useCallback((mi: number, ni: number) => {
    clearNoteHighlight();
    if (mi < 0) return;
    const key = `${mi}-${ni}`;
    colorNote(key, BLUE_NOTE);
    prevNoteKeyRef.current = key;
  }, [clearNoteHighlight, colorNote]);

  const drawMeasureHL = useCallback((idx: number) => {
    const svg = svgRef.current?.querySelector('svg');
    if (!svg) return;
    svg.querySelector('.m-hl')?.remove();
    const r = measureRectsRef.current[idx];
    if (idx < 0 || !r) return;
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('class', 'm-hl');
    rect.setAttribute('x', String(r.x));
    rect.setAttribute('y', String(r.y + 8));
    rect.setAttribute('width', String(r.w));
    rect.setAttribute('height', String(LINE_H - 16));
    rect.setAttribute('fill', MEASURE_HL_COLOR);
    rect.setAttribute('stroke', 'none');
    rect.setAttribute('rx', '4');
    svg.insertBefore(rect, svg.firstChild);
  }, []);

  const clearPlaybackHighlight = useCallback(() => {
    clearNoteHighlight();
    drawMeasureHL(-1);
  }, [clearNoteHighlight, drawMeasureHL]);

  const clearPlaySubscriptions = useCallback(() => {
    playUnsubsRef.current.forEach((fn) => fn());
    playUnsubsRef.current = [];
  }, []);

  /* 다른 카드/표면이 재생을 시작하면 호출되는 UI 리셋 — 리스너 해제 + 버튼/
   * 하이라이트 원복 (카드 B 재생 시 카드 A 고착 방지, LickCard와 동일). */
  const releaseUi = useCallback(() => {
    clearPlaySubscriptions();
    setPlaying(false);
    clearPlaybackHighlight();
  }, [clearPlaySubscriptions, clearPlaybackHighlight]);

  useEffect(() => {
    return () => {
      clearPlaySubscriptions();
      clearPlaybackHighlight();
      releasePlaybackUi(releaseUi);
    };
  }, [clearPlaySubscriptions, clearPlaybackHighlight, releaseUi]);

  // scoped → 카운트인 "1 2 3 4" 오버레이를 전체 화면이 아니라 이 카드(Wrapper)
  // 안에서만 표시. (Wrapper 가 position:relative 라 absolute inset:0 으로 갇힌다.)
  const countIn = useCountInIntro({ scoped: true });

  const togglePlay = useCallback(async () => {
    if (playing || countIn.active) {
      player.stop();
      countIn.cancel();
      releaseUi();
      releasePlaybackUi(releaseUi);
      return;
    }
    const bpm = tempoOverride ?? lick.tempo ?? 200;
    claimPlaybackUi(releaseUi); // 이전 카드의 UI를 정리하고 소유권 획득
    setPlaying(true);
    // 리딩 픽업이면 픽업 음표를 카운트인 꼬리에 얹고 본문만 재생(measureOffset:1) →
    // 픽업과 메인 멜로디 사이 쉼 제거. 카운트인은 항상 1마디 "1 2 3 4", 로드는 병렬.
    // (.catch는 생성 시점에 — 핸들러 없는 rejection이 AudioLifecycleGuard의
    //  stopAllAudio()를 깨워 시작하는 재생을 죽이는 걸 막는다.)
    const preload = player.preload({ kind: 'lick', data: lick.sheetData }).catch(() => {});
    // 클릭 제스처 안에서 backing ctx를 즉시 resume — scoped 카운트인은 backing
    // ctx를 안 깨우고, play()는 카운트인 뒤(제스처 만료 후)에야 resume을 시도해
    // "카운트인은 들리는데 backing 무음"이 된다. (LickCard와 동일 처치.)
    player.unlock({ kind: 'lick', data: lick.sheetData });
    const intro = await prepareLickIntro(player, countIn, lick.sheetData, bpm, preload);
    if (!intro.ok) { setPlaying(false); releasePlaybackUi(releaseUi); return; }
    clearPlaySubscriptions();
    playUnsubsRef.current = [
      /* Re-assert playing on every bar. activate() inside player.play() may
       * stop a previously-active engine while swapping in this lick, which
       * emits a stray 'done' — the handler below would catch it and flip the
       * button back to ▶ even though audio is actually starting. A real 'bar'
       * tick means playback is rolling, so re-confirm (idempotent normally). */
      // Only respond to LICK playback (this card's audition) — the singleton
      // player's bus is shared with the chord-chart engine, so guard on kind so
      // a chord-chart play() doesn't scrub this card's score.
      player.on('bar', (barIndex) => {
        if (player.currentInput?.kind !== 'lick') return;
        setPlaying(true); drawMeasureHL(barIndex);
      }),
      player.on('note', (mi, ni) => {
        if (player.currentInput?.kind !== 'lick') return;
        highlightNote(mi, ni);
      }),
      player.on('done', () => {
        releaseUi();
        releasePlaybackUi(releaseUi);
      }),
    ];
    player.setConfig({ bpm });
    // Await + catch: an unhandled play() rejection would trip AudioLifecycleGuard's
    // `unhandledrejection` → stopAllAudio() (killing this very playback), and on a
    // real failure we want to reset the button/highlight back to idle (#4c).
    try {
      await player.play({ kind: 'lick', data: intro.data }, intro.opts);
    } catch {
      releaseUi();
      releasePlaybackUi(releaseUi);
    }
  }, [
    lick,
    tempoOverride,
    countIn,
    player,
    playing,
    releaseUi,
    drawMeasureHL,
    highlightNote,
  ]);

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
        {/* 릭 번호 — UUID 대신 백엔드 목록상의 정렬 순번(displayNumber)을 표시.
            displayNumber 가 없으면(레거시/AI생성 릭) raw id 로 폴백. */}
        <DevIdBadge title="Lick #">#{lick.displayNumber ?? lick.id}</DevIdBadge>
        <CircleBtn
          $color={playing ? '#1b5e20' : '#2e7d32'}
          onClick={togglePlay}
          title={playing ? '정지' : '재생'}
        >
          {playing ? '■' : '▶'}
        </CircleBtn>
        {onShowInline && (
          <CircleBtn
            $color={inlineActive ? '#B8860B' : '#1a1a1a'}
            onClick={() => onShowInline(lick)}
            title={inlineActive ? '코드차트 아래 표시 끄기' : '코드차트 마디 아래에 표시'}
          >
            {/* down-into-chart arrow */}
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 4v13" />
              <path d="M6 11l6 6 6-6" />
            </svg>
          </CircleBtn>
        )}
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
        {onDeleteLocal && (
          <CircleBtn
            $color="#b3261e"
            onClick={() => onDeleteLocal(lick)}
            title="저장된 릭 삭제"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M3 6h18" />
              <path d="M8 6V4h8v2" />
              <path d="M6 6l1 15h10l1-15" />
              <path d="M10 11v6" />
              <path d="M14 11v6" />
            </svg>
          </CircleBtn>
        )}
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
  const [localSavedMatches, setLocalSavedMatches] = useState(savedMatches);
  useEffect(() => setLocalSavedMatches(savedMatches), [savedMatches]);
  const active = tab === 'recommend' ? matches : localSavedMatches;
  const handleDeleteLocal = useCallback((lick: LickEntry) => {
    deleteUserLick(lick.id);
    setLocalSavedMatches((prev) => prev.filter((m) => String(m.lick.id) !== String(lick.id)));
    window.dispatchEvent(new CustomEvent('jazzify:lickSaved'));
  }, []);

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
          <span style={{ verticalAlign: 'middle' }}>{localSavedMatches.length}</span>
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
            <LickRecommendMessage
              match={m}
              tempoOverride={songTempo}
              onDeleteLocal={tab === 'saved' ? handleDeleteLocal : undefined}
            />
          </div>
        ))
      )}
    </div>
  );
}
