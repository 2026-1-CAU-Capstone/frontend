/**
 * runChatStream — the streaming-turn dispatcher extracted from
 * RightChatPanel.handleSend. Picks a transport based on the user's auth
 * state + attachment kind and falls back to the local HarmoRAG path when
 * the backend stream errors.
 *
 *   - logged-in            → POST /v1/chat/stream (RAG-everywhere; backend
 *                            persists the chat in /v1/chat).
 *   - logged-in + abort    → returns with aborted=true, no error.
 *   - logged-in + error    → falls through to local HarmoRAG (textForLLM
 *                            keeps client-only tricks like [LICK:id] /
 *                            ```glick that the backend can't honor).
 *   - anonymous            → straight to local HarmoRAG (no auth needed).
 *
 * Returns a single result object so the caller doesn't juggle ok/err
 * branches itself. UI streaming is done via the onChunk / onDebug /
 * onNewPublicId callbacks while the stream is in flight.
 */
import { streamChat } from '../../api/chat';
import type { RagDebugInfo } from '../../api/harmorag';
import { streamClaudeMessage, type ClaudeImage, type ClaudeMessage } from '../../api/claude';

export interface RunChatStreamArgs {
  /** Raw user text (DB-safe — no `[내부 지시 …]` injections). */
  text: string;
  /** Augmented text fed to the local HarmoRAG path (lick / glick prompts). */
  textForLLM: string;
  images: ClaudeImage[];
  contextForModel: string | undefined;
  songTitle: string;
  history: ClaudeMessage[];
  chatPublicId: string | null;
  /** Chart origin → selects the categorized backend stream endpoint
   *  (chord/sheet project). undefined → global/direct chat. */
  chartKind?: 'chord' | 'sheet' | null;
  /** publicId of the originating chord/sheet PROJECT — required by the
   *  categorized endpoints so the chat is reopenable on that chart. */
  projectPublicId?: string | null;
  loggedIn: boolean;
  signal: AbortSignal;
  onChunk: (accumulated: string) => void;
  onDebug: (info: RagDebugInfo) => void;
  /** Fires once when the backend assigns a new chatPublicId (first turn
   *  of a brand-new chat). Caller should mirror it into its ref so
   *  subsequent turns continue the same session. */
  onNewChatPublicId: (id: string) => void;
  /** Skip the backend transport entirely (force local HarmoRAG). Used
   *  for lick-recommendation / glick-generation turns whose `textForLLM`
   *  carries client-only `[내부 지시 …]` blocks the backend can't honor.
   *  Persistence is sacrificed for those ephemeral suggestion turns. */
  forceLocal?: boolean;
}

export interface RunChatStreamResult {
  finalText: string;
  aborted: boolean;
  /** Non-null when both the backend AND the local fallback failed. Caller
   *  surfaces this as an inline error + Retry affordance. */
  error: Error | null;
}

/* Convert ClaudeImage[] → backend wire format. Empty array → undefined so
 * the field is omitted from the request body. */
function toBackendImages(
  images: ClaudeImage[],
): Array<{ mediaType: string; data: string }> | undefined {
  if (images.length === 0) return undefined;
  return images.map((img) => ({ mediaType: img.mediaType, data: img.data }));
}

export async function runChatStream(args: RunChatStreamArgs): Promise<RunChatStreamResult> {
  const {
    text, textForLLM, images, contextForModel, songTitle, history,
    chatPublicId, chartKind, projectPublicId, loggedIn, signal,
    onChunk, onDebug, onNewChatPublicId, forceLocal = false,
  } = args;

  let finalText = '';
  let aborted = false;
  let streamError: Error | null = null;

  const hasImages = images.length > 0;

  /* Backend path — only when logged in AND not forced to local. Falls
   * through to HarmoRAG on any non-abort failure. */
  if (loggedIn && !forceLocal) {
    try {
      finalText = await streamChat(
        {
          message: text,
          history: history.map((h) => ({
            role: h.role,
            content: typeof h.content === 'string'
              ? h.content
              : Array.isArray(h.content)
                ? h.content.map((b) => (typeof b === 'string' ? b : (b as { text?: string }).text ?? '')).join('')
                : '',
          })),
          chordContextText: contextForModel || undefined,
          songTitle: songTitle || undefined,
          // Categorized endpoints (now supported by the backend): when this chat
          // originates from a chord/sheet PROJECT, `chartKind` + `projectPublicId`
          // route it to /chord-project|sheet-project/stream so the backend
          // persists type=chordProject/category=chord (+ projectPublicId/songTitle).
          // That's what makes the Recent Chats row show the chart icon + song name
          // and reopen on the chart. (chartKind is stripped from the wire body in
          // streamChat; only projectPublicId is sent.)
          ...(chartKind && projectPublicId
            ? { chartKind, projectPublicId }
            : {}),
          images: toBackendImages(images),
          /* Vision turns skip RAG — image grounding beats corpus retrieval
           * and the backend's image-stream endpoint is non-RAG. */
          useRag: !hasImages,
          suppressInlineChart: !!contextForModel,
          chatPublicId: chatPublicId ?? undefined,
        },
        onChunk,
        onNewChatPublicId,
        (info) => onDebug(info as RagDebugInfo),
        signal,
      );
      return { finalText, aborted: false, error: null };
    } catch (e) {
      if (signal.aborted) {
        return { finalText, aborted: true, error: null };
      }
      streamError = e instanceof Error ? e : new Error(String(e));
      /* fall through to local HarmoRAG */
    }
  }

  /* Fallback — direct Claude (NO RAG). Runs for anonymous users AND when the
   * backend stream errored above. RAG now lives entirely on the backend
   * (/v1/chat/stream with useRag); the old self-hosted Mac-mini RAG server is
   * gone, so there's no RAG in this path — just a plain Claude reply. The
   * augmented `textForLLM` is still used so client-only tricks ([LICK:id] /
   * ```glick) keep working on this path. */
  try {
    finalText = await streamClaudeMessage(
      textForLLM,
      history,
      contextForModel,
      onChunk,
      undefined,
      images,
      signal,
    );
    streamError = null;
  } catch (e) {
    if (signal.aborted) {
      aborted = true;
    } else {
      streamError = e instanceof Error ? e : new Error(String(e));
    }
  }

  return { finalText, aborted, error: streamError };
}
