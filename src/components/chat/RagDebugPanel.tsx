import { useState } from 'react';
import styled from 'styled-components';
import type { RagDebugInfo, RagChunk } from '../../api/harmorag';

/* ── 컨테이너 ── */
const Panel = styled.div<{ $offline?: boolean }>`
  margin: 6px 12px;
  border: 1px solid ${({ $offline }) => ($offline ? '#e57373' : '#c8b400')};
  border-radius: 8px;
  background: ${({ $offline }) => ($offline ? '#fdecea' : '#fffde7')};
  font-family: 'JetBrains Mono', 'Menlo', monospace;
  font-size: 11.5px;
  overflow: hidden;
`;

const Header = styled.button<{ $offline?: boolean }>`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: 11.5px;
  color: ${({ $offline }) => ($offline ? '#a02020' : '#5a4800')};
  font-weight: 600;

  &:hover { background: rgba(0,0,0,0.04); }
`;

const Badge = styled.span<{ $color?: string }>`
  display: inline-block;
  padding: 1px 6px;
  border-radius: 10px;
  background: ${({ $color }) => $color ?? '#c8b400'};
  color: #fff;
  font-size: 10px;
  font-weight: 700;
`;

const Body = styled.div`
  padding: 0 12px 10px;
  border-top: 1px solid #f0e06a;
`;

/* ── 쿼리 섹션 ── */
const Section = styled.div`
  margin-top: 8px;
`;

const SectionTitle = styled.div`
  font-size: 10px;
  font-weight: 700;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 4px;
`;

const QueryRow = styled.div`
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 2px 0;
  color: #333;
`;

const QueryText = styled.span`
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const LvTag = styled.span`
  flex-shrink: 0;
  font-size: 10px;
  color: #999;
`;

/* ── 청크 섹션 ── */
const ChunkList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const ChunkCard = styled.div`
  border: 1px solid #e8d800;
  border-radius: 5px;
  overflow: hidden;
`;

const ChunkHeader = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  background: #fffce0;
  border: none;
  cursor: pointer;
  text-align: left;
  font-family: inherit;
  font-size: 11px;
  color: #333;

  &:hover { background: #fff9c4; }
`;

/* Fixed-width track so the row's gap stays consistent across scores. The
 * inner fill renders the actual pct — no trailing whitespace at low scores. */
const ScoreBar = styled.div`
  width: 60px;
  height: 6px;
  background: rgba(0, 0, 0, 0.07);
  border-radius: 3px;
  flex-shrink: 0;
  overflow: hidden;
`;

const ScoreBarFill = styled.div<{ $pct: number }>`
  width: ${({ $pct }) => Math.max(0, Math.min(1, $pct)) * 100}%;
  height: 100%;
  background: ${({ $pct }) =>
    $pct > 0.6 ? '#43a047' : $pct > 0.35 ? '#fb8c00' : '#bdbdbd'};
  border-radius: 3px;
`;

const ScoreNum = styled.span<{ $pct: number }>`
  flex-shrink: 0;
  font-weight: 700;
  color: ${({ $pct }) =>
    $pct > 0.6 ? '#2e7d32' : $pct > 0.35 ? '#e65100' : '#757575'};
`;

const ChunkBody = styled.div`
  padding: 6px 8px;
  background: #fff;
  border-top: 1px solid #f5e500;
  color: #444;
  line-height: 1.55;
  white-space: pre-wrap;
  font-size: 11px;
`;

/* ── 컴포넌트 ── */

function ChunkItem({ chunk }: { chunk: RagChunk }) {
  const [open, setOpen] = useState(false);
  const pct = chunk.score;
  const matchCount = chunk.matched_queries?.length ?? 1;

  // YouTube 출처면 정확한 시점(mm:ss)으로 가는 딥링크를 만든다.
  const isVideo = !!(chunk.video_id || chunk.video_url) && chunk.start_sec != null;
  const ts = Math.max(0, Math.floor(chunk.start_sec ?? 0));
  const videoUrl = isVideo
    ? (chunk.video_url || `https://www.youtube.com/watch?v=${chunk.video_id}&t=${ts}s`)
    : '';
  const mmss = `${Math.floor(ts / 60)}:${String(ts % 60).padStart(2, '0')}`;

  return (
    <ChunkCard>
      <ChunkHeader onClick={() => setOpen(v => !v)}>
        <ScoreBar>
          <ScoreBarFill $pct={pct} />
        </ScoreBar>
        <ScoreNum $pct={pct}>{pct.toFixed(3)}</ScoreNum>
        {chunk.rrf_score != null && (
          <span
            title={`RRF score (정렬 기준) — ${matchCount}개 sub-query에서 회수됨`}
            style={{
              flexShrink: 0,
              fontSize: 10,
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: 3,
              background: matchCount > 1 ? '#1976d2' : '#90a4ae',
              color: '#fff',
            }}
          >
            RRF {chunk.rrf_score.toFixed(4)}
            {matchCount > 1 ? ` ×${matchCount}` : ''}
          </span>
        )}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {chunk.title}
        </span>
        <span style={{ color: '#aaa', fontSize: 10, flexShrink: 0 }}>
          {chunk.song} · Lv{chunk.level}
        </span>
        <span style={{ fontSize: 10, color: '#bbb', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </ChunkHeader>
      {open && (
        <ChunkBody>
          <div style={{ color: '#888', fontSize: 10, marginBottom: 4 }}>
            id: {chunk.id}
          </div>
          {isVideo && (
            <div style={{ fontSize: 10, marginBottom: 6 }}>
              🎬{' '}
              <a href={videoUrl} target="_blank" rel="noopener noreferrer"
                 style={{ color: '#b3261e', fontWeight: 600 }}>
                {chunk.channel ? `${chunk.channel} · ` : ''}영상 {mmss} 지점 열기
              </a>
            </div>
          )}
          {(() => {
            const mqs = (chunk.matched_queries ?? [])
              .map(cleanDebugQuery)
              .filter((q) => q && !INTERNAL_LEFTOVER_RE.test(q));
            return mqs.length > 0 ? (
              <div style={{ color: '#888', fontSize: 10, marginBottom: 6 }}>
                회수한 sub-query ({mqs.length}개):
                <ul style={{ margin: '2px 0 0 14px', padding: 0 }}>
                  {mqs.map((q, i) => (
                    <li key={i} style={{ listStyle: 'disc' }}>"{q}"</li>
                  ))}
                </ul>
              </div>
            ) : null;
          })()}
          {chunk.response}
        </ChunkBody>
      )}
    </ChunkCard>
  );
}

interface RagDebugPanelProps {
  info: RagDebugInfo;
}

/* The lick-recommendation / glick turns send an AUGMENTED prompt as the RAG
 * query (user question + a long hidden "[내부 지시 …]" instruction block + the
 * matched [LICK:id] list). We only want the user-facing question to show in
 * this debug box — strip everything from the internal-instruction header on,
 * and drop any sub-query that is purely internal-instruction text. */
const INTERNAL_LEFTOVER_RE = /\[내부\s*지시|\[LICK:|사용\s*가능한\s*릭|```glick|```chart/;
function cleanDebugQuery(q: string): string {
  return (q ?? '').split(/\[내부\s*지시/)[0].trim();
}

export function RagDebugPanel({ info }: RagDebugPanelProps) {
  const offline = info.status === 'offline';
  const [open, setOpen] = useState(!offline);  // offline은 접힌 채로 시작

  const topScore = info.chunks[0]?.score ?? 0;
  const badgeColor = topScore > 0.6 ? '#388e3c' : topScore > 0.35 ? '#f57c00' : '#9e9e9e';

  return (
    <Panel $offline={offline}>
      <Header $offline={offline} onClick={() => setOpen(v => !v)}>
        <span>{offline ? '⚠️ HarmoRAG' : '🔍 HarmoRAG'}</span>
        {offline ? (
          <Badge $color="#c62828">OFFLINE</Badge>
        ) : (
          <>
            <Badge $color="#388e3c">CONNECTED</Badge>
            <Badge $color={badgeColor}>top {(topScore * 100).toFixed(0)}%</Badge>
            {info.fusion === 'rrf' && (
              <Badge $color="#1976d2" title={`Reciprocal Rank Fusion (k=${info.rrf_k ?? 60})`}>
                RRF
              </Badge>
            )}
          </>
        )}
        <span style={{ fontWeight: 400, color: offline ? '#a06060' : '#888' }}>
          {offline
            ? '직접 Claude 호출 (RAG 미적용)'
            : `${info.queries?.length ?? 0}개 쿼리 · ${info.total_retrieved ?? 0}개 검색 · ${info.chunks?.length ?? 0}개 사용`}
        </span>
        <span style={{ marginLeft: 'auto', color: '#bbb', fontSize: 10 }}>{open ? '▲' : '▼'}</span>
      </Header>

      {open && (
        <Body>
          {/* 에러 / 오프라인 안내 */}
          {info.error && (
            <div style={{ color: '#c62828', padding: '4px 0', whiteSpace: 'pre-wrap' }}>
              ❌ {info.error}
            </div>
          )}
          {info.serverUrl && (
            <div style={{ color: '#888', fontSize: 10, padding: '2px 0 4px' }}>
              endpoint: {info.serverUrl}
            </div>
          )}

          {/* 쿼리 목록 — connected일 때만 */}
          {!offline && (
            <>
              <Section>
                <SectionTitle>생성된 쿼리</SectionTitle>
                {info.queries
                  ?.map((q) => ({ ...q, query: cleanDebugQuery(q.query) }))
                  .filter((q) => q.query && !INTERNAL_LEFTOVER_RE.test(q.query))
                  .map((q, i) => (
                  <QueryRow key={i}>
                    <span style={{ color: '#bbb', flexShrink: 0 }}>{i + 1}.</span>
                    <QueryText title={q.query}>{q.query}</QueryText>
                    <LvTag>
                      {q.level != null ? `lv${q.level}` : 'all'}
                      {q.tag ? ` · ${q.tag}` : ''}
                    </LvTag>
                  </QueryRow>
                ))}
              </Section>

              <Section>
                <SectionTitle>검색 결과 (top {info.top_k})</SectionTitle>
                <ChunkList>
                  {info.chunks?.map((chunk) => (
                    <ChunkItem key={chunk.id} chunk={chunk} />
                  ))}
                </ChunkList>
              </Section>
            </>
          )}
        </Body>
      )}
    </Panel>
  );
}
