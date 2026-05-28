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

async function readApiError(res: Response): Promise<string> {
  try {
    const j = await res.json() as { code?: string; message?: string; detail?: string };
    return j.detail || j.message || j.code || '';
  } catch {
    return '';
  }
}

/** GET /v1/chat — paginated chat list (most recent first). */
export async function listChats(opts: { page?: number; size?: number; sort?: string } = {}): Promise<Page<ChatSummary>> {
  const params = new URLSearchParams();
  params.set('page', String(opts.page ?? 0));
  params.set('size', String(opts.size ?? 30));
  params.set('sort', opts.sort ?? 'updatedAt,desc');
  const res = await authFetch(`${API_BASE}/v1/chat?${params.toString()}`);
  if (!res.ok) throw new Error(`chat list ${res.status} ${await readApiError(res)}`.trim());
  const json: { data: Page<ChatSummary> } = await res.json();
  return json.data;
}

/** GET /v1/chat/{publicId} — full chat with message history. */
export async function getChat(publicId: string): Promise<ChatDetail> {
  const res = await authFetch(`${API_BASE}/v1/chat/${encodeURIComponent(publicId)}`);
  if (!res.ok) throw new Error(`chat get ${res.status} ${await readApiError(res)}`.trim());
  const json: { data: ChatDetail } = await res.json();
  return json.data;
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
