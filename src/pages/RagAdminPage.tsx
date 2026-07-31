import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useIsNativeUi } from '../contexts/AppPreviewContext';
import { IconSidebar } from '../components/layout/IconSidebar';
import { openAiChatSheet } from '../lib/nativeShell';
import {
  Page, DetailBody, DetailHeader, DetailHeaderRow, DetailBackBtn, DetailTitle,
} from '../components/projects/sharedStyles';
import {
  listRagDocuments, getRagDocument, getRagDocumentChunks,
  createRagDocument, updateRagDocument, deleteRagDocument,
  confirmRagDocument, rejectRagDocument,
  type RagDocumentSummary, type RagDocument, type RagDocumentChunk,
  type RagDocumentInput, type RagConfirmInput, type RagSourceType, type RagStatus,
} from '../api/rag';

/* ─────────────────────────────────────────────────────────────────────────
 * RagAdminPage (/admin/rag) — admin 전용 RAG 문서 관리 + 검수.
 *
 * 분류(sourceType)와 검수 상태(status)는 별개 축이다.
 *   sourceType: standard | lesson | null(미분류, candidate)
 *   status:     candidate(대기) | confirmed(확정·색인됨) | rejected(반려)
 * confirmed 만 벡터 색인되어 검색·채팅에 노출된다.
 *
 * 탭: [검수 대기] [스탠다드] [레슨] [반려함]. 검수 대기 문서는 원본 전사문을 보고
 * 반려/확정(분류 선택 + 편집)한다. 확정 시 청킹·임베딩·색인이 실행된다(수 초).
 * ──────────────────────────────────────────────────────────────────────── */

type TabKey = 'candidate' | 'standard' | 'lesson' | 'rejected';
type DetailTab = 'content' | 'chunks' | 'meta';

const TABS: { key: TabKey; label: string; params: { status?: RagStatus; sourceType?: string } }[] = [
  { key: 'candidate', label: '검수 대기', params: { status: 'candidate' } },
  { key: 'standard', label: '스탠다드', params: { status: 'confirmed', sourceType: 'standard' } },
  { key: 'lesson', label: '레슨', params: { status: 'confirmed', sourceType: 'lesson' } },
  { key: 'rejected', label: '반려함', params: { status: 'rejected' } },
];

/** content 없이 문서를 추가할 때 백엔드 파서(RagFileChunker)가 요구하는 섹션 포맷.
 *  이게 없으면 RAG_014(섹션 추출 실패)로 확정이 거부된다. */
const CONTENT_TEMPLATE = `### 1-1. 섹션 제목

**instruction:** 여기에 질문을 적습니다.

**response:** 여기에 답변(청크 본문)을 적습니다.`;

function sourceLabel(s: RagSourceType | null): string {
  return s === 'lesson' ? '레슨' : s === 'standard' ? '스탠다드' : '미분류';
}

export default function RagAdminPage() {
  const navigate = useNavigate();
  const isNativeUi = useIsNativeUi();

  const [tabKey, setTabKey] = useState<TabKey>('candidate');
  const [query, setQuery] = useState('');
  const [docs, setDocs] = useState<RagDocumentSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [listLoading, setListLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RagDocument | null>(null);
  const [chunks, setChunks] = useState<RagDocumentChunk[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [tab, setTab] = useState<DetailTab>('chunks');

  const [modal, setModal] = useState<null | { mode: 'create' } | { mode: 'edit' | 'confirm'; doc: RagDocument }>(null);
  const [deleteTarget, setDeleteTarget] = useState<RagDocumentSummary | RagDocument | null>(null);
  const [busyAction, setBusyAction] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2600);
  }, []);

  const tabParams = TABS.find((t) => t.key === tabKey)!.params;

  /* 목록 로드 — 탭/검색 변경 시. */
  useEffect(() => {
    let alive = true;
    const run = async () => {
      setListLoading(true);
      setListError(null);
      try {
        const page = await listRagDocuments({ size: 500, ...tabParams, q: query.trim() || undefined });
        if (!alive) return;
        setDocs(page.content ?? []);
        setTotal(page.totalElements ?? page.content?.length ?? 0);
      } catch (e) {
        if (alive) setListError(e instanceof Error ? e.message : '목록을 불러오지 못했습니다.');
      } finally {
        if (alive) setListLoading(false);
      }
    };
    const t = window.setTimeout(run, query ? 250 : 0);
    return () => { alive = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKey, query]);

  /* 상세 로드 — 선택 변경 시. confirmed 는 청크 탭, candidate/rejected 는 청크가 없으니 전사문 탭. */
  useEffect(() => {
    if (!selectedId) { setDetail(null); setChunks([]); return; }
    let alive = true;
    setDetailLoading(true);
    Promise.all([getRagDocument(selectedId), getRagDocumentChunks(selectedId).catch(() => [])])
      .then(([d, c]) => {
        if (!alive) return;
        setDetail(d);
        setChunks(c);
        setTab(d.status === 'confirmed' ? 'chunks' : 'content');
      })
      .catch((e) => { if (alive) { flash(e instanceof Error ? e.message : '문서를 불러오지 못했습니다.'); setSelectedId(null); } })
      .finally(() => { if (alive) setDetailLoading(false); });
    return () => { alive = false; };
  }, [selectedId, flash]);

  const reloadList = useCallback(async () => {
    const page = await listRagDocuments({ size: 500, ...tabParams, q: query.trim() || undefined });
    setDocs(page.content ?? []);
    setTotal(page.totalElements ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabKey, query]);

  const refreshDetail = useCallback((d: RagDocument) => {
    setDetail(d);
    setSelectedId(d.publicId);
    getRagDocumentChunks(d.publicId).then(setChunks).catch(() => setChunks([]));
    setTab(d.status === 'confirmed' ? 'chunks' : 'content');
  }, []);

  const handleSave = useCallback(async (body: RagDocumentInput, editingId?: string) => {
    const saved = editingId ? await updateRagDocument(editingId, body) : await createRagDocument(body);
    setModal(null);
    await reloadList();
    refreshDetail(saved);
    flash(editingId ? '문서를 수정했습니다.' : '문서를 추가했습니다.');
  }, [reloadList, refreshDetail, flash]);

  const handleConfirm = useCallback(async (body: RagConfirmInput, id: string) => {
    const saved = await confirmRagDocument(id, body);
    setModal(null);
    await reloadList();
    // 확정하면 현재 탭(검수 대기/반려함)에서 사라지므로 선택 해제.
    setSelectedId(null);
    flash('확정하고 색인했습니다.');
    return saved;
  }, [reloadList, flash]);

  const handleReject = useCallback(async (doc: RagDocument) => {
    setBusyAction(true);
    try {
      await rejectRagDocument(doc.publicId);
      await reloadList();
      setSelectedId(null);
      flash('반려했습니다.');
    } catch (e) {
      flash(e instanceof Error ? e.message : '반려에 실패했습니다.');
    } finally {
      setBusyAction(false);
    }
  }, [reloadList, flash]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    await deleteRagDocument(deleteTarget.publicId);
    setDeleteTarget(null);
    if (selectedId === deleteTarget.publicId) setSelectedId(null);
    await reloadList();
    flash('문서를 삭제했습니다.');
  }, [deleteTarget, selectedId, reloadList, flash]);

  const copy = useCallback((text: string, label: string) => {
    navigator.clipboard?.writeText(text).then(
      () => flash(`${label} 복사됨`),
      () => flash('복사에 실패했습니다.'),
    );
  }, [flash]);

  const askAi = useCallback((doc: RagDocument) => {
    navigator.clipboard?.writeText(`[RAG 문서: ${doc.title}]\n\n${doc.content}`).catch(() => {});
    openAiChatSheet({ chat: 'new' });
    flash('문서를 복사하고 새 채팅을 열었습니다 — 붙여넣어 질문하세요');
  }, [flash]);

  return (
    <Page>
      {!isNativeUi && <IconSidebar />}
      <DetailBody>
        <DetailHeader>
          <DetailHeaderRow>
            <DetailBackBtn type="button" aria-label="뒤로" onClick={() => navigate(-1)}>
              <BackArrow />
            </DetailBackBtn>
            <DetailTitle>RAG 문서 관리</DetailTitle>
            <HeaderRight>
              <CountPill title="현재 탭 문서 수">{total}건</CountPill>
              <NewBtn type="button" onClick={() => setModal({ mode: 'create' })}>
                <PlusIcon /> 새 문서
              </NewBtn>
            </HeaderRight>
          </DetailHeaderRow>
        </DetailHeader>

        <Split>
          <ListPane $detailOpen={!!selectedId}>
            <Toolbar>
              <Tabs role="tablist">
                {TABS.map((t) => (
                  <Tab key={t.key} $on={tabKey === t.key} onClick={() => { setTabKey(t.key); setSelectedId(null); }}>
                    {t.label}
                  </Tab>
                ))}
              </Tabs>
              <SearchWrap>
                <SearchIcon />
                <SearchInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="제목·slug 검색" />
                {query && <ClearBtn type="button" aria-label="지우기" onClick={() => setQuery('')}>✕</ClearBtn>}
              </SearchWrap>
            </Toolbar>

            {listError && <ErrorBar>{listError}</ErrorBar>}
            {listLoading && <SkeletonNote>불러오는 중…</SkeletonNote>}
            {!listLoading && docs.length === 0 && !listError && (
              <EmptyNote>{tabKey === 'candidate' ? '검수 대기 문서가 없습니다.' : tabKey === 'rejected' ? '반려된 문서가 없습니다.' : '문서가 없습니다.'}{query ? ' (검색 중)' : ''}</EmptyNote>
            )}

            <DocList>
              {docs.map((d) => (
                <DocRow key={d.publicId} $on={d.publicId === selectedId} onClick={() => setSelectedId(d.publicId)}>
                  <RowTop>
                    <SourceBadge $kind={d.sourceType}>{sourceLabel(d.sourceType)}</SourceBadge>
                    <RowTitle>{d.title || d.slug || '제목 없음'}</RowTitle>
                  </RowTop>
                  <RowMeta>
                    {d.status === 'confirmed' && <ChunkCount>청크 {d.chunkCount}</ChunkCount>}
                    {d.status !== 'confirmed' && <StatusDot $status={d.status}>{d.status === 'candidate' ? '검수 대기' : '반려됨'}</StatusDot>}
                    {(d.topicTags ?? []).slice(0, 3).map((t) => <TagChip key={t}>{t}</TagChip>)}
                  </RowMeta>
                </DocRow>
              ))}
            </DocList>
          </ListPane>

          <DetailPane $open={!!selectedId}>
            {!selectedId ? (
              <Placeholder>
                <PlaceholderIcon><RagGlyph /></PlaceholderIcon>
                <PlaceholderText>왼쪽에서 문서를 선택하세요</PlaceholderText>
              </Placeholder>
            ) : detailLoading || !detail ? (
              <SkeletonNote style={{ margin: 24 }}>문서를 불러오는 중…</SkeletonNote>
            ) : (
              <>
                <DetailScroll>
                  <BackToList type="button" onClick={() => setSelectedId(null)}>← 목록</BackToList>
                  <DHeadRow>
                    <SourceBadge $kind={detail.sourceType}>{sourceLabel(detail.sourceType)}</SourceBadge>
                    <StatusBadge $status={detail.status}>
                      {detail.status === 'confirmed' ? '확정' : detail.status === 'candidate' ? '검수 대기' : '반려됨'}
                    </StatusBadge>
                    <DHeadTitle>{detail.title || detail.slug || '제목 없음'}</DHeadTitle>
                  </DHeadRow>
                  <DMetaLine>
                    <span>slug: <code>{detail.slug || '—'}</code></span>
                    {detail.status === 'confirmed' && <span>청크 {detail.chunkCount}개</span>}
                    <span>embedding v{detail.embeddingVersion}</span>
                  </DMetaLine>
                  {detail.sourceUrl && (
                    <SourceUrlRow>
                      <SourceUrlLink href={detail.sourceUrl} target="_blank" rel="noreferrer">🔗 원본 링크</SourceUrlLink>
                      <MiniBtn type="button" onClick={() => copy(detail.sourceUrl!, '원본 링크')}>복사</MiniBtn>
                    </SourceUrlRow>
                  )}

                  {detail.status !== 'confirmed' && (
                    <ReviewHint>
                      {detail.status === 'candidate'
                        ? '검수 대기 문서입니다. 원본 전사문을 확인하고 아래에서 반려하거나, 분류를 정해 확정하세요. 확정 시 색인되어 검색에 노출됩니다.'
                        : '반려된 문서입니다. 다시 확정하면 반려가 취소되고 색인됩니다.'}
                    </ReviewHint>
                  )}

                  <TabBar role="tablist">
                    <DetailTabBtn $on={tab === 'content'} onClick={() => setTab('content')}>원본 전사문</DetailTabBtn>
                    {detail.status === 'confirmed' && (
                      <DetailTabBtn $on={tab === 'chunks'} onClick={() => setTab('chunks')}>청크 {chunks.length}</DetailTabBtn>
                    )}
                    <DetailTabBtn $on={tab === 'meta'} onClick={() => setTab('meta')}>메타데이터</DetailTabBtn>
                  </TabBar>

                  {tab === 'content' && <ContentBox>{detail.content || '(내용 없음)'}</ContentBox>}

                  {tab === 'chunks' && (
                    <ChunkList>
                      {chunks.length === 0 && <EmptyNote>색인된 청크가 없습니다.</EmptyNote>}
                      {chunks.map((c) => (
                        <ChunkCard key={c.chunkId}>
                          <ChunkHead>
                            {c.sectionId && <SectionId>{c.sectionId}</SectionId>}
                            <ChunkTitle>{c.title || '(제목 없음)'}</ChunkTitle>
                            <LevelChip>Lv.{c.level}</LevelChip>
                          </ChunkHead>
                          {c.instruction && <ChunkQ>Q. {c.instruction}</ChunkQ>}
                          <ChunkBody>{c.response}</ChunkBody>
                          {(c.topicTags ?? []).length > 0 && (
                            <ChunkTags>{c.topicTags.map((t) => <TagChip key={t}>{t}</TagChip>)}</ChunkTags>
                          )}
                        </ChunkCard>
                      ))}
                    </ChunkList>
                  )}

                  {tab === 'meta' && (
                    <MetaTable>
                      {Object.entries(detail.metadata ?? {}).length === 0 && <EmptyNote>메타데이터가 없습니다.</EmptyNote>}
                      {Object.entries(detail.metadata ?? {}).map(([k, v]) => (
                        <MetaTableRow key={k}><MetaKey>{k}</MetaKey><MetaVal>{String(v)}</MetaVal></MetaTableRow>
                      ))}
                      {(detail.topicTags ?? []).length > 0 && (
                        <MetaTableRow><MetaKey>topicTags</MetaKey><MetaVal>{detail.topicTags.join(', ')}</MetaVal></MetaTableRow>
                      )}
                    </MetaTable>
                  )}
                </DetailScroll>

                {/* 상태별 액션 바 */}
                {detail.status === 'confirmed' ? (
                  <ActionBar>
                    <ActBtn type="button" onClick={() => copy(detail.content, '전사문')}>📋 복사</ActBtn>
                    <ActBtn type="button" onClick={() => askAi(detail)}>🎷 AI에게 보기</ActBtn>
                    <ActBtn type="button" onClick={() => setModal({ mode: 'edit', doc: detail })}>✏️ 수정</ActBtn>
                    <ActBtn type="button" $danger disabled={busyAction} onClick={() => void handleReject(detail)}>↩︎ 반려(색인 제거)</ActBtn>
                    <ActBtn type="button" $danger onClick={() => setDeleteTarget(detail)}>🗑 삭제</ActBtn>
                  </ActionBar>
                ) : (
                  <ActionBar>
                    <ActBtn type="button" onClick={() => copy(detail.content, '전사문')}>📋 복사</ActBtn>
                    <ActBtn type="button" onClick={() => askAi(detail)}>🎷 AI에게 보기</ActBtn>
                    {detail.status === 'candidate' && (
                      <ActBtn type="button" $danger disabled={busyAction} onClick={() => void handleReject(detail)}>✕ 반려</ActBtn>
                    )}
                    <ConfirmActBtn type="button" onClick={() => setModal({ mode: 'confirm', doc: detail })}>
                      ✓ {detail.status === 'rejected' ? '반려 취소·확정' : '확정하기'}
                    </ConfirmActBtn>
                  </ActionBar>
                )}
              </>
            )}
          </DetailPane>
        </Split>
      </DetailBody>

      {modal && (
        <DocEditModal
          mode={modal.mode}
          initial={modal.mode === 'create' ? null : modal.doc}
          onClose={() => setModal(null)}
          onSaveDoc={handleSave}
          onConfirmDoc={handleConfirm}
        />
      )}
      {deleteTarget && (
        <ConfirmModal onClick={() => setDeleteTarget(null)}>
          <ConfirmCard onClick={(e) => e.stopPropagation()}>
            <ConfirmTitle>문서를 삭제할까요?</ConfirmTitle>
            <ConfirmText>“{deleteTarget.title || deleteTarget.slug}” 을(를) 삭제하면 색인된 청크도 함께 제거됩니다. 되돌릴 수 없습니다.</ConfirmText>
            <ConfirmActionsRow>
              <GhostBtn type="button" onClick={() => setDeleteTarget(null)}>취소</GhostBtn>
              <DangerBtn type="button" onClick={() => void handleDelete()}>삭제</DangerBtn>
            </ConfirmActionsRow>
          </ConfirmCard>
        </ConfirmModal>
      )}
      {toast && <Toast>{toast}</Toast>}
    </Page>
  );
}

/* ── 생성/수정/확정 모달 ─────────────────────────────────────────────────── */
function DocEditModal({
  mode, initial, onClose, onSaveDoc, onConfirmDoc,
}: {
  mode: 'create' | 'edit' | 'confirm';
  initial: RagDocument | null;
  onClose: () => void;
  onSaveDoc: (body: RagDocumentInput, editingId?: string) => Promise<void>;
  onConfirmDoc: (body: RagConfirmInput, id: string) => Promise<RagDocument>;
}) {
  const isConfirm = mode === 'confirm';
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [sourceType, setSourceType] = useState<RagSourceType>((initial?.sourceType as RagSourceType) || 'standard');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [tags, setTags] = useState((initial?.topicTags ?? []).join(', '));
  const [content, setContent] = useState(initial?.content ?? CONTENT_TEMPLATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const canSave = slug.trim() && title.trim() && content.trim() && !busy;

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const tagList = tags.split(',').map((t) => t.trim()).filter(Boolean);
      if (isConfirm && initial) {
        await onConfirmDoc({ sourceType, slug: slug.trim(), title: title.trim(), content, topicTags: tagList }, initial.publicId);
      } else {
        await onSaveDoc(
          { slug: slug.trim(), sourceType, title: title.trim(), content, metadata: initial?.metadata ?? {}, topicTags: tagList },
          initial?.publicId,
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장에 실패했습니다.');
      setBusy(false);
    }
  };

  const heading = isConfirm ? '문서 확정 (검수)' : initial ? '문서 수정' : '새 RAG 문서';
  const cta = isConfirm ? (busy ? '색인 중… (수 초 소요)' : '확정 & 색인') : busy ? '저장 중…' : initial ? '수정' : '추가';

  return (
    <ModalBackdrop onClick={() => { if (!busy) onClose(); }}>
      <ModalCard onClick={(e) => e.stopPropagation()}>
        <ModalTitle>{heading}</ModalTitle>
        {isConfirm && (
          <ConfirmNote>분류를 정하고 필요하면 본문을 다듬은 뒤 확정하세요. 확정하면 청킹·임베딩이 실행되어 검색에 노출됩니다.</ConfirmNote>
        )}
        <Field>
          <FieldLabel>제목</FieldLabel>
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="예: Autumn Leaves 분석" />
        </Field>
        <Row2>
          <Field>
            <FieldLabel>slug (고유 식별자)</FieldLabel>
            <TextInput value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="autumn-leaves" disabled={mode === 'edit'} />
          </Field>
          <Field style={{ flex: '0 0 auto' }}>
            <FieldLabel>분류{isConfirm ? ' (필수)' : ''}</FieldLabel>
            <Segmented>
              <SegBtn type="button" $on={sourceType === 'standard'} onClick={() => setSourceType('standard')}>스탠다드</SegBtn>
              <SegBtn type="button" $on={sourceType === 'lesson'} onClick={() => setSourceType('lesson')}>레슨</SegBtn>
            </Segmented>
          </Field>
        </Row2>
        <Field>
          <FieldLabel>태그 (쉼표로 구분)</FieldLabel>
          <TextInput value={tags} onChange={(e) => setTags(e.target.value)} placeholder="1625, dim7" />
        </Field>
        <Field>
          <FieldLabel>본문 (content)</FieldLabel>
          <FormatHint>
            섹션마다 <code>### 1-1. 제목</code> + <code>**instruction:**</code> / <code>**response:**</code> 형식이어야
            청크로 정확히 색인됩니다. 앞 숫자(1·3)가 레벨입니다. 형식이 없으면 확정이 거부됩니다(RAG_014).
          </FormatHint>
          <TextArea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
        </Field>
        {error && <ModalError>{error}</ModalError>}
        <ModalActions>
          <GhostBtn type="button" disabled={busy} onClick={onClose}>취소</GhostBtn>
          <PrimaryBtn type="button" disabled={!canSave} onClick={() => void submit()}>{cta}</PrimaryBtn>
        </ModalActions>
      </ModalCard>
    </ModalBackdrop>
  );
}

/* ── icons ──────────────────────────────────────────────────────────────── */
const BackArrow = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6" />
  </svg>
);
const PlusIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);
const SearchIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.2" y2="16.2" />
  </svg>
);
const RagGlyph = () => (
  <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
    <path d="M4 11v6c0 1.66 3.58 3 8 3 1.2 0 2.34-.1 3.36-.28" />
    <circle cx="18" cy="18" r="3" /><line x1="20.5" y1="20.5" x2="22" y2="22" />
  </svg>
);

/* ── styled ─────────────────────────────────────────────────────────────── */
const GOLD = '#B8860B';
const GOLD_TINT = 'rgba(184,134,11,0.10)';

const HeaderRight = styled.div` display: flex; align-items: center; gap: 10px; margin-left: auto; `;
const CountPill = styled.span`
  font-size: 12.5px; font-weight: 600; color: #8a7a52; background: ${GOLD_TINT};
  padding: 5px 11px; border-radius: 999px; white-space: nowrap;
`;
const NewBtn = styled.button`
  display: inline-flex; align-items: center; gap: 6px; padding: 8px 15px; border: none; border-radius: 10px;
  background: ${GOLD}; color: #fff; font-size: 13.5px; font-weight: 700; cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui};
  &:hover { background: #a5790a; } &:active { transform: scale(0.97); }
`;

const Split = styled.div` flex: 1; min-height: 0; display: flex; background: ${({ theme }) => theme.colors.barBelow}; `;
const ListPane = styled.div<{ $detailOpen: boolean }>`
  width: 380px; flex: 0 0 auto; display: flex; flex-direction: column; min-height: 0;
  background: #fff; border-right: 1px solid #ececec;
  @media (max-width: 860px) { width: 100%; ${({ $detailOpen }) => ($detailOpen ? 'display: none;' : '')} }
`;
const DetailPane = styled.div<{ $open: boolean }>`
  flex: 1; min-width: 0; display: flex; flex-direction: column; min-height: 0;
  @media (max-width: 860px) { ${({ $open }) => (!$open ? 'display: none;' : '')} }
`;

const Toolbar = styled.div` padding: 14px 14px 10px; border-bottom: 1px solid #f0f0f0; display: flex; flex-direction: column; gap: 10px; `;
const Tabs = styled.div` display: flex; gap: 6px; flex-wrap: wrap; `;
const Tab = styled.button<{ $on: boolean }>`
  padding: 6px 13px; border: none; border-radius: 999px; cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui}; font-size: 13px;
  font-weight: ${({ $on }) => ($on ? 700 : 500)};
  color: ${({ $on }) => ($on ? '#fff' : '#666')};
  background: ${({ $on }) => ($on ? GOLD : '#f1f1ef')};
  &:hover { background: ${({ $on }) => ($on ? '#a5790a' : '#e8e8e6')}; }
`;
const SearchWrap = styled.div`
  display: flex; align-items: center; gap: 8px; padding: 0 11px; background: #f4f4f2;
  border-radius: 9px; color: #999; height: 38px;
`;
const SearchInput = styled.input`
  flex: 1; min-width: 0; border: none; background: transparent; outline: none;
  font-family: ${({ theme }) => theme.fonts.ui}; font-size: 14px; color: #1a1a1a;
`;
const ClearBtn = styled.button` border: none; background: transparent; color: #aaa; cursor: pointer; font-size: 13px; &:hover { color: #666; } `;

const DocList = styled.div` flex: 1; min-height: 0; overflow-y: auto; padding: 6px; `;
const DocRow = styled.button<{ $on: boolean }>`
  width: 100%; text-align: left; display: flex; flex-direction: column; gap: 6px;
  padding: 11px 12px; border: none; border-radius: 11px; cursor: pointer;
  background: ${({ $on }) => ($on ? GOLD_TINT : 'transparent')};
  box-shadow: ${({ $on }) => ($on ? `inset 3px 0 0 ${GOLD}` : 'none')};
  font-family: ${({ theme }) => theme.fonts.ui};
  &:hover { background: ${({ $on }) => ($on ? GOLD_TINT : '#f6f6f4')}; }
`;
const RowTop = styled.div` display: flex; align-items: center; gap: 8px; min-width: 0; `;
const RowTitle = styled.span`
  flex: 1; min-width: 0; font-size: 14px; font-weight: 600; color: #1a1a1a;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
`;
const RowMeta = styled.div` display: flex; align-items: center; gap: 6px; flex-wrap: wrap; `;
const ChunkCount = styled.span` font-size: 11.5px; color: #999; `;
const StatusDot = styled.span<{ $status: RagStatus }>`
  font-size: 11px; font-weight: 600;
  color: ${({ $status }) => ($status === 'candidate' ? '#b07a1a' : '#a04c4c')};
`;
const SourceBadge = styled.span<{ $kind?: RagSourceType | null }>`
  flex: 0 0 auto; font-size: 10.5px; font-weight: 700; padding: 3px 8px; border-radius: 6px;
  color: ${({ $kind }) => ($kind === 'lesson' ? '#2570c8' : $kind === 'standard' ? '#9a6800' : '#888')};
  background: ${({ $kind }) => ($kind === 'lesson' ? 'rgba(43,138,239,0.12)' : $kind === 'standard' ? 'rgba(214,152,18,0.16)' : '#eeeeee')};
`;
const StatusBadge = styled.span<{ $status: RagStatus }>`
  flex: 0 0 auto; font-size: 10.5px; font-weight: 700; padding: 3px 8px; border-radius: 6px;
  color: ${({ $status }) => ($status === 'confirmed' ? '#2d8f5e' : $status === 'candidate' ? '#b07a1a' : '#a04c4c')};
  background: ${({ $status }) => ($status === 'confirmed' ? 'rgba(45,143,94,0.12)' : $status === 'candidate' ? 'rgba(214,152,18,0.14)' : 'rgba(196,92,92,0.12)')};
`;
const TagChip = styled.span` font-size: 10.5px; color: #777; background: #f0f0ee; padding: 2px 7px; border-radius: 5px; `;

const DetailScroll = styled.div` flex: 1; min-height: 0; overflow-y: auto; padding: 20px 24px 8px; `;
const BackToList = styled.button`
  display: none; margin-bottom: 12px; border: none; background: transparent; color: ${GOLD};
  font-size: 13px; font-weight: 600; cursor: pointer; padding: 0;
  @media (max-width: 860px) { display: inline-block; }
`;
const DHeadRow = styled.div` display: flex; align-items: center; gap: 8px; margin-bottom: 8px; flex-wrap: wrap; `;
const DHeadTitle = styled.h2` margin: 0; flex: 1 1 100%; font-size: 20px; font-weight: 800; color: #1a1a1a; letter-spacing: -0.01em; `;
const DMetaLine = styled.div`
  display: flex; flex-wrap: wrap; gap: 14px; font-size: 12.5px; color: #999; margin-bottom: 12px;
  code { background: #f0f0ee; padding: 1px 6px; border-radius: 5px; color: #666; }
`;
const SourceUrlRow = styled.div` display: flex; align-items: center; gap: 10px; margin-bottom: 14px; `;
const SourceUrlLink = styled.a` font-size: 13px; color: #2570c8; text-decoration: none; &:hover { text-decoration: underline; } `;
const MiniBtn = styled.button` border: 1px solid #e0e0e0; background: #fff; border-radius: 7px; padding: 3px 9px; font-size: 11.5px; color: #666; cursor: pointer; &:hover { background: #f6f6f4; } `;
const ReviewHint = styled.div`
  font-size: 12.5px; line-height: 1.55; color: #8a7a52; background: ${GOLD_TINT};
  padding: 10px 13px; border-radius: 10px; margin-bottom: 14px;
`;

const TabBar = styled.div` display: flex; gap: 4px; border-bottom: 1px solid #ececec; margin-bottom: 16px; `;
const DetailTabBtn = styled.button<{ $on: boolean }>`
  border: none; background: transparent; cursor: pointer; padding: 9px 4px; margin-right: 14px;
  font-family: ${({ theme }) => theme.fonts.ui}; font-size: 13.5px;
  font-weight: ${({ $on }) => ($on ? 700 : 500)};
  color: ${({ $on }) => ($on ? '#1a1a1a' : '#999')};
  border-bottom: 2px solid ${({ $on }) => ($on ? GOLD : 'transparent')}; margin-bottom: -1px;
`;
const ContentBox = styled.pre`
  white-space: pre-wrap; word-break: break-word; font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13.5px; line-height: 1.7; color: #333; background: #fff; margin: 0;
  border: 1px solid #eee; border-radius: 12px; padding: 18px;
`;
const ChunkList = styled.div` display: flex; flex-direction: column; gap: 12px; `;
const ChunkCard = styled.div` border: 1px solid #eee; border-radius: 12px; padding: 14px 16px; background: #fff; `;
const ChunkHead = styled.div` display: flex; align-items: center; gap: 8px; margin-bottom: 8px; `;
const SectionId = styled.span` font-size: 11px; font-weight: 700; color: #fff; background: ${GOLD}; padding: 2px 8px; border-radius: 6px; `;
const ChunkTitle = styled.span` flex: 1; min-width: 0; font-size: 14px; font-weight: 700; color: #1a1a1a; `;
const LevelChip = styled.span` font-size: 11px; color: #888; background: #f1f1ef; padding: 2px 8px; border-radius: 6px; `;
const ChunkQ = styled.div` font-size: 13px; font-weight: 600; color: #555; margin-bottom: 6px; `;
const ChunkBody = styled.div` font-size: 13px; line-height: 1.65; color: #444; white-space: pre-wrap; `;
const ChunkTags = styled.div` display: flex; gap: 5px; flex-wrap: wrap; margin-top: 10px; `;

const MetaTable = styled.div` display: flex; flex-direction: column; border: 1px solid #eee; border-radius: 12px; overflow: hidden; `;
const MetaTableRow = styled.div` display: flex; border-bottom: 1px solid #f2f2f2; &:last-child { border-bottom: none; } `;
const MetaKey = styled.div` flex: 0 0 140px; padding: 10px 14px; font-size: 12.5px; font-weight: 600; color: #888; background: #fafafa; `;
const MetaVal = styled.div` flex: 1; min-width: 0; padding: 10px 14px; font-size: 13px; color: #333; word-break: break-word; `;

const ActionBar = styled.div`
  flex: 0 0 auto; display: flex; gap: 8px; padding: 12px 24px calc(12px + env(safe-area-inset-bottom, 0px));
  border-top: 1px solid #ececec; background: #fff; flex-wrap: wrap;
`;
const ActBtn = styled.button<{ $danger?: boolean }>`
  display: inline-flex; align-items: center; gap: 6px; padding: 9px 15px; border-radius: 10px; cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui}; font-size: 13px; font-weight: 600;
  border: 1px solid ${({ $danger }) => ($danger ? 'rgba(196,92,92,0.4)' : '#e2e2e2')};
  background: ${({ $danger }) => ($danger ? 'rgba(196,92,92,0.06)' : '#fff')};
  color: ${({ $danger }) => ($danger ? '#c04c4c' : '#444')};
  &:hover { background: ${({ $danger }) => ($danger ? 'rgba(196,92,92,0.12)' : '#f6f6f4')}; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
const ConfirmActBtn = styled.button`
  margin-left: auto; display: inline-flex; align-items: center; gap: 6px; padding: 9px 18px; border-radius: 10px;
  border: none; cursor: pointer; font-family: ${({ theme }) => theme.fonts.ui}; font-size: 13px; font-weight: 700;
  background: #2d8f5e; color: #fff; &:hover { background: #26794f; } &:active { transform: scale(0.97); }
`;

const Placeholder = styled.div` flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; color: #ccc; `;
const PlaceholderIcon = styled.div` color: #d8d0b8; `;
const PlaceholderText = styled.div` font-size: 14px; color: #aaa; `;
const SkeletonNote = styled.div` padding: 14px; font-size: 13px; color: #999; `;
const EmptyNote = styled.div` padding: 24px 14px; font-size: 13px; color: #aaa; text-align: center; `;
const ErrorBar = styled.div` margin: 10px 14px; padding: 9px 12px; border-radius: 9px; background: rgba(160,48,34,0.08); color: #a03022; font-size: 12.5px; `;

/* 모달 */
const ModalBackdrop = styled.div`
  position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: ${({ theme }) => theme.zIndex.max};
  display: flex; align-items: center; justify-content: center; padding: 24px;
`;
const ModalCard = styled.div`
  background: #fff; border-radius: 16px; width: min(600px, 100%); max-height: 90vh; overflow-y: auto;
  padding: 24px; box-shadow: 0 16px 48px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 14px;
  font-family: ${({ theme }) => theme.fonts.ui};
`;
const ModalTitle = styled.h2` margin: 0; font-size: 18px; font-weight: 800; color: #1a1a1a; `;
const ConfirmNote = styled.div` font-size: 12.5px; line-height: 1.5; color: #2d8f5e; background: rgba(45,143,94,0.08); padding: 9px 12px; border-radius: 9px; `;
const Field = styled.div` display: flex; flex-direction: column; gap: 6px; flex: 1; min-width: 0; `;
const Row2 = styled.div` display: flex; gap: 12px; align-items: flex-end; `;
const FieldLabel = styled.label` font-size: 12.5px; font-weight: 600; color: #777; `;
const TextInput = styled.input`
  height: 38px; padding: 0 12px; border: 1px solid #e0e0e6; border-radius: 9px; outline: none;
  font-family: ${({ theme }) => theme.fonts.ui}; font-size: 14px; color: #1a1a1a;
  &:focus { border-color: ${GOLD}; } &:disabled { background: #f6f6f4; color: #999; }
`;
const TextArea = styled.textarea`
  min-height: 240px; resize: vertical; padding: 12px; border: 1px solid #e0e0e6; border-radius: 9px; outline: none;
  font-family: ${({ theme }) => theme.fonts.chord}; font-size: 13px; line-height: 1.6; color: #1a1a1a;
  &:focus { border-color: ${GOLD}; }
`;
const FormatHint = styled.div`
  font-size: 11.5px; line-height: 1.5; color: #8a7a52; background: ${GOLD_TINT}; padding: 8px 11px; border-radius: 8px;
  code { background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 4px; font-family: ${({ theme }) => theme.fonts.chord}; }
`;
const Segmented = styled.div` display: inline-flex; background: #f1f1ef; border-radius: 9px; padding: 3px; `;
const SegBtn = styled.button<{ $on: boolean }>`
  border: none; border-radius: 7px; padding: 7px 14px; cursor: pointer; font-size: 13px;
  font-family: ${({ theme }) => theme.fonts.ui}; font-weight: ${({ $on }) => ($on ? 700 : 500)};
  color: ${({ $on }) => ($on ? '#fff' : '#777')}; background: ${({ $on }) => ($on ? GOLD : 'transparent')};
`;
const ModalError = styled.div` font-size: 12.5px; color: #c0392b; `;
const ModalActions = styled.div` display: flex; justify-content: flex-end; gap: 10px; margin-top: 4px; `;
const GhostBtn = styled.button`
  border: none; background: transparent; color: #888; cursor: pointer; padding: 9px 16px; border-radius: 9px;
  font-family: ${({ theme }) => theme.fonts.ui}; font-size: 13.5px; font-weight: 600;
  &:hover { background: #f2f2f2; color: #555; } &:disabled { opacity: 0.5; }
`;
const PrimaryBtn = styled.button`
  border: none; background: ${GOLD}; color: #fff; cursor: pointer; padding: 9px 20px; border-radius: 9px;
  font-family: ${({ theme }) => theme.fonts.ui}; font-size: 13.5px; font-weight: 700;
  &:hover { background: #a5790a; } &:disabled { opacity: 0.45; cursor: not-allowed; }
`;
const ConfirmModal = styled(ModalBackdrop)``;
const ConfirmCard = styled(ModalCard)` width: min(400px, 100%); gap: 10px; `;
const ConfirmTitle = styled.h2` margin: 0; font-size: 17px; font-weight: 800; color: #1a1a1a; `;
const ConfirmText = styled.p` margin: 0; font-size: 13.5px; line-height: 1.6; color: #666; `;
const ConfirmActionsRow = styled.div` display: flex; justify-content: flex-end; gap: 10px; margin-top: 8px; `;
const DangerBtn = styled(PrimaryBtn)` background: #c04c4c; &:hover { background: #a83e3e; } `;

const Toast = styled.div`
  position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%); z-index: ${({ theme }) => theme.zIndex.toast};
  background: #1a1a1a; color: #fff; font-size: 13px; font-weight: 500; padding: 11px 18px; border-radius: 10px;
  box-shadow: 0 6px 20px rgba(0,0,0,0.25); font-family: ${({ theme }) => theme.fonts.ui}; max-width: 90vw;
`;
