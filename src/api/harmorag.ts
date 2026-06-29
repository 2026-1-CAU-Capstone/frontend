/**
 * RAG shared types.
 *
 * RAG now runs entirely on the Jazzify backend (POST /v1/chat/stream with
 * `useRag`, plus /v1/rag/*). The old self-hosted Mac-mini FastAPI server
 * (reached via VITE_RAG_BASE / Tailscale Funnel / cloudflared) has been
 * removed — this file keeps only the response-shape types that the backend
 * streams back in its RAG_DEBUG block (parsed in api/chat.ts) and that the
 * chat UI (RagDebugPanel, ChatMessage citations) renders.
 */

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
  /** 출처 종류. 'youtube'면 아래 영상 필드가 채워져 인라인 인용이 영상
   *  딥링크(특정 시점)로 렌더링된다. 'standard'/'lesson'은 텍스트 출처. */
  source_type?: 'standard' | 'lesson' | 'youtube' | string;
  /** YouTube 출처일 때 — 인라인 인용 칩이 해당 영상의 정확한 시점으로 링크. */
  video_id?: string;
  video_url?: string;                  // 보통 ?t=NN 가 포함된 딥링크
  channel?: string;
  start_sec?: number;                  // 이 구절이 시작하는 초 (mm:ss 표시용)
  end_sec?: number;
}

export interface RagDebugInfo {
  queries: Array<{ query: string; level: number | null; tag: string | null }>;
  total_retrieved: number;
  top_k: number;
  fusion?: 'rrf' | 'score';            // 융합 방식 (서버가 알려줌)
  rrf_k?: number;
  chunks: RagChunk[];
  error?: string;
  /** Connection status. 'connected' = backend RAG ran for this turn. */
  status?: 'connected' | 'offline';
}
