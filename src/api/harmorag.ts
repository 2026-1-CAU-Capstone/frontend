/**
 * HarmoRAG — FastAPI 서버를 통한 RAG 강화 Claude 호출
 * 서버가 꺼져 있으면 자동으로 직접 Claude 호출로 폴백
 *
 * Endpoint 결정 우선순위:
 *   1. VITE_RAG_BASE                — 임시 Mac mini 서버 / 정식 백엔드 URL
 *   2. http://127.0.0.1:8001        — 로컬 개발용 폴백
 *
 * (선택) VITE_RAG_TOKEN 가 설정돼 있으면 Authorization: Bearer 헤더가
 * 자동으로 붙습니다. tmp-rag-server/.env 의 RAG_AUTH_TOKEN 과 같은 값을
 * 사용하세요.
 */

import { streamClaudeMessage, type ClaudeMessage, type ClaudeImage } from './claude';
import { isNativeApp } from '../lib/platform';

const RAG_SERVER =
  (import.meta.env.VITE_RAG_BASE as string | undefined)?.trim().replace(/\/+$/, '')
  || 'http://127.0.0.1:8001';

const RAG_TOKEN = (import.meta.env.VITE_RAG_TOKEN as string | undefined)?.trim() || '';

function authHeaders(base: Record<string, string> = {}): Record<string, string> {
  return RAG_TOKEN ? { ...base, Authorization: `Bearer ${RAG_TOKEN}` } : base;
}

const RAG_OPEN  = '\x00RAG_DEBUG\x00';
const RAG_CLOSE = '\x00END_DEBUG\x00';

export interface RagChunk {
  id: string;
  score: number;                       // cosine similarity (참고용)
  rrf_score?: number;                  // Reciprocal Rank Fusion score (정렬 기준)
  title: string;
  song: string;
  level: number;
  matched_query: string;               // 첫 번째 매칭 쿼리 (하위 호환)
  matched_queries?: string[];          // 이 청크를 회수한 모든 sub-query
  response: string;
}

export interface RagDebugInfo {
  queries: Array<{ query: string; level: number | null; tag: string | null }>;
  total_retrieved: number;
  top_k: number;
  fusion?: 'rrf' | 'score';            // 융합 방식 (서버가 알려줌)
  rrf_k?: number;
  chunks: RagChunk[];
  error?: string;
  /** Connection status — set by the client (not the server) so the debug
   *  panel can render even when RAG is unreachable. 'connected' = RAG /chat
   *  was used; 'offline' = server unreachable, fell back to direct Claude. */
  status?: 'connected' | 'offline';
  /** Which RAG endpoint the client tried — handy for diagnosing a build that
   *  baked in the wrong VITE_RAG_BASE (e.g. localhost on a deployed site). */
  serverUrl?: string;
}

let serverAlive: boolean | null = null;

async function checkServer(): Promise<boolean> {
  if (serverAlive !== null) return serverAlive;
  // 네이티브 앱(iOS/Android WebView)에선 localhost 자체가 의미 없으므로
  // 로컬호스트 endpoint면 폴백. 공용 URL(https)이면 정상 체크 진행.
  const isLocalEndpoint = /(localhost|127\.0\.0\.1)/.test(RAG_SERVER);
  if (isNativeApp() && isLocalEndpoint) {
    serverAlive = false;
    return serverAlive;
  }
  try {
    const res = await fetch(`${RAG_SERVER}/health`, {
      headers: authHeaders(),
      signal: AbortSignal.timeout(1500),
    });
    serverAlive = res.ok;
  } catch {
    serverAlive = false;
  }
  setTimeout(() => { serverAlive = null; }, 30_000);
  return serverAlive;
}

export async function streamWithRAG(
  message: string,
  history: ClaudeMessage[],
  chordContextText: string | undefined,
  songTitle: string,
  onChunk: (accumulated: string) => void,
  onDebug?: (info: RagDebugInfo) => void,
  images?: ClaudeImage[],
): Promise<string> {
  // Image attachments → skip RAG (text retrieval is meaningless for an image)
  // and go straight to Claude's vision call so it can read the picture/score.
  if (images && images.length > 0) {
    return streamClaudeMessage(message, history, chordContextText, onChunk, undefined, images);
  }

  const alive = await checkServer();

  if (!alive) {
    console.info('[HarmoRAG] 서버 꺼짐 → 직접 Claude 호출');
    // Demo mode: still surface a debug panel so the user can SEE that RAG is
    // offline (instead of the panel silently never appearing). Tells them
    // which URL was tried — useful for diagnosing a wrong baked-in build URL.
    onDebug?.({
      status: 'offline',
      serverUrl: RAG_SERVER,
      error: `RAG 서버에 연결할 수 없습니다 (${RAG_SERVER}) — 직접 Claude 호출로 폴백`,
      queries: [],
      total_retrieved: 0,
      top_k: 0,
      chunks: [],
    });
    return streamClaudeMessage(message, history, chordContextText, onChunk);
  }

  console.info('[HarmoRAG] 서버 연결됨 → RAG 강화 호출');

  try {
    const res = await fetch(`${RAG_SERVER}/chat`, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        message,
        chord_context_text: chordContextText ?? null,
        history: history.map(h => ({ role: h.role, content: h.content })),
        song_title: songTitle,
        // The user already sees this song's chord chart on screen, so we
        // don't want the AI to regenerate it. The server can honor this
        // by stripping chart blocks for the in-context song.
        suppress_inline_chart: !!chordContextText,
      }),
    });

    if (!res.ok) throw new Error(`서버 오류 ${res.status}`);

    const reader = res.body?.getReader();
    if (!reader) throw new Error('스트림 없음');

    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';
    let debugParsed = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // RAG 디버그 블록 파싱 (스트림 앞부분에서 한 번만)
      if (!debugParsed) {
        const openIdx  = buffer.indexOf(RAG_OPEN);
        const closeIdx = buffer.indexOf(RAG_CLOSE);

        if (openIdx !== -1 && closeIdx !== -1) {
          const jsonStr = buffer.slice(openIdx + RAG_OPEN.length, closeIdx);
          try {
            const info = JSON.parse(jsonStr) as RagDebugInfo;
            onDebug?.({ ...info, status: 'connected', serverUrl: RAG_SERVER });
          } catch { /* 무시 */ }
          // 디버그 블록 제거, 나머지만 남김
          buffer = buffer.slice(closeIdx + RAG_CLOSE.length);
          debugParsed = true;
        } else {
          // 디버그 블록이 아직 덜 왔으면 기다림
          continue;
        }
      }

      accumulated += buffer;
      buffer = '';
      onChunk(accumulated);
    }

    // 버퍼에 남은 내용 처리
    if (buffer) {
      accumulated += buffer;
      onChunk(accumulated);
    }

    return accumulated || '[응답 없음]';

  } catch (err) {
    console.warn('[HarmoRAG] 오류, 직접 Claude로 폴백:', err);
    serverAlive = false;
    onDebug?.({
      status: 'offline',
      serverUrl: RAG_SERVER,
      error: `RAG 호출 중 오류 — 직접 Claude 호출로 폴백 (${err instanceof Error ? err.message : String(err)})`,
      queries: [],
      total_retrieved: 0,
      top_k: 0,
      chunks: [],
    });
    return streamClaudeMessage(message, history, chordContextText, onChunk);
  }
}
