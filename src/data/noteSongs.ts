/* ─── Song index for /note page (wjazzd + omnibook) ──────────────────── */

export interface NoteSongEntry {
  id: string;
  title: string;
  composer: string;
  collection: 'wjazzd' | 'omnibook';
  fileType: 'midi' | 'xml';
  loadUrl: () => Promise<string>;
}

/* ── Vite glob imports ────────────────────────────────────────────────── */

const wjazzdModules = import.meta.glob('../../data/wjazzd/*.mid', {
  import: 'default',
  query: '?url',
}) as Record<string, () => Promise<string>>;

const omnibookModules = import.meta.glob('../../data/omnibook/Omnibook xml/*.xml', {
  import: 'default',
  query: '?url',
}) as Record<string, () => Promise<string>>;

/* ── Filename helpers ─────────────────────────────────────────────────── */

function splitCamel(s: string): string {
  return s
    .replace(/([a-z'])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

function parseWjazzd(filename: string): { artist: string; title: string } {
  const base = filename.replace(/\.mid$/i, '').replace(/_FINAL$/, '');
  const parts = base.split('_');
  const artist = splitCamel(parts[0] ?? '');
  const title = parts
    .slice(1)
    .map((p) => splitCamel(p.replace(/-(\d)/g, ' $1')))
    .join(' ');
  return { artist, title };
}

function parseOmnibook(filename: string): string {
  return filename.replace(/\.xml$/i, '').replace(/_/g, ' ');
}

/* ── Build unified list ───────────────────────────────────────────────── */

const wjazzdSongs: NoteSongEntry[] = Object.entries(wjazzdModules).map(
  ([path, loadUrl]) => {
    const fn = path.split('/').pop() ?? '';
    const { artist, title } = parseWjazzd(fn);
    return { id: `wjazzd:${fn}`, title, composer: artist, collection: 'wjazzd' as const, fileType: 'midi' as const, loadUrl };
  },
);

const omnibookSongs: NoteSongEntry[] = Object.entries(omnibookModules).map(
  ([path, loadUrl]) => {
    const fn = path.split('/').pop() ?? '';
    const title = parseOmnibook(fn);
    return { id: `omnibook:${fn}`, title, composer: 'Charlie Parker', collection: 'omnibook' as const, fileType: 'xml' as const, loadUrl };
  },
);

export const noteSongs: NoteSongEntry[] = [
  ...omnibookSongs,
  ...wjazzdSongs,
].sort((a, b) => a.title.localeCompare(b.title));
