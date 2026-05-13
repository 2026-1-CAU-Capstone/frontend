/**
 * Jazz-typeset chord notation utilities.
 *
 * Converts a ChordSymbol to the Unicode jazz display format used across
 * Jazzify (`-`/`△`/`°`/`ø`/`+`), and exposes a high-level normalizeChord()
 * that mirrors the legacy normalizeChord/normalizeSingleChord found in
 * LickInputPage/SoloGeneratorPage but uses the robust JJazzLab-style parser
 * underneath.
 *
 * Backward-compat goals:
 *   - "Cm7" / "Cmin7" / "Cmi7" / "C-7"  → "C-7"
 *   - "Cmaj7" / "CM7"                   → "C△7"
 *   - "Cdim" / "Co"                     → "C°"
 *   - "Cm7b5" / "Cmi7-5"                → "Cø7"
 *   - "Caug" / "C+"                     → "C+"
 *   - "C7b9" / "C7#11"                  → "C7b9" / "C7#11" (tensions stay ASCII)
 *   - Unrecognised input                → passthrough (graceful fallback)
 */
import { ChordSymbol } from './chord-symbol';
import type { ChordType } from './chord-type';

/** Map ChordType canonical name → jazz Unicode display fragment. */
export function chordTypeToJazzText(ct: ChordType): string {
  const name = ct.name;

  // ── Diminished family ────────────────────────────────────────────
  if (ct.family === 'DIMINISHED') {
    if (name === 'm7b5')   return 'ø7';
    if (name === 'm9b5')   return 'ø9';
    if (name === 'm11b5')  return 'ø11';
    if (name === 'dim')    return '°';
    if (name === 'dim7')   return '°7';
    if (name === 'dim7M')  return '°△7';
  }

  // ── Major family ─────────────────────────────────────────────────
  if (ct.family === 'MAJOR') {
    if (name === '') return '';                    // plain major triad
    if (name === '+') return '+';                  // augmented triad
    if (name === '6') return '6';
    if (name === '69') return '6/9';
    if (name.startsWith('M')) {                    // M7, M9, M13, M7b5, M7#5, M7#11, M9#11, M13#11, M7add13
      return '△' + name.substring(1);
    }
  }

  // ── Minor family ─────────────────────────────────────────────────
  if (ct.family === 'MINOR') {
    if (name === 'm')   return '-';
    if (name === 'm+')  return '-#5';
    if (name === 'm2')  return '-add9';
    if (name.startsWith('m')) {
      const tail = name.substring(1);
      // m7M → -△7 (minor-major)
      if (/^\d+M$/.test(tail)) return '-△' + tail.slice(0, -1);
      // m69 → -6/9
      if (tail === '69') return '-6/9';
      return '-' + tail;
    }
  }

  // SEVENTH family + SUS family: canonical names already work
  // ("7", "9", "13", "7b9", "7sus", "13sus", etc.)
  return name;
}

/** Render a ChordSymbol in Unicode jazz notation: root + quality + optional /bass. */
export function toJazzNotation(cs: ChordSymbol): string {
  const root = cs.rootNote.toRelativeString();
  const quality = chordTypeToJazzText(cs.chordType);
  const bass = cs.isSlashChord() ? '/' + cs.bassNote.toRelativeString() : '';
  return root + quality + bass;
}

/**
 * Normalise a chord-cell value — replacement for legacy normalizeChord().
 *
 * Supports:
 *   - Single chord: "Cm7" → "C-7"
 *   - Multiple chords separated by whitespace: "D-7 G7" → "D-7  G7"
 *     (uses 2-space separator so renderers that split on >=2 spaces still work)
 *   - Unrecognised input is returned unchanged.
 */
export function normalizeChord(raw: string): string {
  if (!raw) return raw;

  // Multi-chord cell ("D-7 G7" or "Dm7  G7") — recurse per token
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    return parts.map(normalizeChord).join('  ');
  }

  const single = parts[0] ?? '';
  if (!single) return raw;

  try {
    const cs = ChordSymbol.parse(single);
    return toJazzNotation(cs);
  } catch {
    // Preserve user input rather than break the cell
    return raw;
  }
}

/**
 * Like normalizeChord but also converts tension accidentals (b9, #11) to
 * Unicode (♭9, ♯11). Use for display contexts where typography matters more
 * than re-parseability.
 */
export function normalizeChordTypeset(raw: string): string {
  return normalizeChord(raw)
    .replace(/b(\d)/g, '♭$1')
    .replace(/#(\d)/g, '♯$1');
}

/** Does a string parse cleanly as a chord? */
export function isValidChord(raw: string): boolean {
  if (!raw || !raw.trim()) return false;
  try { ChordSymbol.parse(raw.trim()); return true; }
  catch { return false; }
}

/**
 * Convert raw chord text to jazz Unicode display via STRING-LEVEL
 * substitution (no parsing). Idempotent on Unicode glyphs.
 *
 * Use this inside SVG/text renderers where input may be a mix of raw user
 * text and already-normalised text. For input-time canonicalisation use
 * normalizeChord() (which is parser-based).
 *
 * Replaces the inline formatChord() previously duplicated across
 * NoteSheet/LickCard/Lick12KeyPage.
 *
 * Substitutions (in order — specific before general):
 *   maj7/M7/j7/Ma7 (followed by digit) → △ + digit  (e.g., Maj9 → △9)
 *   m7b5 / min7b5 / -7b5  → ø7
 *   h7 → ø7, h alone → ø
 *   o7 → °7, o alone → °
 *   dim7M → °△7, dim7 → °7, dim alone → °
 *   "mi" / "min" after root → "-"
 *   bare "m" after root (not followed by letter) → "-"
 *   root accidental b → ♭ (after A-G letter, not followed by lowercase letter)
 *   tensions b/# in digits → ♭/♯
 */
export function formatChordDisplay(raw: string): string {
  if (!raw) return raw;
  return raw
    // Major 7 prefix — digit required so bare "maj"/"M" doesn't get converted
    // (kept as triad). Order: specific Maj/maj/Ma/ma/M/j before bare 'm' rule.
    .replace(/(?:Maj|maj|Ma|ma|M|j)(?=\d)/g, '△')
    // Half-diminished — specific patterns first
    .replace(/(?:m7b5|min7b5|mi7b5|-7b5|m7\(b5\)|-7\(b5\))/g, 'ø7')
    .replace(/h7/g, 'ø7')
    .replace(/h(?!\d)/g, 'ø')
    // Diminished
    .replace(/dim7M/g, '°△7')
    .replace(/dim7/g, '°7')
    .replace(/dim(?![a-zA-Z\d])/g, '°')
    .replace(/o7/g, '°7')
    .replace(/o(?!\d)/g, '°')
    // Minor — must come after the above so we don't disturb maj/dim/etc.
    // Order: longest alternative first (min before mi) to avoid leaving 'n' behind.
    .replace(/(?<=[A-G][b#♭♯]?)(?:min|mi)/g, '-')
    .replace(/(?<=[A-G][b#♭♯]?)m(?![a-zA-Z])/g, '-')
    // Root flat → ♭ (single 'b' after A-G, not followed by lowercase letter)
    .replace(/(?<=[A-G])b(?=[^a-z]|$)/g, '♭')
    // Tension accidentals
    .replace(/(\d)b/g, '$1♭')
    .replace(/b(\d)/g, '♭$1')
    .replace(/(\d)#/g, '$1♯')
    .replace(/#(\d)/g, '♯$1');
}
