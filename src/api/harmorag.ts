/**
 * HarmoRAG — FastAPI 서버를 통한 RAG 강화 Claude 호출
 * 서버: localhost:8001 (rag/server.py)
 *
 * 서버가 꺼져 있으면 자동으로 직접 Claude 호출로 폴백
 */

import { streamClaudeMessage, type ClaudeMessage } from './claude';

const RAG_SERVER = 'http://localhost:8001';

/** 서버 alive 여부 캐시 (매번 health check 안 하려고) */
let serverAlive: boolean | null = null;

async function checkServer(): Promise<boolean> {
  if (serverAlive !== null) return serverAlive;
  try {
    const res = await fetch(`${RAG_SERVER}/health`, { signal: AbortSignal.timeout(800) });
    serverAlive = res.ok;
  } catch {
    serverAlive = false;
  }
  // 30초 후 재확인
  setTimeout(() => { serverAlive = null; }, 30_000);
  return serverAlive;
}

/**
 * HarmoRAG 스트리밍 호출
 * - 서버 가동 중: RAG 컨텍스트 주입 후 Claude
 * - 서버 꺼짐: 기존 직접 Claude 호출로 폴백
 */
export async function streamWithRAG(
  message: string,
  history: ClaudeMessage[],
  chordContextText: string | undefined,
  songTitle: string,
  onChunk: (accumulated: string) => void,
): Promise<string> {
  const alive = await checkServer();

  if (!alive) {
    // 폴백: 기존 방식 그대로
    console.info('[HarmoRAG] 서버 꺼짐 → 직접 Claude 호출');
    return streamClaudeMessage(message, history, chordContextText, onChunk);
  }

  console.info('[HarmoRAG] 서버 연결됨 → RAG 강화 호출');

  try {
    const res = await fetch(`${RAG_SERVER}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        chord_context_text: chordContextText ?? null,
        history: history.map(h => ({ role: h.role, content: h.content })),
        song_title: songTitle,
      }),
    });

    if (!res.ok) {
      throw new Error(`서버 오류 ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('스트림 없음');

    const decoder = new TextDecoder();
    let accumulated = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value, { stream: true });
      onChunk(accumulated);
    }

    return accumulated || '[응답 없음]';

  } catch (err) {
    console.warn('[HarmoRAG] 오류, 직접 Claude로 폴백:', err);
    serverAlive = false;
    return streamClaudeMessage(message, history, chordContextText, onChunk);
  }
}
