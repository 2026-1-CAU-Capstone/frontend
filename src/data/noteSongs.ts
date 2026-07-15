/* ─── Song index for /note page ──────────────────────────────────────── */

import { chordMatchIndex } from './chordMatchIndex';

export type SongGroup = 'external' | 'manual' | 'leadsheet';

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
  /** music21 변환 풀 피아노 "연주" 파일(맥켄지 정량화본) — 파서의
   *  pianoPerformance 모드(마디별 멜로디 voice 선택 + 저음 컷)로 로드. */
  pianoPerformance?: boolean;
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

/* Doug McKenzie 아카이브 — data/jazzstandards(위 jazzstandardModules)와는 다른
 * 파일이다: jazzstandards는 원시 연주 MIDI(사람 타이밍 그대로라 표기가 지저분함),
 * 이건 그 같은 곡들을 리듬 정량화(quantize)한 MusicXML — 노트 표기가 훨씬
 * 깔끔하다. musicxml/(비정량화)는 중복이라 제외하고 quantized만 쓴다. */
const mckenzieModules = import.meta.glob('../../data/midi_dougmckenzie/musicxml_quantized/*.musicxml', {
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

const mckenzieSongs: NoteSongEntry[] = Object.entries(mckenzieModules).map(
  ([path, loadUrl]) => {
    const fn = path.split('/').pop() ?? '';
    const title = parseJazzStandard(decodeURIComponent(fn).replace(/\.musicxml$/i, '.mid'));
    return { id: `mckenzie:${fn}`, title, composer: 'Doug McKenzie', collection: 'mckenzie', group: 'external' as const, fileType: 'xml' as const, loadUrl, pianoPerformance: true };
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

/* ── OMR'd from /Users/benzity/Documents/DEV/auto/pdf2png/output/leadsheet ──
 * These were originally added to handCraftedManualSongs, but every entry is a
 * lead-sheet PDF run through OMR, so they form their own picker group in the
 * NotePage UI ("Lead Sheet"). Keeping them in a separate array means the
 * Manual list stays small/hand-curated while these grow as more PDFs are
 * processed. */
const omrLeadsheetSongs: NoteSongEntry[] = [
  {
    id: 'manual-omr:A_Foggy_Day_F',
    title: "A Foggy Day (F)",
    composer: "George Gershwin / Ira Gershwin",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/A_Foggy_Day_F.json',
  },
  {
    id: 'manual-omr:A_Night_In_Tunisia_Bm',
    title: "A Night In Tunisia (Bm)",
    composer: "Dizzy Gillespie / Frank Paparelli",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/A_Night_In_Tunisia_Bm.json',
  },
  {
    id: 'manual-omr:A_Night_In_Tunisia_Dm',
    title: "A Night In Tunisia (Dm)",
    composer: "Dizzy Gillespie / Frank Paparelli",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/A_Night_In_Tunisia_Dm.json',
  },
  {
    id: 'manual-omr:A_Night_In_Tunisia_Em',
    title: "A Night In Tunisia (Em)",
    composer: "Dizzy Gillespie / Frank Paparelli",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/A_Night_In_Tunisia_Em.json',
  },
  {
    id: 'manual-omr:After_You_ve_Gone_Bb',
    title: "After You've Gone (Bb)",
    composer: "Turner Layton / Henry Creamer",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/After_You_ve_Gone_Bb.json',
  },
  {
    id: 'manual-omr:All_Of_Me_A',
    title: "All Of Me (A)",
    composer: "Gerald Marks / Seymour Simons",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/All_Of_Me_A.json',
  },
  {
    id: 'manual-omr:All_Of_Me_C',
    title: "All Of Me (C)",
    composer: "Gerald Marks / Seymour Simons",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/All_Of_Me_C.json',
  },
  {
    id: 'manual-omr:All_of_Me_F',
    title: "All of Me (F)",
    composer: "Gerald Marks / Seymour Simons",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/All_of_Me_F.json',
  },
  {
    id: 'manual-omr:All_Of_Me_G',
    title: "All Of Me (G)",
    composer: "Gerald Marks / Seymour Simons",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/All_Of_Me_G.json',
  },
  {
    id: 'manual-omr:All_The_Things_You_Are_Ab',
    title: "All The Things You Are (Ab)",
    composer: "Jerome Kern / Oscar Hammerstein II",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/All_The_Things_You_Are_Ab.json',
  },
  {
    id: 'manual-omr:All_The_Things_You_Are_Eb',
    title: "All The Things You Are (Eb)",
    composer: "Jerome Kern / Oscar Hammerstein II",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/All_The_Things_You_Are_Eb.json',
  },
  {
    id: 'manual-omr:All_The_Things_You_Are_F',
    title: "All The Things You Are (F)",
    composer: "Jerome Kern / Oscar Hammerstein II",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/All_The_Things_You_Are_F.json',
  },
  {
    id: 'manual-omr:Autumn_Leaves_Dm',
    title: "Autumn Leaves (Dm)",
    composer: "Joseph Kosma / Jacques Prévert / Johnny Mercer",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Autumn_Leaves_Dm.json',
  },
  {
    id: 'manual-omr:Autumn_Leaves_F_m',
    title: "Autumn Leaves (F#m)",
    composer: "Joseph Kosma / Jacques Prévert / Johnny Mercer",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Autumn_Leaves_F_m.json',
  },
  {
    id: 'manual-omr:Autumn_Leaves_solo_only_Chet_Baker_Fm',
    title: "Autumn Leaves (solo only) - Chet Baker (Fm)",
    composer: "",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Autumn_Leaves_solo_only_Chet_Baker_Fm.json',
  },
  {
    id: 'manual-omr:Billie_s_Bounce_D',
    title: "Billie's Bounce (D)",
    composer: "Charlie Parker",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Billie_s_Bounce_D.json',
  },
  {
    id: 'manual-omr:Billie_s_Bounce_F',
    title: "Billie's Bounce (F)",
    composer: "Charlie Parker",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Billie_s_Bounce_F.json',
  },
  {
    id: 'manual-omr:Blue_Bossa_Eb',
    title: "Blue Bossa (Eb)",
    composer: "Kenny Dorham",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Blue_Bossa_Eb.json',
  },
  {
    id: 'manual-omr:Cheek_To_Cheek_C',
    title: "Cheek To Cheek (C)",
    composer: "Irving Berlin",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Cheek_To_Cheek_C.json',
  },
  {
    id: 'manual-omr:Cherokee_Bb',
    title: "Cherokee (Bb)",
    composer: "Ray Noble",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Cherokee_Bb.json',
  },
  {
    id: 'manual-omr:Corcovado_C',
    title: "Corcovado (C)",
    composer: "Antônio Carlos Jobim",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Corcovado_C.json',
  },
  {
    id: 'manual-omr:Crazy_Race_Gb',
    title: "Crazy Race (Gb)",
    composer: "",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Crazy_Race_Gb.json',
  },
  {
    id: 'manual-omr:Desfinado_Eb',
    title: "Desfinado (Eb)",
    composer: "Antônio Carlos Jobim",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Desfinado_Eb.json',
  },
  {
    id: 'manual-omr:Desfinado_F',
    title: "Desfinado (F)",
    composer: "Antônio Carlos Jobim",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Desfinado_F.json',
  },
  {
    id: 'manual-omr:Destination_Moon_F',
    title: "Destination Moon (F)",
    composer: "Marvin Fisher / Roy Alfred",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Destination_Moon_F.json',
  },
  {
    id: 'manual-omr:Destination_Moon_허소영_ver_Piano',
    title: "Destination Moon (허소영 ver, Piano)",
    composer: "Marvin Fisher / Roy Alfred",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Destination_Moon_허소영_ver_Piano.json',
  },
  {
    id: 'manual-omr:Donna_Lee_Ab',
    title: "Donna Lee (Ab)",
    composer: "Charlie Parker",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Donna_Lee_Ab.json',
  },
  {
    id: 'manual-omr:Fly_me_to_the_moon_C',
    title: "Fly me to the moon (C)",
    composer: "Bart Howard",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Fly_me_to_the_moon_C.json',
  },
  {
    id: 'manual-omr:L_O_V_E_G',
    title: "L-O-V-E (G)",
    composer: "Bert Kaempfert / Milt Gabler",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/L_O_V_E_G.json',
  },
  {
    id: 'manual-omr:Mister_Magic_Eb',
    title: "Mister Magic (Eb)",
    composer: "Grover Washington Jr. / Ralph MacDonald / William Salter",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Mister_Magic_Eb.json',
  },
  {
    id: 'manual-omr:Misty_Bb',
    title: "Misty (Bb)",
    composer: "Erroll Garner",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Misty_Bb.json',
  },
  {
    id: 'manual-omr:Misty_Eb',
    title: "Misty (Eb)",
    composer: "Erroll Garner",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Misty_Eb.json',
  },
  {
    id: 'manual-omr:Moanin_Fm',
    title: "Moanin' (Fm)",
    composer: "Bobby Timmons",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Moanin_Fm.json',
  },
  {
    id: 'manual-omr:Moose_The_Mooche_Bb',
    title: "Moose The Mooche (Bb)",
    composer: "Charlie Parker",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Moose_The_Mooche_Bb.json',
  },
  {
    id: 'manual-omr:Moose_The_Mooche_G',
    title: "Moose The Mooche (G)",
    composer: "Charlie Parker",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Moose_The_Mooche_G.json',
  },
  {
    id: 'manual-omr:My_Favorite_Things_Em',
    title: "My Favorite Things (Em)",
    composer: "Richard Rodgers / Oscar Hammerstein II",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/My_Favorite_Things_Em.json',
  },
  {
    id: 'manual-omr:My_Little_Suede_Shoes_C',
    title: "My Little Suede Shoes (C)",
    composer: "Charlie Parker",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/My_Little_Suede_Shoes_C.json',
  },
  {
    id: 'manual-omr:My_Little_Suede_Shoes_Eb',
    title: "My Little Suede Shoes (Eb)",
    composer: "Charlie Parker",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/My_Little_Suede_Shoes_Eb.json',
  },
  {
    id: 'manual-omr:Nica_s_Dream_Bbm',
    title: "Nica's Dream (Bbm)",
    composer: "Horace Silver",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Nica_s_Dream_Bbm.json',
  },
  {
    id: 'manual-omr:Oleo_Bb',
    title: "Oleo (Bb)",
    composer: "Sonny Rollins",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Oleo_Bb.json',
  },
  {
    id: 'manual-omr:Someday_My_Prince_Will_Come_Bb',
    title: "Someday My Prince Will Come (Bb)",
    composer: "Frank Churchill / Larry Morey",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Someday_My_Prince_Will_Come_Bb.json',
  },
  {
    id: 'manual-omr:Someday_My_Prince_Will_Come_G',
    title: "Someday My Prince Will Come (G)",
    composer: "Frank Churchill / Larry Morey",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Someday_My_Prince_Will_Come_G.json',
  },
  {
    id: 'manual-omr:Spain_D',
    title: "Spain (D)",
    composer: "Chick Corea",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Spain_D.json',
  },
  {
    id: 'manual-omr:Strasbourg_St_Denis_Ab',
    title: "Strasbourg St. Denis (Ab)",
    composer: "Roy Hargrove",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Strasbourg_St_Denis_Ab.json',
  },
  {
    id: 'manual-omr:Take_Five_Ebm',
    title: "Take Five (Ebm)",
    composer: "Paul Desmond",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Take_Five_Ebm.json',
  },
  {
    id: 'manual-omr:Take_The_A_Train_Ab',
    title: "Take The A Train (Ab)",
    composer: "Billy Strayhorn",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Take_The_A_Train_Ab.json',
  },
  {
    id: 'manual-omr:Take_The_A_Train_C',
    title: "Take The A Train (C)",
    composer: "Billy Strayhorn",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Take_The_A_Train_C.json',
  },
  {
    id: 'manual-omr:The_Days_of_Wine_and_Roses_F',
    title: "The Days of Wine and Roses (F)",
    composer: "Henry Mancini / Johnny Mercer",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/The_Days_of_Wine_and_Roses_F.json',
  },
  {
    id: 'manual-omr:The_Girl_From_Ipanema_F',
    title: "The Girl From Ipanema (F)",
    composer: "",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/The_Girl_From_Ipanema_F.json',
  },
  {
    id: 'manual-omr:There_Will_Never_Be_Another_You_Eb',
    title: "There Will Never Be Another You (Eb)",
    composer: "",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/There_Will_Never_Be_Another_You_Eb.json',
  },
  {
    id: 'manual-omr:This_I_Dig_Of_You_Bb',
    title: "This I Dig Of You (Bb)",
    composer: "",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/This_I_Dig_Of_You_Bb.json',
  },
  {
    id: 'manual-omr:Tristeza_C',
    title: "Tristeza (C)",
    composer: "",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Tristeza_C.json',
  },
  {
    id: 'manual-omr:Tristeza_D',
    title: "Tristeza (D)",
    composer: "",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Tristeza_D.json',
  },
  {
    id: 'manual-omr:Wave_D',
    title: "Wave (D)",
    composer: "Antônio Carlos Jobim",
    collection: 'leadsheet',
    group: 'leadsheet',
    fileType: 'json',
    loadUrl: async () => '/data/manual-omr/Wave_D.json',
  },
];

/* ── Manual clones: every external song whose title appears in jazz1460. ──
 * The clones reuse the same source-file loader as the corresponding external
 * entry, but carry a `chordJazzIndex` so the page can overlay chord-analysis
 * chords (from jazz1460.json) on top of the parsed melody. The original
 * external entries are left untouched. */

const externalById = new Map<string, NoteSongEntry>();
for (const s of [...omnibookSongs, ...wjazzdSongs, ...jazzstandardSongs, ...pdmxSongs, ...mckenzieSongs]) {
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

const leadsheetSongs: NoteSongEntry[] = [...omrLeadsheetSongs]
  .sort((a, b) => a.title.localeCompare(b.title));

/* ── Exports ─────────────────────────────────────────────────────────── */

export const externalSongs: NoteSongEntry[] = [
  ...omnibookSongs,
  ...wjazzdSongs,
  ...jazzstandardSongs,
  ...pdmxSongs,
  ...mckenzieSongs,
].sort((a, b) => a.title.localeCompare(b.title));

/* External을 "데이터셋별로" 볼 수 있게 소스별 그룹으로도 내보낸다. NotePage의
 * External 피커는 이걸로 2단 선택(데이터셋 → 그 안의 곡)을 구성한다 — 예전엔
 * 4개 소스(현재 5개)를 통째로 알파벳 정렬해 하나의 거대한 드롭다운에 섞어
 * 보여줬다(PDMX/McKenzie 등이 뒤섞임). */
export interface ExternalCollection {
  id: string;
  label: string;
  songs: NoteSongEntry[];
}

export const externalCollections: ExternalCollection[] = [
  { id: 'pdmx', label: 'PDMX', songs: pdmxSongs },
  { id: 'mckenzie', label: 'Doug McKenzie (MusicXML)', songs: mckenzieSongs },
  { id: 'jazzstandards', label: 'Jazz Standards (McKenzie MIDI)', songs: jazzstandardSongs },
  { id: 'omnibook', label: 'Omnibook (Charlie Parker)', songs: omnibookSongs },
  { id: 'wjazzd', label: 'WJazzD', songs: wjazzdSongs },
].map((c) => ({ ...c, songs: [...c.songs].sort((a, b) => a.title.localeCompare(b.title)) }));

export { manualSongs, leadsheetSongs };

export const noteSongs: NoteSongEntry[] = [
  ...manualSongs,
  ...leadsheetSongs,
  ...externalSongs,
].sort((a, b) => a.title.localeCompare(b.title));
