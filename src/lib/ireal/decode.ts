/**
 * iRealPro URI decoding & unscrambling.
 *
 * Format: irealb://song1===song2===...
 * Each song: title=composer==style=key=n=<music>=...
 * The music field starts with MUSIC_PREFIX and is scrambled.
 */

const MUSIC_PREFIX = '1r34LbKcu7';

// ─── pianosnake obfuscation (chunks of 50) ──────────────────────────────────

function obfusc50(s: string): string {
  const a = s.split('');
  for (let i = 0; i < 5; i++)  [a[i], a[49 - i]] = [a[49 - i], a[i]];
  for (let i = 10; i < 24; i++) [a[i], a[49 - i]] = [a[49 - i], a[i]];
  return a.join('');
}

export function unscramble(s: string): string {
  let result = '';
  let remaining = s;
  while (remaining.length > 50) {
    const chunk = remaining.slice(0, 50);
    remaining = remaining.slice(50);
    result += remaining.length < 2 ? chunk : obfusc50(chunk);
  }
  return result + remaining;
}

// ─── Raw song record (before chart parsing) ─────────────────────────────────

export interface RawSong {
  title: string;
  composer: string;
  style: string;
  key: string;
  transpose?: number;
  bpm?: number;
  repeats?: number;
  compStyle?: string;
  chart: string;           // decoded + unscrambled chart string
}

// ─── URI → RawSong[] ────────────────────────────────────────────────────────

export function decodeIRealUrl(uri: string): RawSong[] {
  // Strip protocol prefix
  let content = uri.replace(/^irealb:\/\//, '');
  content = decodeURIComponent(content);

  const songStrings = content.split('===').filter(s => s.trim().length > 0);
  const songs: RawSong[] = [];

  for (const raw of songStrings) {
    const parts = raw.split('=');
    const musicIdx = parts.findIndex(p => p.startsWith(MUSIC_PREFIX));
    if (musicIdx === -1) continue;

    const title = (parts[0] || '').trim();
    if (!title) continue;

    const composer  = (parts[1] || '').trim();
    // parts[2] is usually empty
    const style     = (parts[3] || 'Swing').trim();
    const key       = (parts[musicIdx - 1] || parts[musicIdx - 2] || 'C').trim() || 'C';

    const encoded = parts[musicIdx].slice(MUSIC_PREFIX.length);
    const chart   = unscramble(encoded);

    songs.push({ title, composer, style, key, chart });
  }

  return songs;
}
