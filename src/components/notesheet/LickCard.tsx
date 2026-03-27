import { useEffect, useRef, useState, useCallback } from 'react';
import styled from 'styled-components';
import {
  Renderer,
  Stave,
  StaveNote,
  Voice,
  Formatter,
  Beam,
  Accidental,
  Dot,
  Annotation,
  Barline,
  BarlineType,
} from 'vexflow';
import type { NoteSheetData, MeasureInfo } from '../../data/sampleMelody';
import type { LickEntry } from '../../data/lickData';
import { NotePlayer } from '../../lib/note/notePlayer';

/* ─── layout constants ──────────────────────────────────────────────── */

const LINE_HEIGHT = 160;
const MARGIN = { top: 40, left: 10, right: 10, bottom: 10 };
const CHORD_FONT = "'MuseJazz Text', 'DM Sans', sans-serif";

/**
 * Replace text chord tokens with proper music symbols.
 * Data format: j7=maj7, Ab=A♭, -=minor, o=dim, +=aug, b5=♭5, 9#=♯9
 */
function formatChord(raw: string): string {
  return raw
    .replace(/j7/g, '\u25B37')                    // j7 → △7
    .replace(/(?<=[A-G])b(?=[^a-z]|$)/g, '\u266D') // Ab → A♭ (root flat)
    .replace(/(\d)b/g, '$1\u266D')                 // 5b, 9b, 13b → 5♭, 9♭, 13♭
    .replace(/b(\d)/g, '\u266D$1')                 // b5, b9, b13 → ♭5, ♭9, ♭13
    .replace(/(\d)#/g, '$1\u266F')                 // 9# → 9♯
    .replace(/#(\d)/g, '\u266F$1')                 // #9 → ♯9
    .replace(/-/g, 'm')                            // - → m (minor)
    .replace(/o7/g, '\u00B07')                     // o7 → °7
    .replace(/o(?!\d)/g, '\u00B0');                // o → °
}
const DECOR_FIRST = 80;

/* ─── styled ────────────────────────────────────────────────────────── */

const Card = styled.div`
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  padding: 12px 20px 8px;

  &:hover {
    background: ${({ theme }) => theme.colors.bgSecondary};
  }
`;

const MetaRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 2px;
`;

const LickId = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.72rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  opacity: 0.6;
`;

const Performer = styled.span`
  font-family: "MuseJazz Text", 'DM Sans', sans-serif;
  font-size: 1rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Title = styled.span`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.88rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const TagRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 24px;
`;

const Badge = styled.span<{ $color?: string }>`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 3px;
  background: ${({ $color }) => $color ?? '#f0ebe0'};
  color: #555;
`;

const ChordBadge = styled(Badge)`
  font-family: 'DM Sans', sans-serif;
  font-size: 0.78rem;
  background: #efe8d4;
  color: #8B6914;
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

const SvgWrap = styled.div`
  overflow-x: auto;
`;

const Placeholder = styled.div`
  height: 140px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-family: 'DM Sans', sans-serif;
  font-size: 0.8rem;
  opacity: 0.4;
`;

/* ─── helpers ───────────────────────────────────────────────────────── */

function buildDuration(dur: string, dotted?: boolean): string {
  if (!dotted) return dur;
  if (dur.endsWith('r')) return dur.slice(0, -1) + 'd' + 'r';
  return dur + 'd';
}

function buildVfNotes(measure: MeasureInfo): StaveNote[] {
  return measure.notes.map((n) => {
    const isRest = n.duration.endsWith('r');
    const dur = buildDuration(n.duration, n.dotted);
    const note = new StaveNote({
      keys: isRest ? ['b/4'] : n.keys,
      duration: dur,
      autoStem: true,
    });
    if (n.dotted) Dot.buildAndAttach([note]);
    if (!isRest && n.accidentals) {
      for (const [idx, type] of Object.entries(n.accidentals)) {
        note.addModifier(new Accidental(type), Number(idx));
      }
    }
    return note;
  });
}

/* ─── component ─────────────────────────────────────────────────────── */

interface LickCardProps {
  lick: LickEntry;
  width: number;
  visible: boolean;
}

export function LickCard({ lick, width, visible }: LickCardProps) {
  const svgRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);

  /* player */
  const playerRef = useRef<NotePlayer | null>(null);
  const [playing, setPlaying] = useState(false);

  const togglePlay = useCallback(async () => {
    if (!playerRef.current) {
      const p = new NotePlayer();
      p.onDone = () => setPlaying(false);
      playerRef.current = p;
    }
    const p = playerRef.current;
    if (p.playing) {
      p.stop();
      setPlaying(false);
    } else {
      setPlaying(true);
      await p.play(lick.sheetData, lick.tempo ?? 120);
    }
  }, [lick]);

  // cleanup on unmount
  useEffect(() => () => { playerRef.current?.dispose(); }, []);

  // stop if lick changes while playing
  useEffect(() => {
    playerRef.current?.stop();
    setPlaying(false);
    renderedRef.current = false;
  }, [lick.id]);

  /* render notation when visible */
  useEffect(() => {
    const el = svgRef.current;
    if (!el || !visible || renderedRef.current) return;
    if (!lick.sheetData.measures.length) return;

    renderedRef.current = true;
    el.innerHTML = '';

    const data = lick.sheetData;
    const nMeasures = data.measures.length;
    const [numBeats, beatValue] = data.timeSignature.split('/').map(Number);

    // Width per measure proportional to note count
    const PX_PER_NOTE = 40;
    const BAR_PAD = 30;
    const weights = data.measures.map((m) => BAR_PAD + m.notes.length * PX_PER_NOTE);
    const totalWeight = weights.reduce((s, w) => s + w, 0);
    const containerW = width - MARGIN.left - MARGIN.right;
    const needsScroll = totalWeight + DECOR_FIRST > containerW;
    const availW = needsScroll ? totalWeight : containerW - DECOR_FIRST;
    const scale = availW / totalWeight;
    const barWidths = weights.map((w) => w * scale);

    const svgW = MARGIN.left + DECOR_FIRST + availW + MARGIN.right;
    const totalH = MARGIN.top + LINE_HEIGHT + MARGIN.bottom;

    const renderer = new Renderer(el, Renderer.Backends.SVG);
    renderer.resize(svgW, totalH);
    const ctx = renderer.getContext();

    let x = MARGIN.left;

    for (let m = 0; m < nMeasures; m++) {
      const isFirst = m === 0;
      const isLast = m === nMeasures - 1;
      const w = isFirst ? barWidths[m] + DECOR_FIRST : barWidths[m];

      const stave = new Stave(x, MARGIN.top, w);
      if (isFirst) {
        stave.addClef('treble');
        if (data.key && data.key !== 'C') stave.addKeySignature(data.key);
        stave.addTimeSignature(data.timeSignature);
      }
      if (isLast) stave.setEndBarType(BarlineType.END);
      stave.setContext(ctx).draw();

      const measure = data.measures[m];
      const vfNotes = buildVfNotes(measure);

      if (measure.chord && vfNotes.length > 0) {
        const ann = new Annotation(formatChord(measure.chord));
        ann.setFont(CHORD_FONT, 16, 'bold');
        ann.setVerticalJustification(Annotation.VerticalJustify.TOP);
        vfNotes[0].addModifier(ann);
      }

      const beams = Beam.generateBeams(vfNotes);
      const voice = new Voice({ numBeats, beatValue });
      voice.setStrict(false);
      voice.addTickables(vfNotes);

      new Formatter().joinVoices([voice]).formatToStave([voice], stave);
      voice.draw(ctx, stave);
      beams.forEach((b) => b.setContext(ctx).draw());

      x += w;
    }
  }, [visible, width, lick]);

  const keyNorm = lick.key.split('-')[0] || '?';

  return (
    <Card>
      <MetaRow>
        <LickId>#{lick.id}</LickId>
        <Performer>{lick.performer}</Performer>
        <Title>{lick.title}</Title>
        <PlayBtn $active={playing} onClick={togglePlay}>
          {playing ? '\u23F9' : '\u25B6'}
        </PlayBtn>
      </MetaRow>
      <TagRow>
        <Badge>{keyNorm}</Badge>
        <Badge $color="#e8eef5">{lick.style}</Badge>
        <Badge $color="#eee">{lick.instrument}</Badge>
        {lick.tempo && <Badge $color="#f5f0e0">{lick.tempo} bpm</Badge>}
        <Badge $color="#f0eee8">{lick.rhythmfeel}</Badge>
        <Badge $color="#ede8f0">{lick.tag}</Badge>
        <Badge $color="#e8f0e8">{lick.nEvents} notes</Badge>
        {lick.chords.map((c, i) => (
          <ChordBadge key={i}>{formatChord(c)}</ChordBadge>
        ))}
      </TagRow>
      {visible ? (
        <SvgWrap ref={svgRef} />
      ) : (
        <Placeholder>scroll to render</Placeholder>
      )}
    </Card>
  );
}
