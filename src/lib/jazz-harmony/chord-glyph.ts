/**
 * Chord-symbol glyph design — SINGLE SOURCE OF TRUTH for every VexFlow-based
 * chord label in Jazzify (NoteSheet / LickCard / Lick12KeyPage → and the PDF
 * export, which rasterises NoteSheet's SVG).
 *
 * The three renderers each keep their own colour/tension/slash-bass code, but
 * the *typography of the quality glyph + extension number* lives here so the
 * look stays identical everywhere and a design tweak is a one-file change.
 *
 * Current design rules:
 *   △7 (major 7) — triangle drawn slightly smaller than the root; the "7" sits
 *                  higher and hugs the triangle (tighter, pulled left).
 *   dominant 7   — bare root + "7" (no △/°/ø/- quality marker): the "7" is
 *                  larger and raised. A sharp root (C♯7) pushes it further
 *                  right so the digit clears the ♯ glyph.
 *   everything else (−7, ø7, 9, 13 …) keeps the standard superscript.
 */

/** 코드 라벨을 렌더 조각으로 분해한 결과. */
export interface ChordParts {
  /** 루트 + 퀄리티 (예: `G#-`, `C△`). */
  base: string;
  /** 확장 숫자 (예: `7`, `13`). 없으면 ''. */
  ext: string;
  /** 확장 뒤 텐션 문자열 (예: `♭9`). 없으면 ''. */
  tension: string;
  /** 분수코드의 베이스 — 선행 '/' 포함 (예: `/F#`). 분수코드가 아니면 undefined. */
  bass?: string;
}

/**
 * 코드 문자열 → 렌더 조각. **모든 렌더러(NoteSheet·LickCard·Lick12KeyPage·
 * Editor)가 반드시 이 함수를 거친다** — 에디터와 뷰어 출력이 100% 같아야 하고,
 * 예전처럼 각자 구현을 두면 분수코드(`G#-7/F#`)의 베이스가 조용히 사라진다.
 *
 * 슬래시 뒤 베이스는 텐션이 아니라 루트와 같은 크기로 그려야 하므로, 확장/텐션
 * 파싱 **전에** 먼저 떼어낸다.
 */
export function splitChordParts(formatted: string): ChordParts {
  let bass: string | undefined;
  let body = formatted;
  const slashIdx = formatted.indexOf('/');
  if (slashIdx > 0) {
    body = formatted.slice(0, slashIdx);
    bass = formatted.slice(slashIdx); // 선행 '/' 포함
  }
  const m = body.match(/^(\D*?)(\d+)(.*)$/);
  if (!m) return { base: body, ext: '', tension: '', ...(bass ? { bass } : {}) };
  return { base: m[1], ext: m[2], tension: m[3] || '', ...(bass ? { bass } : {}) };
}

/** U+25B3 WHITE UP-POINTING TRIANGLE — the maj-7 glyph used across the app. */
export const TRIANGLE = '△';
/** U+00B0 DEGREE SIGN — diminished. */
export const DEGREE = '°';

/** Per-glyph size multipliers applied inside the chord *base* (root+quality). */
const GLYPH_SCALE: Record<string, number> = {
  // ° renders tiny in MuseJazz at label sizes — bump it up to stay readable.
  [DEGREE]: 1.4,
  // △ reads heavy next to the root; trim it a touch so the "7" can tuck in.
  [TRIANGLE]: 0.86,
};

/** True when the quality is a plain dominant 7 (bare root + "7"). */
export function isDominant7(base: string, ext: string): boolean {
  return ext === '7' && !/[△°ø-]/.test(base);
}

/** True when the base ends on a sharp — the digit needs extra clearance. */
function endsWithSharp(base: string): boolean {
  return /[#♯]$/.test(base);
}

/**
 * Split the chord base into `<tspan>`-ready segments, each with the font-size
 * it should render at. Glyphs listed in GLYPH_SCALE (° and △) get their own
 * segment so they can be sized independently of the root letter.
 */
export function chordBaseSegments(base: string, size: number): { text: string; fontSize: number }[] {
  const special = Object.keys(GLYPH_SCALE);
  if (!special.some((g) => base.includes(g))) {
    return [{ text: base, fontSize: size }];
  }
  const splitter = new RegExp(`([${special.join('')}])`, 'g');
  return base
    .split(splitter)
    .filter(Boolean)
    .map((seg) => ({
      text: seg,
      fontSize: Math.round(size * (GLYPH_SCALE[seg] ?? 1)),
    }));
}

/**
 * Typography for the extension digit ("7", "9", "13" …) that follows the base.
 * Returns raw `<tspan>` attribute values.
 */
export function chordExtStyle(
  base: string, ext: string, size: number,
): { fontSize: number; dx: string; dy: string } {
  // ── maj 7: tuck the digit up and in against the (smaller) triangle.
  if (base.endsWith(TRIANGLE)) {
    return {
      fontSize: Math.round(size * 0.85),
      dx: '-2.5',
      dy: String(-size * 0.26),
    };
  }
  // ── dominant 7: bigger digit, raised; extra right shift past a sharp root.
  if (isDominant7(base, ext)) {
    return {
      fontSize: Math.round(size * 1.0),
      dx: endsWithSharp(base) ? '4.5' : '3',
      dy: String(-size * 0.12),
    };
  }
  // ── everything else: standard superscript.
  return {
    fontSize: Math.round(size * 0.85),
    dx: '1',
    dy: String(-size * 0.18),
  };
}
