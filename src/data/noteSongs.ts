/* ─── Song index for /note page (wjazzd + omnibook) ──────────────────── */

export interface NoteSongEntry {
  id: string;
  title: string;
  composer: string;
  collection: 'wjazzd' | 'omnibook' | 'jazzstandards' | 'pdmx';
  fileType: 'midi' | 'xml' | 'mxl';
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

const jazzstandardModules = import.meta.glob('../../data/jazzstandards/*.{mid,MID}', {
  import: 'default',
  query: '?url',
}) as Record<string, () => Promise<string>>;

const pdmxModules = import.meta.glob('../../data/PDMX/scores/*.mxl', {
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

function parseJazzStandard(filename: string): string {
  return filename
    .replace(/\.mid$/i, '')
    .replace(/_/g, ' ')
    .replace(/\s*\d+$/, '')                        // trailing numbers
    .replace(/\s*(GM|XG)$/i, '')                   // format suffixes
    .replace(/\s*\(Doug McKenzie\)/gi, '')
    .replace(/\s*(solo|trio|duet|piano|duo)\s*/gi, ' ')
    .replace(/([a-z'])([A-Z])/g, '$1 $2')          // camelCase → spaces
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Build unified list ───────────────────────────────────────────────── */

const jazzstandardSongs: NoteSongEntry[] = Object.entries(jazzstandardModules).map(
  ([path, loadUrl]) => {
    const fn = path.split('/').pop() ?? '';
    const title = parseJazzStandard(decodeURIComponent(fn));
    return { id: `jazzstandard:${fn}`, title, composer: 'Doug McKenzie', collection: 'jazzstandards' as const, fileType: 'midi' as const, loadUrl };
  },
);

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

const pdmxSongs: NoteSongEntry[] = Object.entries(pdmxModules).map(
  ([path, loadUrl]) => {
    const fn = path.split('/').pop() ?? '';
    const title = decodeURIComponent(fn).replace(/\.mxl$/i, '').replace(/\s*\(\d+\)$/, '');
    return { id: `pdmx:${fn}`, title, composer: 'PDMX', collection: 'pdmx' as const, fileType: 'mxl' as const, loadUrl };
  },
);

export const noteSongs: NoteSongEntry[] = [
  ...omnibookSongs,
  ...wjazzdSongs,
  ...jazzstandardSongs,
  ...pdmxSongs,
].sort((a, b) => a.title.localeCompare(b.title));
