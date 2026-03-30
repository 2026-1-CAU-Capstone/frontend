import React from 'react';

/**
 * Chord symbol regex: matches common jazz chord symbols like
 * C, Dm7, F#maj7, Bbm7b5, G7#9, Ab/Gb, Cmaj7, E7, Fmaj7, Am7, etc.
 * Must start with a root note (A-G) optionally followed by accidental (b/#/♭/♯)
 * then a quality suffix.
 */
const CHORD_RE =
  /\b([A-G][b#♭♯]?)(maj7|maj9|maj13|maj|min7|min9|min11|min|m7b5|m7♭5|mMaj7|mM7|m7|m9|m11|m6|m|dim7|dim|aug7|aug|sus4|sus2|sus|add9|add11|7b9|7#9|7b13|7#11|7alt|7sus4|7sus|7|9|11|13|6\/9|6|5|°7|°|ø7|ø|△7|△|-7|-|Δ7|Δ|\^7|\^)?(\([^)]*\))?(\/[A-G][b#♭♯]?)?\b/g;

/** Map raw quality text → MuseJazz-style Unicode */
const QUALITY_MAP: [RegExp, string][] = [
  [/^(maj7|M7|\^7|Δ7|△7)$/, '△7'],
  [/^(maj9)$/, '△9'],
  [/^(maj13)$/, '△13'],
  [/^(maj|M|\^|Δ|△)$/, '△'],
  [/^(-maj7|mMaj7|mM7)$/, '-△7'],
  [/^(m7b5|m7♭5|-7b5)$/, 'ø7'],
  [/^(dim7|°7)$/, '°7'],
  [/^(dim|°)$/, '°'],
  [/^(m7|min7|-7)$/, '-7'],
  [/^(m9|min9|-9)$/, '-9'],
  [/^(m11|min11|-11)$/, '-11'],
  [/^(m6|-6)$/, '-6'],
  [/^(m|min|-)$/, '-'],
  [/^(aug7)$/, '+7'],
  [/^(aug)$/, '+'],
  [/^(ø7)$/, 'ø7'],
  [/^(ø)$/, 'ø'],
];

function normalizeQuality(raw: string): string {
  for (const [re, replacement] of QUALITY_MAP) {
    if (re.test(raw)) return replacement;
  }
  // Convert remaining b/# in tensions to ♭/♯
  return raw.replace(/b/g, '♭').replace(/#/g, '♯');
}

function normalizeAccidental(acc: string): string {
  return acc.replace(/b/g, '♭').replace(/#/g, '♯');
}

/**
 * Takes a text string and returns React nodes where chord symbols
 * are wrapped in a styled span with MuseJazz Text font.
 */
export function formatChordsInText(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Reset regex state
  CHORD_RE.lastIndex = 0;

  while ((match = CHORD_RE.exec(text)) !== null) {
    const [full, root, quality, paren, bass] = match;
    const idx = match.index;

    // Push text before match
    if (idx > lastIndex) {
      nodes.push(text.slice(lastIndex, idx));
    }

    // Build formatted chord
    const rootNorm = normalizeAccidental(root);
    const qualNorm = quality ? normalizeQuality(quality) : '';
    const parenNorm = paren ? paren.replace(/b/g, '♭').replace(/#/g, '♯') : '';
    const bassNorm = bass ? '/' + normalizeAccidental(bass.slice(1)) : '';

    nodes.push(
      <span
        key={`chord-${idx}`}
        style={{
          fontFamily: "'MuseJazz Text', 'Oswald', sans-serif",
          fontWeight: 600,
          fontSize: '1.05em',
          letterSpacing: '0.01em',
          whiteSpace: 'nowrap',
        }}
      >
        {rootNorm}
        {qualNorm}
        {parenNorm}
        {bassNorm}
      </span>,
    );

    lastIndex = idx + full.length;
  }

  // Remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}
