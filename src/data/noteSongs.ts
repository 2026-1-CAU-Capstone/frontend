/* ─── Song index for /note page ──────────────────────────────────────── */

import { chordMatchIndex } from './chordMatchIndex';

export type SongGroup = 'external' | 'manual';

export interface NoteSongEntry {
  id: string;
  title: string;
  composer: string;
  collection: string;
  group: SongGroup;
  fileType: 'midi' | 'xml' | 'mxl' | 'json';
  loadUrl: () => Promise<string>;
  /**
   * If set, the page should replace the parsed chord field on each measure
   * with the chord progression from jazz1460.json at this index. Used to
   * clone external songs into "manual" with chord-analysis data layered on
   * top of the melody parsed from the source file.
   */
  chordJazzIndex?: number;
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
    return { id: `jazzstandard:${fn}`, title, composer: 'Doug McKenzie', collection: 'jazzstandards', group: 'external' as const, fileType: 'midi' as const, loadUrl };
  },
);

const wjazzdSongs: NoteSongEntry[] = Object.entries(wjazzdModules).map(
  ([path, loadUrl]) => {
    const fn = path.split('/').pop() ?? '';
    const { artist, title } = parseWjazzd(fn);
    return { id: `wjazzd:${fn}`, title, composer: artist, collection: 'wjazzd', group: 'external' as const, fileType: 'midi' as const, loadUrl };
  },
);

const omnibookSongs: NoteSongEntry[] = Object.entries(omnibookModules).map(
  ([path, loadUrl]) => {
    const fn = path.split('/').pop() ?? '';
    const title = parseOmnibook(fn);
    return { id: `omnibook:${fn}`, title, composer: 'Charlie Parker', collection: 'omnibook', group: 'external' as const, fileType: 'xml' as const, loadUrl };
  },
);

const pdmxSongs: NoteSongEntry[] = Object.entries(pdmxModules).map(
  ([path, loadUrl]) => {
    const fn = path.split('/').pop() ?? '';
    const title = decodeURIComponent(fn).replace(/\.mxl$/i, '').replace(/\s*\(\d+\)$/, '');
    return { id: `pdmx:${fn}`, title, composer: 'PDMX', collection: 'pdmx', group: 'external' as const, fileType: 'mxl' as const, loadUrl };
  },
);

/* ── Manual songs (hand-crafted JSON) ─────────────────────────────────── */

const handCraftedManualSongs: NoteSongEntry[] = [
  {
    id: 'manual:Autumn_Leaves',
    title: 'Autumn Leaves',
    composer: 'Joseph Kosma',
    collection: 'manual',
    group: 'manual',
    fileType: 'json',
    loadUrl: async () => '/data/data-jazzstandards-main/Autumn_Leaves.json',
  },
];

/* ── Manual clones: every external song whose title appears in jazz1460. ──
 * The clones reuse the same source-file loader as the corresponding external
 * entry, but carry a `chordJazzIndex` so the page can overlay chord-analysis
 * chords (from jazz1460.json) on top of the parsed melody. The original
 * external entries are left untouched. */

const externalById = new Map<string, NoteSongEntry>();
for (const s of [...omnibookSongs, ...wjazzdSongs, ...jazzstandardSongs, ...pdmxSongs]) {
  externalById.set(s.id, s);
}

const clonedManualSongs: NoteSongEntry[] = chordMatchIndex.flatMap((match) => {
  const source = externalById.get(match.noteId);
  if (!source) return [];
  const entry: NoteSongEntry = {
    id: `manual-clone:${match.noteId}`,
    title: source.title,
    composer: source.composer,
    collection: `manual (${source.collection})`,
    group: 'manual',
    fileType: source.fileType,
    loadUrl: source.loadUrl,
    chordJazzIndex: match.jazzIndex,
  };
  return [entry];
});

const manualSongs: NoteSongEntry[] = [
  ...handCraftedManualSongs,
  ...clonedManualSongs,
].sort((a, b) => a.title.localeCompare(b.title));

/* ── Exports ─────────────────────────────────────────────────────────── */

export const externalSongs: NoteSongEntry[] = [
  ...omnibookSongs,
  ...wjazzdSongs,
  ...jazzstandardSongs,
  ...pdmxSongs,
].sort((a, b) => a.title.localeCompare(b.title));

export { manualSongs };

export const noteSongs: NoteSongEntry[] = [
  ...manualSongs,
  ...externalSongs,
].sort((a, b) => a.title.localeCompare(b.title));
