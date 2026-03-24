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
const BARLINE_PAD  = 18;  // px — left padding reserved for barline decoration
const BAR_H        = 78;  // px — row height (snug around chord content)
const BARLINE_GAP  = 6;   // px — vertical inset at top/bottom of each barline
const ROW_GAP      = 36;  // px — space between rows (extra room for bigger labels)
const LABEL_OFFSET = 26;  // px — how far the section label floats above the grid
const CHORD_FONT   = "'MuseJazz Text', 'Oswald', 'DM Sans', sans-serif";
const LABEL_FONT   = "'DM Sans', 'Pretendard', sans-serif"; // gothic for A/B labels

/* ─── page ───────────────────────────────────────────────────────────────── */

const ViewerOuter = styled.div`
  flex: 1;
  overflow: auto;
  background: ${({ theme }) => theme.colors.bgSecondary};
  display: flex;
  justify-content: center;
  padding: 24px;
  /* container queries — child styled components use cqi units */
  container-type: inline-size;
  container-name: leadsheet;
`;

const Page = styled.div`
  background: #fff;
  width: 100%;
  align-self: flex-start;
  box-shadow: ${({ theme }) => theme.shadows.xl};
  border-radius: 4px;
  padding: 36px 32px 48px;
  font-family: ${CHORD_FONT};
  color: #000;
`;

/* ─── header ─────────────────────────────────────────────────────────────── */

const SheetTitle = styled.h1`
  text-align: center;
  font-size: clamp(1.6rem, 4.5cqi, 3.0rem);
  font-weight: 700;
  letter-spacing: 0.06em;
  margin: 0 0 6px;
  font-family: ${CHORD_FONT};
`;

const MetaRow = styled.div`
  display: flex;
  justify-content: space-between;
  font-size: clamp(1.0rem, 1.8cqi, 1.3rem);
  font-family: 'DM Sans', sans-serif;
  font-weight: 400;
  margin-bottom: 28px;
`;

/* ─── system row ─────────────────────────────────────────────────────────── */

const SystemRow = styled.div`
  display: flex;
  align-items: stretch;
  margin-bottom: ${ROW_GAP}px;
  /* overflow visible so the section label can float above the grid */
  position: relative;
  overflow: visible;
`;

/* Left column: time-sig lives here (only row 1); always same width so that
   the bars grid starts at the same x-position on every row.             */
const LeftMeta = styled.div`
  width: 56px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: 6px;
`;

const TimeSig = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  font-size: 2.6rem;
  font-weight: 700;
  line-height: 1;
  font-family: ${CHORD_FONT};
`;

const TimeSigDivider = styled.div`
  width: 100%;
  height: 2px;
  background: #000;
  margin: 1px 0;
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

/* Floats above the top-left corner of the bars grid */
const SectionLabel = styled.div`
  position: absolute;
  top: -${LABEL_OFFSET}px;
  left: 0;
  background: #000;
  color: #fff;
  font-family: ${LABEL_FONT};
  font-size: clamp(0.75rem, 1.8cqi, 1.1rem);
  font-weight: 800;
  line-height: 1;
  padding: 3px 7px 3px 6px;
  letter-spacing: 0.02em;
  z-index: 3;
`;

/* ─── bar cell ───────────────────────────────────────────────────────────── */

/* Each bar cell has a left padding equal to BARLINE_PAD.
   display:flex + align-items:center keeps chord content vertically centred
   regardless of BAR_H — barlines are absolute so they always span the full
   cell, giving a uniform line length across every bar in the row.        */
const BarCell = styled.div`
  position: relative;
  min-height: ${BAR_H}px;
  display: flex;
  align-items: center;
  padding: 0 6px 0 ${BARLINE_PAD}px;
`;

/* Barline decoration area — sits inside the BARLINE_PAD space on the left.
   BARLINE_GAP creates white space above and below so barlines don't touch
   across rows — giving the classic lead-sheet "floating bar" look.       */
const BarlineArea = styled.div`
  position: absolute;
  left: 0;
  top: ${BARLINE_GAP}px;
  bottom: ${BARLINE_GAP}px;
  width: ${BARLINE_PAD}px;
  display: flex;
  align-items: stretch;
`;

/* End barline — on the right edge of the 4th bar cell */
const EndBarlineArea = styled.div`
  position: absolute;
  right: 0;
  top: ${BARLINE_GAP}px;
  bottom: ${BARLINE_GAP}px;
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

/* ─── bar section layout ─────────────────────────────────────────────────────
 *  A bar is always divided into 2 equal SECTIONS (half-note units in 4/4).
 *  Each section holds 1 or 2 chords.  When a section holds 2 chords the
 *  chord symbols are scaled down ($compact) so they fit comfortably.
 * ────────────────────────────────────────────────────────────────────────── */

/** Split a bar's chord array into [section1, section2]. */
function splitSections(chords: LeadSheetChord[]): [LeadSheetChord[], LeadSheetChord[]] {
  const n = chords.length;
  if (n <= 1) return [chords, []];          // single chord: full-width
  const mid = Math.floor(n / 2);            // 2→[1,1]  3→[1,2]  4→[2,2]
  return [chords.slice(0, mid), chords.slice(mid)];
}

/* Two equal columns, one per section */
const BarSections = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  width: 100%;
`;

/* One section slot; flex so 2 chords sit side-by-side with a small gap */
const SectionSlot = styled.div`
  display: flex;
  align-items: flex-end;
  gap: 3px;
`;

/* ─── chord symbol ───────────────────────────────────────────────────────── */

const ChordWrap = styled.span`
  display: inline-flex;
  align-items: flex-end;
  line-height: 1;
`;

/* $compact = true when 2 chords share a single half-bar section.
   All font sizes use clamp(min, X cqi, max) so they scale smoothly as the
   lead-sheet panel is resized (cqi = 1% of the container inline size).    */
const Root = styled.span<{ $compact?: boolean }>`
  font-size: ${({ $compact }) =>
    $compact
      ? 'clamp(1.0rem, 3.7cqi, 2.2rem)'
      : 'clamp(1.5rem, 5.8cqi, 3.5rem)'};
  font-weight: 700;
  line-height: 0.88;
  letter-spacing: -0.01em;
  font-family: ${CHORD_FONT};
`;

/* ── AccQualStack: stacks accidental (top) + quality (bottom) ────────────
 * By sharing one horizontal slot the quality never drifts right when an
 * accidental is present (e.g. C♯-7 vs C-7 stay visually aligned).       */
const AccQualStack = styled.span`
  display: inline-flex;
  flex-direction: column;
  justify-content: space-between;
  align-self: stretch;  /* matches Root height → acc at top, quality at bottom */
`;

/* Top-slot wrapper — always rendered; holds Acc when present, empty otherwise */
const AccTopSlot = styled.span`
  line-height: 1;
`;

const Acc = styled.span<{ $compact?: boolean }>`
  font-size: ${({ $compact }) =>
    $compact
      ? 'clamp(0.55rem, 1.9cqi, 1.1rem)'
      : 'clamp(0.8rem,  3.0cqi, 1.8rem)'};
  font-weight: 700;
  font-family: ${CHORD_FONT};
  line-height: 1;
`;

/* Quality is intentionally larger than before — user requested bigger size */
const Quality = styled.span<{ $compact?: boolean }>`
  font-size: ${({ $compact }) =>
    $compact
      ? 'clamp(0.6rem,  1.8cqi, 1.1rem)'
      : 'clamp(0.9rem,  2.9cqi, 1.7rem)'};
  font-weight: 600;
  font-family: ${CHORD_FONT};
  line-height: 1;
  padding-bottom: 1px;
`;

const TensionSpan = styled.span<{ $compact?: boolean }>`
  font-size: ${({ $compact }) =>
    $compact
      ? 'clamp(0.35rem, 1.2cqi, 0.7rem)'
      : 'clamp(0.45rem, 1.6cqi, 1.0rem)'};
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

interface ChordSymbolProps {
  chord: LeadSheetChord;
  compact?: boolean;   // true when 2 chords share one half-bar section
}

function ChordSymbol({ chord, compact = false }: ChordSymbolProps) {
  if (chord.isRepeat) return <SimileSign />;

  const accChar =
    chord.accidental === '#' ? '♯' :
    chord.accidental === 'b' ? '♭' : null;

  const [base, tensions] = chord.quality
    ? splitQuality(normalizeQuality(chord.quality))
    : ['', ''];

  const hasQuality = !!(base || tensions);

  return (
    <ChordWrap>
      <Root $compact={compact}>{chord.root}</Root>

      {/* AccQualStack: acc (top) and quality (bottom) share one horizontal slot.
          This prevents quality from drifting right when an accidental is present. */}
      {(accChar || hasQuality) && (
        <AccQualStack>
          {/* top slot — empty span keeps space-between working when no acc */}
          <AccTopSlot>
            {accChar && <Acc $compact={compact}>{accChar}</Acc>}
          </AccTopSlot>
          {hasQuality && (
            <Quality $compact={compact}>
              {base}
              {tensions && <TensionSpan $compact={compact}>{tensions}</TensionSpan>}
            </Quality>
          )}
        </AccQualStack>
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
            <TimeSigDivider />
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

              {/* Chord content — always split into 2 equal sections */}
              {(() => {
                const [s1, s2] = splitSections(bar.chords);
                // Single chord: render full-width (no grid split needed)
                if (s2.length === 0) {
                  return s1.map((chord, j) => (
                    <ChordSymbol key={j} chord={chord} />
                  ));
                }
                // 2+ chords: two equal-width sections
                return (
                  <BarSections>
                    <SectionSlot>
                      {s1.map((chord, j) => (
                        <ChordSymbol key={j} chord={chord} compact={s1.length > 1} />
                      ))}
                    </SectionSlot>
                    <SectionSlot>
                      {s2.map((chord, j) => (
                        <ChordSymbol key={j} chord={chord} compact={s2.length > 1} />
                      ))}
                    </SectionSlot>
                  </BarSections>
                );
              })()}
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
