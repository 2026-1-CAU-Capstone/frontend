import { useEffect, useState } from 'react';
import styled from 'styled-components';
import {
  getPlayerSettings,
  setPlayerSetting,
  subscribePlayerSettings,
  type TransposingInstrument,
} from '../../lib/note/playerSettings';
import type { AnalysisFilters } from '../../hooks/useAnalysisFilters';

/* 고급 설정 모달 — 상단바 톱니바퀴에서 연다. Jazzify 설정 모달(SettingsModal)과
 * 동일한 풀스크린 사이드바 디자인을 따르되, 탭을 "분석 엔진 / 악기 이조" 둘로
 * 나눈다(일단). 믹서·플레이어 설정은 여기 두지 않는다 — 그건 상단바 믹서
 * 아이콘 드롭다운에 있다.
 *
 * 분석 보기 ON/OFF 마스터 토글은 상단바 전구 아이콘이 담당하고, 여기서는 분석
 * 엔진이 켜졌을 때 "무엇을" 보여줄지 세부 항목을 고른다(전구가 꺼져 있으면 세부
 * 항목은 비활성). */

interface Props {
  open: boolean;
  onClose: () => void;
  filters: AnalysisFilters;
  onToggleFilter: (key: keyof AnalysisFilters) => void;
}

type TabId = 'engine' | 'transpose';

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'engine', label: '분석 엔진' },
  { id: 'transpose', label: '악기 이조' },
];

const ANALYSIS_OPTIONS: { key: keyof AnalysisFilters; label: string; helper: string }[] = [
  { key: 'showDegree', label: '도수 표시', helper: '각 코드의 조성 내 도수(II-V-I 등)를 표기' },
  { key: 'showIIVI', label: '2-5-1 하이라이트', helper: 'ii-V-I 진행을 묶어 강조' },
  { key: 'showArrows', label: '해결 화살표', helper: 'V→I 등 해결 진행을 화살표로 표시' },
  { key: 'showColors', label: '비화성음 · 모달 색상', helper: '비화성음/모달 인터체인지를 색으로 구분' },
];

export function AnalysisSettingsModal({ open, onClose, filters, onToggleFilter }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('engine');

  /* Esc 로 닫기 + 모달 열린 동안 body 스크롤 잠금. */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
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
      <Modal onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="고급 설정">
        <CloseBtn onClick={onClose} aria-label="설정 닫기">
          <CloseIcon />
        </CloseBtn>

        <Body>
          <Sidebar>
            <SidebarTitle>설정</SidebarTitle>
            <TabList>
              {TABS.map((tab) => (
                <TabBtn key={tab.id} $active={activeTab === tab.id} onClick={() => setActiveTab(tab.id)}>
                  <TabLabel>{tab.label}</TabLabel>
                </TabBtn>
              ))}
            </TabList>
          </Sidebar>

          <Content>
            {activeTab === 'engine'
              ? <EnginePanel filters={filters} onToggleFilter={onToggleFilter} />
              : <TransposePanel />}
          </Content>
        </Body>
      </Modal>
    </Backdrop>
  );
}

/* ── 분석 엔진 탭 ────────────────────────────────────────────────────── */

function EnginePanel({ filters, onToggleFilter }: Pick<Props, 'filters' | 'onToggleFilter'>) {
  const on = filters.showAnalysis;
  return (
    <PanelInner>
      {/* 마스터 "분석 보기" 토글 — 제목·설명 바로 오른쪽에 크게. */}
      <PanelHeader>
        <PanelHeaderText>
          <SectionTitle>분석 엔진</SectionTitle>
          <FieldHelper style={{ margin: 0 }}>
            룰 기반 화성 분석을 켜고, 악보에 표시할 항목을 선택합니다. (분석 보기는 상단바
            전구 아이콘으로도 켜고 끌 수 있습니다.)
          </FieldHelper>
        </PanelHeaderText>
        <BigSwitch
          type="button" role="switch" aria-checked={on} aria-label="분석 보기"
          $on={on} onClick={() => onToggleFilter('showAnalysis')}
        />
      </PanelHeader>

      {ANALYSIS_OPTIONS.map(({ key, label, helper }) => (
        <FieldRow key={key} $dim={!on}>
          <div>
            <FieldLabel as="span">{label}</FieldLabel>
            <FieldHelper style={{ margin: '4px 0 0' }}>{helper}</FieldHelper>
          </div>
          <FieldControl>
            <Switch
              type="button" role="switch" aria-checked={on && !!filters[key]} aria-label={label}
              disabled={!on}
              $on={on && !!filters[key]}
              onClick={() => { if (on) onToggleFilter(key); }}
            />
          </FieldControl>
        </FieldRow>
      ))}
    </PanelInner>
  );
}

/* ── 악기 이조 탭 ────────────────────────────────────────────────────── */

const TRANSPOSING_INSTRUMENTS: { id: TransposingInstrument; label: string; examples: string }[] = [
  { id: 'C',  label: 'C',  examples: '피아노, 기타, 베이스, 보컬…' },
  { id: 'Bb', label: 'B♭', examples: '테너 색소폰, 트럼펫…' },
  { id: 'Eb', label: 'E♭', examples: '알토 색소폰…' },
  { id: 'F',  label: 'F',  examples: '잉글리시 호른…' },
  { id: 'G',  label: 'G',  examples: '알토 플루트…' },
];

function TransposePanel() {
  const [instrument, setInstrument] = useState<TransposingInstrument>(
    () => getPlayerSettings().transposingInstrument,
  );
  useEffect(() => subscribePlayerSettings((s) => setInstrument(s.transposingInstrument)), []);

  return (
    <PanelInner>
      <SectionTitle>이조 악기</SectionTitle>
      <FieldHelper>선택한 관악기에 맞춰 코드 차트의 조를 옮겨 표시합니다. (C = 콘서트 조)</FieldHelper>
      <InstrumentList>
        {TRANSPOSING_INSTRUMENTS.map(({ id, label, examples }) => {
          const active = instrument === id;
          return (
            <InstrumentRow key={id} type="button" $active={active} onClick={() => setPlayerSetting('transposingInstrument', id)}>
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

/* ── icons ─────────────────────────────────────────────────────────── */

const CloseIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </svg>
);

const CheckIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

/* ── styles (Jazzify 설정 모달과 동일, 크기만 크게) ──────────────────── */

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
  max-width: 1240px;
  height: 100%;
  max-height: 880px;
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
  grid-template-columns: 260px minmax(0, 1fr);
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
  padding: 11px 14px;
  border: none;
  border-radius: 8px;
  background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.06)' : 'transparent')};
  color: #1a1a1a;
  font-family: inherit;
  font-size: 15px;
  font-weight: ${({ $active }) => ($active ? 600 : 500)};
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
  &:hover { background: rgba(0, 0, 0, 0.05); }
`;

const TabLabel = styled.span`
  flex: 1;
`;

const Content = styled.section`
  overflow-y: auto;
  padding: 56px 56px 64px;

  @media (max-width: 820px) {
    padding: 28px 20px 40px;
  }
`;

const PanelInner = styled.div`
  max-width: 820px;
`;

const SectionTitle = styled.h2`
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 700;
  color: #1a1a1a;
  letter-spacing: -0.01em;
`;

/* 분석 엔진 헤더 — 제목+설명(좌) + 큰 마스터 토글(우). */
const PanelHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 28px;
  padding-bottom: 20px;
  margin-bottom: 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
`;
const PanelHeaderText = styled.div`
  flex: 1;
  min-width: 0;
  & > h2 { margin-bottom: 6px; }
`;
const BigSwitch = styled.button<{ $on?: boolean }>`
  position: relative;
  flex-shrink: 0;
  width: 60px;
  height: 34px;
  border: none;
  border-radius: 999px;
  background: ${({ $on }) => ($on ? '#1a1a1a' : 'rgba(0, 0, 0, 0.18)')};
  cursor: pointer;
  transition: background 0.15s;
  &::after {
    content: '';
    position: absolute;
    top: 3px;
    left: ${({ $on }) => ($on ? '29px' : '3px')};
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    transition: left 0.15s;
  }
`;

const FieldRow = styled.div<{ $dim?: boolean }>`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 24px;
  padding: 16px 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  opacity: ${({ $dim }) => ($dim ? 0.5 : 1)};
  transition: opacity 0.12s;
  &:last-of-type { border-bottom: none; }
`;

const FieldLabel = styled.label`
  font-size: 15px;
  font-weight: 500;
  color: #1a1a1a;
`;

const FieldHelper = styled.p`
  margin: 0 0 8px;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.55);
  line-height: 1.5;
`;

const FieldControl = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
`;

const Switch = styled.button<{ $on?: boolean }>`
  position: relative;
  width: 44px;
  height: 26px;
  border: none;
  border-radius: 999px;
  background: ${({ $on }) => ($on ? '#1a1a1a' : 'rgba(0, 0, 0, 0.18)')};
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s;
  &:disabled { cursor: default; }

  &::after {
    content: '';
    position: absolute;
    top: 3px;
    left: ${({ $on }) => ($on ? '21px' : '3px')};
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    transition: left 0.15s;
  }
`;

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
  padding: 18px 22px;
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
  font-size: 20px;
  font-weight: 600;
  color: ${({ $active }) => ($active ? '#2f6df0' : '#1a1a1a')};
  min-width: 30px;
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
