import type { LeadSheetData, LeadSheetChord, LeadSheetSystem } from '../../data/leadSheetTypes';
import type { NoteSheetData } from '../../data/sampleMelody';

/* Frontend-only chord-chart sharing.
 *
 * There's no backend share-token endpoint yet (that's tracked as a backend
 * requirement for cross-device / sheet-project sharing), so a "share link" is
 * built entirely on the client: the chart is serialized, base64url-encoded, and
 * carried in the URL hash. The public `/v` viewer decodes it and renders a
 * read-only lead sheet — no auth, anyone with the link can view.
 *
 * Heavy/derivable fields (rule-based analysis, diatonic flags, ids) are stripped
 * before encoding — the viewer re-runs analysis client-side — so the URL stays
 * small (a typical 32-bar tune is ~2KB encoded). */

const SHARE_VERSION = 1;
const SHARE_ROUTE = '#/v';

type ShareKind = 'chord' | 'note';

/** Wrapper persisted in the URL. `v` guards against format drift, `kind`
 *  discriminates a chord chart from a note sheet. */
interface SharePayload {
  v: number;
  kind: ShareKind;
  d: LeadSheetData | NoteSheetData;
}

/** Result of decoding a share token — discriminated by `kind`. */
export type DecodedShare =
  | { kind: 'chord'; data: LeadSheetData }
  | { kind: 'note'; data: NoteSheetData };

/** Strip a chord down to what the viewer needs to render + re-analyze. */
function slimChord(chord: LeadSheetChord): LeadSheetChord {
  const out: LeadSheetChord = {};
  if (chord.root) out.root = chord.root;
  if (chord.accidental) out.accidental = chord.accidental;
  if (chord.quality) out.quality = chord.quality;
  if (chord.bass) out.bass = chord.bass;
  if (chord.isRepeat) out.isRepeat = chord.isRepeat;
  if (typeof chord.durationBeats === 'number') out.durationBeats = chord.durationBeats;
  return out;
}

function slimSystem(system: LeadSheetSystem): LeadSheetSystem {
  return {
    ...(system.sectionLabel ? { sectionLabel: system.sectionLabel } : {}),
    ...(system.label ? { label: system.label } : {}),
    ...(system.hasRepeatStart ? { hasRepeatStart: true } : {}),
    ...(system.hasRepeatEnd ? { hasRepeatEnd: true } : {}),
    bars: system.bars.map((bar) => ({
      ...(typeof bar.ending === 'number' ? { ending: bar.ending } : {}),
      chords: bar.chords.map(slimChord),
    })),
  };
}

/** Drop analysis/ids/diatonic flags so the encoded chart stays compact. */
function slimChart(sheet: LeadSheetData): LeadSheetData {
  return {
    title: sheet.title,
    style: sheet.style,
    composer: sheet.composer,
    timeSignature: sheet.timeSignature,
    ...(sheet.key ? { key: sheet.key } : {}),
    systems: sheet.systems.map(slimSystem),
  };
}

function toBase64Url(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(encoded: string): string {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(b64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** Serialize a chord chart into the base64url token that rides in the share URL. */
export function encodeChart(sheet: LeadSheetData): string {
  const payload: SharePayload = { v: SHARE_VERSION, kind: 'chord', d: slimChart(sheet) };
  return toBase64Url(JSON.stringify(payload));
}

/** Serialize a note sheet (melody/solo) into the share token. */
export function encodeNoteSheet(sheet: NoteSheetData): string {
  const payload: SharePayload = { v: SHARE_VERSION, kind: 'note', d: sheet };
  return toBase64Url(JSON.stringify(payload));
}

/** Decode a share token into a chord chart or note sheet. Returns null on any
 *  malformed input. A missing `kind` is treated as a chord (original format). */
export function decodeShare(encoded: string | null | undefined): DecodedShare | null {
  if (!encoded) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as Partial<SharePayload>;
    const data = parsed?.d as (LeadSheetData & NoteSheetData) | undefined;
    if (!data || typeof data.title !== 'string') return null;
    if (parsed.kind === 'note') {
      if (!Array.isArray(data.measures)) return null;
      return { kind: 'note', data: data as NoteSheetData };
    }
    if (!Array.isArray(data.systems)) return null;
    return { kind: 'chord', data: data as LeadSheetData };
  } catch {
    return null;
  }
}

/** Deployed web app origin. In the native iOS shell the runtime origin is
 *  `capacitor://localhost` (or `file://`), which is unreachable from anyone
 *  else's device — a link built from it would be dead the moment it's sent. So
 *  share links must point at the public web app. On the web we use the live
 *  origin instead, so dev/staging links resolve to wherever you're running. */
const PUBLIC_WEB_ORIGIN = 'https://jazzify.app';

function shareOrigin(): string {
  const origin = window.location.origin;
  return origin.startsWith('http') ? origin : PUBLIC_WEB_ORIGIN;
}

/** Build the full public share URL for a chord chart (HashRouter `/v` route). */
export function buildShareUrl(sheet: LeadSheetData): string {
  return `${shareOrigin()}/${SHARE_ROUTE}?d=${encodeChart(sheet)}`;
}

/** Build the full public share URL for a note sheet (HashRouter `/v` route). */
export function buildNoteShareUrl(sheet: NoteSheetData): string {
  return `${shareOrigin()}/${SHARE_ROUTE}?d=${encodeNoteSheet(sheet)}`;
}

/** Hand a URL to the OS share sheet (Web Share API). Returns true if the share
 *  UI was shown or dismissed by the user; false when the API is unavailable and
 *  the caller should fall back to a copy-link modal. */
export async function tryNativeShare(title: string, url: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  try {
    await navigator.share({ title, url });
  } catch (err) {
    // User dismissed the sheet (AbortError) → handled; any other failure → fall back.
    return err instanceof Error && err.name === 'AbortError';
  }
  return true;
}
