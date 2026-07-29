import { useEffect, useState } from 'react';
import styled from 'styled-components';
import type { AuthUser } from '../../api/auth';
import {
  getPlayerSettings,
  setPlayerSetting,
  subscribePlayerSettings,
  type TransposingInstrument,
  type BassMode,
} from '../../lib/note/playerSettings';
import { usePref } from '../../lib/prefsStore';
import {
  myChartsViewMode, mySheetsViewMode,
  myChartsSort, mySheetsSort, stemPreset, editorExplicitAcc,
  SORT_MODES, SORT_LABELS, type SortMode,
} from '../../lib/pagePrefs';
import { useAnalysisFilters, type AnalysisFilters } from '../../hooks/useAnalysisFilters';
import { STEM_PRESETS, type StemPresetId } from '../../lib/stems/mockSeparate';
import type { SettingsTabId, PerformanceSectionId } from '../../lib/settingsBus';
import type { ProjectViewMode } from '../../hooks/useViewModePref';

/* 풀스크린 설정 모달 — Claude 데스크탑 설정 페이지 패턴.
 *
 * 좌측 사이드바에 탭. "악보/연주" 탭은 2차 사이드바를 하나 더 열어
 * 페이지별(내 코드 차트·내 악보 차트·내 릭·음원 분리) 설정을 나눠 담는다.
 * 각 페이지의 톱니바퀴는 settingsBus 로 해당 섹션을 바로 연다.
 *
 * 일반 탭의 프로필/환경설정 입력은 아직 visual mock — 저장 / 적용 안 됨. */

interface Props {
  open: boolean;
  user: AuthUser;
  onClose: () => void;
  /** 열릴 때 선택할 탭 / 악보·연주 섹션 (settingsBus 요청). */
  initialTab?: SettingsTabId;
  initialSection?: PerformanceSectionId;
}

const TABS: ReadonlyArray<{ id: SettingsTabId; label: string; badge?: string }> = [
  { id: 'general', label: '일반' },
  { id: 'performance', label: '악보/연주' },
  { id: 'account', label: '계정' },
  { id: 'privacy', label: '개인정보보호' },
  { id: 'billing', label: '결제' },
  { id: 'usage', label: '사용량' },
  { id: 'features', label: '기능' },
  { id: 'connectors', label: '커넥터' },
  { id: 'cli', label: 'Jazzify CLI' },
  { id: 'chrome', label: 'Chrome용 Jazzify', badge: '베타' },
];

/** 악보/연주 2차 사이드바 — 각 페이지의 톱니바퀴가 이 id 로 진입한다. */
const PERF_SECTIONS: ReadonlyArray<{ id: PerformanceSectionId; label: string }> = [
  { id: 'transpose', label: '이조 악기' },
  { id: 'mixer', label: '믹서' },
  { id: 'chordAnalysis', label: '코드 분석' },
  { id: 'editor', label: '에디터' },
  { id: 'myCharts', label: '내 코드 차트' },
  { id: 'mySheets', label: '내 악보 차트' },
  { id: 'myLicks', label: '내 릭' },
  { id: 'stems', label: '음원 분리' },
];

export function SettingsModal({ open, user, onClose, initialTab, initialSection }: Props) {
  /* 시작 위치는 마운트 시점에 확정된다. 호출자(GlobalSettingsModal)가 요청마다
   * key 를 바꿔 새로 마운트하므로, 다른 섹션을 요청하면 그 위치에서 열린다. */
  const [activeTab, setActiveTab] = useState<SettingsTabId>(() => initialTab ?? 'general');
  const [perfSection, setPerfSection] = useState<PerformanceSectionId>(() => initialSection ?? 'transpose');

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

  const showSub = activeTab === 'performance';

  return (
    <Backdrop onClick={onClose}>
      <Modal onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="설정">
        <CloseBtn onClick={onClose} aria-label="설정 닫기">
          <CloseIcon />
        </CloseBtn>

        <Body $withSub={showSub}>
          <Sidebar>
            <SidebarTitle>설정</SidebarTitle>
            <TabList>
              {TABS.map((tab) => (
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

          {showSub && (
            <SubSidebar>
              <SubSidebarTitle>악보/연주</SubSidebarTitle>
              <TabList>
                {PERF_SECTIONS.map((s) => (
                  <TabBtn
                    key={s.id}
                    $active={perfSection === s.id}
                    onClick={() => setPerfSection(s.id)}
                  >
                    <TabLabel>{s.label}</TabLabel>
                  </TabBtn>
                ))}
              </TabList>
            </SubSidebar>
          )}

          <Content>
            {activeTab === 'general' ? (
              <GeneralPanel user={user} />
            ) : activeTab === 'performance' ? (
              <PerformanceSection section={perfSection} />
            ) : (
              <Placeholder>준비 중</Placeholder>
            )}
          </Content>
        </Body>
      </Modal>
    </Backdrop>
  );
}

/* ── 악보/연주 — 2차 사이드바 섹션 라우팅 ─────────────────────────────── */

function PerformanceSection({ section }: { section: PerformanceSectionId }) {
  switch (section) {
    case 'transpose':     return <PerformancePanel />;
    case 'mixer':         return <MixerPanel />;
    case 'chordAnalysis': return <ChordAnalysisPanel />;
    case 'editor':        return <EditorPanel />;
    case 'myCharts':      return <ProjectListPanel kind="charts" />;
    case 'mySheets':      return <ProjectListPanel kind="sheets" />;
    case 'stems':         return <StemsPanel />;
    /* 내 릭은 지금 페이지에 영속되는 설정이 없다(필터는 세션 한정). 새 설정을
     * 임의로 만들지 않고 자리만 잡아둔다. */
    case 'myLicks':       return <Placeholder>준비 중</Placeholder>;
  }
}

/* ── 믹서 — 드롭다운의 '고급 기능' 중 곡과 무관한 항목을 옮겨왔다 ────────
 *
 * 브레이크 에디터·구간 반복은 여기 없다. 그 둘은 설정이 아니라 "지금 열어둔
 * 차트의 마디를 클릭해 편집하는 모드"라, 차트가 없는 설정 창에서는 동작할 수
 * 없다. 계속 믹서 드롭다운에 남는다. */

const BASS_MODES: { id: BassMode; label: string; desc: string }[] = [
  { id: 'half',      label: '1박/코드', desc: '코드마다 한 음 — 가장 단순한 워킹' },
  { id: 'two-feel',  label: '2-feel',   desc: '2박 느낌 — 발라드·머디엄에 무난' },
  { id: 'four-feel', label: '4-feel',   desc: '4박 워킹 — 스윙의 기본' },
];

function MixerPanel() {
  const [settings, setSettings] = useState(() => getPlayerSettings());
  useEffect(() => subscribePlayerSettings(setSettings), []);
  const { countInEnabled, countInBars, playInlineLick, bassMode } = settings;

  return (
    <PanelInner>
      <SectionTitle>재생</SectionTitle>

      <FieldRow>
        <div>
          <FieldLabel as="span">카운트인</FieldLabel>
          <FieldHelper style={{ margin: '2px 0 0' }}>
            재생 전 “1 2 3 4” 박자를 세고 시작합니다. 끄면 즉시 재생.
          </FieldHelper>
        </div>
        <FieldControl>
          <Switch
            type="button" role="switch" aria-checked={countInEnabled} aria-label="카운트인"
            $on={countInEnabled}
            onClick={() => setPlayerSetting('countInEnabled', !countInEnabled)}
          />
        </FieldControl>
      </FieldRow>

      {countInEnabled && (
        <FieldRow>
          <FieldLabel as="span">세는 마디</FieldLabel>
          <FieldControl>
            <Segmented>
              {[1, 2].map((n) => (
                <SegBtn
                  key={n} type="button" $on={countInBars === n}
                  onClick={() => setPlayerSetting('countInBars', n)}
                >
                  {n}마디
                </SegBtn>
              ))}
            </Segmented>
          </FieldControl>
        </FieldRow>
      )}

      <FieldRow>
        <div>
          <FieldLabel as="span">인라인 릭 재생</FieldLabel>
          <FieldHelper style={{ margin: '2px 0 0' }}>
            악보 위에 띄운 추천 릭(라인)을 반주와 함께 들려줍니다. 코드 차트에서만 쓰입니다.
          </FieldHelper>
        </div>
        <FieldControl>
          <Switch
            type="button" role="switch" aria-checked={playInlineLick} aria-label="인라인 릭 재생"
            $on={playInlineLick}
            onClick={() => setPlayerSetting('playInlineLick', !playInlineLick)}
          />
        </FieldControl>
      </FieldRow>

      <SectionTitle style={{ marginTop: 44 }}>베이스</SectionTitle>
      <FieldHelper>워킹 베이스가 코드 한 개를 몇 박으로 걸을지 정합니다.</FieldHelper>
      <InstrumentList>
        {BASS_MODES.map(({ id, label, desc }) => {
          const active = bassMode === id;
          return (
            <InstrumentRow
              key={id} type="button" $active={active}
              onClick={() => setPlayerSetting('bassMode', id)}
            >
              <InstrumentKey $active={active}>{label}</InstrumentKey>
              <InstrumentExamples>({desc})</InstrumentExamples>
              {active && <InstrumentCheck><CheckIcon /></InstrumentCheck>}
            </InstrumentRow>
          );
        })}
      </InstrumentList>

      <FieldHelper style={{ marginTop: 36 }}>
        볼륨·솔로·뮤트·악기 선택은 곡을 들으며 바로 조절하는 값이라 믹서 드롭다운에 그대로 있습니다.
        브레이크 에디터와 구간 반복도 열어둔 차트의 마디를 클릭해 쓰는 기능이라 믹서에 남습니다.
      </FieldHelper>
    </PanelInner>
  );
}

/* ── 코드 분석 — 기존 AnalysisSettingsModal 의 '분석 엔진' 탭을 옮겨왔다 ── */

const ANALYSIS_OPTIONS: { id: keyof AnalysisFilters; label: string; helper: string }[] = [
  { id: 'showDegree', label: '도수 표시',        helper: '코드 아래 로마numeral·도수를 표시합니다.' },
  { id: 'showIIVI',   label: '2-5-1 하이라이트', helper: '2-5-1 진행을 밴드와 브라켓으로 묶어 보여줍니다.' },
  { id: 'showArrows', label: '해결 화살표',      helper: '세컨더리 도미넌트의 해결 방향을 화살표로 그립니다.' },
  { id: 'showColors', label: '비화성음 · 모달 색상', helper: '모달 인터체인지·비화성음을 색으로 구분합니다.' },
];

function ChordAnalysisPanel() {
  const { filters, toggleFilter } = useAnalysisFilters();
  const master = filters.showAnalysis;

  return (
    <PanelInner>
      <SectionTitle>분석 표시</SectionTitle>
      <FieldHelper>
        코드 페이지 상단바의 전구 아이콘과 같은 설정입니다. 마스터를 끄면 세부 항목도 모두 꺼집니다.
      </FieldHelper>

      <FieldRow>
        <FieldLabel as="span">분석 보기</FieldLabel>
        <FieldControl>
          <Switch
            type="button" role="switch" aria-checked={master} aria-label="분석 보기"
            $on={master} onClick={() => toggleFilter('showAnalysis')}
          />
        </FieldControl>
      </FieldRow>

      {ANALYSIS_OPTIONS.map((o) => (
        <FieldRow key={o.id} style={{ opacity: master ? 1 : 0.45 }}>
          <div>
            <FieldLabel as="span">{o.label}</FieldLabel>
            <FieldHelper style={{ margin: '2px 0 0' }}>{o.helper}</FieldHelper>
          </div>
          <FieldControl>
            <Switch
              type="button" role="switch" aria-checked={filters[o.id]} aria-label={o.label}
              disabled={!master}
              $on={filters[o.id]} onClick={() => toggleFilter(o.id)}
            />
          </FieldControl>
        </FieldRow>
      ))}
    </PanelInner>
  );
}

/* ── 에디터 — 기존 '출력 설정' 모달의 설정 항목을 옮겨왔다 ──────────────
 *
 * 옥타브 이동(Oct ±1)은 여기 없다. 그건 설정이 아니라 지금 편집 중인 악보의
 * 음표를 실제로 옮기는 동작이라, 악보가 없는 설정 창에서는 의미가 없다.
 * 에디터의 undo/redo 줄에 남는다. MIDI 기기 설정도 연결된 포트를 실시간으로
 * 읽어야 해서 에디터의 MIDI 버튼에 그대로 둔다. */
function EditorPanel() {
  const [explicitAcc, setExplicitAcc] = usePref(editorExplicitAcc);

  return (
    <PanelInner>
      <SectionTitle>악보 표기</SectionTitle>

      <FieldRow>
        <div>
          <FieldLabel as="span">조표 무시</FieldLabel>
          <FieldHelper style={{ margin: '2px 0 0' }}>
            켜면 조표를 그리지 않고 마디 안의 ♯/♭(마디 내 상속 포함)만으로 판단합니다 —
            조표 없이 마디마다 임시표로 해결하는 악보 전용. 끄면 조표에 맞춰 임시표를 생략합니다(기본).
          </FieldHelper>
        </div>
        <FieldControl>
          <Switch
            type="button" role="switch" aria-checked={explicitAcc} aria-label="조표 무시"
            $on={explicitAcc} onClick={() => setExplicitAcc(!explicitAcc)}
          />
        </FieldControl>
      </FieldRow>

      <FieldHelper style={{ marginTop: 36 }}>
        옥타브 이동은 편집 중인 악보를 직접 바꾸는 동작이라 에디터 화면에 있습니다.
        MIDI 기기 설정도 연결된 기기를 실시간으로 읽어야 해서 에디터의 MIDI 버튼에 있습니다.
      </FieldHelper>
    </PanelInner>
  );
}

/* ── 내 코드 차트 / 내 악보 차트 ─────────────────────────────────────── */

const VIEW_MODE_OPTIONS: { id: ProjectViewMode; label: string }[] = [
  { id: 'grid', label: '그리드' },
  { id: 'list', label: '리스트' },
];

function ProjectListPanel({ kind }: { kind: 'charts' | 'sheets' }) {
  const [viewMode, setViewMode] = usePref(kind === 'charts' ? myChartsViewMode : mySheetsViewMode);
  const [sort, setSort] = usePref(kind === 'charts' ? myChartsSort : mySheetsSort);
  const what = kind === 'charts' ? '코드 차트' : '악보 차트';

  return (
    <PanelInner>
      <SectionTitle>목록 표시</SectionTitle>
      <FieldHelper>내 {what} 목록을 어떻게 열지 정합니다. 페이지 상단에서 바꾼 값과 같은 설정입니다.</FieldHelper>

      <FieldRow>
        <FieldLabel as="span">보기 방식</FieldLabel>
        <FieldControl>
          <Segmented>
            {VIEW_MODE_OPTIONS.map((o) => (
              <SegBtn key={o.id} type="button" $on={viewMode === o.id} onClick={() => setViewMode(o.id)}>
                {o.label}
              </SegBtn>
            ))}
          </Segmented>
        </FieldControl>
      </FieldRow>

      <FieldRow>
        <FieldLabel as="span">기본 정렬</FieldLabel>
        <FieldControl>
          <SelectInput value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
            {SORT_MODES.map((m) => (
              <option key={m} value={m}>{SORT_LABELS[m]}</option>
            ))}
          </SelectInput>
        </FieldControl>
      </FieldRow>
    </PanelInner>
  );
}

/* ── 음원 분리 ───────────────────────────────────────────────────────── */

function StemsPanel() {
  const [preset, setPreset] = usePref(stemPreset);

  return (
    <PanelInner>
      <SectionTitle>분리 기본값</SectionTitle>
      <FieldHelper>음원 분리 페이지를 열 때 시작할 갈래 수입니다.</FieldHelper>
      <InstrumentList>
        {(Object.keys(STEM_PRESETS) as StemPresetId[]).map((id) => {
          const p = STEM_PRESETS[id];
          const active = preset === id;
          return (
            <InstrumentRow key={id} type="button" $active={active} onClick={() => setPreset(id)}>
              <InstrumentKey $active={active}>{p.label}</InstrumentKey>
              <InstrumentExamples>({p.desc})</InstrumentExamples>
              {active && <InstrumentCheck><CheckIcon /></InstrumentCheck>}
            </InstrumentRow>
          );
        })}
      </InstrumentList>
    </PanelInner>
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

/* ── 이조 악기 ──────────────────────────────────────────────────────── */

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

const Body = styled.div<{ $withSub?: boolean }>`
  flex: 1;
  display: grid;
  /* 악보/연주 탭은 2차 사이드바가 하나 더 붙어 3단이 된다. */
  grid-template-columns: ${({ $withSub }) => ($withSub ? '208px 192px minmax(0, 1fr)' : '240px minmax(0, 1fr)')};
  min-height: 0;

  @media (max-width: 1000px) {
    grid-template-columns: ${({ $withSub }) => ($withSub ? '180px 168px minmax(0, 1fr)' : '220px minmax(0, 1fr)')};
  }

  @media (max-width: 820px) {
    grid-template-columns: 1fr;
    grid-template-rows: ${({ $withSub }) => ($withSub ? 'auto auto minmax(0, 1fr)' : 'auto minmax(0, 1fr)')};
  }
`;

/* 2차 사이드바 — 1차와 같은 TabBtn 을 쓰되 배경을 한 톤 낮춰 계층을 보인다. */
const SubSidebar = styled.aside`
  border-right: 1px solid rgba(0, 0, 0, 0.08);
  background: rgba(0, 0, 0, 0.016);
  padding: 40px 10px 24px 14px;
  overflow-y: auto;

  @media (max-width: 820px) {
    border-right: none;
    border-bottom: 1px solid rgba(0, 0, 0, 0.08);
    padding: 12px 16px;
  }
`;

const SubSidebarTitle = styled.h2`
  margin: 0 0 12px 12px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: #8a8a83;
`;

const Segmented = styled.div`
  display: inline-flex;
  background: rgba(0, 0, 0, 0.05);
  border-radius: 9px;
  padding: 3px;
`;

const SegBtn = styled.button<{ $on?: boolean }>`
  border: none;
  border-radius: 7px;
  padding: 7px 16px;
  cursor: pointer;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: ${({ $on }) => ($on ? 700 : 500)};
  color: ${({ $on }) => ($on ? '#1a1a1a' : '#77776f')};
  background: ${({ $on }) => ($on ? '#fff' : 'transparent')};
  box-shadow: ${({ $on }) => ($on ? '0 1px 3px rgba(0,0,0,0.10)' : 'none')};
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

