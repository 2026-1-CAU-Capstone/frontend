import React from 'react';

/**
 * Chord symbol regex: matches common jazz chord symbols like
 * C, Dm7, F#maj7, Bbm7b5, G7#9, Ab/Gb, Cmaj7, E7, Fmaj7, Am7, etc.
 * Must start with a root note (A-G) optionally followed by accidental (b/#/♭/♯)
 * then a quality suffix.
 */
const CHORD_RE =
  /\b([A-G][b#♭♯]?)(maj7|maj9|maj13|maj|Maj7|Maj9|Maj13|Maj|M13|M9|M7|j13|j9|j7|min7|min9|min11|min|m7b5|m7♭5|m7\(b5\)|m7\(♭5\)|mMaj7|mM7|m7|m9|m11|m6|m|dim7|dim|aug7|aug|sus4|sus2|sus|add9|add11|7b9|7♭9|7#9|7♯9|7b13|7♭13|7#11|7♯11|7alt|7sus4|7sus|7|9|11|13|6\/9|6|5|h7|h|o7|o|°7|°|ø7|ø|△7|△|-7b5|-7\(b5\)|-7|-|Δ7|Δ|\^7|\^)?(\([^)]*\))?(\/[A-G][b#♭♯]?)?(?=$|[\s,.;:!?)\]\}가-힣ㄱ-ㅎㅏ-ㅣ]|[→←↔])/g;

/** Map raw quality text → MuseJazz-style Unicode.
 *  `j7`/`j9`/`j13` = MuseJazz-font convention for the major-7 triangle;
 *  some backend lick data stores chords with that spelling. */
const QUALITY_MAP: [RegExp, string][] = [
  [/^(maj7|Maj7|M7|j7|\^7|Δ7|△7)$/, '△7'],
  [/^(maj9|Maj9|M9|j9)$/, '△9'],
  [/^(maj13|Maj13|M13|j13)$/, '△13'],
  [/^(maj|Maj|\^|Δ|△)$/, '△'],
  [/^(-maj7|mMaj7|mM7)$/, '-△7'],
  [/^(m7b5|m7♭5|m7\(b5\)|m7\(♭5\)|-7b5|-7\(b5\)|h7|ø7)$/, 'ø7'],
  [/^(h|ø)$/, 'ø'],
  [/^(dim7|o7|°7)$/, '°7'],
  [/^(dim|o|°)$/, '°'],
  [/^(m7|min7|-7)$/, '-7'],
  [/^(m9|min9|-9)$/, '-9'],
  [/^(m11|min11|-11)$/, '-11'],
  [/^(m6|-6)$/, '-6'],
  [/^(m|min|-)$/, '-'],
  [/^(aug7)$/, '+7'],
  [/^(aug)$/, '+'],
];

function normalizeQuality(raw: string): string {
  for (const [re, replacement] of QUALITY_MAP) {
    if (re.test(raw)) return replacement;
  }
  return raw.replace(/b/g, '♭').replace(/#/g, '♯');
}

function normalizeAccidental(acc: string): string {
  return acc.replace(/b/g, '♭').replace(/#/g, '♯');
}

const ROOT_STYLE: React.CSSProperties = {
  fontFamily: "'MuseJazz Text', 'Oswald', sans-serif",
  fontWeight: 700,
};

const QUALITY_STYLE: React.CSSProperties = {
  fontFamily: "'MuseJazz Text', 'Oswald', sans-serif",
  fontWeight: 600,
  fontSize: '0.82em',
  letterSpacing: 0,
};

/**
 * Takes a text string and returns React nodes where chord symbols
 * are wrapped in styled spans:
 *   - Root letter → MuseJazz bold
 *   - Quality/numbers → MuseJazz, slightly smaller
 *   - Everything else → untouched (regular font)
 */
export function formatChordsInText(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  CHORD_RE.lastIndex = 0;

  while ((match = CHORD_RE.exec(text)) !== null) {
    const [full, root, quality, paren, bass] = match;
    const idx = match.index;

    if (idx > lastIndex) {
      nodes.push(text.slice(lastIndex, idx));
    }

    const rootNorm = normalizeAccidental(root);
    const qualNorm = quality ? normalizeQuality(quality) : '';
    const parenNorm = paren ? paren.replace(/b/g, '♭').replace(/#/g, '♯') : '';
    const bassNorm = bass ? normalizeAccidental(bass.slice(1)) : '';

    nodes.push(
      <span key={`chord-${idx}`} style={{ whiteSpace: 'nowrap' }}>
        {/* 루트: MuseJazz 굵게 */}
        <span style={ROOT_STYLE}>{rootNorm}</span>
        {/* 퀄리티: MuseJazz 조금 작게 */}
        {qualNorm && <span style={QUALITY_STYLE}>{qualNorm}</span>}
        {parenNorm && <span style={QUALITY_STYLE}>{parenNorm}</span>}
        {/* 슬래시 베이스: 루트/베이스 형식 */}
        {bassNorm && (
          <>
            <span style={{ ...QUALITY_STYLE }}>/</span>
            <span style={ROOT_STYLE}>{bassNorm}</span>
          </>
        )}
      </span>,
    );

    lastIndex = idx + full.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}
