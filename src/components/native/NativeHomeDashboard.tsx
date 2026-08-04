import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import styled from 'styled-components';
import { BrandLogoImage } from '../common/BrandLogoImage';
import {
  getCachedUser,
  onAuthChange,
  type AuthUser,
} from '../../api/auth';
import {
  listChats,
  getCachedChatList,
  setCachedChatList,
  onChatListChange,
  type ChatSummary,
} from '../../api/chat';
import { listChordProjects, type ChordProject } from '../../api/chordProjects';
import { listSheetProjects, type SheetProject } from '../../api/sheetProjects';
import { loadUserLicksSync } from '../../data/lickData';
import { openAiChatSheet } from '../../lib/nativeShell';

/* ─────────────────────────────────────────────────────────────────────────
 * 네이티브(iPhone·iPad) 홈 대시보드 — 노션 모바일 홈 형식.
 *
 *   [Jazzify 로고]                    [🔔] [아바타]   ← 상단 바 (이 파일에 포함)
 *   2x2 그리드 ── [내 프로젝트][내 릭] / [내 코드 차트][내 악보 차트] (정사각형)
 *   최근 채팅  ── 5개 행
 *   전체     ── 통합 목록 (채팅+코드차트+악보 전부)
 *
 * HomePage 의 네이티브 분기가 이 컴포넌트로 대체된다(웹 분기는 불변).
 * 채팅은 여기서 열지 않고 AiChatSheet(lib/nativeShell)로 넘긴다.
 * ──────────────────────────────────────────────────────────────────────── */

/* ── 통합 아이템 ─────────────────────────────────────────────────────── */

interface HomeItem {
  kind: 'chord' | 'sheet' | 'chat';
  id: string;
  title: string;
  updatedAt: string;
}

const KIND_EMOJI: Record<HomeItem['kind'], string> = {
  chord: '🎼',
  sheet: '📄',
  chat: '💬',
};

const KIND_LABEL: Record<HomeItem['kind'], string> = {
  chord: '코드 차트',
  sheet: '악보 차트',
  chat: '채팅',
};

function toItems(
  chats: ChatSummary[],
  chords: ChordProject[],
  sheets: SheetProject[],
): HomeItem[] {
  const items: HomeItem[] = [
    ...chats.map((c): HomeItem => ({ kind: 'chat', id: c.publicId, title: c.title || '새 대화', updatedAt: c.updatedAt })),
    ...chords.map((p): HomeItem => ({ kind: 'chord', id: p.publicId, title: p.title, updatedAt: p.updatedAt })),
    ...sheets.map((s): HomeItem => ({ kind: 'sheet', id: s.publicId, title: s.title, updatedAt: s.updatedAt })),
  ];
  return items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export function NativeHomeDashboard() {
  const navigate = useNavigate();

  /* ── auth ── */
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getCachedUser());
  useEffect(() => onAuthChange((loggedIn, user) => setAuthUser(loggedIn ? user : null)), []);
  const isLoggedIn = authUser !== null;


  /* 스크롤 다운 시 상단 검은 바를 반투명으로 (뒤 콘텐츠가 살짝 비침). */
  const [scrolled, setScrolled] = useState(false);

  /* ── 알림 드롭다운 (현재 빈 상태 — 알림 기능 연동 대기) ── */
  const [notifOpen, setNotifOpen] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!notifOpen) return;
    const close = (e: PointerEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [notifOpen]);

  /* ── data ──
   * 채팅은 사이드바와 같은 localStorage 캐시로 즉시 그리고(listChats 로
   * 재검증), 코드/악보 프로젝트는 마운트 시 병렬 로드. 로그아웃 상태면
   * 전부 스킵하고 로그인 유도 카드만 보여준다. */
  const [chats, setChats] = useState<ChatSummary[]>(() => getCachedChatList() ?? []);
  const [chords, setChords] = useState<ChordProject[]>([]);
  const [sheets, setSheets] = useState<SheetProject[]>([]);

  const reloadChats = useCallback(() => {
    if (!isLoggedIn) return;
    listChats({ size: 30 })
      .then((page) => { setChats(page.content); setCachedChatList(page.content); })
      .catch(() => { /* 캐시로 이미 그려짐 — 네트워크 실패는 조용히 */ });
  }, [isLoggedIn]);

  useEffect(() => {
    /* 로그아웃 상태에선 아무것도 안 한다 — 목록 섹션 자체가 게스트 히어로로
     * 대체되어 렌더되지 않으므로 이전 상태를 지울 필요도 없다(재로그인 시
     * 아래 fetch 들이 통째로 덮어쓴다). */
    if (!isLoggedIn) return;
    reloadChats();
    listChordProjects({ size: 30, sort: 'updatedAt,desc' })
      .then((p) => setChords(p.content)).catch(() => { /* noop */ });
    listSheetProjects({ size: 30, sort: 'updatedAt,desc' })
      .then((p) => setSheets(p.content)).catch(() => { /* noop */ });
  }, [isLoggedIn, reloadChats]);

  /* 새 채팅 생성/삭제 시 목록 갱신 (AI 시트에서의 대화도 반영) */
  useEffect(() => onChatListChange(reloadChats), [reloadChats]);

  const lickCount = useMemo(() => loadUserLicksSync().length, []);

  const allItems = useMemo(() => toItems(chats, chords, sheets), [chats, chords, sheets]);
  const recentChats = chats.slice(0, 5);

  const openItem = useCallback((it: HomeItem) => {
    if (it.kind === 'chord') navigate(`/mychord?project=${encodeURIComponent(it.id)}`);
    else if (it.kind === 'sheet') navigate('/my-sheets');
    else openAiChatSheet({ chat: it.id });
  }, [navigate]);

  const initial = (authUser?.name ?? authUser?.username ?? '?').slice(0, 1).toUpperCase();

  /* ── 하단 5탭 바의 + 드롭다운 (바 자체에 앵커, 위로 펼침) ── */
  const [plusOpen, setPlusOpen] = useState(false);
  const plusRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!plusOpen) return;
    const close = (e: PointerEvent) => {
      if (plusRef.current && !plusRef.current.contains(e.target as Node)) setPlusOpen(false);
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [plusOpen]);

  return (
    <Page onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
      {/* ── 상단 바: 좌측 Jazzify 로고 + 우측 알림·프로필. 로그인 크림색 배경 ── */}
      <TopBar $scrolled={scrolled}>
        <LogoWhite height={30} scaleX={1.1} onClick={() => navigate('/')} />

        {/* ── 우측 그룹: 알림 + 프로필 ── */}
        <NotifWrap ref={notifRef}>
          <TopCircle type="button" aria-label="알림" $on={notifOpen} onClick={() => setNotifOpen((v) => !v)}>
            <BellGlyph />
          </TopCircle>
          {notifOpen && (
            <NotifMenu role="menu">
              <NotifTitle>알림</NotifTitle>
              <NotifEmpty>새로운 알림이 없습니다</NotifEmpty>
            </NotifMenu>
          )}
        </NotifWrap>

        <ProfileWrap>
          {isLoggedIn ? (
            <AvatarBtn type="button" aria-label="프로필" onClick={() => navigate('/profile')}>
              {initial}
            </AvatarBtn>
          ) : (
            <LoginChip type="button" onClick={() => navigate('/login')}>로그인</LoginChip>
          )}
        </ProfileWrap>
      </TopBar>

      {!isLoggedIn ? (
        <GuestHero>
          <GuestLogo src="/jazzifylogo.png" alt="Jazzify" />
          <GuestTitle>재즈, 눈으로 듣다</GuestTitle>
          <GuestDesc>로그인하면 내 차트·악보·대화가 이곳에 모여요.</GuestDesc>
          <GuestBtn type="button" onClick={() => navigate('/login')}>로그인하고 시작하기</GuestBtn>
        </GuestHero>
      ) : (
        <Body>
          {/* ── 2x2 메인 그리드 (정사각형, 크게):
           *    [내 프로젝트] [내 릭]
           *    [내 코드 차트] [내 악보 차트]
           *  '내 프로젝트'는 코드/악보 차트를 묶은 악보집 개념(잼·긱 참여용) —
           *  아직 목적지 페이지가 없어 카드만 먼저 두고 '준비 중'으로 표시한다. */}
          <QuadGrid>
            <QuadCell type="button" aria-label="내 프로젝트 (준비 중)">
              <QuadEmoji>📚</QuadEmoji>
              <QuadFoot>
                <QuadLabel>내 프로젝트</QuadLabel>
                <QuadCount>준비 중</QuadCount>
              </QuadFoot>
            </QuadCell>
            <QuadCell type="button" onClick={() => navigate('/my-licks')}>
              <QuadEmoji>🎷</QuadEmoji>
              <QuadFoot>
                <QuadLabel>내 릭</QuadLabel>
                <QuadCount>{lickCount}</QuadCount>
              </QuadFoot>
            </QuadCell>
            <QuadCell type="button" onClick={() => navigate('/my-charts')}>
              <QuadEmoji>🎼</QuadEmoji>
              <QuadFoot>
                <QuadLabel>내 코드 차트</QuadLabel>
                <QuadCount>{chords.length}</QuadCount>
              </QuadFoot>
            </QuadCell>
            <QuadCell type="button" onClick={() => navigate('/my-sheets')}>
              <QuadEmoji>📄</QuadEmoji>
              <QuadFoot>
                <QuadLabel>내 악보 차트</QuadLabel>
                <QuadCount>{sheets.length}</QuadCount>
              </QuadFoot>
            </QuadCell>
          </QuadGrid>

          {/* ── 최근 채팅 5 ── */}
          <SectionHead>최근 채팅</SectionHead>
          {recentChats.length > 0 ? (
            <List>
              {recentChats.map((c) => (
                <Row key={c.publicId} type="button" onClick={() => openAiChatSheet({ chat: c.publicId })}>
                  <RowIcon>💬</RowIcon>
                  <RowTitle>{c.title || '새 대화'}</RowTitle>
                </Row>
              ))}
            </List>
          ) : (
            <EmptyRow>대화가 없어요 — "AI에게 질문하기"로 시작해 보세요.</EmptyRow>
          )}

          {/* ── 통합 목록 (채팅·코드 차트·악보 차트 전부) ── */}
          <SectionHead>전체 항목</SectionHead>
          {allItems.length > 0 ? (
            <List>
              {allItems.slice(0, 30).map((it) => (
                <Row key={`all-${it.kind}:${it.id}`} type="button" onClick={() => openItem(it)}>
                  <RowIcon>{KIND_EMOJI[it.kind]}</RowIcon>
                  <RowTitle>{it.title}</RowTitle>
                  <RowTag>{KIND_LABEL[it.kind]}</RowTag>
                </Row>
              ))}
            </List>
          ) : (
            <EmptyRow>항목이 없어요.</EmptyRow>
          )}
        </Body>
      )}


      {/* ── 하단 5탭 바 (홈 전용) — 홈 · 컨텐츠 · + · 커뮤니티 · 강의/스토어.
       *  컨텐츠 · 커뮤니티 · 강의/스토어는 아직 목적지 페이지가 없어 디자인만
       *  먼저 넣는다(요구사항: "일단 디자인만"). 이 화면 자체가 홈이라 홈
       *  탭은 항상 active(진한 색)로 표시한다. */}
      <BottomBar>
        <BarTab type="button" $active onClick={() => navigate('/')}>
          <HomeTabIcon />
          <BarLabel>홈</BarLabel>
        </BarTab>
        <BarTab type="button">
          <ContentTabIcon />
          <BarLabel>컨텐츠</BarLabel>
        </BarTab>

        {plusOpen && <PlusBackdrop />}
        <PlusWrap ref={plusRef}>
          {plusOpen && (
            <BubbleCluster role="menu">
              <Bubble
                type="button"
                role="menuitem"
                $x={-100}
                $y={-92}
                onClick={() => { setPlusOpen(false); navigate('/input'); }}
              >
                <BubbleCircle>📄</BubbleCircle>
                <BubbleLabel>악보차트</BubbleLabel>
              </Bubble>
              <Bubble
                type="button"
                role="menuitem"
                $x={-38}
                $y={-168}
                onClick={() => { setPlusOpen(false); navigate('/mychord?empty=1'); }}
              >
                <BubbleCircle>🎼</BubbleCircle>
                <BubbleLabel>코드 차트</BubbleLabel>
              </Bubble>
              <Bubble
                type="button"
                role="menuitem"
                $x={38}
                $y={-168}
                onClick={() => { setPlusOpen(false); navigate('/editor?mode=lick'); }}
              >
                <BubbleCircle>🎷</BubbleCircle>
                <BubbleLabel>릭</BubbleLabel>
              </Bubble>
              <Bubble
                type="button"
                role="menuitem"
                $x={100}
                $y={-92}
                onClick={() => { setPlusOpen(false); navigate('/stems'); }}
              >
                <BubbleCircle>🎧</BubbleCircle>
                <BubbleLabel>음원</BubbleLabel>
              </Bubble>
            </BubbleCluster>
          )}
          <PlusBtn type="button" aria-label="추가" aria-expanded={plusOpen} onClick={() => setPlusOpen((v) => !v)}>
            <PlusGlyph open={plusOpen} />
          </PlusBtn>
        </PlusWrap>

        <BarTab type="button">
          <CommunityTabIcon />
          <BarLabel>커뮤니티</BarLabel>
        </BarTab>
        <BarTab type="button">
          <StoreTabIcon />
          <BarLabel>강의/스토어</BarLabel>
        </BarTab>
      </BottomBar>

      {/* AI 채팅 진입점 — 하단 바 바로 위 오른쪽에 떠 있는 아바타.
       *  + 버블 메뉴가 열려 있는 동안은 같이 어두워지고 비활성화된다. */}
      <AiFab
        type="button"
        aria-label="AI에게 질문하기"
        onClick={() => openAiChatSheet()}
        disabled={plusOpen}
        $dimmed={plusOpen}
      >
        <AiChatIcon />
      </AiFab>
    </Page>
  );
}

/* ── bottom-bar (5탭) glyphs ────────────────────────────────────────── */

const HomeTabIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9.5 12 3l9 6.5V20a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1Z" />
  </svg>
);

const ContentTabIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CommunityTabIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);

const StoreTabIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
  </svg>
);

/* AI 채팅 아바타용 — 말풍선 + 안의 점 3개(타이핑) 로 채팅임을 바로 알아보게. */
const AiChatIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <circle cx="8.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="12" cy="10.5" r="1" fill="currentColor" stroke="none" />
    <circle cx="15.5" cy="10.5" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const PlusGlyph = ({ open }: { open: boolean }) => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round"
       style={{ transform: open ? 'rotate(45deg)' : 'none', transition: 'transform 0.16s' }}>
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

/* ── top-bar glyphs ──────────────────────────────────────────────────── */

/* ── styled ──────────────────────────────────────────────────────────── */

const Page = styled.div`
  /* 전역 body{overflow:hidden} 이라 window 스크롤이 안 잡힌다 — Page 를 직접
   * 스크롤 컨테이너로 삼아 onScroll 로 상단바 투명도를 제어한다. sticky 도
   * 이 컨테이너 기준으로 정상 동작한다. */
  height: 100dvh;
  overflow-y: auto;
  background: ${({ theme }) => theme.colors.surfaceSunken};
  font-family: 'Pretendard', sans-serif;
  /* 하단 5탭 바(78px)에 가리지 않게 */
  padding-bottom: calc(110px + env(safe-area-inset-bottom, 0px));
`;

const TopBar = styled.header<{ $scrolled?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: calc(10px + env(safe-area-inset-top, 0px)) 16px 12px;
  position: sticky;
  top: 0;
  z-index: 50;
  /* 흰색 상단 바. 스크롤 다운 시 살짝 투명해져 뒤 콘텐츠가 비친다(요청). 라운드는
   * 상단 바가 아니라 아래 회색 Body 가 진다(Body 상단 코너 필렛). */
  background: ${({ $scrolled, theme }) => ($scrolled
    ? (theme.mode === 'dark' ? 'rgba(38, 38, 43, 0.72)' : 'rgba(255, 255, 255, 0.72)')
    : theme.colors.surface)};
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  transition: background 0.25s ease;
`;

/* 크림색 상단 바 위 — 원본(검정) 워드마크 그대로 표시. */
const LogoWhite = styled(BrandLogoImage)`
  filter: none;
`;

const ProfileWrap = styled.div`
  position: relative;
  margin-right: 2px;
  flex: 0 0 auto;
`;

const AvatarBtn = styled.button`
  width: 40px;
  height: 40px;
  border: 1.5px solid ${({ theme }) => theme.colors.border};
  border-radius: 50%;
  /* 크림색 상단 바 위 — 흰 원 + 진한 글자로 대비 확보 */
  background: ${({ theme }) => theme.colors.surface};
  color: ${({ theme }) => theme.colors.textPrimary};
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;

  &:active { opacity: 0.75; }
`;

const LoginChip = styled.button`
  height: 40px;
  padding: 0 14px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 999px;
  background: ${({ theme }) => theme.colors.surface};
  font-size: 0.88rem;
  font-weight: 650;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
`;

const TopCircle = styled.button<{ $on?: boolean }>`
  width: 40px;
  height: 40px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  /* 크림색 상단 바 위 — 반투명 검정 배경 + 진한 아이콘 */
  background: ${({ $on }) => ($on ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.045)')};
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;

  &:active { opacity: 0.65; }
`;

/* 알림 버튼 — 프로필 왼쪽. margin-left:auto 로 알림+프로필을 우측으로 민다. */
const NotifWrap = styled.div`
  position: relative;
  margin-left: auto;
  flex: 0 0 auto;
`;

const NotifMenu = styled.div`
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 240px;
  padding: 6px;
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 14px;
  box-shadow: 0 14px 44px rgba(0, 0, 0, 0.18);
  z-index: 60;
`;

const NotifTitle = styled.div`
  padding: 8px 10px 6px;
  font-size: 0.82rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textSecondary};
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  margin-bottom: 4px;
`;

const NotifEmpty = styled.div`
  padding: 22px 10px;
  text-align: center;
  font-size: 0.88rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const BellGlyph = () => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

/* ── body ── */

const Body = styled.main`
  padding: 6px 14px 0;
  /* iPad: 목록·카드가 전폭으로 퍼지지 않게 노션처럼 센터 컬럼으로 제한 */
  max-width: 860px;
  margin: 0 auto;
`;

const SectionHead = styled.h2`
  /* 섹션 세로 여백 축소 — '내 라이브러리'가 상단 바에 더 붙고 헤더↔그리드
   * 간격도 타이트하게(요청). 첫 섹션은 아래 &:first-of-type 로 상단을 더 줄임. */
  margin: 10px 2px 7px;
  font-size: 0.86rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textSecondary};

  &:first-of-type {
    margin-top: 4px;
  }
`;

/* ── 2x2 메인 그리드 (정사각형, 크게) ── */

const QuadGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-top: 4px;
`;

const QuadCell = styled.button`
  aspect-ratio: 1 / 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: space-between;
  padding: 16px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 18px;
  background: ${({ theme }) => theme.colors.surface};
  cursor: pointer;
  box-shadow: 0 1px 5px rgba(0, 0, 0, 0.05);
  min-width: 0;
  text-align: left;

  &:active { transform: scale(0.98); }
`;

const QuadEmoji = styled.span`
  font-size: 34px;
  line-height: 1;
`;

const QuadFoot = styled.span`
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  max-width: 100%;
`;

const QuadLabel = styled.span`
  font-size: 1.02rem;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
`;

const QuadCount = styled.span`
  font-size: 0.8rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

/* ── 목록 ── */

const List = styled.div`
  display: flex;
  flex-direction: column;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 14px;
  background: ${({ theme }) => theme.colors.surface};
  overflow: hidden;
`;

const Row = styled.button`
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 13px;
  border: none;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: transparent;
  text-align: left;
  cursor: pointer;

  &:last-child { border-bottom: none; }
  &:active { background: ${({ theme }) => theme.colors.surface}; }
`;

const RowIcon = styled.span`
  font-size: 17px;
  flex: 0 0 auto;
`;

const RowTitle = styled.span`
  flex: 1 1 auto;
  min-width: 0;
  font-size: 0.92rem;
  font-weight: 550;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const RowTag = styled.span`
  flex: 0 0 auto;
  font-size: 0.72rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const EmptyRow = styled.div`
  padding: 18px 14px;
  border: 1px dashed ${({ theme }) => theme.colors.border};
  border-radius: 14px;
  font-size: 0.86rem;
  color: ${({ theme }) => theme.colors.textSecondary};
  background: ${({ theme }) => theme.colors.surface};
`;

/* ── guest ── */

const GuestHero = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 90px 24px 0;
  text-align: center;
`;

const GuestLogo = styled.img`
  width: 74px;
  height: 74px;
  object-fit: contain;
`;

const GuestTitle = styled.div`
  font-size: 1.3rem;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const GuestDesc = styled.div`
  font-size: 0.92rem;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const GuestBtn = styled.button`
  margin-top: 10px;
  height: 48px;
  padding: 0 22px;
  border: none;
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.inkSurface};
  color: ${({ theme }) => theme.colors.onInk};
  font-size: 0.95rem;
  font-weight: 700;
  cursor: pointer;

  &:active { opacity: 0.8; }
`;

/* ── 하단 5탭 바 (홈 전용) ───────────────────────────────────────────── */

const BottomBar = styled.nav`
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  display: flex;
  /* 탭 4개는 자기 컨텐츠 높이만큼만 차지하고 바 아래쪽에 정렬 — + 만 별도로
   * translateY 로 띄운다. */
  align-items: flex-end;
  height: 90px;
  padding: 0 4px calc(4px + env(safe-area-inset-bottom, 0px));
  background: ${({ theme }) => theme.colors.surface};
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  font-family: 'Pretendard', sans-serif;
`;

const BarTab = styled.button<{ $active?: boolean }>`
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  border: none;
  background: transparent;
  /* 활성 탭은 진하게 — hover 대신 "선택됨"을 색으로 표현 */
  color: ${({ $active }) => ($active ? '#1d2129' : '#8a8f98')};
  cursor: pointer;
  transition: color 0.12s;

  &:active { opacity: 0.6; }
`;

const BarLabel = styled.span`
  font-size: 0.68rem;
  font-weight: 600;
  white-space: nowrap;
`;

const PlusWrap = styled.div`
  position: relative;
  /* PlusBackdrop 이 BottomBar 의 자식이라 로컬 스태킹 컨텍스트를 공유한다 —
   * backdrop(z:1) 보다 높여야 버블·× 버튼이 dim 되지 않고 밝게 뜬다. */
  z-index: 2;
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  align-items: center;
  justify-content: center;
`;

const PlusBtn = styled.button`
  width: 52px;
  height: 52px;
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: 50%;
  background: #B8860B;
  color: #fff;
  box-shadow: 0 4px 14px rgba(184, 134, 11, 0.45);
  cursor: pointer;
  /* 바 위로 살짝 떠오르게 — 참고 디자인의 중앙 raised 버튼 */
  transform: translateY(-10px);

  &:active { transform: translateY(-10px) scale(0.94); }
`;

/* + 를 누르면 버튼 주변에 원형 버블이 부채꼴로 떠오른다(참고 디자인 —
 * 건강 앱의 +를 누르면 체중/운동/식단 등이 원형 아이콘으로 흩어져 뜨는
 * 패턴). 배경은 어둡게 dim, 중앙 + 는 PlusGlyph 의 회전으로 ×가 된다. */
const PlusBackdrop = styled.div`
  position: fixed;
  inset: 0;
  /* BottomBar(z:100) 안의 자식이라 이 z-index 는 그 로컬 컨텍스트에서만
   * 비교된다 — BarTab(auto) 보다는 높게, PlusWrap(2) 보다는 낮게 둬서
   * 좌우 4탭은 dim 되고 버블/× 버튼만 밝게 위에 뜨도록 한다. */
  z-index: 1;
  background: ${({ theme }) => theme.colors.scrim};
`;

const BubbleCluster = styled.div`
  /* PlusBtn 은 PlusWrap 안에서 flex-centered + translateY(-10px) — 버블은
   * 그 중심점을 원점으로 삼아 $x/$y 오프셋만큼 퍼진다. */
  position: absolute;
  left: 50%;
  top: calc(50% - 10px);
  width: 0;
  height: 0;
`;

const Bubble = styled.button<{ $x: number; $y: number }>`
  position: absolute;
  left: ${({ $x }) => $x}px;
  top: ${({ $y }) => $y}px;
  transform: translateX(-50%);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  cursor: pointer;

  &:active > span:first-child { transform: scale(0.92); }
`;

const BubbleCircle = styled.span`
  width: 54px;
  height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: ${({ theme }) => theme.colors.surface};
  font-size: 24px;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
  transition: transform 0.1s;
`;

const BubbleLabel = styled.span`
  font-size: 0.76rem;
  font-weight: 650;
  color: ${({ theme }) => theme.colors.onInk};
  white-space: nowrap;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
`;

/* AI 채팅 진입점 — 하단 바 바로 위 오른쪽에 겹쳐 뜨는 아바타(참고 디자인의
 * 고양이 마스코트 위치). 바의 상단 테두리에 걸치도록 절반만 겹친다. */
const AiFab = styled.button<{ $dimmed?: boolean }>`
  position: fixed;
  right: 16px;
  bottom: calc(90px + env(safe-area-inset-bottom, 0px) - 24px);
  z-index: 101;
  width: 52px;
  height: 52px;
  border-radius: 50%;
  border: 2px solid ${({ theme }) => theme.colors.surface};
  background: ${({ theme }) => theme.colors.inkSurface};
  color: ${({ theme }) => theme.colors.onInk};
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
  cursor: pointer;
  opacity: ${({ $dimmed }) => ($dimmed ? 0.3 : 1)};
  pointer-events: ${({ $dimmed }) => ($dimmed ? 'none' : 'auto')};
  transition: opacity 0.15s;

  &:active { transform: scale(0.94); }
`;
