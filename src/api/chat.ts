/**
 * Chat — Jazzify backend (/v1/chat/*) client.
 *
 * Endpoints:
 *   GET  /v1/chat                 — list my chats (paginated)
 *   GET  /v1/chat/{publicId}      — chat detail + messages
 *   POST /v1/chat/stream          — stream Claude reply; X-Chat-Public-Id
 *                                   header identifies the chat (created or
 *                                   continued).
 *
 * Requires authentication (Bearer token via authFetch).
 *
 * Lightweight pub-sub on the side so the sidebar list refreshes when a new
 * chat is created and so clicking a chat in the sidebar loads its messages
 * in the right panel.
 */

import { authFetch } from './auth';
import type { ClaudeMessage, ClaudeImage } from './claude';
import type { components } from './schema';

type Schemas = components['schemas'];

/* Same base convention as solos.ts / licks.ts. authFetch() detects an
 * already-base-prefixed URL and does NOT re-prepend, so this stays a single
 * '/api/…' in dev (no '/api/api/…' double). */
const API_BASE = import.meta.env.DEV ? '/api' : 'https://jazzify.p-e.kr/api';

/* ── Types (mirror the Swagger schemas) ──────────────────────────────── */

export type ChatType = 'global' | 'chordProject' | 'sheetProject' | 'direct' | 'rag' | string;
export type ChatCategory = 'direct' | 'chord' | 'sheet' | 'overview' | string;

/* 타입 원천 = 생성 스키마(브릿지, BR-23 참조). 항상 오는 필드만 Required로 좁히고,
 * 프론트가 문자열/ null로 느슨하게 다루는 필드만 경계에서 명시. */
export type ChatSummary =
  Required<Omit<Schemas['ChatSummaryResponse'], 'type' | 'category' | 'songTitle' | 'projectPublicId'>>
  & {
      type: ChatType;
      category?: ChatCategory | null;
      songTitle?: string | null;
      /** Set for chats started from a chord/sheet PROJECT. Lets the Recent Chats
       *  sidebar reopen the originating chart directly. */
      projectPublicId?: string | null;
    };

export type ChatMessage = Required<Schemas['ChatMessageResponse']>;  // role: 'user'|'assistant'|'system'

export type ChatDetail = ChatSummary & { messages: ChatMessage[] };

/** Request body for POST /v1/chat/stream. `chatPublicId` is omitted on the
 *  first message (server creates a new chat and returns the ID via the
 *  X-Chat-Public-Id response header). */
export interface ChatStreamRequest {
  message: string;
  history?: { role: string; content: string }[];
  /** Structured chord-context object (used by the RAG path). */
  chordContext?: Record<string, unknown>;
  /** Plain-text chord context rendered into the prompt. */
  chordContextText?: string;
  category?: ChatCategory;
  songTitle?: string;
  /** Required by the chord-project / sheet-project stream endpoints — the
   *  backend stores it on the chat so the session is reopenable on that chart. */
  projectPublicId?: string;
  /** CLIENT-ONLY routing hint (NOT sent in the body): selects the categorized
   *  stream endpoint. 'chord' → /chord-project/stream, 'sheet' →
   *  /sheet-project/stream, undefined → /global/stream. */
  chartKind?: 'chord' | 'sheet';
  images?: { mediaType: string; data: string }[];
  /** When true the backend attaches RAG (multi-query + RRF over the corpus)
   *  and prefixes the stream with a \x00RAG_DEBUG\x00 … \x00END_DEBUG\x00
   *  block; otherwise it returns a plain Anthropic stream. */
  useRag?: boolean;
  /** Ask the backend NOT to emit an inline chord chart in the reply. */
  suppressInlineChart?: boolean;
  chatPublicId?: string;
}

interface Page<T> {
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
  size: number;
  content: T[];
  number: number;
}

/* ── Pub-sub: sidebar refresh + active chat selection ────────────────── */

type ListListener = () => void;
type ActiveListener = (publicId: string | null) => void;

const _listListeners = new Set<ListListener>();
const _activeListeners = new Set<ActiveListener>();
let _activeChatId: string | null = null;

/** Subscribe to chat-list changes (called whenever a new chat is created or
 *  an existing one is deleted/updated). Returns an unsubscribe function. */
export function onChatListChange(cb: ListListener): () => void {
  _listListeners.add(cb);
  return () => { _listListeners.delete(cb); };
}

export function notifyChatListChanged(): void {
  for (const cb of _listListeners) {
    try { cb(); } catch { /* swallow */ }
  }
}

/* ── Pending new-chat placeholder ─────────────────────────────────────────
 * When the user sends the first message of a brand-new chat, the backend
 * creates the chat lazily — it isn't listable until the request commits. So
 * the sidebar shows an optimistic placeholder (spinner) from send-start until
 * a fresh listChats() returns the new row. RightChatPanel drives this; the
 * Recent Chats list renders + clears it. */
export interface PendingChatInfo {
  songTitle: string | null;
  kind: 'chord' | 'sheet' | null;
}
let _pendingChat: PendingChatInfo | null = null;
const _pendingListeners = new Set<() => void>();

export function onPendingChatChange(cb: () => void): () => void {
  _pendingListeners.add(cb);
  return () => { _pendingListeners.delete(cb); };
}

export function setPendingChat(p: PendingChatInfo | null): void {
  _pendingChat = p;
  for (const cb of _pendingListeners) {
    try { cb(); } catch { /* swallow */ }
  }
}

export function getPendingChat(): PendingChatInfo | null {
  return _pendingChat;
}

/** Subscribe to "which chat is currently open in the right panel" changes.
 *  Sidebar items dispatch by calling setActiveChat(id); the right panel
 *  reacts by loading that chat's history (or clearing on null). Late
 *  subscribers immediately receive the current state. */
export function onActiveChatChange(cb: ActiveListener): () => void {
  _activeListeners.add(cb);
  try { cb(_activeChatId); } catch { /* swallow */ }
  return () => { _activeListeners.delete(cb); };
}

export function setActiveChat(publicId: string | null): void {
  _activeChatId = publicId;
  for (const cb of _activeListeners) {
    try { cb(publicId); } catch { /* swallow */ }
  }
}

export function getActiveChatId(): string | null {
  return _activeChatId;
}

/* ── REST ─────────────────────────────────────────────────────────────── */

/* Internal-instruction sentinel used by RightChatPanel when building textForLLM
 * (lick injection / glick generation prompts). If any legacy DB record contains
 * this marker in a stored user message, strip it on display so the user never
 * sees the augmented prompt. Belt-and-suspenders — going forward we send only
 * raw text in the `message` field, but this defends against historical leaks. */
const INTERNAL_INSTRUCTION_RE = /\n*\[내부 지시 — 유저에게 보이지 않음:[\s\S]*$/;
export function stripInternalInstructions(s: string): string {
  return s.replace(INTERNAL_INSTRUCTION_RE, '').trimEnd();
}

async function readApiError(res: Response): Promise<string> {
  try {
    const j = await res.json() as { code?: string; message?: string; detail?: string };
    // detail(백엔드 내부 예외 문자열)은 UI로 내보내지 않는다 — dev 콘솔만.
    if (import.meta.env.DEV && j.detail) console.debug(`[api ${res.status}] detail:`, j.detail);
    return j.message || j.code || '';
  } catch {
    return '';
  }
}

/* ── sidebar chat-list cache (localStorage) ──────────────────────────────
 * The recent-chats sidebar fetches GET /v1/chat on every mount, so a refresh
 * always flashed an empty "불러오는 중…" until the round-trip finished. We
 * cache the first page so the list paints instantly from localStorage and the
 * network result just reconciles it (stale-while-revalidate). */
const CHAT_LIST_CACHE_KEY = 'jazzify.chat.listCache';

export function getCachedChatList(): ChatSummary[] | null {
  try {
    const raw = window.localStorage.getItem(CHAT_LIST_CACHE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    // 비배열(키 충돌/스키마 변경/수동 변조)이면 RecentChatsList의 items.map에서
    // 사이드바가 통째로 죽는다 — 캐시를 버리고 자가 복구.
    if (!Array.isArray(parsed)) {
      window.localStorage.removeItem(CHAT_LIST_CACHE_KEY);
      return null;
    }
    return parsed as ChatSummary[];
  } catch { return null; }
}

export function setCachedChatList(list: ChatSummary[]): void {
  try { window.localStorage.setItem(CHAT_LIST_CACHE_KEY, JSON.stringify(list)); } catch { /* quota/private mode */ }
}

export function clearCachedChatList(): void {
  try { window.localStorage.removeItem(CHAT_LIST_CACHE_KEY); } catch { /* noop */ }
}

/** GET /v1/chat — paginated chat list (most recent first). Titles are
 *  scrubbed of any internal-instruction leak (backend may auto-title from
 *  the first user message, which historically included the augmented prompt). */
export async function listChats(opts: { page?: number; size?: number; sort?: string } = {}): Promise<Page<ChatSummary>> {
  const params = new URLSearchParams();
  params.set('page', String(opts.page ?? 0));
  params.set('size', String(opts.size ?? 30));
  params.set('sort', opts.sort ?? 'updatedAt,desc');
  const res = await authFetch(`${API_BASE}/v1/chat?${params.toString()}`);
  if (!res.ok) throw new Error(`chat list ${res.status} ${await readApiError(res)}`.trim());
  const json: { data: Page<ChatSummary> } = await res.json();
  const page = json.data;
  page.content = page.content.map((c) => ({ ...c, title: stripInternalInstructions(c.title) }));
  return page;
}

/** GET /v1/chat/{publicId} — full chat with message history. User messages
 *  are sanitized through stripInternalInstructions on the way out so any
 *  legacy DB rows with leaked `[내부 지시 ...]` blocks do not reach the UI. */
export async function getChat(publicId: string): Promise<ChatDetail> {
  const res = await authFetch(`${API_BASE}/v1/chat/${encodeURIComponent(publicId)}`);
  if (!res.ok) throw new Error(`chat get ${res.status} ${await readApiError(res)}`.trim());
  const json: { data: ChatDetail } = await res.json();
  const detail = json.data;
  // Defend against a detail payload that omits `messages` (or names it
  // differently) so a chord/sheet-project chat detail can't crash the loader.
  detail.messages = (detail.messages ?? []).map((m) =>
    (m.role || '').toLowerCase() === 'user'
      ? { ...m, content: stripInternalInstructions(m.content) }
      : m,
  );
  return detail;
}

/** DELETE /v1/chat/{publicId} — delete a chat session and its message history.
 *  Returns 204 No Content on success. */
export async function deleteChat(publicId: string): Promise<void> {
  const res = await authFetch(`${API_BASE}/v1/chat/${encodeURIComponent(publicId)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error(`chat delete ${res.status} ${await readApiError(res)}`.trim());
}

/* RAG debug-block markers — when `useRag` is set the backend prefixes the
 * stream with `\x00RAG_DEBUG\x00 {json} \x00END_DEBUG\x00` before the reply. */
const RAG_OPEN  = '\x00RAG_DEBUG\x00';
const RAG_CLOSE = '\x00END_DEBUG\x00';

/** POST /v1/chat/stream — single streaming chat endpoint.
 *
 *  `req.useRag=true` → backend attaches RAG context and prefixes the stream
 *  with a `\x00RAG_DEBUG\x00 … \x00END_DEBUG\x00` block (parsed out and handed
 *  to `onDebug`); otherwise it's a plain Anthropic stream. Either way the body
 *  is text/plain, streamed via TextDecoder → `onChunk(accumulated)`.
 *
 *  The `X-Chat-Public-Id` response header identifies the chat. When
 *  `req.chatPublicId` is omitted the server creates a NEW chat and returns its
 *  id here (via `onChatPublicId`); pass it back on the next turn to continue
 *  the same session. Returns the final accumulated reply text.
 */
export async function streamChat(
  req: ChatStreamRequest,
  onChunk: (accumulated: string) => void,
  onChatPublicId?: (id: string) => void,
  onDebug?: (info: unknown) => void,
  signal?: AbortSignal,
): Promise<string> {
  /* Pick the categorized stream endpoint. A chord/sheet PROJECT chat must go
   * through its own endpoint so the backend persists type=chordProject/category=chord
   * (+ projectPublicId/songTitle) — that's what drives the Recent Chats icon +
   * "reopen on the chart" behaviour. Everything else is a global/direct chat.
   * `chartKind` is a client-only hint; strip it from the wire body. */
  const { chartKind, ...body } = req;
  const path =
    chartKind === 'chord' && body.projectPublicId ? '/v1/chat/chord-project/stream'
    : chartKind === 'sheet' && body.projectPublicId ? '/v1/chat/sheet-project/stream'
    : '/v1/chat/global/stream';
  const res = await authFetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    throw new Error(`stream ${res.status} ${await readApiError(res)}`.trim());
  }
  const newPublicId = res.headers.get('X-Chat-Public-Id') || res.headers.get('x-chat-public-id');
  if (newPublicId && onChatPublicId) onChatPublicId(newPublicId);

  const reader = res.body?.getReader();
  if (!reader) throw new Error('stream: no body reader');

  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let debugParsed = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    /* Optional RAG debug block sits at the very start of the stream. Parse it
     * exactly once — once parsed (or proven absent), the rest is reply text. */
    if (!debugParsed) {
      const openIdx  = buffer.indexOf(RAG_OPEN);
      const closeIdx = buffer.indexOf(RAG_CLOSE);
      if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
        const jsonStr = buffer.slice(openIdx + RAG_OPEN.length, closeIdx);
        try { onDebug?.(JSON.parse(jsonStr)); } catch { /* malformed — still strip markers */ }
        buffer = buffer.slice(closeIdx + RAG_CLOSE.length);
        debugParsed = true;
      } else if (openIdx === -1) {
        /* Stream started without any debug marker — nothing to wait for. */
        debugParsed = true;
      } else {
        /* Opening marker present but closing not yet arrived — keep buffering,
         * don't flush to onChunk yet (we'd leak the marker). */
        continue;
      }
    }

    if (buffer) {
      accumulated += buffer;
      buffer = '';
      onChunk(accumulated);
    }
  }

  /* Flush any remaining bytes from the decoder's internal multi-byte buffer.
   * If the debug block never closed (server crashed mid-write?) strip the open
   * marker so the user still sees clean text rather than the raw marker. */
  const tail = decoder.decode();
  if (tail) buffer += tail;
  if (!debugParsed) {
    const openIdx = buffer.indexOf(RAG_OPEN);
    if (openIdx !== -1) buffer = buffer.slice(0, openIdx);
  }
  if (buffer) {
    accumulated += buffer;
    onChunk(accumulated);
  }

  return accumulated;
}

/* ── Helpers for adapting existing call sites ─────────────────────────── */

/** ClaudeMessage[] → backend history[] shape (just trims to {role, content}). */
export function toBackendHistory(history: ClaudeMessage[]): { role: string; content: string }[] {
  return history.map((h) => ({
    role: h.role,
    content: typeof h.content === 'string'
      ? h.content
      : Array.isArray(h.content)
        ? h.content.map((b) => (typeof b === 'string' ? b : (b as { text?: string }).text ?? '')).join('')
        : '',
  }));
}

/** ClaudeImage[] → backend images[] shape ({mediaType, data}). */
export function toBackendImages(images?: ClaudeImage[]): { mediaType: string; data: string }[] | undefined {
  if (!images || images.length === 0) return undefined;
  return images.map((img) => ({ mediaType: img.mediaType, data: img.data }));
}
