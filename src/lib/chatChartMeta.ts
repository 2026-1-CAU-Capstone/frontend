/* Client-side tag + mirror for chats started from a chord/sheet chart.
 *
 * Two jobs:
 *  1. Tag a chat's origin (chord vs sheet) + song name so the Recent Chats
 *     sidebar can render the right square icon + title.
 *  2. MIRROR the chat locally (publicId + updatedAt) so the sidebar can show it
 *     instantly — and keep showing it — even when the backend's chat list is
 *     slow to include it (or omits chart-context chats entirely). The chat
 *     itself is real (the backend returned its publicId), so clicking the row
 *     loads its messages normally.
 *
 * Data is tiny strings/numbers, so localStorage is fine.
 */

export type ChatChartKind = 'chord' | 'sheet';

export interface ChatChartMeta {
  kind: ChatChartKind;
  songTitle: string;
  /** ms epoch of the last activity — used to order the sidebar. */
  updatedAt: number;
  /** In-app route of the originating chart (e.g. "/mychord?project=…") so the
   *  sidebar can reopen that exact chart when the chat row is clicked. */
  route?: string;
}

export interface ChatChartEntry extends ChatChartMeta {
  publicId: string;
}

const KEY = 'jazzify.chat.chartMeta';
const listeners = new Set<() => void>();

function readAll(): Record<string, ChatChartMeta> {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // plain object가 아니면(배열/문자열 오염) Object.entries 소비자가 비정상
    // 동작한다 — 버리고 자가 복구.
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      window.localStorage.removeItem(KEY);
      return {};
    }
    return parsed as Record<string, ChatChartMeta>;
  } catch {
    return {};
  }
}

function writeAll(map: Record<string, ChatChartMeta>): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* private mode / quota — best-effort */
  }
  for (const cb of listeners) {
    try { cb(); } catch { /* swallow */ }
  }
}

/** Subscribe to any change (set/remove). Returns an unsubscribe fn. */
export function onChatChartMetaChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Tag a chat as originating from a chord/sheet chart. */
export function setChatChartMeta(chatId: string, meta: ChatChartMeta): void {
  if (!chatId) return;
  const all = readAll();
  all[chatId] = meta;
  writeAll(all);
}

/** Lookup a chat's chart origin, or null for a plain chat. */
export function getChatChartMeta(chatId: string): ChatChartMeta | null {
  return readAll()[chatId] ?? null;
}

/** Every locally-tracked chord/sheet chat (most-recent first). */
export function listChatChartMeta(): ChatChartEntry[] {
  return Object.entries(readAll())
    .map(([publicId, m]) => ({ publicId, ...m }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Drop a chat's tag (call when the chat is deleted). */
export function removeChatChartMeta(chatId: string): void {
  const all = readAll();
  if (chatId in all) {
    delete all[chatId];
    writeAll(all);
  }
}
