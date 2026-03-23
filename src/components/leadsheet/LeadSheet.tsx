import styled from 'styled-components';
import type {
  LeadSheetData,
  LeadSheetSystem,
  LeadSheetChord,
} from '../../data/leadSheetTypes';

/* ─── constants ──────────────────────────────────────────────────────────────
 *  BARLINE_PAD = left padding reserved inside every bar cell for the barline.
 *  All four bar cells always have the same padding, so chords stay perfectly
 *  column-aligned regardless of the barline type (normal / section / repeat).
 * ────────────────────────────────────────────────────────────────────────── */
const BARLINE_PAD = 18; // px
const BAR_H      = 94;  // px min-height per row
const CHORD_FONT = "'Oswald', 'DM Sans', sans-serif";

/* ─── page ───────────────────────────────────────────────────────────────── */

const ViewerOuter = styled.div`
  flex: 1;
  overflow: auto;
  background: ${({ theme }) => theme.colors.bgSecondary};
  display: flex;
  justify-content: center;
  padding: 24px;
`;

const Page = styled.div`
  background: #fff;
  width: 100%;
  max-width: 800px;
  align-self: flex-start;
  box-shadow: ${({ theme }) => theme.shadows.xl};
  border-radius: 4px;
  padding: 36px 44px 48px;
  font-family: ${CHORD_FONT};
  color: #000;
`;

/* ─── header ─────────────────────────────────────────────────────────────── */

const SheetTitle = styled.h1`
  text-align: center;
  font-size: 1.3rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  margin: 0 0 4px;
  font-family: ${CHORD_FONT};
`;

const MetaRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: 0.88rem;
  font-family: 'DM Sans', sans-serif;
  font-weight: 400;
  margin-bottom: 18px;
`;

/* ─── system row ─────────────────────────────────────────────────────────── */

const SystemRow = styled.div`
  display: flex;
  align-items: stretch;
`;

/* Left column: time-sig lives here (only row 1); always same width so that
   the bars grid starts at the same x-position on every row.             */
const LeftMeta = styled.div`
  width: 50px;
  flex-shrink: 0;
  display: flex;
  align-items: flex-start;
  justify-content: flex-end;
  padding-right: 4px;
  padding-top: 6px;
`;

const TimeSig = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 1.55rem;
  font-weight: 700;
  line-height: 1.05;
  font-family: ${CHORD_FONT};
`;

/* ─── bars grid ──────────────────────────────────────────────────────────── */

/* 4 equal columns. Barlines are absolute overlays so they never affect
   the column widths — this is what keeps chords vertically aligned.    */
const BarsGrid = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  position: relative; /* anchor for SectionLabel */
`;

/* ─── section label ──────────────────────────────────────────────────────── */

const SectionLabel = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  background: #000;
  color: #fff;
  font-family: ${CHORD_FONT};
  font-size: 0.6rem;
  font-weight: 700;
  line-height: 1;
  padding: 2px 4px 2px 3px;
  z-index: 3;
`;

/* ─── bar cell ───────────────────────────────────────────────────────────── */

/* Each bar cell has a left padding equal to BARLINE_PAD.
   The barline decoration is absolutely positioned inside that padding area.
   This keeps the chord content width identical for all 4 columns.       */
const BarCell = styled.div`
  position: relative;
  min-height: ${BAR_H}px;
  padding: 10px 6px 8px ${BARLINE_PAD}px;
`;

/* Barline decoration area — sits inside the BARLINE_PAD space on the left */
const BarlineArea = styled.div`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: ${BARLINE_PAD}px;
  display: flex;
  align-items: stretch;
`;

/* End barline — on the right edge of the 4th bar cell */
const EndBarlineArea = styled.div`
  position: absolute;
  right: 0;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: stretch;
`;

/* ─── chord quality normalisation ───────────────────────────────────────────
 * Converts all common chord quality notations (iReal Pro, lead-sheet, etc.)
 * to the standard jazz symbols used on this sheet:
 *
 *   M7 / maj7 / ^7 / Δ7  →  △7   (major-seven triangle)
 *   m  / min  / -        →  -    (minus = minor)
 *   m7 / min7 / -7       →  -7
 *   dim / o              →  °    (degree sign = diminished)
 *   dim7 / o7            →  °7
 *   h  / m7b5 / -7b5     →  ø    (ø = half-diminished)
 *   h7 / m7b5 (with 7)   →  ø7
 *   -maj7 / mMaj7        →  -△7  (minor-major seven)
 *
 * The function only replaces the quality PREFIX; any tensions / alterations
 * that follow (b9, #11, b13 …) are preserved verbatim.
 * ────────────────────────────────────────────────────────────────────────── */

/** [prefix-regex, replacement] pairs – evaluated in order (specific first). */
const QUALITY_PREFIXES: [RegExp, string][] = [
  // ── Half-diminished ──────────────────────────────────────────────────────
  [/^(-7b5|-7\(b5\)|m7b5)/,                         'ø7'],
  [/^h(?=\d)/,                                        'ø'],   // h7 → ø7, h9 → ø9
  [/^h$/,                                             'ø'],   // bare h → ø
  // ── Diminished ───────────────────────────────────────────────────────────
  [/^(dim7|o7)/,                                      '°7'],
  [/^(dim|o)(?!\d)/,                                  '°'],   // o alone (lookahead avoids matching o7 here)
  // ── Minor-Major 7 (before both minor and major checks) ───────────────────
  [/^(-[Mm]aj7|-△7|-Δ7|-\^7|m[Mm]aj7|mM7)/,         '-△7'],
  // ── Major 7 ──────────────────────────────────────────────────────────────
  [/^(Δ7|△7|\^7|[Mm]aj7|M7)/,                        '△7'],
  // ── Major (triad / with extension number) ────────────────────────────────
  [/^(Δ|△|\^|[Mm]aj(?!7)|M(?=[69]|$))/,              '△'],
  // ── Minor 7 (before bare-minor check) ────────────────────────────────────
  [/^(-7(?!b5)|m7(?!b5)|min7)/,                       '-7'],
  // ── Minor (triad / with extension) ───────────────────────────────────────
  [/^(-(?!\d)|m(?!aj|7|in)|min(?!7))/,                '-'],
];

function normalizeQuality(raw: string): string {
  if (!raw) return '';
  const s = raw.trim();
  for (const [re, rep] of QUALITY_PREFIXES) {
    const match = s.match(re);
    if (match) return rep + s.slice(match[0].length);
  }
  return s;
}

/* ─── chord content ──────────────────────────────────────────────────────── */

const ChordRow = styled.div<{ count: number }>`
  display: flex;
  align-items: flex-end;
  gap: ${({ count }) => (count > 1 ? '8px' : '0')};
`;

/* ─── chord symbol ───────────────────────────────────────────────────────── */

const ChordWrap = styled.span`
  display: inline-flex;
  align-items: flex-end;
  line-height: 1;
`;

const Root = styled.span`
  font-size: 2.9rem;
  font-weight: 700;
  line-height: 0.88;
  letter-spacing: -0.01em;
  font-family: ${CHORD_FONT};
`;

const Acc = styled.span`
  font-size: 1.5rem;
  font-weight: 700;
  align-self: flex-start;
  margin-top: 1px;
  font-family: ${CHORD_FONT};
`;

/* Quality wraps the chord type (△7, -7, °7 …) plus any tensions (b9 #11 …).
   The TensionSpan inside is rendered slightly smaller so alterations read
   clearly without competing with the base quality symbol.                   */
const Quality = styled.span`
  font-size: 1.2rem;
  font-weight: 600;
  align-self: flex-end;
  padding-bottom: 1px;
  font-family: ${CHORD_FONT};
`;

const TensionSpan = styled.span`
  font-size: 0.82rem;
  font-weight: 600;
  font-family: ${CHORD_FONT};
`;

/* ─── quality string → [base, tensions] ─────────────────────────────────────
 * After normalisation, optional tension tokens (b5 #5 b9 #9 #11 b13 alt …)
 * that trail the base quality are split off for lighter rendering.          */
function splitQuality(normalized: string): [base: string, tensions: string] {
  // Base is: optional quality char(s) + optional extension number + optional sus
  // Tensions: one or more of (b|#)<digits> or 'alt', optionally in parens
  const m = normalized.match(
    /^(△7?|-7?|°7?|ø7?|-△7?|[0-9]+(?:sus[24]?)?|sus[24]?|add\d+)?(.*)/,
  );
  if (m) {
    const base = m[1] ?? normalized;
    const rest = (m[2] ?? '').replace(/[()]/g, ''); // strip optional parens
    if (rest && /^(?:[b#]\d+|alt)+$/.test(rest)) {
      return [base, rest];
    }
  }
  return [normalized, ''];
}

/* ─── simile sign (one-bar repeat %) ─────────────────────────────────────── */

function SimileSign() {
  return (
    <svg
      width="40"
      height="50"
      viewBox="0 0 40 50"
      style={{ display: 'block', marginTop: '4px' }}
    >
      <circle cx="9"  cy="12" r="5.5" fill="black" />
      <line
        x1="7" y1="41" x2="33" y2="9"
        stroke="black" strokeWidth="3.5" strokeLinecap="round"
      />
      <circle cx="31" cy="38" r="5.5" fill="black" />
    </svg>
  );
}

/* ─── ChordSymbol ─────────────────────────────────────────────────────────── */

function ChordSymbol({ chord }: { chord: LeadSheetChord }) {
  if (chord.isRepeat) return <SimileSign />;

  const accChar =
    chord.accidental === '#' ? '♯' :
    chord.accidental === 'b' ? '♭' : null;

  const [base, tensions] = chord.quality
    ? splitQuality(normalizeQuality(chord.quality))
    : ['', ''];

  return (
    <ChordWrap>
      <Root>{chord.root}</Root>
      {accChar && <Acc>{accChar}</Acc>}
      {(base || tensions) && (
        <Quality>
          {base}
          {tensions && <TensionSpan>{tensions}</TensionSpan>}
        </Quality>
      )}
    </ChordWrap>
  );
}

/* ─── barline rendering helpers ──────────────────────────────────────────── */

function NormalLine() {
  return <div style={{ width: '1.5px', background: '#000', alignSelf: 'stretch' }} />;
}

/* section-start: two thin lines (||) */
function SectionStartBarline() {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: '100%', gap: '3px' }}>
      <div style={{ width: '1.5px', background: '#000' }} />
      <div style={{ width: '1.5px', background: '#000' }} />
    </div>
  );
}

/* repeat-start: thick | thin  ●
 *                             ●                                           */
function RepeatStartBarline() {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: '100%' }}>
      <div style={{ width: '4px',   background: '#000' }} />
      <div style={{ width: '1.5px', background: '#000', marginLeft: '2px' }} />
      <div style={{
        display: 'flex', flexDirection: 'column',
        justifyContent: 'center', gap: '7px', paddingLeft: '3px',
      }}>
        <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#000' }} />
        <div style={{ width: '5px', height: '5px', borderRadius: '50%', background: '#000' }} />
      </div>
    </div>
  );
}

/* double end: thin | thick */
function DoubleEndBarline() {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', height: '100%', gap: '2px' }}>
      <div style={{ width: '1.5px', background: '#000' }} />
      <div style={{ width: '4px',   background: '#000' }} />
    </div>
  );
}

type LeftBarlineKind = 'normal' | 'section-start' | 'repeat-start';

function LeftBarline({ kind }: { kind: LeftBarlineKind }) {
  if (kind === 'repeat-start')  return <RepeatStartBarline />;
  if (kind === 'section-start') return <SectionStartBarline />;
  return <NormalLine />;
}

/* ─── SystemRowComponent ─────────────────────────────────────────────────── */

interface SystemRowProps {
  system: LeadSheetSystem;
  isFirst: boolean;
  timeSignature: string;
}

function SystemRowComponent({ system, isFirst, timeSignature }: SystemRowProps) {
  const [top, bot] = timeSignature.split('/');

  // Determine left barline style for the first bar of this row
  const firstBarlineKind: LeftBarlineKind =
    system.hasRepeatStart   ? 'repeat-start'  :
    (isFirst || system.sectionLabel) ? 'section-start' : 'normal';

  return (
    <SystemRow>
      {/* ── left meta (time sig, first row only) ── */}
      <LeftMeta>
        {isFirst && (
          <TimeSig>
            <span>{top}</span>
            <span>{bot}</span>
          </TimeSig>
        )}
      </LeftMeta>

      {/* ── bars grid ── */}
      <BarsGrid>
        {/* Section label floated over the top-left corner */}
        {system.sectionLabel && (
          <SectionLabel>{system.sectionLabel}</SectionLabel>
        )}

        {system.bars.map((bar, i) => {
          const isLastBar = i === system.bars.length - 1;
          const kind: LeftBarlineKind = i === 0 ? firstBarlineKind : 'normal';

          return (
            <BarCell key={i}>
              {/* Left barline (absolute, inside the BARLINE_PAD area) */}
              <BarlineArea>
                <LeftBarline kind={kind} />
              </BarlineArea>

              {/* End barline on the last bar */}
              {isLastBar && (
                <EndBarlineArea>
                  {system.hasRepeatEnd ? <DoubleEndBarline /> : <NormalLine />}
                </EndBarlineArea>
              )}

              {/* Chord content */}
              <ChordRow count={bar.chords.length}>
                {bar.chords.map((chord, j) => (
                  <ChordSymbol key={j} chord={chord} />
                ))}
              </ChordRow>
            </BarCell>
          );
        })}
      </BarsGrid>
    </SystemRow>
  );
}

/* ─── LeadSheet (public) ─────────────────────────────────────────────────── */

interface LeadSheetProps {
  data: LeadSheetData;
}

export function LeadSheet({ data }: LeadSheetProps) {
  return (
    <ViewerOuter>
      <Page>
        <SheetTitle>{data.title}</SheetTitle>
        <MetaRow>
          <span>({data.style})</span>
          <span>{data.composer}</span>
        </MetaRow>

        {data.systems.map((system, i) => (
          <SystemRowComponent
            key={i}
            system={system}
            isFirst={i === 0}
            timeSignature={data.timeSignature}
          />
        ))}
      </Page>
    </ViewerOuter>
  );
}
