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

const API_BASE = 'https://jazzify.p-e.kr/api';

/* ── Types (mirror the Swagger schemas) ──────────────────────────────── */

export type ChatType = 'direct' | 'rag' | string;
export type ChatCategory = 'overview' | string;

export interface ChatSummary {
  publicId: string;
  type: ChatType;
  title: string;
  category?: ChatCategory | null;
  songTitle?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatMessage {
  publicId: string;
  role: string;                       // 'user' | 'assistant' | 'system'
  content: string;
  sortOrder: number;
  createdAt: string;
}

export interface ChatDetail extends ChatSummary {
  messages: ChatMessage[];
}

/** Request body for POST /v1/chat/stream. `chatPublicId` is omitted on the
 *  first message (server creates a new chat and returns the ID via the
 *  X-Chat-Public-Id response header). */
export interface ChatStreamRequest {
  message: string;
  history?: { role: string; content: string }[];
  chordContext?: string;
  category?: ChatCategory;
  songTitle?: string;
  images?: { mediaType: string; data: string }[];
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
    return j.detail || j.message || j.code || '';
  } catch {
    return '';
  }
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
  detail.messages = detail.messages.map((m) =>
    m.role === 'user' ? { ...m, content: stripInternalInstructions(m.content) } : m,
  );
  return detail;
}

/** POST /v1/chat/stream — text/plain stream of the assistant reply.
 *  X-Chat-Public-Id response header identifies the chat. Streams the body
 *  via TextDecoder; on each tick, calls onChunk(accumulated). Returns the
 *  final accumulated text.
 *
 *  When `req.chatPublicId` is omitted, the server creates a NEW chat and
 *  the returned X-Chat-Public-Id is the brand-new id. Pass it back on the
 *  next call to continue the same chat.
 */
export async function streamChat(
  req: ChatStreamRequest,
  onChunk: (accumulated: string) => void,
  onChatPublicId?: (id: string) => void,
): Promise<string> {
  const res = await authFetch(`${API_BASE}/v1/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(`stream ${res.status} ${await readApiError(res)}`.trim());
  }
  const newPublicId = res.headers.get('X-Chat-Public-Id') || res.headers.get('x-chat-public-id');
  if (newPublicId && onChatPublicId) onChatPublicId(newPublicId);

  const reader = res.body?.getReader();
  if (!reader) throw new Error('stream: no body reader');

  const decoder = new TextDecoder();
  let accumulated = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    accumulated += decoder.decode(value, { stream: true });
    onChunk(accumulated);
  }
  // final flush — decoder may hold a partial multi-byte sequence
  const tail = decoder.decode();
  if (tail) {
    accumulated += tail;
    onChunk(accumulated);
  }

  return accumulated;
}

/** Request body for POST /v1/rag/chat. Backend runs multi-query + RRF
 *  retrieval and streams the LLM reply as text/plain — same envelope as
 *  /v1/chat/stream, but the body shape includes a structured chordContext
 *  object + chordContextText and a suppressInlineChart hint instead of the
 *  image-attach field. `chatPublicId` is again omitted on first message
 *  (server returns X-Chat-Public-Id header) and echoed back to continue. */
export interface RagChatStreamRequest {
  message: string;
  history?: { role: string; content: string }[];
  chordContext?: Record<string, unknown>;
  chordContextText?: string;
  songTitle?: string;
  suppressInlineChart?: boolean;
  chatPublicId?: string;
}

/* RAG debug-block markers — same protocol the HarmoRAG FastAPI server uses,
 * mirrored on the Spring `/v1/rag/chat` backend so the existing debug panel
 * keeps working regardless of which RAG path served the request. */
const RAG_OPEN  = '\x00RAG_DEBUG\x00';
const RAG_CLOSE = '\x00END_DEBUG\x00';

/** POST /v1/rag/chat — RAG-enhanced streaming chat. Same response envelope
 *  as streamChat (text/plain stream + X-Chat-Public-Id header) so call
 *  sites only need to swap the request body.
 *
 *  Response stream layout:
 *
 *     \x00RAG_DEBUG\x00 {json:RagDebugInfo} \x00END_DEBUG\x00 …assistant text…
 *
 *  The leading debug block is extracted, parsed into the RagDebugInfo
 *  shape and surfaced via `onDebug`. Everything after the closing marker
 *  is the actual LLM reply that streams into `onChunk(accumulated)`.
 *
 *  When the user is logged in the backend persists this chat in /v1/chat
 *  the same way /v1/chat/stream does, so the sidebar list picks it up.
 *  Pass back the returned id on follow-ups to append to the same session
 *  instead of creating a new chat each turn. */
export async function streamRagChat(
  req: RagChatStreamRequest,
  onChunk: (accumulated: string) => void,
  onChatPublicId?: (id: string) => void,
  onDebug?: (info: unknown) => void,
): Promise<string> {
  const res = await authFetch(`${API_BASE}/v1/rag/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  if (!res.ok) {
    throw new Error(`rag stream ${res.status} ${await readApiError(res)}`.trim());
  }
  const newPublicId = res.headers.get('X-Chat-Public-Id') || res.headers.get('x-chat-public-id');
  if (newPublicId && onChatPublicId) onChatPublicId(newPublicId);

  const reader = res.body?.getReader();
  if (!reader) throw new Error('rag stream: no body reader');

  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let debugParsed = false;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    /* Debug block (if any) sits at the very start of the stream. Parse it
     * exactly once — once parsed, every later chunk is plain reply text. */
    if (!debugParsed) {
      const openIdx  = buffer.indexOf(RAG_OPEN);
      const closeIdx = buffer.indexOf(RAG_CLOSE);
      if (openIdx !== -1 && closeIdx !== -1 && closeIdx > openIdx) {
        const jsonStr = buffer.slice(openIdx + RAG_OPEN.length, closeIdx);
        try {
          const info = JSON.parse(jsonStr);
          onDebug?.(info);
        } catch { /* malformed json — skip, still strip the markers */ }
        buffer = buffer.slice(closeIdx + RAG_CLOSE.length);
        debugParsed = true;
      } else if (openIdx === -1) {
        /* Stream started without any debug marker — no block to wait for. */
        debugParsed = true;
      } else {
        /* Opening marker present but closing not yet arrived — keep
         * buffering, don't flush to onChunk yet (we'd leak the marker). */
        continue;
      }
    }

    if (buffer) {
      accumulated += buffer;
      buffer = '';
      onChunk(accumulated);
    }
  }

  /* Flush any remaining bytes from the decoder's internal multi-byte
   * buffer. If the debug block never closed (server crashed mid-write?)
   * surface whatever text we collected — better than swallowing the
   * partial reply. */
  const tail = decoder.decode();
  if (tail) buffer += tail;
  if (!debugParsed) {
    /* Debug block was opened but never closed. Strip the open marker so
     * the user at least sees clean text, even if debug info is lost. */
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
