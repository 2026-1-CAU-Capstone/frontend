import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { useTransitionState } from '../../hooks/useTransitionState';
import { getCachedUser } from '../../api/auth';
import { listChats, getCachedChatList, type ChatSummary } from '../../api/chat';
import { listChordProjects, type ChordProject } from '../../api/chordProjects';
import { listSheetProjects, type SheetProject } from '../../api/sheetProjects';
import { getSongIndex, type SongEntry } from '../../lib/ireal/irealLoader';
import { openAiChatSheet } from '../../lib/nativeShell';

/* ─────────────────────────────────────────────────────────────────────────
 * 검색 시트 — 하단 바의 ◯🔍 버튼이 연다.
 *
 * v1 범위(계획서): 내 코드/악보 차트 + 채팅 제목 + 내장 라이브러리 1,460곡을
 * 클라이언트에서 부분일치 필터. 데이터는 "시트를 처음 열 때" 로드한다 —
 * jazz1460.json(2.8MB)은 irealLoader 가 모듈 캐시하므로 재오픈은 즉시.
 * ──────────────────────────────────────────────────────────────────────── */

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Hit {
  group: '내 콘텐츠' | '곡 라이브러리';
  icon: string;
  title: string;
  sub: string;
  onOpen: () => void;
}

const MAX_PER_GROUP = 20;

export function SearchSheet({ open, onClose }: Props) {
  const navigate = useNavigate();
  const t = useTransitionState(open, 260);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  /* 시트 첫 오픈 시 1회 로드 */
  const [songs, setSongs] = useState<SongEntry[]>([]);
  const [chats, setChats] = useState<ChatSummary[]>(() => getCachedChatList() ?? []);
  const [chords, setChords] = useState<ChordProject[]>([]);
  const [sheets, setSheets] = useState<SheetProject[]>([]);
  const loadedRef = useRef(false);
  useEffect(() => {
    if (!open || loadedRef.current) return;
    loadedRef.current = true;
    getSongIndex().then(setSongs).catch(() => { /* 라이브러리 없이도 검색은 동작 */ });
    if (getCachedUser()) {
      listChats({ size: 30 }).then((p) => setChats(p.content)).catch(() => { /* noop */ });
      listChordProjects({ size: 50, sort: 'updatedAt,desc' }).then((p) => setChords(p.content)).catch(() => { /* noop */ });
      listSheetProjects({ size: 50, sort: 'updatedAt,desc' }).then((p) => setSheets(p.content)).catch(() => { /* noop */ });
    }
  }, [open]);

  /* 열릴 때 입력 포커스 + 닫힐 때 질의 유지(재오픈 시 이어서) */
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 120);
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const out: Hit[] = [];

    let mine = 0;
    for (const p of chords) {
      if (mine >= MAX_PER_GROUP) break;
      if (p.title.toLowerCase().includes(needle)) {
        out.push({
          group: '내 콘텐츠', icon: '🎼', title: p.title, sub: '코드 차트',
          onOpen: () => navigate(`/mychord?project=${encodeURIComponent(p.publicId)}`),
        });
        mine++;
      }
    }
    for (const s of sheets) {
      if (mine >= MAX_PER_GROUP) break;
      if (s.title.toLowerCase().includes(needle)) {
        out.push({
          group: '내 콘텐츠', icon: '📄', title: s.title, sub: '악보 차트',
          onOpen: () => navigate('/my-sheets'),
        });
        mine++;
      }
    }
    for (const c of chats) {
      if (mine >= MAX_PER_GROUP) break;
      const title = c.title || '새 대화';
      if (title.toLowerCase().includes(needle)) {
        out.push({
          group: '내 콘텐츠', icon: '💬', title, sub: '채팅',
          onOpen: () => openAiChatSheet({ chat: c.publicId }),
        });
        mine++;
      }
    }

    let lib = 0;
    for (const s of songs) {
      if (lib >= MAX_PER_GROUP) break;
      if (s.title.toLowerCase().includes(needle) || s.composer.toLowerCase().includes(needle)) {
        out.push({
          group: '곡 라이브러리', icon: '🎵', title: s.title, sub: s.composer,
          onOpen: () => navigate(`/chord?song=${s.index}`),
        });
        lib++;
      }
    }
    return out;
  }, [q, chats, chords, sheets, songs, navigate]);

  if (!t.mounted) return null;

  const groups: Hit['group'][] = ['내 콘텐츠', '곡 라이브러리'];

  return (
    <Backdrop $entered={t.entered} onClick={onClose}>
      <Sheet $entered={t.entered} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="검색">
        <Handle />
        <InputRow>
          <SearchGlyph />
          <Input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="곡·차트·채팅 검색"
            enterKeyHint="search"
          />
          {q && <ClearBtn type="button" aria-label="지우기" onClick={() => setQ('')}>×</ClearBtn>}
        </InputRow>

        <Results>
          {q.trim() === '' ? (
            <Hint>제목으로 검색 — 내 차트·악보·채팅과 내장 1,460곡을 한 번에.</Hint>
          ) : hits.length === 0 ? (
            <Hint>"{q}" 에 대한 결과가 없어요.</Hint>
          ) : (
            groups.map((g) => {
              const rows = hits.filter((h) => h.group === g);
              if (rows.length === 0) return null;
              return (
                <Group key={g}>
                  <GroupHead>{g}</GroupHead>
                  {rows.map((h, i) => (
                    <HitRow key={`${g}-${i}`} type="button" onClick={() => { onClose(); h.onOpen(); }}>
                      <HitIcon>{h.icon}</HitIcon>
                      <HitTitle>{h.title}</HitTitle>
                      <HitSub>{h.sub}</HitSub>
                    </HitRow>
                  ))}
                </Group>
              );
            })
          )}
        </Results>
      </Sheet>
    </Backdrop>
  );
}

/* ── icons ───────────────────────────────────────────────────────────── */

const SearchGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8a8f98" strokeWidth="2.1" strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <line x1="21" y1="21" x2="16.2" y2="16.2" />
  </svg>
);

/* ── styled ──────────────────────────────────────────────────────────── */

const Backdrop = styled.div<{ $entered: boolean }>`
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(0, 0, 0, ${({ $entered }) => ($entered ? 0.42 : 0)});
  transition: background 0.26s ease;
  display: flex;
  align-items: flex-end;
`;

const Sheet = styled.div<{ $entered: boolean }>`
  width: 100%;
  height: calc(88dvh);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-radius: 18px 18px 0 0;
  box-shadow: 0 -8px 40px rgba(0, 0, 0, 0.22);
  transform: translateY(${({ $entered }) => ($entered ? '0%' : '100%')});
  transition: transform 0.26s cubic-bezier(0.32, 0.72, 0, 1);
  overflow: hidden;
  font-family: 'Pretendard', sans-serif;
`;

const Handle = styled.div`
  width: 40px;
  height: 4.5px;
  border-radius: 999px;
  background: #d9dce1;
  margin: 8px auto 6px;
  flex: 0 0 auto;
`;

const InputRow = styled.div`
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 4px 14px 10px;
  padding: 0 13px;
  height: 46px;
  border-radius: 13px;
  background: #f1f3f6;
  flex: 0 0 auto;
`;

const Input = styled.input`
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  background: transparent;
  outline: none;
  font-size: 1rem;
  color: #1d2129;

  &::placeholder { color: #9aa0a8; }
`;

const ClearBtn = styled.button`
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: #d9dce1;
  color: #55595f;
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
`;

const Results = styled.div`
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0 14px calc(20px + env(safe-area-inset-bottom, 0px));
`;

const Hint = styled.div`
  padding: 26px 6px;
  font-size: 0.88rem;
  color: #8a8f98;
  text-align: center;
`;

const Group = styled.div`margin-bottom: 14px;`;

const GroupHead = styled.div`
  margin: 12px 2px 7px;
  font-size: 0.78rem;
  font-weight: 700;
  color: #8a8f98;
`;

const HitRow = styled.button`
  width: 100%;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 11px 10px;
  border: none;
  border-radius: 11px;
  background: transparent;
  text-align: left;
  cursor: pointer;

  &:active { background: #f2f4f7; }
`;

const HitIcon = styled.span`font-size: 16px; flex: 0 0 auto;`;

const HitTitle = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.93rem;
  font-weight: 550;
  color: #1d2129;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const HitSub = styled.span`
  flex: 0 0 auto;
  font-size: 0.74rem;
  color: #9aa0a8;
  max-width: 40%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
