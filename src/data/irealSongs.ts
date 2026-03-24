import { irealMeta } from './irealMeta';

const midiModules = import.meta.glob('../../iRealPro/jazz-1460/*.mid', {
  import: 'default',
  query: '?url',
}) as Record<string, () => Promise<string>>;

function slugToTitle(slug: string): string {
  return slug
    .replace(/\.mid$/i, '')
    .replace(/--/g, "'")
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase())
    .trim();
}

export interface IRealSongAsset {
  id: string;
  title: string;
  composer?: string;
  style?: string;
  loadUrl: () => Promise<string>;
}

export const irealSongs: IRealSongAsset[] = Object.entries(midiModules)
  .map(([path, loadUrl]) => {
    const fileName = path.split('/').pop() ?? path;
    const id = fileName.replace(/\.mid$/i, '');
    const meta = irealMeta[id];
    return {
      id,
      title: slugToTitle(fileName),
      composer: meta?.composer,
      style: meta?.style,
      loadUrl,
    };
  })
  .sort((a, b) => a.title.localeCompare(b.title));
