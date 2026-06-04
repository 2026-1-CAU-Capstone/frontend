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
import { streamWithRAG, type RagDebugInfo } from '../../api/harmorag';
import type { ClaudeImage, ClaudeMessage } from '../../api/claude';

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
    chatPublicId, loggedIn, signal, onChunk, onDebug, onNewChatPublicId,
    forceLocal = false,
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

  /* Local HarmoRAG path — direct call to the FastAPI server. Runs for
   * anonymous users AND as fallback when the backend errored above. */
  try {
    finalText = await streamWithRAG(
      textForLLM,
      history,
      contextForModel,
      songTitle,
      onChunk,
      onDebug,
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
