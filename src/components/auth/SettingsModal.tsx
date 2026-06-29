import { useEffect, useState } from 'react';
import styled from 'styled-components';
import type { AuthUser } from '../../api/auth';
import {
  getPlayerSettings,
  setPlayerSetting,
  subscribePlayerSettings,
  type TransposingInstrument,
} from '../../lib/note/playerSettings';

/* 풀스크린 설정 모달 — Claude 데스크탑 설정 페이지 패턴.
 *
 * 좌측 사이드바에 9개 탭. 현재는 "일반" 탭만 본문이 채워져 있고
 * 나머지는 placeholder ("준비 중"). 모든 입력은 visual mock — 저장 / 적용
 * 안 됨. 이름 / 아바타 등 user-derived 표시는 로그인 정보에서 read-only. */

/** A single on/off display preference shown in the 디스플레이 tab. The page
 *  that opens the modal owns the state; the modal just renders + toggles. */
export interface DisplaySetting {
  id: string;
  label: string;
  active: boolean;
  onToggle: () => void;
}

interface Props {
  open: boolean;
  user: AuthUser;
  onClose: () => void;
  /** Page-specific display toggles (e.g. chord-analysis sub-options). When
   *  non-empty, a "디스플레이" tab appears listing them. */
  displaySettings?: DisplaySetting[];
}

type TabId =
  | 'general'
  | 'performance'
  | 'display'
  | 'account'
  | 'privacy'
  | 'billing'
  | 'usage'
  | 'features'
  | 'connectors'
  | 'cli'
  | 'chrome';

const TABS: ReadonlyArray<{ id: TabId; label: string; badge?: string }> = [
  { id: 'general', label: '일반' },
  { id: 'performance', label: '악보/연주' },
  { id: 'display', label: '디스플레이' },
  { id: 'account', label: '계정' },
  { id: 'privacy', label: '개인정보보호' },
  { id: 'billing', label: '결제' },
  { id: 'usage', label: '사용량' },
  { id: 'features', label: '기능' },
  { id: 'connectors', label: '커넥터' },
  { id: 'cli', label: 'Jazzify CLI' },
  { id: 'chrome', label: 'Chrome용 Jazzify', badge: '베타' },
];

export function SettingsModal({ open, user, onClose, displaySettings }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('general');

  /* Hide the 디스플레이 tab when the opener has no page-specific toggles
   *  (e.g. the global account menu). */
  const hasDisplay = !!displaySettings && displaySettings.length > 0;
  const tabs = hasDisplay ? TABS : TABS.filter((t) => t.id !== 'display');

  /* Esc 로 닫기 + 모달 열린 동안 body 스크롤 잠금. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <Backdrop onClick={onClose}>
      <Modal onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="설정">
        <CloseBtn onClick={onClose} aria-label="설정 닫기">
          <CloseIcon />
        </CloseBtn>

        <Body>
          <Sidebar>
            <SidebarTitle>설정</SidebarTitle>
            <TabList>
              {tabs.map((tab) => (
                <TabBtn
                  key={tab.id}
                  $active={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                >
                  <TabLabel>{tab.label}</TabLabel>
                  {tab.badge && <Badge>{tab.badge}</Badge>}
                </TabBtn>
              ))}
            </TabList>
          </Sidebar>

          <Content>
            {activeTab === 'general' ? (
              <GeneralPanel user={user} />
            ) : activeTab === 'performance' ? (
              <PerformancePanel />
            ) : activeTab === 'display' ? (
              <DisplayPanel settings={displaySettings ?? []} />
            ) : (
              <Placeholder>준비 중</Placeholder>
            )}
          </Content>
        </Body>
      </Modal>
    </Backdrop>
  );
}

/* ── general 탭 본문 ────────────────────────────────────────────────── */

function GeneralPanel({ user }: { user: AuthUser }) {
  const displayName = (user.name?.trim() || user.username || '').trim();
  const initial = pickInitial(user);

  return (
    <PanelInner>
      <SectionTitle>프로필</SectionTitle>

      <FieldRow>
        <FieldLabel>아바타</FieldLabel>
        <FieldControl>
          <Avatar>{initial}</Avatar>
        </FieldControl>
      </FieldRow>

      <FieldRow>
        <FieldLabel>성명</FieldLabel>
        <FieldControl>
          <TextInput type="text" defaultValue={displayName} />
        </FieldControl>
      </FieldRow>

      <FieldRow>
        <FieldLabel>Jazzify가 어떻게 불러드릴까요?</FieldLabel>
        <FieldControl>
          <TextInput type="text" defaultValue={displayName} />
        </FieldControl>
      </FieldRow>

      <FieldRow>
        <FieldLabel>귀하의 음악 활동을 가장 잘 설명하는 것은 무엇입니까?</FieldLabel>
        <FieldControl>
          <SelectInput defaultValue="">
            <option value="" disabled>선택</option>
            <option value="performer">연주자</option>
            <option value="student">학생</option>
            <option value="educator">교육자</option>
            <option value="composer">작곡가/편곡자</option>
            <option value="listener">감상자</option>
            <option value="other">기타</option>
          </SelectInput>
        </FieldControl>
      </FieldRow>

      <FieldRowVertical>
        <FieldLabel>Jazzify 지침</FieldLabel>
        <FieldHelper>
          Jazzify는 가이드라인 내에서 채팅과 분석 전반에 걸쳐 이 내용을 기억합니다.{' '}
          <FieldLink href="#more">자세히 알아보기</FieldLink>
        </FieldHelper>
        <TextArea placeholder="예시: 답변을 간단명료하게 유지" rows={4} />
      </FieldRowVertical>

      <SectionTitle style={{ marginTop: 48 }}>환경설정</SectionTitle>

      <FieldRow>
        <FieldLabel>모양</FieldLabel>
        <FieldControl>
          <ThemeToggle>
            <ThemeBtn $active title="시스템"><SystemIcon /></ThemeBtn>
            <ThemeBtn title="라이트"><SunIcon /></ThemeBtn>
            <ThemeBtn title="다크"><MoonIcon /></ThemeBtn>
          </ThemeToggle>
        </FieldControl>
      </FieldRow>

      <FieldRow>
        <FieldLabel>채팅 글꼴</FieldLabel>
        <FieldControl>
          <SelectInput defaultValue="pretendard">
            <option value="pretendard">Pretendard</option>
            <option value="inter">Inter</option>
            <option value="system">시스템 기본</option>
          </SelectInput>
        </FieldControl>
      </FieldRow>

      <FieldRow>
        <FieldLabel>음성</FieldLabel>
        <FieldControl>
          <SelectInput defaultValue="default">
            <option value="default">기본</option>
            <option value="warm">따뜻한 음색</option>
            <option value="cool">차분한 음색</option>
          </SelectInput>
        </FieldControl>
      </FieldRow>
    </PanelInner>
  );
}

/* ── 디스플레이 탭 본문 ─────────────────────────────────────────────── */

function DisplayPanel({ settings }: { settings: DisplaySetting[] }) {
  if (settings.length === 0) return <Placeholder>준비 중</Placeholder>;

  return (
    <PanelInner>
      <SectionTitle>분석 표시</SectionTitle>
      {settings.map((s) => (
        <FieldRow key={s.id}>
          <FieldLabel as="span">{s.label}</FieldLabel>
          <FieldControl>
            <Switch
              type="button"
              role="switch"
              aria-checked={s.active}
              aria-label={s.label}
              $on={s.active}
              onClick={s.onToggle}
            />
          </FieldControl>
        </FieldRow>
      ))}
    </PanelInner>
  );
}

/* ── 악보/연주 탭 본문 ──────────────────────────────────────────────── */

const TRANSPOSING_INSTRUMENTS: { id: TransposingInstrument; label: string; examples: string }[] = [
  { id: 'C',  label: 'C',  examples: '피아노, 기타, 베이스, 보컬…' },
  { id: 'Bb', label: 'B♭', examples: '테너 색소폰, 트럼펫…' },
  { id: 'Eb', label: 'E♭', examples: '알토 색소폰…' },
  { id: 'F',  label: 'F',  examples: '잉글리시 호른…' },
  { id: 'G',  label: 'G',  examples: '알토 플루트…' },
];

function PerformancePanel() {
  const [instrument, setInstrument] = useState<TransposingInstrument>(
    () => getPlayerSettings().transposingInstrument,
  );
  useEffect(
    () => subscribePlayerSettings((s) => setInstrument(s.transposingInstrument)),
    [],
  );

  return (
    <PanelInner>
      <SectionTitle>이조 악기</SectionTitle>
      <FieldHelper>
        선택한 관악기에 맞춰 코드 차트의 조를 옮겨 표시합니다. (C = 콘서트 조)
      </FieldHelper>
      <InstrumentList>
        {TRANSPOSING_INSTRUMENTS.map(({ id, label, examples }) => {
          const active = instrument === id;
          return (
            <InstrumentRow
              key={id}
              type="button"
              $active={active}
              onClick={() => setPlayerSetting('transposingInstrument', id)}
            >
              <InstrumentKey $active={active}>{label}</InstrumentKey>
              <InstrumentExamples>({examples})</InstrumentExamples>
              {active && <InstrumentCheck><CheckIcon /></InstrumentCheck>}
            </InstrumentRow>
          );
        })}
      </InstrumentList>
    </PanelInner>
  );
}

function pickInitial(user: AuthUser): string {
  const src = (user.name?.trim() || user.username?.trim() || '?');
  const first = Array.from(src)[0] ?? '?';
  return /[a-zA-Z]/.test(first) ? first.toUpperCase() : first;
}

/* ── icons ─────────────────────────────────────────────────────────── */

const CloseIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

const SystemIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <line x1="8" y1="20" x2="16" y2="20" />
    <line x1="12" y1="17" x2="12" y2="20" />
  </svg>
);

const SunIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="4" />
    <line x1="12" y1="2" x2="12" y2="5" />
    <line x1="12" y1="19" x2="12" y2="22" />
    <line x1="2" y1="12" x2="5" y2="12" />
    <line x1="19" y1="12" x2="22" y2="12" />
    <line x1="4.9" y1="4.9" x2="7" y2="7" />
    <line x1="17" y1="17" x2="19.1" y2="19.1" />
    <line x1="4.9" y1="19.1" x2="7" y2="17" />
    <line x1="17" y1="7" x2="19.1" y2="4.9" />
  </svg>
);

const MoonIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
);

const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/* ── styles ────────────────────────────────────────────────────────── */

const Backdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: ${({ theme }) => theme.zIndex.modalHigh};
  background: rgba(20, 20, 20, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;

const Modal = styled.div`
  width: 100%;
  max-width: 1080px;
  height: 100%;
  max-height: 760px;
  background: #faf9f7;
  border-radius: 16px;
  box-shadow: 0 30px 80px rgba(0, 0, 0, 0.22);
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: ${({ theme }) => theme.fonts.ui};

  @media (max-width: 820px) {
    max-width: 100%;
    max-height: 100%;
    border-radius: 0;
  }
`;

const CloseBtn = styled.button`
  position: absolute;
  top: 16px;
  right: 16px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  border: none;
  background: transparent;
  color: rgba(0, 0, 0, 0.55);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
  transition: background 0.12s, color 0.12s;
  &:hover { background: rgba(0, 0, 0, 0.06); color: #000; }
`;

const Body = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  min-height: 0;

  @media (max-width: 820px) {
    grid-template-columns: 1fr;
    grid-template-rows: auto minmax(0, 1fr);
  }
`;

const Sidebar = styled.aside`
  border-right: 1px solid rgba(0, 0, 0, 0.08);
  padding: 40px 12px 24px 24px;
  overflow-y: auto;

  @media (max-width: 820px) {
    border-right: none;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    padding: 16px 16px 8px;
  }
`;

const SidebarTitle = styled.h1`
  margin: 0 0 18px;
  padding-left: 8px;
  font-size: 28px;
  font-weight: 600;
  color: #1a1a1a;
  letter-spacing: -0.02em;
`;

const TabList = styled.nav`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const TabBtn = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-radius: 8px;
  background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.06)' : 'transparent')};
  color: #1a1a1a;
  font-family: inherit;
  font-size: 14.5px;
  font-weight: ${({ $active }) => ($active ? 600 : 500)};
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
  &:hover { background: rgba(0, 0, 0, 0.05); }
`;

const TabLabel = styled.span`
  flex: 1;
`;

const Badge = styled.span`
  font-size: 11px;
  font-weight: 600;
  background: rgba(0, 0, 0, 0.07);
  color: rgba(0, 0, 0, 0.6);
  padding: 2px 8px;
  border-radius: 999px;
`;

const Content = styled.section`
  overflow-y: auto;
  padding: 56px 56px 64px;

  @media (max-width: 820px) {
    padding: 28px 20px 40px;
  }
`;

const PanelInner = styled.div`
  max-width: 760px;
`;

const Placeholder = styled.div`
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(0, 0, 0, 0.4);
  font-size: 15px;
`;

const SectionTitle = styled.h2`
  margin: 0 0 18px;
  font-size: 16px;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: -0.01em;
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 24px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  &:last-of-type { border-bottom: none; }
`;

const FieldRowVertical = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
`;

const FieldLabel = styled.label`
  font-size: 14.5px;
  font-weight: 500;
  color: #1a1a1a;
`;

const FieldHelper = styled.p`
  margin: 0 0 8px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.55);
  line-height: 1.5;
`;

const FieldLink = styled.a`
  color: rgba(0, 0, 0, 0.7);
  text-decoration: underline;
  &:hover { color: #000; }
`;

const FieldControl = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
`;

const Avatar = styled.span`
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: #6b6b6b;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  letter-spacing: -0.02em;
  display: inline-flex;
  align-items: center;
  justify-content: center;
`;

const TextInput = styled.input`
  width: 240px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 8px;
  background: #ffffff;
  font-family: inherit;
  font-size: 14px;
  color: #1a1a1a;
  outline: none;
  transition: border-color 0.12s;
  &:focus { border-color: rgba(0, 0, 0, 0.4); }
`;

const SelectInput = styled.select`
  height: 36px;
  padding: 0 32px 0 12px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 8px;
  background: #ffffff;
  font-family: inherit;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.7);
  cursor: pointer;
  outline: none;
  &:focus { border-color: rgba(0, 0, 0, 0.4); }
`;

const TextArea = styled.textarea`
  width: 100%;
  padding: 12px 14px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 10px;
  background: #ffffff;
  font-family: inherit;
  font-size: 14px;
  color: #1a1a1a;
  resize: vertical;
  outline: none;
  &:focus { border-color: rgba(0, 0, 0, 0.4); }
`;

const Switch = styled.button<{ $on?: boolean }>`
  position: relative;
  width: 40px;
  height: 24px;
  border: none;
  border-radius: 999px;
  background: ${({ $on }) => ($on ? '#1a1a1a' : 'rgba(0, 0, 0, 0.18)')};
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;

  &::after {
    content: '';
    position: absolute;
    top: 3px;
    left: ${({ $on }) => ($on ? '19px' : '3px')};
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: #fff;
    transition: left 0.15s;
  }
`;

const ThemeToggle = styled.div`
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(0, 0, 0, 0.14);
  border-radius: 999px;
  background: #ffffff;
`;

const ThemeBtn = styled.button<{ $active?: boolean }>`
  width: 32px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.06)' : 'transparent')};
  color: ${({ $active }) => ($active ? '#1a1a1a' : 'rgba(0, 0, 0, 0.55)')};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s;
  &:hover { background: rgba(0, 0, 0, 0.06); color: #1a1a1a; }
`;

/* ── 이조 악기 목록 ─────────────────────────────────────────────────── */

const InstrumentList = styled.div`
  margin-top: 8px;
  background: #ffffff;
  border: 1px solid rgba(0, 0, 0, 0.1);
  border-radius: 14px;
  overflow: hidden;
`;

const InstrumentRow = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 16px 20px;
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 0.1s;
  &:last-child { border-bottom: none; }
  &:hover { background: rgba(0, 0, 0, 0.03); }
`;

const InstrumentKey = styled.span<{ $active?: boolean }>`
  font-size: 19px;
  font-weight: 600;
  color: ${({ $active }) => ($active ? '#2f6df0' : '#1a1a1a')};
  min-width: 28px;
`;

const InstrumentExamples = styled.span`
  flex: 1;
  font-size: 17px;
  color: #1a1a1a;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const InstrumentCheck = styled.span`
  color: #2f6df0;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
`;

