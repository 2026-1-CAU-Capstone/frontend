import { useEffect, useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
// vexflow는 ~1 MB이므로 dynamic import로 lazy-load.
// 렌더링 useEffect 내부에서 await import('vexflow') 로 사용.
import type {
  Renderer as RendererT,
  Stave as StaveT,
  StaveNote as StaveNoteT,
  Voice as VoiceT,
  Formatter as FormatterT,
  Beam as BeamT,
  Accidental as AccidentalT,
  Dot as DotT,
  BarlineType as BarlineTypeT,
  VoltaType as VoltaTypeT,
  StaveTie as StaveTieT,
  Tuplet as TupletT,
  Repetition as RepetitionT,
  Articulation as ArticulationT,
  Annotation as AnnotationT,
  AnnotationVerticalJustify as AnnotationVerticalJustifyT,
  Ornament as OrnamentT,
  Tremolo as TremoloT,
  Curve as CurveT,
} from 'vexflow';
type Renderer = RendererT;
type Stave = StaveT;
type StaveNote = StaveNoteT;
type Voice = VoiceT;
type Formatter = FormatterT;
type Beam = BeamT;
type Accidental = AccidentalT;
type Dot = DotT;
type BarlineType = BarlineTypeT;
type VoltaType = VoltaTypeT;
type StaveTie = StaveTieT;
type Tuplet = TupletT;
type Repetition = RepetitionT;
type Articulation = ArticulationT;
type Annotation = AnnotationT;
type AnnotationVerticalJustify = AnnotationVerticalJustifyT;
type Ornament = OrnamentT;
type Tremolo = TremoloT;
type Curve = CurveT;
let Renderer: typeof RendererT;
let Stave: typeof StaveT;
let StaveNote: typeof StaveNoteT;
let Voice: typeof VoiceT;
let Formatter: typeof FormatterT;
let Beam: typeof BeamT;
let Accidental: typeof AccidentalT;
let Dot: typeof DotT;
let BarlineType: typeof BarlineTypeT;
let VoltaType: typeof VoltaTypeT;
let StaveTie: typeof StaveTieT;
let Tuplet: typeof TupletT;
let Repetition: typeof RepetitionT;
let Articulation: typeof ArticulationT;
let Annotation: typeof AnnotationT;
let AnnotationVerticalJustify: typeof AnnotationVerticalJustifyT;
let Ornament: typeof OrnamentT;
let Tremolo: typeof TremoloT;
let Curve: typeof CurveT;
let __vexflowLoaded = false;
async function __ensureVexflow() {
  if (__vexflowLoaded) return;
  const vf = await import('vexflow');
  Renderer = vf.Renderer;
  Stave = vf.Stave;
  StaveNote = vf.StaveNote;
  Voice = vf.Voice;
  Formatter = vf.Formatter;
  Beam = vf.Beam;
  Accidental = vf.Accidental;
  Dot = vf.Dot;
  BarlineType = vf.BarlineType;
  VoltaType = vf.VoltaType;
  StaveTie = vf.StaveTie;
  Tuplet = vf.Tuplet;
  Repetition = vf.Repetition;
  Articulation = vf.Articulation;
  Annotation = vf.Annotation;
  AnnotationVerticalJustify = vf.AnnotationVerticalJustify;
  Ornament = vf.Ornament;
  Tremolo = vf.Tremolo;
  Curve = vf.Curve;
  __vexflowLoaded = true;
}
import type { NoteInfo, MeasureInfo } from '../../data/sampleMelody';
import type { LickEntry } from '../../data/lickData';
import { useGlobalPlayer, warmupPlayerOnce } from '../../lib/player';
import { YoutubeEmbed } from '../common/YoutubeEmbed';
import { getLickVideo, lickYoutubeSearchUrl } from '../../data/lickVideos';
import { useCountInIntro } from '../../hooks/useCountInIntro';
import { prepareLickIntro } from '../../lib/note/anacrusis';
import { resolveMeasureAccidental } from '../../lib/note/measureAccidentals';
import { formatChordDisplay } from '../../lib/jazz-harmony';

/* ─── layout constants ──────────────────────────────────────────────── */

const LINE_HEIGHT = 140;
/* MARGIN.top: 코드 라벨이 고음 노트 위로 올라갈 때를 대비해 충분히 확보.
 * MARGIN.right: 마지막 마디의 코드 라벨(예: "C-7"이 ~40px)이 SVG 우측 끝에서
 * 잘리지 않도록 확보. */
const MARGIN = { top: 40, left: 10, right: 44, bottom: 10 };
/* 코드 라벨의 최소 baseline y — SVG 상단 밖으로 텍스트가 나가지 않도록 클램프. */
const CHORD_MIN_Y = 16;
const CHORD_FONT = "'MuseJazz Text', 'Pretendard', sans-serif";
const MEASURE_HL_COLOR = 'rgba(100, 181, 246, 0.13)';
const DECOR_OTHER = 35;
/* Uniform per-note base width: every note contributes the same horizontal allotment regardless
 * of duration, so the rendered distance between consecutive notes (8th-8th, 16th-16th, etc.) is
 * the same across all licks. The value is set high enough (22) to give VexFlow room to render
 * note glyphs without crowding; combined with the softmaxFactor in the Formatter call below this
 * makes spacing nearly uniform by count rather than proportional to duration. */
const PX_PER_DUR: Record<string, number> = { w: 22, h: 22, q: 22, '8': 22, '16': 22 };
const DUR_BEATS: Record<string, number> = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25 };

const formatChord = formatChordDisplay;

/** Normalize lick key to VexFlow key signature format. */
function toVexKey(key: string): string {
  const parts = key.split('-');
  const root = parts[0] || 'C';
  const mode = parts[1] || '';
  if (mode === 'min' || mode === 'minor') return root + 'm';
  return root;
}

/** Map instrument shorthand codes to display names. Unknown values render as-is. */
const INSTRUMENT_DISPLAY: Record<string, string> = {
  as: 'Alto Saxophone',
  ts: 'Tenor Saxophone',
};

function formatInstrument(inst: string | undefined): string {
  if (!inst) return '';
  return INSTRUMENT_DISPLAY[inst.trim().toLowerCase()] ?? inst;
}

/** Split formatted chord into base, extension number, and tensions. */
function splitChordParts(formatted: string): { base: string; ext: string; tension: string } {
  const m = formatted.match(/^(\D*?)(\d+)(.*)$/);
  if (!m) return { base: formatted, ext: '', tension: '' };
  return { base: m[1], ext: m[2], tension: m[3] || '' };
}

/** Append chord text to SVG with superscript extension + smaller tension above. */
function appendChordSVG(
  svgEl: SVGElement, x: number, y: number,
  chord: string, font: string, size: number,
) {
  const { base, ext, tension } = splitChordParts(formatChord(chord));
  const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  txt.setAttribute('x', String(x));
  txt.setAttribute('y', String(y));
  txt.setAttribute('font-family', font);
  txt.setAttribute('fill', '#333');
  txt.setAttribute('stroke', '#333');
  txt.setAttribute('stroke-width', '0.3');

  // Render base — split out the diminished sign (°) so it can be drawn at
  // ~1.4x size (raw glyph is too small to read at chord-label sizes).
  if (base.includes('°')) {
    const dimSize = Math.round(size * 1.4);
    for (const seg of base.split(/(°)/g)) {
      if (!seg) continue;
      const sp = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
      sp.setAttribute('font-size', String(seg === '°' ? dimSize : size));
      sp.textContent = seg;
      txt.appendChild(sp);
    }
  } else {
    const baseSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    baseSpan.setAttribute('font-size', String(size));
    baseSpan.textContent = base;
    txt.appendChild(baseSpan);
  }

  if (ext) {
    // Dominant 7: bare root (no \u25B3/\u00B0/\u00F8/- quality marker) followed by "7".
    // Renders ~8 % larger, slightly lower, and nudged right vs. other
    // 7-extensions \u2014 mirrors the same treatment applied in LeadSheet.
    const isDom7 = ext === '7' && !/[\u25B3\u00B0\u00F8\-]/.test(base);
    const extSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
    extSpan.setAttribute(
      'font-size',
      String(Math.round(size * (isDom7 ? 0.92 : 0.85))),
    );
    extSpan.setAttribute(
      'dx',
      base.endsWith('\u25B3') ? '-1' : (isDom7 ? '3' : '1'),
    );
    extSpan.setAttribute('dy', String(isDom7 ? -size * 0.03 : -size * 0.18));
    extSpan.textContent = ext;
    txt.appendChild(extSpan);

    if (tension) {
      // Split tension into accidental symbols (♭♯) and digits
      const accMatch = tension.match(/^([\u266D\u266F]*)(.*)/);
      const tensionAcc = accMatch?.[1] || '';
      const tensionNum = accMatch?.[2] || '';

      if (tensionNum) {
        const numSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        numSpan.setAttribute('font-size', String(Math.round(size * 0.6)));
        numSpan.setAttribute('dx', '4.5');
        numSpan.setAttribute('dy', String(-size * 0.15));
        numSpan.textContent = tensionNum;
        txt.appendChild(numSpan);
      }
      if (tensionAcc) {
        const accSpan = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        accSpan.setAttribute('font-size', String(Math.round(size * 0.55)));
        accSpan.setAttribute('dx', tensionNum ? '-' + String(Math.round(size * 0.38)) : '2');
        accSpan.setAttribute('dy', String(size * 0.1));
        accSpan.textContent = tensionAcc;
        txt.appendChild(accSpan);
      }
    }
  }

  svgEl.appendChild(txt);
}
/** Estimate first-measure decoration width (clef + key sig + time sig). */
function decorFirstWidth(vexKey: string): number {
  const CLEF_W = 33;
  const TIME_SIG_W = 28;
  const PER_ACC = 10;
  const nFlats = FLAT_KEYS[vexKey] ?? 0;
  const nSharps = SHARP_KEYS[vexKey] ?? 0;
  const keySigW = (nFlats || nSharps) * PER_ACC;
  return CLEF_W + keySigW + TIME_SIG_W + 6; // 6px padding
}

function measureMinWidth(m: MeasureInfo): number {
  let w = 18;
  for (const n of m.notes) {
    const base = n.duration.replace(/[dr]/g, '');
    w += PX_PER_DUR[base] ?? 24;
    if (n.accidentals) w += Object.keys(n.accidentals).length * 10;
    if (n.dotted) w += 5;
  }
  return Math.max(w, 55);
}

/* ─── styled ────────────────────────────────────────────────────────── */

const Card = styled.div`
  position: relative; /* scoped CountInOverlay 가 카드 내부에 absolute 로 자리잡도록 */
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  padding: 12px 20px 8px;

  &:hover {
    background: ${({ theme }) => theme.colors.bgSecondary};
  }

  @media (max-width: 960px) {
    padding: 10px 12px 6px;
  }
`;

const MetaRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 8px;
`;

const LickId = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.72rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  opacity: 0.6;
`;

const Performer = styled.span`
  font-family: "MuseJazz Text", 'Pretendard', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Title = styled.span`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.88rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const TagRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
`;

const Badge = styled.span<{ $color?: string }>`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  padding: 2px 8px;
  border-radius: 3px;
  background: ${({ $color }) => $color ?? '#f0ebe0'};
  color: #555;
`;


const PlayBtn = styled.button<{ $active?: boolean }>`
  font-size: 0.85rem;
  line-height: 1;
  background: ${({ $active }) => ($active ? '#f0e8d0' : 'transparent')};
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  color: #333;
  &:hover { background: #f0f0f0; }
`;

const BpmInput = styled.input`
  font-family: 'Pretendard', sans-serif;
  font-size: 0.82rem;
  width: 44px;
  padding: 2px 4px;
  border: 1px solid #ddd;
  border-radius: 4px;
  background: #fff;
  color: #333;
  text-align: center;
  outline: none;
`;

const SvgWrap = styled.div<{ $scroll?: boolean }>`
  overflow-x: ${({ $scroll }) => ($scroll ? 'auto' : 'hidden')};
  overflow-y: hidden;
`;

const Placeholder = styled.div`
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: 'Pretendard', sans-serif;
  font-size: 0.8rem;
  opacity: 0.4;
`;

/* ─── helpers ───────────────────────────────────────────────────────── */

function buildDuration(dur: string, dotted?: boolean): string {
  if (!dotted) return dur;
  if (dur.endsWith('r')) return dur.slice(0, -1) + 'd' + 'r';
  return dur + 'd';
}

function drawGlissLine(svgEl: SVGElement, fromNote: StaveNote, toNote: StaveNote) {
  const fromYs = fromNote.getYs();
  const toYs = toNote.getYs();
  if (!fromYs.length || !toYs.length) return;

  const x1 = fromNote.getNoteHeadEndX() + 3;
  const y1 = fromYs[0];
  const x2 = toNote.getNoteHeadBeginX() - 3;
  const y2 = toYs[0];

  const dx = x2 - x1;
  const dy = y2 - y1;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 4) return;

  const px = -dy / dist;
  const py = dx / dist;

  const waves = Math.max(3, Math.round(dist / 5));
  const amp = 3.5;
  let d = `M ${x1} ${y1}`;
  for (let i = 1; i <= waves; i++) {
    const t = i / waves;
    const mt = t - 0.5 / waves;
    const sign = i % 2 === 1 ? -1 : 1;
    const mx = x1 + dx * mt + px * amp * sign;
    const my = y1 + dy * mt + py * amp * sign;
    const ex = x1 + dx * t;
    const ey = y1 + dy * t;
    d += ` Q ${mx} ${my} ${ex} ${ey}`;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('stroke', '#333');
  path.setAttribute('stroke-width', '3');
  path.setAttribute('fill', 'none');
  svgEl.appendChild(path);

  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  txt.setAttribute('x', String(midX));
  txt.setAttribute('y', String(midY - 8));
  txt.setAttribute('text-anchor', 'middle');
  txt.setAttribute('font-family', "'Times New Roman', 'Georgia', serif");
  txt.setAttribute('font-size', '9');
  txt.setAttribute('font-style', 'italic');
  txt.setAttribute('fill', '#333');
  txt.setAttribute('transform', `rotate(${angle}, ${midX}, ${midY - 8})`);
  txt.textContent = 'gliss.';
  svgEl.appendChild(txt);
}

function buildManualBeams(vfNotes: StaveNote[], notes: NoteInfo[]): Beam[] {
  const beams: Beam[] = [];
  let beamGroup: StaveNote[] = [];
  let beatPos = 0;          // absolute beat position within the measure
  let inTupletN = 0;        // 0 = not in tuplet, else the N of the current N-tuplet group
  let postTupletMerged = false;

  for (let i = 0; i < vfNotes.length; i++) {
    const vn = vfNotes[i];
    const tupletN = notes[i]?.tuplet ?? 0;
    const isTuplet = tupletN >= 3;
    const dur = vn.getDuration();
    const isBeamable = dur === '8' || dur === '16' || dur === '8d' || dur === '16d';
    const isRest = vn.isRest();
    const noteDots = vn.getModifiersByType('Dot')?.length ?? 0;
    let noteBeats = DUR_BEATS[dur.replace('d', '')] ?? 1;
    if (noteDots > 0 || dur.endsWith('d')) noteBeats *= 1.5;
    if (isTuplet) {
      // N-tuplet occupies the time of the largest power of 2 strictly less than N
      const denom = Math.pow(2, Math.floor(Math.log2(tupletN - 1)));
      noteBeats *= denom / tupletN;
    }

    if (postTupletMerged && beamGroup.length > 0) {
      if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
      beamGroup = [];
      postTupletMerged = false;
    }

    // Break beam group when the tuplet status / N changes
    if (tupletN !== inTupletN && beamGroup.length > 0) {
      const prevIs16Triplet = inTupletN === 3 && beamGroup.some((bn) => { const d = bn.getDuration(); return d === '16' || d === '16d'; });
      if (prevIs16Triplet && isBeamable && !isRest && !isTuplet) {
        postTupletMerged = true;
      } else {
        if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
        beamGroup = [];
      }
    }
    inTupletN = tupletN;

    if (isBeamable && !isRest) {
      if (!isTuplet && !postTupletMerged) {
        const newBeatPos = beatPos + noteBeats;
        const has16 = dur === '16' || dur === '16d' || beamGroup.some((bn) => { const d = bn.getDuration(); return d === '16' || d === '16d'; });
        const boundary = has16 ? 1 : 2;
        // Break if this note crosses a beat boundary
        if (beamGroup.length > 0 && Math.floor((beatPos - 0.001) / boundary) !== Math.floor((newBeatPos - 0.001) / boundary)) {
          if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
          beamGroup = [];
        }
      }
      beamGroup.push(vn);
      // Split consecutive N-tuplet groups every N notes (3 notes for triplet, 5 for quintuplet, …)
      if (isTuplet && beamGroup.length === tupletN) {
        beams.push(new Beam(beamGroup, true));
        beamGroup = [];
        beatPos += noteBeats;
        continue;
      }
      if (notes[i]?.beamBreak) {
        if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
        beamGroup = [];
        beatPos += noteBeats;
        postTupletMerged = false;
        continue;
      }
    } else {
      // Rest or non-beamable: flush current beam group
      if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
      beamGroup = [];
      postTupletMerged = false;
    }
    beatPos += noteBeats;
  }
  if (beamGroup.length >= 2) beams.push(new Beam(beamGroup, true));
  return beams;
}

/** Build a map of note letters affected by the key signature.
 *  e.g. key "F" → { b: 'b' }, key "G" → { f: '#' }, key "Bbm" → { b:'b', e:'b', a:'b', d:'b', g:'b' }
 */
const KEY_SIG_FLATS = ['b', 'e', 'a', 'd', 'g', 'c', 'f'];
const KEY_SIG_SHARPS = ['f', 'c', 'g', 'd', 'a', 'e', 'b'];
const FLAT_KEYS: Record<string, number> = { F: 1, Bb: 2, Eb: 3, Ab: 4, Db: 5, Gb: 6, Cb: 7, Dm: 1, Gm: 2, Cm: 3, Fm: 4, Bbm: 5, Ebm: 6, Abm: 7 };
const SHARP_KEYS: Record<string, number> = { G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, Em: 1, Bm: 2, 'F#m': 3, 'C#m': 4, 'G#m': 5, 'D#m': 6, 'A#m': 7 };

function keySigAccidentals(vexKey: string): Map<string, 'b' | '#'> {
  const map = new Map<string, 'b' | '#'>();
  const nFlats = FLAT_KEYS[vexKey];
  if (nFlats) {
    for (let i = 0; i < nFlats; i++) map.set(KEY_SIG_FLATS[i], 'b');
  }
  const nSharps = SHARP_KEYS[vexKey];
  if (nSharps) {
    for (let i = 0; i < nSharps; i++) map.set(KEY_SIG_SHARPS[i], '#');
  }
  return map;
}

type LickAcc = 'b' | '#' | 'n' | '##' | 'bb';
function buildVfNotes(measure: MeasureInfo, initialAcc?: Map<string, LickAcc>, keySigAcc?: Map<string, 'b' | '#'>): StaveNote[] {
  const activeAcc = initialAcc ? new Map(initialAcc) : new Map<string, LickAcc>();

  return measure.notes.map((n) => {
    const isRest = n.duration.endsWith('r');
    const dur = buildDuration(n.duration, n.dotted);
    const note = new StaveNote({
      keys: isRest ? ['b/4'] : n.keys,
      duration: dur,
      autoStem: true,
    });
    if (n.dotted) Dot.buildAndAttach([note]);

    if (!isRest) {
      // Octave-aware accidental rule — single shared helper.
      const realAcc = n.accidentals?.[0] as LickAcc | undefined;
      const glyph = resolveMeasureAccidental(activeAcc, keySigAcc, n.keys[0], realAcc);
      if (glyph) note.addModifier(new Accidental(glyph), 0);
    }

    // ── Articulations (staccato/accent/tenuto/marcato) ──
    if (n.articulations && n.articulations.length > 0) {
      const stemDown = note.getStemDirection() === -1;
      const pos = stemDown ? Articulation.Position.BELOW : Articulation.Position.ABOVE;
      for (const a of n.articulations) {
        const code = a === 'staccato' ? 'a.'
          : a === 'accent' ? 'a>'
          : a === 'tenuto' ? 'a-'
          : a === 'marcato' ? 'a^'
          : '';
        if (code) note.addModifier(new Articulation(code).setPosition(pos), 0);
      }
    }

    // ── Fermata ──
    if (n.fermata) {
      note.addModifier(new Articulation('a@a').setPosition(Articulation.Position.ABOVE), 0);
    }

    // ── Ornaments (trill/mordent/turn/tremolo) ──
    if (n.ornaments && n.ornaments.length > 0) {
      for (const o of n.ornaments) {
        if (o === 'tremolo') {
          note.addModifier(new Tremolo(3), 0);
        } else {
          const oName = o === 'trill' ? 'tr'
            : o === 'mordent' ? 'mordent'
            : o === 'inverted-mordent' ? 'mordent_inverted'
            : o === 'turn' ? 'turn'
            : o === 'inverted-turn' ? 'turn_inverted'
            : '';
          if (oName) note.addModifier(new Ornament(oName), 0);
        }
      }
    }

    // ── Dynamics (p/mp/mf/f/ff etc.) ──
    if (n.dynamics) {
      const ann = new Annotation(n.dynamics);
      ann.setVerticalJustification(AnnotationVerticalJustify.BOTTOM);
      ann.setFont('Times New Roman', 12, 'bold italic');
      note.addModifier(ann, 0);
    }

    return note;
  });
}

/* ─── component ─────────────────────────────────────────────────────── */

interface LickCardProps {
  lick: LickEntry;
  width: number;
  visible: boolean;
  compact?: boolean;
  displayId?: number;
  onDelete?: () => void;
  onEdit?: () => void;
  onTranspose?: () => void;
  onPractice?: () => void;
  onClick?: () => void;
}

export function LickCard({ lick, width, visible, compact, displayId, onDelete, onEdit, onTranspose, onPractice, onClick }: LickCardProps) {
  const svgRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  /* measure SvgWrap's actual rendered width — the `width` prop comes from the
   * parent's feedWidth which may not match the real container after CSS layout
   * (sidebars, paddings, scrollbars). Track the live width here so the sizing
   * math always sees the true container. */
  const [containerW, setContainerW] = useState<number>(width);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !visible) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setContainerW(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [visible]);

  /* player */
  const { player } = useGlobalPlayer();

  /* Eager warmup: as soon as a lick card is on screen, warm the audio engine
   * (AudioContext + piano/bass/drums + melody lead) in the background — without
   * resuming the context (no sound). Runs once per session; by the time the
   * user presses Play the samples are decoded and playback is instant. */
  useEffect(() => {
    if (visible === false) return;
    warmupPlayerOnce(player, { kind: 'lick', data: lick.sheetData });
  }, [visible, player, lick.sheetData]);

  const [playing, setPlaying] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [scrollable, setScrollable] = useState(false);
  // 백엔드가 attach한 lick.video 우선, 없으면 정적 registry + localStorage 오버라이드로 폴백.
  const video = lick.video ?? getLickVideo(lick.id);

  /* 디폴트 BPM 규칙:
   *  - 16분음표(혹은 32분음표) 가 한 음이라도 있으면 → 최저 150 (lick.tempo 가 더 빠르면 그 값 사용)
   *  - 그 외 (8분음표 이상만) → 200 고정
   * 16분음표가 있는 릭을 200 으로 시작하면 손가락이 못 따라가서 사실상 못 들음. */
  const has16thOrShorter = lick.sheetData.measures.some((m) =>
    m.notes.some((n) => {
      const base = n.duration.replace(/[dr]/g, '');
      return base === '16' || base === '32';
    }),
  );
  const defaultBpm = has16thOrShorter
    ? Math.max(150, lick.tempo ?? 150)
    : 200;
  const [bpm, setBpm] = useState(defaultBpm);
  const [bpmText, setBpmText] = useState(String(defaultBpm));
  useEffect(() => { setBpm(defaultBpm); setBpmText(String(defaultBpm)); }, [defaultBpm]);
  const measureRectsRef = useRef<{ x: number; y: number; w: number }[]>([]);
  const noteElMapRef = useRef<Map<string, SVGElement>>(new Map());
  const prevNoteKeyRef = useRef<string | null>(null);

  // note highlight helpers
  const colorNote = useCallback((key: string, color: string) => {
    const el = noteElMapRef.current.get(key);
    if (!el) return;
    const apply = (e: Element) => { (e as SVGElement).style.fill = color; };
    apply(el);
    el.querySelectorAll('*').forEach(apply);
    let parent = el.parentElement;
    while (parent && parent.tagName !== 'svg') {
      const cls = parent.getAttribute('class') || '';
      if (cls.includes('vf-stavenote') || cls.includes('vf-stemmablenote')) { apply(parent); parent.querySelectorAll('*').forEach(apply); break; }
      parent = parent.parentElement;
    }
  }, []);

  const highlightNote = useCallback((mi: number, ni: number) => {
    const prev = prevNoteKeyRef.current;
    if (prev) colorNote(prev, '');
    if (mi < 0) { prevNoteKeyRef.current = null; return; }
    const key = `${mi}-${ni}`;
    colorNote(key, '#1565c0');
    prevNoteKeyRef.current = key;
  }, [colorNote]);

  const clearNoteHighlight = useCallback(() => {
    const prev = prevNoteKeyRef.current;
    if (prev) colorNote(prev, '');
    prevNoteKeyRef.current = null;
  }, [colorNote]);

  // Direct SVG highlight — no useEffect, called synchronously from RAF
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
    rect.setAttribute('height', String(LINE_HEIGHT - 16));
    rect.setAttribute('fill', MEASURE_HL_COLOR);
    rect.setAttribute('stroke', 'none');
    rect.setAttribute('rx', '4');
    svg.insertBefore(rect, svg.firstChild);
  }, []);

  const countIn = useCountInIntro({ scoped: true });

  /* bar/note/done 구독 해제 핸들 — 수동 정지·릭 교체·언마운트 어디서든 풀 수
   * 있게 ref로 보관. 예전엔 'done' 콜백 안에서만 해제해서, 수동 정지 시
   * (player.stop()은 onDone을 emit하지 않음) 리스너 3개가 전역 싱글톤 버스에
   * 사이클마다 누적됐고 — 이후 다른 카드/페이지 재생이 이 카드의 SVG에
   * 하이라이트를 잘못 그렸다. */
  const playUnsubsRef = useRef<Array<() => void>>([]);
  const releasePlaySubs = useCallback(() => {
    playUnsubsRef.current.forEach((fn) => { try { fn(); } catch { /* noop */ } });
    playUnsubsRef.current = [];
  }, []);
  useEffect(() => releasePlaySubs, [releasePlaySubs]); // unmount에서도 해제

  const togglePlay = useCallback(async () => {
    if (playing || countIn.active) {
      player.stop();
      countIn.cancel();
      releasePlaySubs();
      setPlaying(false);
      clearNoteHighlight();
      drawMeasureHL(-1);
      return;
    }
    setPlaying(true);
    // 리딩 픽업(anacrusis)이면 픽업 음표를 카운트인 꼬리에 얹고 픽업 마디를 떼어
    // 본문만 재생(measureOffset:1) → 픽업과 메인 멜로디 사이 쉼 없이 이어진다.
    // 카운트인은 항상 1마디 "1 2 3 4", 샘플 로드는 병렬. (prepareLickIntro 참조)
    const preload = player.preload({ kind: 'lick', data: lick.sheetData }).catch(() => {});
    const intro = await prepareLickIntro(player, countIn, lick.sheetData, bpm, preload);
    if (!intro.ok) {
      setPlaying(false);
      return;
    }

    releasePlaySubs(); // 혹시 남은 이전 사이클 구독 정리 후 등록
    playUnsubsRef.current = [
      player.on('bar', (barIndex) => drawMeasureHL(barIndex)),
      player.on('note', (mi, ni) => highlightNote(mi, ni)),
      player.on('done', () => {
        setPlaying(false);
        clearNoteHighlight();   // 재생 끝나면 파란 음표/마디 하이라이트 제거
        drawMeasureHL(-1);
        releasePlaySubs();
      }),
    ];

    player.setConfig({ bpm });
    try {
      await player.play({ kind: 'lick', data: intro.data }, intro.opts);
    } catch {
      // Reset UI + release the just-registered listeners on failure (no
      // 'done' will ever fire for a play() that never started).
      setPlaying(false);
      clearNoteHighlight();
      drawMeasureHL(-1);
      releasePlaySubs();
    }
  }, [player, lick, bpm, playing, countIn, highlightNote, clearNoteHighlight, drawMeasureHL, releasePlaySubs]);

  // stop if lick changes while playing — but NOT on first mount. player는
  // 전역 싱글톤이라, 마운트마다 무조건 stop()하면 목록 갱신/페이지네이션으로
  // 새 카드가 마운트되는 순간 다른 카드의 진행 중 재생이 끊겼다.
  const prevLickIdRef = useRef<typeof lick.id | null>(null);
  useEffect(() => {
    const prev = prevLickIdRef.current;
    prevLickIdRef.current = lick.id;
    if (prev === null || prev === lick.id) return; // 첫 마운트/동일 릭 → no-op
    player.stop();
    releasePlaySubs();
    setPlaying(false);
    clearNoteHighlight();
    drawMeasureHL(-1);
    renderedRef.current = false;
  }, [lick.id, player, clearNoteHighlight, drawMeasureHL, releasePlaySubs]);

  /* render notation — default size → CSS scale → horizontal scroll */
  useEffect(() => {
    let cancelled = false;
    const elOuter = svgRef.current;
    if (!elOuter || !visible) return;
    if (!lick.sheetData.measures.length) return;
    void __ensureVexflow().then(() => {
      if (cancelled) return;
      renderLick(elOuter);
    });
    return () => { cancelled = true; };

    function renderLick(el: HTMLDivElement) {
    renderedRef.current = true;
    el.innerHTML = '';
    el.style.width = '';
    el.style.height = '';

    const data = lick.sheetData;
    const nMeasures = data.measures.length;
    const [numBeats, beatValue] = (data.timeSignature ?? '4/4').split('/').map(Number);
    const vexKey = toVexKey(lick.key);
    const keySigAcc = keySigAccidentals(vexKey);
    const DECOR_FIRST = decorFirstWidth(vexKey);

    const cardInner = containerW > 0 ? containerW : width;
    const decorW = DECOR_FIRST;
    const baseWidths = data.measures.map((m) => measureMinWidth(m));

    // Unified spacing: every lick renders at MULT_DEFAULT regardless of length, so the
    // note-to-note distance is identical across all licks. If the music doesn't fit at this
    // spacing, allow horizontal scroll (no compression, no CSS scale — those would alter spacing).
    // Note width budget = PX_PER_DUR (22) × MULT_DEFAULT (1.15) ≈ 25 px per note.
    const MULT_DEFAULT = 1.15;

    const decorTotal = MARGIN.left + decorW + MARGIN.right;
    const baseTotal = baseWidths.reduce((s, w) => s + w, 0);
    const naturalW = decorTotal + baseTotal * MULT_DEFAULT;

    const mult = MULT_DEFAULT;
    const scale = 1;
    const scroll = naturalW > cardInner;
    const svgW = naturalW;

    const measWidths = baseWidths.map((w) => w * mult);
    setScrollable(scroll);

    const lines: number[][] = [Array.from({ length: nMeasures }, (_, i) => i)];
    const nLines = 1;
    const totalH = MARGIN.top + nLines * LINE_HEIGHT + MARGIN.bottom;

    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(svgW, totalH);
    const ctx = renderer.getContext();

    // Apply CSS scale if needed. Transform doesn't affect layout box, so we only set the height
    // (so the card doesn't reserve excess vertical space). Width is left to SvgWrap's natural
    // flow (= Card content width) so ResizeObserver keeps measuring the real container.
    const svgEl = el.querySelector('svg');
    if (svgEl && scale !== 1) {
      svgEl.style.transformOrigin = 'top left';
      svgEl.style.transform = `scale(${scale})`;
      svgEl.style.overflow = 'visible';
      el.style.height = `${totalH * scale}px`;
    }

    const allVfNotes: StaveNote[] = [];
    let tieCarryAcc: Map<string, LickAcc> | undefined;

    const stavePositions: { x: number; y: number; w: number }[] = [];
    for (let li = 0; li < nLines; li++) {
      const indices = lines[li];
      const y = MARGIN.top + li * LINE_HEIGHT;
      let x = MARGIN.left;

      const lineDecorW = indices[0] === 0 ? DECOR_FIRST : DECOR_OTHER;

      for (let j = 0; j < indices.length; j++) {
        const m = indices[j];
        const firstInLine = j === 0;
        const isLast = m === nMeasures - 1;
        const barW = measWidths[m];
        const w = firstInLine ? barW + lineDecorW : barW;

        const stave = new Stave(x, y, w);
        if (firstInLine) {
          stave.addClef('treble');
          if (vexKey && vexKey !== 'C') stave.addKeySignature(vexKey);
          if (m === 0) stave.addTimeSignature(data.timeSignature ?? '4/4');
        }
        const measure = data.measures[m];
        if (measure.repeatStart) stave.setBegBarType(BarlineType.REPEAT_BEGIN);
        if (measure.repeatEnd) stave.setEndBarType(BarlineType.REPEAT_END);
        else if (isLast) stave.setEndBarType(BarlineType.END);
        if (measure.volta) {
          const v = measure.volta;
          const prevV = m > 0 ? data.measures[m - 1]?.volta : undefined;
          const isS = prevV !== v;
          stave.setVoltaType(isS ? VoltaType.BEGIN : VoltaType.MID, `${v}.`, 30);
        }
        if (measure.navigation) {
          const navMap: Record<string, number[]> = {
            segno: [Repetition.type.SEGNO_LEFT], coda: [Repetition.type.CODA_LEFT],
            fine: [Repetition.type.FINE], toCoda: [Repetition.type.TO_CODA],
            dc: [Repetition.type.DC], dcAlCoda: [Repetition.type.DC_AL_CODA], dcAlFine: [Repetition.type.DC_AL_FINE],
            ds: [Repetition.type.DS], dsAlCoda: [Repetition.type.DS_AL_CODA], dsAlFine: [Repetition.type.DS_AL_FINE],
          };
          const rts = navMap[measure.navigation];
          if (rts) for (const rt of rts) stave.setRepetitionType(rt);
        }
        stave.setContext(ctx).draw();
        const decorW = firstInLine ? lineDecorW : 0;
        stavePositions[m] = { x: x + decorW + 4, y, w: barW - 4 };
        const vfNotes = buildVfNotes(measure, tieCarryAcc, keySigAcc);

        tieCarryAcc = undefined;
        const lastNote = measure.notes[measure.notes.length - 1];
        if (lastNote?.tie && !lastNote.duration.endsWith('r')) {
          const acc = lastNote.accidentals?.[0] as LickAcc | undefined;
          if (acc) {
            // Carry by full letter+octave key (modern engraving convention).
            tieCarryAcc = new Map([[lastNote.keys[0], acc]]);
          }
        }

        const beams = buildManualBeams(vfNotes, measure.notes);
        const voice = new Voice({ numBeats, beatValue });
        voice.setStrict(false);
        voice.addTickables(vfNotes);

        // Low softmaxFactor → VexFlow distributes notes more evenly by count rather than
        // proportionally to duration. formatToStave handles bar alignment using stave's
        // intrinsic note area, which keeps bar lines / next-measure x positions correct.
        new Formatter({ softmaxFactor: 5 }).joinVoices([voice]).formatToStave([voice], stave);
        voice.draw(ctx, stave);
        beams.forEach((b) => b.setContext(ctx).draw());

        if (measure.chord) {
          const barContentX = firstInLine ? x + lineDecorW + 4 : x + 4;
          const barContentW = barW - 8;
          // Default chord baseline = y + 12 (above stave area).
          // For measures with very high notes, lift the chord baseline so it
          // sits above the topmost note glyph (incl. ledger lines / stems).
          const baseChordY = y + 12;
          const SAFE_GAP = 4;
          let topNoteY = Infinity;
          for (const n of vfNotes) {
            try {
              const bb = n.getBoundingBox();
              if (bb && bb.y < topNoteY) topNoteY = bb.y;
            } catch { /* noop */ }
          }
          const rawChordY = Number.isFinite(topNoteY) && topNoteY - SAFE_GAP < baseChordY
            ? topNoteY - SAFE_GAP
            : baseChordY;
          // SVG 상단 밖으로 텍스트가 나가지 않도록 최소값으로 클램프.
          const chordY = Math.max(rawChordY, CHORD_MIN_Y);
          const svg = el.querySelector('svg');
          if (svg) {
            const chords = measure.chord.split(/\s{2,}/);
            if (chords.length === 1) {
              appendChordSVG(svg, barContentX, chordY, chords[0], CHORD_FONT, 20);
            } else {
              const sliceW = barContentW / chords.length;
              for (let ci = 0; ci < chords.length; ci++) {
                appendChordSVG(svg, barContentX + ci * sliceW, chordY, chords[ci], CHORD_FONT, 20);
              }
            }
          }
        }

        // Render tuplet brackets — any N-tuplet (3, 5, 6, 7, …) with the correct number above
        {
          let ti = 0;
          while (ti < measure.notes.length) {
            const n = measure.notes[ti].tuplet;
            if (n && n >= 3) {
              const group: StaveNote[] = [];
              while (ti < measure.notes.length && measure.notes[ti].tuplet === n && group.length < n) {
                group.push(vfNotes[ti]);
                ti++;
              }
              if (group.length >= 2) {
                const stemDown = group[0].getStemDirection() === -1;
                const notesOccupied = Math.pow(2, Math.floor(Math.log2(n - 1)));
                const tuplet = new Tuplet(group, { numNotes: group.length, notesOccupied });
                if (stemDown) tuplet.setTupletLocation(-1);
                tuplet.setContext(ctx).draw();
              }
            } else {
              ti++;
            }
          }
        }

        allVfNotes.push(...vfNotes);
        x += w;
      }
    }

    // Build measure→line lookup
    const measureLine = new Map<number, number>();
    for (let li = 0; li < nLines; li++) {
      for (const idx of lines[li]) measureLine.set(idx, li);
    }

    // Build flat note→measure index mapping
    const noteMi: number[] = [];
    for (let mi = 0; mi < data.measures.length; mi++) {
      for (let ni = 0; ni < data.measures[mi].notes.length; ni++) noteMi.push(mi);
    }

    // Draw ties (skip cross-line ties)
    let flatIdx = 0;
    for (const measure of data.measures) {
      for (let ni = 0; ni < measure.notes.length; ni++) {
        if (measure.notes[ni].tie && allVfNotes[flatIdx + 1]) {
          const fromLine = measureLine.get(noteMi[flatIdx]);
          const toLine = measureLine.get(noteMi[flatIdx + 1]);
          if (fromLine === toLine) {
            new StaveTie({ firstNote: allVfNotes[flatIdx], lastNote: allVfNotes[flatIdx + 1], firstIndexes: [0], lastIndexes: [0] })
              .setContext(ctx).draw();
          }
        }
        flatIdx++;
      }
    }

    // Draw slurs — stack-based start/stop tracking across the flat note list.
    {
      const slurStack: number[] = [];
      let fi2 = 0;
      for (const measure of data.measures) {
        for (let ni = 0; ni < measure.notes.length; ni++) {
          const n = measure.notes[ni];
          if (n.slurStart) slurStack.push(fi2);
          if (n.slurStop && slurStack.length > 0) {
            const fromIdx = slurStack.pop()!;
            const fromN = allVfNotes[fromIdx];
            const toN = allVfNotes[fi2];
            const fromLine = measureLine.get(noteMi[fromIdx]);
            const toLine = measureLine.get(noteMi[fi2]);
            if (fromN && toN && fromLine === toLine) {
              new Curve(fromN, toN, {} as never).setContext(ctx).draw();
            }
          }
          fi2++;
        }
      }
    }

    // Draw glissando lines + ghost note parentheses + 8va brackets
    const svg = el.querySelector('svg');
    if (svg) {
      flatIdx = 0;
      let ottavaActive: '8va' | '8vb' | null = null;
      let ottavaStartX = 0;
      let ottavaY = 0;

      for (const measure of data.measures) {
        for (let ni = 0; ni < measure.notes.length; ni++) {
          const noteInfo = measure.notes[ni];
          const vfNote = allVfNotes[flatIdx];

          // ── Glissando ──
          if (noteInfo.gliss && allVfNotes[flatIdx + 1]) {
            drawGlissLine(svg as SVGElement, vfNote, allVfNotes[flatIdx + 1]);
          }

          // ── Ghost note: draw ( ) parentheses around note head ──
          if (noteInfo.ghost && vfNote && !noteInfo.duration.endsWith('r')) {
            const noteEl = vfNote.getSVGElement?.() as SVGGraphicsElement | undefined;
            if (noteEl) {
              const bbox = noteEl.getBBox?.();
              if (bbox) {
                const PAD = 3;
                const cx = bbox.x - PAD;
                const cy = bbox.y + bbox.height / 2;
                const h = bbox.height * 0.55;
                const bulge = 5;
                // left paren
                const lp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                lp.setAttribute('d', `M${cx} ${cy - h} Q${cx - bulge} ${cy} ${cx} ${cy + h}`);
                lp.setAttribute('fill', 'none');
                lp.setAttribute('stroke', '#555');
                lp.setAttribute('stroke-width', '1.5');
                svg.appendChild(lp);
                // right paren
                const rx2 = bbox.x + bbox.width + PAD;
                const rp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
                rp.setAttribute('d', `M${rx2} ${cy - h} Q${rx2 + bulge} ${cy} ${rx2} ${cy + h}`);
                rp.setAttribute('fill', 'none');
                rp.setAttribute('stroke', '#555');
                rp.setAttribute('stroke-width', '1.5');
                svg.appendChild(rp);
              }
            }
          }

          // ── 8va bracket start ──
          if (noteInfo.ottavaStart && vfNote) {
            const noteEl = vfNote.getSVGElement?.() as SVGGraphicsElement | undefined;
            if (noteEl) {
              const bbox = noteEl.getBBox?.();
              if (bbox) {
                ottavaActive = noteInfo.ottavaStart;
                ottavaStartX = bbox.x;
                ottavaY = bbox.y - 10;
              }
            }
          }

          // ── 8va bracket end ──
          if (noteInfo.ottavaEnd && ottavaActive && vfNote) {
            const noteEl = vfNote.getSVGElement?.() as SVGGraphicsElement | undefined;
            if (noteEl) {
              const bbox = noteEl.getBBox?.();
              if (bbox) {
                const endX = bbox.x + bbox.width;
                const y = ottavaY;
                const label = ottavaActive;
                // dashed horizontal line
                const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                line.setAttribute('x1', String(ottavaStartX + 28));
                line.setAttribute('y1', String(y));
                line.setAttribute('x2', String(endX + 4));
                line.setAttribute('y2', String(y));
                line.setAttribute('stroke', '#333');
                line.setAttribute('stroke-width', '1.2');
                line.setAttribute('stroke-dasharray', '4,3');
                svg.appendChild(line);
                // label text
                const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                txt.setAttribute('x', String(ottavaStartX));
                txt.setAttribute('y', String(y + 3));
                txt.setAttribute('font-family', 'Times New Roman, serif');
                txt.setAttribute('font-style', 'italic');
                txt.setAttribute('font-size', '11');
                txt.setAttribute('fill', '#333');
                txt.textContent = label;
                svg.appendChild(txt);
                // end tick
                const tick = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                tick.setAttribute('x1', String(endX + 4));
                tick.setAttribute('y1', String(y));
                tick.setAttribute('x2', String(endX + 4));
                tick.setAttribute('y2', String(y + 8));
                tick.setAttribute('stroke', '#333');
                tick.setAttribute('stroke-width', '1.2');
                svg.appendChild(tick);
                ottavaActive = null;
              }
            }
          }

          flatIdx++;
        }
      }
      // Draw intro brackets — small arcs inside bracketed measures
      const drawArc = (cx: number, top: number, bot: number, openSide: boolean) => {
        const h = bot - top;
        const bulge = Math.min(h * 0.18, 6);
        const d = openSide
          ? `M ${cx} ${top} Q ${cx - bulge} ${(top + bot) / 2} ${cx} ${bot}`
          : `M ${cx} ${top} Q ${cx + bulge} ${(top + bot) / 2} ${cx} ${bot}`;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', d);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', '#444');
        path.setAttribute('stroke-width', '1.8');
        svg.appendChild(path);
      };
      let bi = 0;
      while (bi < data.measures.length) {
        if (data.measures[bi].bracket) {
          const groupStart = bi;
          while (bi < data.measures.length && data.measures[bi].bracket) bi++;
          const groupEnd = bi - 1;
          const pStart = stavePositions[groupStart];
          const pEnd = stavePositions[groupEnd];
          if (pStart && pEnd) {
            const top = pStart.y + 28;
            const bot = pStart.y + LINE_HEIGHT - 50;
            drawArc(pStart.x + 2, top, bot, true);
            drawArc(pEnd.x + pEnd.w * 0.55, top, bot, false);
          }
        } else {
          bi++;
        }
      }
    }

    // Store measure rects for highlight
    measureRectsRef.current = stavePositions;

    // Store SVG elements for note highlighting
    const noteMap = new Map<string, SVGElement>();
    let fi = 0;
    for (let mi = 0; mi < data.measures.length; mi++) {
      for (let ni = 0; ni < data.measures[mi].notes.length; ni++) {
        const vn = allVfNotes[fi];
        if (vn) {
          const noteEl = vn.getSVGElement?.() as SVGGraphicsElement | undefined;
          if (noteEl) noteMap.set(`${mi}-${ni}`, noteEl);
        }
        fi++;
      }
    }
    noteElMapRef.current = noteMap;
    } // end renderLick
  }, [visible, width, containerW, lick]);

  const keyNorm = (() => {
    const k = lick.key || '';
    if (k.endsWith('-min')) return k.slice(0, -4) + 'm';
    if (k.endsWith('-maj')) return k.slice(0, -4);
    return k || '?';
  })();

  return (
    <Card style={onClick ? { cursor: 'pointer' } : undefined} onClick={onClick}>
      {countIn.overlay}
      <MetaRow>
        <LickId>#{displayId ?? lick.id}</LickId>
        <Performer>{lick.performer}</Performer>
        <Title>{lick.title}</Title>
        <PlayBtn $active={playing} onClick={(e) => { e.stopPropagation(); togglePlay(); }} style={{ color: '#2a6e3f', borderColor: '#2a6e3f' }}>
          {playing ? '\u23F9 Stop' : '\u25B6 Play'}
        </PlayBtn>
        <BpmInput
          type="text"
          inputMode="numeric"
          value={bpmText}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = e.target.value.replace(/[^0-9]/g, '');
            setBpmText(v);
            const n = Number(v);
            if (n >= 20 && n <= 400) setBpm(n);
          }}
          onBlur={() => {
            const n = Math.max(20, Math.min(400, Number(bpmText) || defaultBpm));
            setBpm(n);
            setBpmText(String(n));
          }}
          title="BPM"
        />
        {video && (
          <PlayBtn
            onClick={(e) => { e.stopPropagation(); setShowVideo((v) => !v); }}
            style={{ color: '#c4302b', borderColor: '#c4302b', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            title={showVideo ? '\uC6D0\uBCF8 \uC601\uC0C1 \uB2EB\uAE30' : '\uC6D0\uBCF8 \uC601\uC0C1 \uBCF4\uAE30'}
          >
            <svg width="14" height="10" viewBox="0 0 24 17" aria-hidden>
              <path fill="#c4302b" d="M23.5 2.6a3 3 0 0 0-2.1-2.1C19.5 0 12 0 12 0S4.5 0 2.6.5A3 3 0 0 0 .5 2.6 31 31 0 0 0 0 8.5c0 2 .2 4 .5 5.9a3 3 0 0 0 2.1 2.1C4.5 17 12 17 12 17s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.3-1.9.5-3.9.5-5.9 0-2-.2-4-.5-5.9z"/>
              <path fill="#fff" d="M9.6 12.1V4.9L15.8 8.5z"/>
            </svg>
            YouTube
          </PlayBtn>
        )}
        {!video && (
          <PlayBtn
            onClick={(e) => { e.stopPropagation(); window.open(lickYoutubeSearchUrl(lick), '_blank', 'noopener,noreferrer'); }}
            style={{ color: '#c4302b', borderColor: '#c4302b', display: 'inline-flex', alignItems: 'center', gap: 4 }}
            title="원곡을 유튜브에서 검색"
          >
            <svg width="14" height="10" viewBox="0 0 24 17" aria-hidden>
              <path fill="#c4302b" d="M23.5 2.6a3 3 0 0 0-2.1-2.1C19.5 0 12 0 12 0S4.5 0 2.6.5A3 3 0 0 0 .5 2.6 31 31 0 0 0 0 8.5c0 2 .2 4 .5 5.9a3 3 0 0 0 2.1 2.1C4.5 17 12 17 12 17s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1c.3-1.9.5-3.9.5-5.9 0-2-.2-4-.5-5.9z"/>
              <path fill="#fff" d="M9.6 12.1V4.9L15.8 8.5z"/>
            </svg>
            원곡 찾기
          </PlayBtn>
        )}
        {onEdit && (
          <PlayBtn onClick={(e) => { e.stopPropagation(); onEdit(); }} style={{ color: '#1565c0', borderColor: '#90caf9' }} title="Edit">
            {'✎ Edit'}
          </PlayBtn>
        )}
        {onDelete && (
          <PlayBtn onClick={(e) => { e.stopPropagation(); onDelete(); }} style={{ color: '#c62828', borderColor: '#e57373' }} title="Delete">
            {'\u{1F5D1} Delete'}
          </PlayBtn>
        )}
        {onTranspose && (
          <PlayBtn
            onClick={(e) => { e.stopPropagation(); onTranspose(); }}
            style={{ color: '#7b1fa2', borderColor: '#ce93d8' }}
            title="Transpose (change original key)"
          >
            {'⇋ Transpose'}
          </PlayBtn>
        )}
        {onPractice && (
          <PlayBtn
            onClick={(e) => { e.stopPropagation(); onPractice(); }}
            style={{ color: '#1b6b4f', borderColor: '#86c7ab' }}
            title="12키 연습 (4도권)"
          >
            {'🎹 12키 연습'}
          </PlayBtn>
        )}
      </MetaRow>
      {!compact && (
        <TagRow>
          <Badge>{keyNorm}</Badge>
          <Badge $color="#e8eef5">{lick.style}</Badge>
          <Badge $color="#eee">{formatInstrument(lick.instrument)}</Badge>
          {lick.tempo && <Badge $color="#f5f0e0">{lick.tempo} bpm</Badge>}
          <Badge $color="#f0eee8">{lick.rhythmfeel}</Badge>
          <Badge $color="#ede8f0">{lick.tag}</Badge>
        </TagRow>
      )}
      {compact && (
        <TagRow>
          <Badge>{keyNorm}</Badge>
          <Badge $color="#eee">{formatInstrument(lick.instrument)}</Badge>
        </TagRow>
      )}
      {visible ? (
        <SvgWrap ref={svgRef} $scroll={scrollable} />
      ) : (
        <Placeholder>scroll to render</Placeholder>
      )}
      {visible && video && showVideo && (
        <YoutubeEmbed videoId={video.videoId} startSec={video.startSec} endSec={video.endSec} autoplay />
      )}
    </Card>
  );
}
