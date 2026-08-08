import { useEffect, useMemo, useRef, useState } from 'react';
import styled from 'styled-components';
import { type AuthUser } from '../../api/auth';
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
  myChartsSort, mySheetsSort, stemPreset, editorExplicitAcc, showLyricsDefault, lyricsDefaultSeeded,
  SORT_MODES, SORT_LABELS, type SortMode,
} from '../../lib/pagePrefs';
import { useAnalysisFilters, type AnalysisFilters } from '../../hooks/useAnalysisFilters';
import { STEM_PRESETS, type StemPresetId } from '../../lib/stems/mockSeparate';
import type { SettingsTabId, PageSectionId } from '../../lib/settingsBus';
import type { ProjectViewMode } from '../../hooks/useViewModePref';
import { myInstruments, MY_INSTRUMENTS, suggestedTranspose } from '../../lib/note/instrumentPrefs';
import { instrumentIconUrl } from '../../data/instrumentIcons';
import {
  lickFollowMyInstrument, lickInstruments, resolveLickInstruments,
  allLickInstrumentIds, LICK_INSTRUMENT_OPTIONS,
} from '../../lib/note/lickRecoPrefs';
import { useDismissable } from '../../hooks/useDismissable';
import { themeMode } from '../../lib/themePrefs';
import {
  noteNamesOn, noteNameLang, noteNameColor, noteNameSize,
  NOTE_NAME_SIZE_MIN, NOTE_NAME_SIZE_MAX, NOTE_NAME_COLOR_DEFAULT,
} from '../../lib/note/noteNamePrefs';
import { chordDiagramsOn, diagramSuggestSeen } from '../../lib/note/chordDiagramPrefs';

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
  initialSection?: PageSectionId;
}

const TABS: ReadonlyArray<{ id: SettingsTabId; label: string; badge?: string }> = [
  { id: 'general', label: '일반' },
  { id: 'notation', label: '표기' },
  { id: 'playback', label: '믹서' },
  { id: 'chat', label: '채팅' },
  { id: 'pages', label: '화면별' },
];

/** '화면별' 탭의 2차 사이드바 — 각 화면의 ⚙ 가 이 id 로 바로 진입한다. */
const PAGE_SECTIONS: ReadonlyArray<{ id: PageSectionId; label: string }> = [
  { id: 'editor', label: '에디터' },
  { id: 'myCharts', label: '내 코드 차트' },
  { id: 'mySheets', label: '내 악보 차트' },
  { id: 'stems', label: '음원 분리' },
];

export function SettingsModal({ open, user, onClose, initialTab, initialSection }: Props) {
  /* 시작 위치는 마운트 시점에 확정된다. 호출자(GlobalSettingsModal)가 요청마다
   * key 를 바꿔 새로 마운트하므로, 다른 섹션을 요청하면 그 위치에서 열린다. */
  const [activeTab, setActiveTab] = useState<SettingsTabId>(() => initialTab ?? 'general');
  const [pageSection, setPageSection] = useState<PageSectionId>(() => initialSection ?? 'editor');

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

  const showSub = activeTab === 'pages';

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
              <SubSidebarTitle>화면별</SubSidebarTitle>
              <TabList>
                {PAGE_SECTIONS.map((sec) => (
                  <TabBtn
                    key={sec.id}
                    $active={pageSection === sec.id}
                    onClick={() => setPageSection(sec.id)}
                  >
                    <TabLabel>{sec.label}</TabLabel>
                  </TabBtn>
                ))}
              </TabList>
            </SubSidebar>
          )}

          <Content>
            {activeTab === 'general' ? <GeneralPanel user={user} />
              : activeTab === 'notation' ? <NotationTab />
              : activeTab === 'playback' ? <PlaybackTab />
              : activeTab === 'chat' ? <ChatTab />
              : <PageTab page={pageSection} />}
          </Content>
        </Body>
      </Modal>
    </Backdrop>
  );
}

/* ── 탭 본문 ────────────────────────────────────────────────────────────
 *
 * 성격별 탭(표기·재생·채팅·라이브러리)은 **전역 기본값 + 페이지별 예외 전체**를,
 * '화면별' 탭은 **그 화면 범위 값만** 보여준다. 값은 같은 Pref 하나라서 어느
 * 쪽에서 만져도 결과가 같다 — 화면만 둘이고 정의는 하나다.
 *
 * 화면별에서 범위 혼란("이거 여기만 바뀌나?")이 없도록, 각 항목이 전역 기본값을
 * 한 줄로 함께 보여준다(NoteNameOverrideRow 참조).
 * ──────────────────────────────────────────────────────────────────── */

function NotationTab() {
  return (
    <PanelInner>
      <SheetDisplayBody />
    </PanelInner>
  );
}

function PlaybackTab() {
  return <PanelInner><PlaybackBody /></PanelInner>;
}

function ChatTab() {
  return (
    <PanelInner>
      <SectionTitle>AI 채팅</SectionTitle>
      <ChatBody />
      <FieldHelper style={{ marginTop: 28 }}>
        AI가 준 릭을 오선/TAB 중 무엇으로 볼지는 렌더러 작업이 끝난 뒤 여기에 추가됩니다.
        지금은 모든 릭이 오선으로 표시됩니다.
      </FieldHelper>

      <SectionTitle style={{ marginTop: 44 }}>릭 추천 범위</SectionTitle>
      <FieldHelper>
        AI가 어떤 악기의 릭까지 추천할지 정합니다. 기본은 <b>주 악기</b>(설정 › 계정)를
        따라가며, 직접 고르고 싶으면 따라가기를 끄고 복수 선택하세요.
        릭은 선율 프레이즈라 <b>드럼 같은 리듬 악기는 목록에 없습니다.</b>
      </FieldHelper>
      <LickInstrumentPicker />
    </PanelInner>
  );
}

/** 릭 추천 범위 — 주 악기 따라가기 토글 + 복수 선택 드롭다운(전체 선택/해제). */
function LickInstrumentPicker() {
  const [follow, setFollow] = usePref(lickFollowMyInstrument);
  const [picked, setPicked] = usePref(lickInstruments);
  const [myInsts] = usePref(myInstruments);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  useDismissable(open, anchorRef, () => setOpen(false));

  /* 실제 적용될 집합 — 따라가기가 켜져 있으면 주 악기에서 파생된다. */
  const effective = useMemo(
    () => resolveLickInstruments(follow, picked, myInsts),
    [follow, picked, myInsts],
  );
  const all = allLickInstrumentIds();
  const summary = effective.length === 0
    ? '선택 없음 — 추천이 표시되지 않습니다'
    : effective.length >= all.length
      ? '전체 악기'
      : LICK_INSTRUMENT_OPTIONS.filter((o) => effective.includes(o.id)).map((o) => o.label).join(', ');

  const toggle = (id: string) => {
    setPicked(picked.includes(id) ? picked.filter((v) => v !== id) : [...picked, id]);
  };

  return (
    <>
      <FieldRow>
        <div>
          <FieldLabel as="span">주 악기 따라가기</FieldLabel>
          <FieldHelper style={{ margin: '2px 0 0' }}>
            {myInsts.length === 0
              ? '주 악기가 선택되지 않아 전체 악기를 추천합니다.'
              : '주 악기를 바꾸면 추천 범위도 함께 바뀝니다.'}
          </FieldHelper>
        </div>
        <FieldControl>
          <Switch type="button" role="switch" aria-checked={follow} $on={follow}
            onClick={() => setFollow(!follow)}>
            <span />
          </Switch>
        </FieldControl>
      </FieldRow>

      <FieldRow>
        <div>
          <FieldLabel as="span">추천 받을 악기</FieldLabel>
          <FieldHelper style={{ margin: '2px 0 0' }}>{summary}</FieldHelper>
        </div>
        <FieldControl>
          <MultiAnchor ref={anchorRef}>
            <MultiTrigger type="button" disabled={follow} $open={open}
              onClick={() => setOpen((v) => !v)}
              title={follow ? '주 악기 따라가기를 끄면 직접 고를 수 있습니다' : undefined}>
              <span>{follow ? '자동' : `${picked.length}개 선택`}</span>
              <Caret aria-hidden>▾</Caret>
            </MultiTrigger>
            {open && !follow && (
              <MultiMenu>
                <MultiBulk>
                  <button type="button" onClick={() => setPicked(all)}>전체 선택</button>
                  <button type="button" onClick={() => setPicked([])}>전체 해제</button>
                </MultiBulk>
                {LICK_INSTRUMENT_OPTIONS.map((o) => (
                  <MultiItem key={o.id}>
                    <input type="checkbox" checked={picked.includes(o.id)} onChange={() => toggle(o.id)} />
                    <span>{o.label}</span>
                  </MultiItem>
                ))}
              </MultiMenu>
            )}
          </MultiAnchor>
        </FieldControl>
      </FieldRow>
    </>
  );
}

/** 화면별 — 그 화면에 영향을 주는 설정만 모아 보여준다. */
function PageTab({ page }: { page: PageSectionId }) {
  const label = PAGE_SECTIONS.find((p) => p.id === page)?.label ?? '';
  return (
    <PanelInner>
      <SectionTitle>{label}</SectionTitle>
      <FieldHelper>
        이 화면에만 적용되는 설정입니다. ‘전역 따름’이면 표기·재생 탭의 기본값을 씁니다.
      </FieldHelper>

      {page === 'editor' && <EditorOnlyBody />}
      {page === 'stems' && <StemsBody />}
      {(page === 'myCharts' || page === 'mySheets') && (
        <ProjectListBody kind={page === 'myCharts' ? 'charts' : 'sheets'} />
      )}
      {/* 코드 분석 표시는 코드 차트에서만 의미가 있다 — 표기 탭에서 여기로 옮겼다. */}
      {page === 'myCharts' && <><Divider /><ChordAnalysisBody /></>}

    </PanelInner>
  );
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

function PlaybackBody() {
  const [settings, setSettings] = useState(() => getPlayerSettings());
  useEffect(() => subscribePlayerSettings(setSettings), []);
  const { countInEnabled, countInBars, bassMode } = settings;

  return (
    <>
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
    </>
  );
}

function ChatBody() {
  const [settings, setSettings] = useState(() => getPlayerSettings());
  useEffect(() => subscribePlayerSettings(setSettings), []);
  const { playInlineLick } = settings;
  return (
    <>
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
    </>
  );
}


/* ── 코드 분석 — 기존 AnalysisSettingsModal 의 '분석 엔진' 탭을 옮겨왔다 ── */

const ANALYSIS_OPTIONS: { id: keyof AnalysisFilters; label: string; helper: string }[] = [
  { id: 'showDegree', label: '도수 표시',        helper: '코드 아래 로마numeral·도수를 표시합니다.' },
  { id: 'showIIVI',   label: '2-5-1 하이라이트', helper: '2-5-1 진행을 밴드와 브라켓으로 묶어 보여줍니다.' },
  { id: 'showArrows', label: '해결 화살표',      helper: '세컨더리 도미넌트의 해결 방향을 화살표로 그립니다.' },
  { id: 'showColors', label: '비화성음 · 모달 색상', helper: '모달 인터체인지·비화성음을 색으로 구분합니다.' },
];

function ChordAnalysisBody() {
  const { filters, toggleFilter } = useAnalysisFilters();
  const master = filters.showAnalysis;

  return (
    <>
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
    </>
  );
}

/* ── 에디터 — 기존 '출력 설정' 모달의 설정 항목을 옮겨왔다 ──────────────
 *
 * 옥타브 이동(Oct ±1)은 여기 없다. 그건 설정이 아니라 지금 편집 중인 악보의
 * 음표를 실제로 옮기는 동작이라, 악보가 없는 설정 창에서는 의미가 없다.
 * 에디터의 undo/redo 줄에 남는다. MIDI 기기 설정도 연결된 포트를 실시간으로
 * 읽어야 해서 에디터의 MIDI 버튼에 그대로 둔다. */

/* ── 악보 표시 — 음이름 라벨(전역 + 페이지별) ─────────────────────────────
 *
 * 전역에서 켜기·언어·색·크기를 정하고, 아래 목록에서 페이지마다 따로 끄거나
 * 켤 수 있다. 각 페이지 섹션(에디터·내 코드 차트…)에도 같은 덮어쓰기 컨트롤이
 * 있어 어디서 찾든 같은 값을 만진다. */
function SheetDisplayBody() {
  const [on, setOn] = usePref(noteNamesOn);
  const [lang, setLang] = usePref(noteNameLang);
  const [color, setColor] = usePref(noteNameColor);
  const [size, setSize] = usePref(noteNameSize);
  const [diagrams, setDiagrams] = usePref(chordDiagramsOn);
  const [, setSuggestSeen] = usePref(diagramSuggestSeen);

  return (
    <>
      <SectionTitle>기타 코드 다이어그램</SectionTitle>

      <FieldRow>
        <div>
          <FieldLabel as="span">코드 위에 운지 표시</FieldLabel>
          <FieldHelper style={{ margin: '2px 0 0' }}>
            켜면 코드심볼 아래에 <b>기타 프렛 다이어그램</b>이 함께 뜹니다. 운지는 사람이
            검수한 공개 데이터(chords-db)를 그대로 가져옵니다 — 저희가 만들지 않습니다.
            데이터에 없는 코드는 표시하지 않습니다.
          </FieldHelper>
          <FieldHelper style={{ margin: '4px 0 0' }}>
            <b>표준 튜닝 전용</b>입니다. 카포·드롭D·베이스 보표에서는 폼이 맞지 않아
            자동으로 표시하지 않습니다.
          </FieldHelper>
        </div>
        <FieldControl>
          <Switch
            type="button" role="switch" aria-checked={diagrams} aria-label="기타 코드 다이어그램"
            $on={diagrams}
            onClick={() => {
              /* 직접 정했으면 세션 변경 시 다시 권하지 않는다. */
              setSuggestSeen(true);
              setDiagrams(!diagrams);
            }}
          />
        </FieldControl>
      </FieldRow>

      <SectionTitle>음표에 음 표시하기</SectionTitle>

      <FieldRow>
        <div>
          <FieldLabel as="span">음이름 표시</FieldLabel>
          <FieldHelper style={{ margin: '2px 0 0' }}>
            켜면 모든 악보에서 <b>음표 머리 바로 위</b>에 음이름이 함께 뜹니다.
            TAB 숫자와 드럼 보표에는 붙지 않습니다(음높이가 아니라서요).
          </FieldHelper>
        </div>
        <FieldControl>
          <Switch
            type="button" role="switch" aria-checked={on} aria-label="음이름 표시"
            $on={on} onClick={() => setOn(!on)}
          />
        </FieldControl>
      </FieldRow>

      <FieldRow>
        <div>
          <FieldLabel as="span">표기 언어</FieldLabel>
          <FieldHelper style={{ margin: '2px 0 0' }}>
            한국어는 계이름(도·레·미), 영어는 음이름(C·D·E)으로 적습니다. 임시표는 ♯·♭로 붙습니다.
          </FieldHelper>
        </div>
        <FieldControl>
          <Segmented>
            <SegBtn type="button" $on={lang === 'ko'} onClick={() => setLang('ko')}>한국어</SegBtn>
            <SegBtn type="button" $on={lang === 'en'} onClick={() => setLang('en')}>English</SegBtn>
          </Segmented>
        </FieldControl>
      </FieldRow>

      <FieldRow>
        <div>
          <FieldLabel as="span">글자 색</FieldLabel>
          <FieldHelper style={{ margin: '2px 0 0' }}>악보의 검정과 구분되는 색을 고르세요.</FieldHelper>
        </div>
        <FieldControl>
          <ColorPickRow>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)}
              aria-label="음이름 글자 색" />
            <ColorHex>{color.toUpperCase()}</ColorHex>
            <SegBtn type="button" onClick={() => setColor(NOTE_NAME_COLOR_DEFAULT)}>기본값</SegBtn>
          </ColorPickRow>
        </FieldControl>
      </FieldRow>

      <FieldRow>
        <div>
          <FieldLabel as="span">글자 크기</FieldLabel>
          <FieldHelper style={{ margin: '2px 0 0' }}>
            악보 배율에 함께 곱해지므로 어느 화면에서든 같은 비율로 보입니다.
          </FieldHelper>
        </div>
        <FieldControl>
          <ColorPickRow>
            <input type="range" min={NOTE_NAME_SIZE_MIN} max={NOTE_NAME_SIZE_MAX} step={1}
              value={size} onChange={(e) => setSize(Number(e.target.value))}
              aria-label="음이름 글자 크기" />
            <ColorHex>{size}</ColorHex>
          </ColorPickRow>
        </FieldControl>
      </FieldRow>

    </>
  );
}



function EditorOnlyBody() {
  const [explicitAcc, setExplicitAcc] = usePref(editorExplicitAcc);
  const [lyricsOn, setLyricsOn] = usePref(showLyricsDefault);

  return (
    <>
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

      <FieldRow>
        <div>
          <FieldLabel as="span">가사 표시</FieldLabel>
          <FieldHelper style={{ margin: '2px 0 0' }}>
            악보에 가사가 있으면 음표 아래에 절 순서대로 보여 줍니다(보컬용).
            여기서 정한 값은 <b>기본값</b>이고, 악보마다 상단의 <b>가사</b> 버튼으로 따로 켜고 끌 수 있습니다.
          </FieldHelper>
        </div>
        <FieldControl>
          <Switch
            type="button" role="switch" aria-checked={lyricsOn} aria-label="가사 표시"
            $on={lyricsOn} onClick={() => setLyricsOn(!lyricsOn)}
          />
        </FieldControl>
      </FieldRow>

      <FieldHelper style={{ marginTop: 36 }}>
        옥타브 이동은 편집 중인 악보를 직접 바꾸는 동작이라 에디터 화면에 있습니다.
        MIDI 기기 설정도 연결된 기기를 실시간으로 읽어야 해서 에디터의 MIDI 버튼에 있습니다.
      </FieldHelper>
    </>
  );
}

/* ── 내 코드 차트 / 내 악보 차트 ─────────────────────────────────────── */

const VIEW_MODE_OPTIONS: { id: ProjectViewMode; label: string }[] = [
  { id: 'grid', label: '그리드' },
  { id: 'list', label: '리스트' },
];

function ProjectListBody({ kind }: { kind: 'charts' | 'sheets' }) {
  const [viewMode, setViewMode] = usePref(kind === 'charts' ? myChartsViewMode : mySheetsViewMode);
  const [sort, setSort] = usePref(kind === 'charts' ? myChartsSort : mySheetsSort);
  const what = kind === 'charts' ? '코드 차트' : '악보 차트';

  return (
    <>
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
    </>
  );
}

/* ── 음원 분리 ───────────────────────────────────────────────────────── */

function StemsBody() {
  const [preset, setPreset] = usePref(stemPreset);

  return (
    <>
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
    </>
  );
}

/* ── general 탭 본문 ────────────────────────────────────────────────── */

function GeneralPanel({ user }: { user: AuthUser }) {
  const displayName = (user.name?.trim() || user.username || '').trim();
  /* 이메일 계정이면 Google 마크와 함께 보여준다. admin 처럼 아이디만인 계정은 생략. */
  const email = user.username?.includes('@') ? user.username : null;
  const [editingName, setEditingName] = useState(false);
  const [mode, setMode] = usePref(themeMode);

  return (
    <PanelInner>
      <SectionTitle>계정</SectionTitle>

      <AccountRow>
        {/* 아바타 — hover 하면 카메라 아이콘 오버레이가 뜬다(글자 없음).
            업로드 기능은 아직 없다(디자인만). */}
        <AvatarEdit type="button" title="프로필 사진 변경 (준비 중)">
          <AccountAvatar>{pickInitial(user)}</AccountAvatar>
          <AvatarOverlay><CameraGlyph /></AvatarOverlay>
        </AvatarEdit>
        <AccountWho>
          {editingName ? (
            /* 이름 편집 — 저장 API 가 아직 없어 값은 반영되지 않는다(디자인만). */
            <NameEditRow>
              <TextInput
                type="text" defaultValue={displayName} autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') setEditingName(false); }}
              />
              <NameEditDone type="button" onClick={() => setEditingName(false)}>완료</NameEditDone>
            </NameEditRow>
          ) : (
            <NameRow>
              <AccountName>{displayName}</AccountName>
              <NameEditBtn type="button" aria-label="이름 수정" title="이름 수정"
                onClick={() => setEditingName(true)}>
                <PencilGlyph />
              </NameEditBtn>
            </NameRow>
          )}
          {email && (
            <AccountEmail>
              <GoogleMark />
              <span>{email}</span>
            </AccountEmail>
          )}
        </AccountWho>
      </AccountRow>

      <SectionTitle style={{ marginTop: 44 }}>악기</SectionTitle>
      <MyInstrumentPicker />
      <TransposeBody />

      <SectionTitle style={{ marginTop: 48 }}>환경설정</SectionTitle>

      {/* 언어 — 사이드바 사용자 메뉴에 있던 '언어' 항목을 여기로 옮겼다.
        * ⚠ 아직 **디자인만**이다. i18n 이 없어서 고르면 아무 일도 일어나지 않는다.
        * 실제 번역이 붙을 때 값 저장과 적용을 함께 넣는다. */}
      <FieldRow>
        <div>
          <FieldLabel as="span">언어</FieldLabel>
          <FieldHelper style={{ margin: '2px 0 0' }}>준비 중 — 지금은 한국어로 표시됩니다.</FieldHelper>
        </div>
        <FieldControl>
          <SelectInput defaultValue="ko" disabled>
            <option value="ko">한국어</option>
            <option value="en">English</option>
            <option value="ja">日本語</option>
          </SelectInput>
        </FieldControl>
      </FieldRow>

      <FieldRow>
        <FieldLabel>모양</FieldLabel>
        <FieldControl>
          <ThemeToggle>
            {([
              ['system', '시스템', <SystemIcon key="s" />],
              ['light', '라이트', <SunIcon key="l" />],
              ['dark', '다크', <MoonIcon key="d" />],
            ] as const).map(([id, title, icon]) => (
              <ThemeBtn
                key={id} type="button" title={title} aria-label={title}
                aria-pressed={mode === id}
                $active={mode === id} onClick={() => setMode(id)}
              >
                {icon}
              </ThemeBtn>
            ))}
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

/* 이조 — '내 악기' 와 **같은 Picker 디자인**의 단일 선택 드롭다운.
 * 네이티브 select 는 옵션 안에 예시를 넣어야 해서 트리거가 길어졌다
 * ("C (피아노, 기타, 베이스, 보컬…)"). 여기서는 트리거에 조(調)만 크게 두고,
 * 예시는 메뉴 항목의 보조 줄로 내린다. */
function TransposeBody() {
  const [instrument, setInstrument] = useState<TransposingInstrument>(
    () => getPlayerSettings().transposingInstrument,
  );
  const [open, setOpen] = useState(false);
  useEffect(
    () => subscribePlayerSettings((st) => setInstrument(st.transposingInstrument)),
    [],
  );
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const cur = TRANSPOSING_INSTRUMENTS.find((t) => t.id === instrument) ?? TRANSPOSING_INSTRUMENTS[0];

  return (
    <FieldRow>
      <FieldLabel as="span">이조</FieldLabel>
      <FieldControl>
        <PickerWrap>
          <PickerTrigger type="button" onClick={() => setOpen((v) => !v)} $open={open}>
            <TransposeKey>{cur.label}</TransposeKey>
            <TransposeMeta>{cur.examples}</TransposeMeta>
            <PickerCaret>⌄</PickerCaret>
          </PickerTrigger>

          {open && (
            <>
              <PickerBackdrop onClick={() => setOpen(false)} />
              <PickerMenu role="listbox">
                {TRANSPOSING_INSTRUMENTS.map(({ id, label, examples }) => {
                  const on = id === instrument;
                  return (
                    <PickerItem
                      key={id} type="button" role="option" aria-selected={on} $on={on}
                      onClick={() => {
                        setPlayerSetting('transposingInstrument', id);
                        setOpen(false);
                      }}
                    >
                      <TransposeKey>{label}</TransposeKey>
                      <TransposeMeta>{examples}</TransposeMeta>
                      {on && <PickerCheck><CheckIcon /></PickerCheck>}
                    </PickerItem>
                  );
                })}
              </PickerMenu>
            </>
          )}
        </PickerWrap>
      </FieldControl>
    </FieldRow>
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
  background: ${({ theme }) => theme.colors.scrim};
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
  background: ${({ theme }) => theme.colors.surfaceSunken};
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
  color: ${({ theme }) => theme.colors.textSecondary};
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 2;
  transition: background 0.12s, color 0.12s;
  &:hover { background: ${({ theme }) => theme.colors.activeFill}; color: ${({ theme }) => theme.colors.textPrimary}; }
`;

const Body = styled.div<{ $withSub?: boolean }>`
  flex: 1;
  display: grid;
  /* 악보/연주 탭은 2차 사이드바가 하나 더 붙어 3단이 된다. */
  grid-template-columns: ${({ $withSub }) => ($withSub ? '176px 192px minmax(0, 1fr)' : '196px minmax(0, 1fr)')};
  min-height: 0;

  @media (max-width: 1000px) {
    grid-template-columns: ${({ $withSub }) => ($withSub ? '156px 168px minmax(0, 1fr)' : '182px minmax(0, 1fr)')};
  }

  @media (max-width: 820px) {
    grid-template-columns: 1fr;
    grid-template-rows: ${({ $withSub }) => ($withSub ? 'auto auto minmax(0, 1fr)' : 'auto minmax(0, 1fr)')};
  }
`;

/* 2차 사이드바 — 1차와 같은 TabBtn 을 쓰되 배경을 한 톤 낮춰 계층을 보인다. */
const SubSidebar = styled.aside`
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  background: ${({ theme }) => theme.colors.hover};
  padding: 40px 10px 24px 14px;
  overflow-y: auto;

  @media (max-width: 820px) {
    border-right: none;
    border-bottom: 1px solid ${({ theme }) => theme.colors.border};
    padding: 12px 16px;
  }
`;

const SubSidebarTitle = styled.h2`
  margin: 0 0 12px 12px;
  font-size: 11.5px;
  font-weight: 700;
  letter-spacing: 0.02em;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const Segmented = styled.div`
  display: inline-flex;
  background: ${({ theme }) => theme.colors.hover};
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
  color: ${({ $on, theme }) => ($on ? theme.colors.textPrimary : theme.colors.textSecondary)};
  background: ${({ $on }) => ($on ? '#fff' : 'transparent')};
  box-shadow: ${({ $on }) => ($on ? '0 1px 3px rgba(0,0,0,0.10)' : 'none')};
`;

const Sidebar = styled.aside`
  border-right: 1px solid ${({ theme }) => theme.colors.border};
  padding: 40px 12px 24px 24px;
  overflow-y: auto;

  @media (max-width: 820px) {
    border-right: none;
    border-bottom: 1px solid ${({ theme }) => theme.colors.border};
    padding: 16px 16px 8px;
  }
`;

const SidebarTitle = styled.h1`
  margin: 0 0 18px;
  padding-left: 8px;
  font-size: 28px;
  font-weight: 600;
  color: ${({ theme }) => theme.colors.textPrimary};
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
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: inherit;
  font-size: 14.5px;
  font-weight: ${({ $active }) => ($active ? 600 : 500)};
  cursor: pointer;
  text-align: left;
  transition: background 0.1s;
  &:hover { background: ${({ theme }) => theme.colors.hover}; }
`;

const TabLabel = styled.span`
  flex: 1;
`;

const Badge = styled.span`
  font-size: 11px;
  font-weight: 600;
  background: ${({ theme }) => theme.colors.hover};
  color: ${({ theme }) => theme.colors.textSecondary};
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

/* 성격별 탭 안에서 설정 묶음을 가르는 얇은 선. */


/** 내 악기 — 아이콘이 보이는 자체 드롭다운(복수 선택).
 *
 *  · 트리거에는 고른 악기 아이콘을 겹쳐 보여준다(0개면 안내 문구).
 *  · **단독 선택일 때만** 이조를 함께 맞춘다 — suggestedTranspose 참조.
 */
function MyInstrumentPicker() {
  const [picked, setPicked] = usePref(myInstruments);
  /* 보컬을 고르면 가사 표시 기본값을 켠다 — **최초 1회만**. 사용자가 나중에
   * 직접 끈 걸 다시 켜지 않도록 seeded 표식을 남긴다(온보딩 성격의 초기화). */
  const [, setLyricsDefault] = usePref(showLyricsDefault);
  const [seeded, setSeeded] = usePref(lyricsDefaultSeeded);
  useEffect(() => {
    if (seeded || !picked.includes('voc')) return;
    setLyricsDefault(true);
    setSeeded(true);
  }, [picked, seeded, setLyricsDefault, setSeeded]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = (id: (typeof MY_INSTRUMENTS)[number]['id']) => {
    const on = picked.includes(id);
    /* 최소 하나는 남는다 — 악기를 모르면 이조·표기 기본값을 정할 근거가 없다.
     * 마지막 항목은 아래에서 비활성으로 그려 클릭이 헛돌지 않게 알려 준다. */
    if (on && picked.length === 1) return;
    const next = on ? picked.filter((x) => x !== id) : [...picked, id];
    setPicked(next);
    const tr = suggestedTranspose(next);
    if (tr) setPlayerSetting('transposingInstrument', tr);
  };

  const chosen = MY_INSTRUMENTS.filter((m2) => picked.includes(m2.id));

  return (
    <FieldRow>
      <FieldLabel as="span">내 악기</FieldLabel>
      <FieldControl>
        <PickerWrap>
          <PickerTrigger type="button" onClick={() => setOpen((v) => !v)} $open={open}>
            {chosen.length === 0 ? (
              <PickerEmpty>악기 선택</PickerEmpty>
            ) : (
              <>
                <PickerIcons>
                  {chosen.slice(0, 3).map((m2) => (
                    <img key={m2.id} src={instrumentIconUrl(m2.icon) ?? ''} alt="" />
                  ))}
                </PickerIcons>
                <PickerText>
                  {chosen[0].label}{chosen.length > 1 ? ` +${chosen.length - 1}` : ''}
                </PickerText>
              </>
            )}
            <PickerCaret>⌄</PickerCaret>
          </PickerTrigger>

          {open && (
            <>
              <PickerBackdrop onClick={() => setOpen(false)} />
              <PickerMenu role="listbox" aria-multiselectable>
                {MY_INSTRUMENTS.map((m2) => {
                  const on = picked.includes(m2.id);
                  const locked = on && picked.length === 1;
                  return (
                    <PickerItem
                      key={m2.id} type="button" role="option" aria-selected={on}
                      $on={on} $locked={locked} disabled={locked}
                      title={locked ? '최소 하나는 선택되어야 합니다' : undefined}
                      onClick={() => toggle(m2.id)}
                    >
                      <img src={instrumentIconUrl(m2.icon) ?? ''} alt="" />
                      <span>{m2.label}</span>
                      {on && <PickerCheck><CheckIcon /></PickerCheck>}
                    </PickerItem>
                  );
                })}
              </PickerMenu>
            </>
          )}
        </PickerWrap>
      </FieldControl>
    </FieldRow>
  );
}

/* ── 계정 카드 ───────────────────────────────────────────────────────────
 * 아바타 + 이름/이메일 + 로그아웃을 한 줄에, 아래에 회원 탈퇴. */


/* 아바타 hover 편집 + 이름 인라인 편집. 둘 다 **디자인만** — 저장 API 가 없다. */
const AvatarEdit = styled.button`
  position: relative;
  flex: none;
  padding: 0;
  border: 0;
  background: none;
  border-radius: 50%;
  cursor: pointer;
  line-height: 0;

  &:hover > span:last-child, &:focus-visible > span:last-child { opacity: 1; }
`;
const AvatarOverlay = styled.span`
  position: absolute;
  inset: 0;
  border-radius: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.colors.scrim};
  color: ${({ theme }) => theme.colors.surface};
  opacity: 0;
  transition: opacity 0.14s;

  svg { width: 20px; height: 20px; }
`;
const NameRow = styled.div`
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
`;
const NameEditBtn = styled.button`
  flex: none;
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  cursor: pointer;

  &:hover { background: ${({ theme }) => theme.colors.activeFill}; color: ${({ theme }) => theme.colors.textPrimary}; }
  svg { width: 14px; height: 14px; }
`;
const NameEditRow = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;

  input { max-width: 220px; }
`;
const NameEditDone = styled.button`
  flex: none;
  padding: 7px 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;

  &:hover { border-color: ${({ theme }) => theme.colors.gold}; }
`;

const CameraGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" />
  </svg>
);
const PencilGlyph = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4z" />
  </svg>
);

/* ── 내 악기 아이콘 드롭다운(복수 선택) ─────────────────────────────────── */
const PickerWrap = styled.div`
  position: relative;
  display: inline-block;
`;
const PickerTrigger = styled.button<{ $open?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 190px;
  height: 38px;
  padding: 0 10px;
  border: 1px solid ${({ $open, theme }) => ($open ? theme.colors.gold : theme.colors.border)};
  border-radius: 9px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13.5px;
  color: ${({ theme }) => theme.colors.textPrimary};

  &:hover { border-color: ${({ theme }) => theme.colors.border}; }
`;
/* 고른 악기 아이콘을 살짝 겹쳐 보여준다 — 여러 개여도 폭이 안 늘어난다. */
const PickerIcons = styled.span`
  display: inline-flex;
  flex: none;

  img {
    width: 22px;
    height: 22px;
    object-fit: contain;
    background: ${({ theme }) => theme.colors.bgPrimary};
    border-radius: 50%;
  }
  img + img { margin-left: -7px; }
`;
const PickerText = styled.span`
  flex: 1;
  min-width: 0;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
`;
const PickerEmpty = styled.span`
  flex: 1;
  text-align: left;
  color: ${({ theme }) => theme.colors.textSecondary};
`;
const PickerCaret = styled.span`
  flex: none;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 15px;
  line-height: 1;
`;
const PickerBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1;
`;
const PickerMenu = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 2;
  width: 236px;
  padding: 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.14);
`;
const PickerItem = styled.button<{ $on?: boolean; $locked?: boolean }>`
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 7px 8px;
  border: 0;
  border-radius: 8px;
  background: ${({ $on }) => ($on ? 'rgba(184,150,10,0.10)' : 'transparent')};
  cursor: pointer;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13.5px;
  font-weight: ${({ $on }) => ($on ? 700 : 500)};
  color: ${({ theme }) => theme.colors.textPrimary};
  text-align: left;

  &:hover { background: ${({ $on }) => ($on ? 'rgba(184,150,10,0.16)' : 'rgba(0,0,0,0.05)')}; }

  /* 마지막 남은 선택 — 해제할 수 없으니 커서·hover 로 그걸 알린다. */
  &:disabled { cursor: default; }
  &:disabled:hover { background: rgba(184, 150, 10, 0.10); }

  img { width: 22px; height: 22px; object-fit: contain; flex: none; }
  span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
`;
const PickerCheck = styled.span`
  flex: none;
  color: ${({ theme }) => theme.colors.gold};
  display: inline-flex;

  svg { width: 13px; height: 13px; }
`;
/* 이조 — 악기 아이콘 자리에 조(調) 글자를 같은 크기로 둔다. 아이콘이 있는
 * '내 악기' 항목과 좌측 정렬이 맞아 두 드롭다운이 한 세트로 보인다. */
/* ⚠️ `&&` 로 특이도를 올린다 — PickerItem 의 `span { flex: 1; … }` 규칙이
 * (클래스+타입 = 0,1,1) 이 컴포넌트의 클래스(0,1,0)를 이겨서, 그냥 두면 조(調)
 * 칸이 flex:1 로 늘어나 행마다 폭이 달라진다(= 설명 텍스트 좌측이 들쭉날쭉).
 * 두 글자(B♭·E♭)가 들어가도 안 밀리도록 폭도 넉넉히 잡고 왼쪽 정렬한다. */
const TransposeKey = styled.span`
  && {
    flex: none;
    width: 30px;
    text-align: left;
    overflow: visible;
  }
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 14px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.textPrimary};
`;
const TransposeMeta = styled.span`
  && {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textSecondary};
`;

const AccountRow = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 22px;
`;
const AccountAvatar = styled.div`
  width: 62px;
  height: 62px;
  flex: none;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${({ theme }) => theme.colors.textPrimary};
  color: ${({ theme }) => theme.colors.surface};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 22px;
  font-weight: 700;
`;
const AccountWho = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;
const AccountName = styled.div`
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 17px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;
const AccountEmail = styled.div`
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textSecondary};

  span {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;


/** Google 마크 — 계정 출처 표시용(공식 4색). */
const GoogleMark = () => (
  <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden style={{ flex: 'none' }}>
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2.5 24 .5 14.6.5 6.5 5.9 2.6 13.8l7.8 6.1C12.3 13.7 17.6 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.१-3.2-.4-4.7H24v9h12.6c-.5 2.9-2.2 5.4-4.7 7l7.6 5.9c4.4-4.1 7-10.1 7-17.2z" />
    <path fill="#FBBC05" d="M10.4 28.6c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.8-6.1C1 16.4 0 20.1 0 24s1 7.6 2.6 10.7l7.8-6.1z" />
    <path fill="#34A853" d="M24 47.5c6.2 0 11.5-2 15.4-5.6l-7.6-5.9c-2.1 1.4-4.8 2.3-7.8 2.3-6.4 0-11.7-4.2-13.6-9.9l-7.8 6.1C6.5 42.1 14.6 47.5 24 47.5z" />
  </svg>
);

const Divider = styled.hr`
  border: 0;
  border-top: 1px solid ${({ theme }) => theme.colors.border};
  margin: 30px 0 22px;
`;

const PanelInner = styled.div`
  max-width: 760px;
`;

const SectionTitle = styled.h2`
  margin: 0 0 18px;
  font-size: 16px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
  letter-spacing: -0.01em;
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 24px;
  padding: 14px 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  &:last-of-type { border-bottom: none; }
`;

const FieldLabel = styled.label`
  font-size: 14.5px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const FieldHelper = styled.p`
  margin: 0 0 8px;
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textSecondary};
  line-height: 1.5;
`;

const FieldControl = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-end;
`;


const TextInput = styled.input`
  width: 240px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.surface};
  font-family: inherit;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textPrimary};
  outline: none;
  transition: border-color 0.12s;
  &:focus { border-color: ${({ theme }) => theme.colors.border}; }
`;

const SelectInput = styled.select`
  height: 36px;
  padding: 0 32px 0 12px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 8px;
  background: ${({ theme }) => theme.colors.surface};
  font-family: inherit;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  outline: none;
  &:focus { border-color: ${({ theme }) => theme.colors.border}; }
`;

/* 색 선택기·슬라이더 한 줄 — 값 표시와 기본값 버튼을 옆에 붙인다. */
const ColorPickRow = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 8px;

  input[type='color'] {
    width: 34px; height: 26px; padding: 0; cursor: pointer;
    border: 1px solid ${({ theme }) => theme.colors.border}; border-radius: 6px; background: none;
  }
  input[type='range'] { width: 130px; accent-color: #2f6fe0; cursor: pointer; }
`;
const ColorHex = styled.span`
  font-family: ${({ theme }) => theme.fonts.chord};
  font-size: 12px;
  color: ${({ theme }) => theme.colors.textSecondary};
  min-width: 30px;
`;

const Switch = styled.button<{ $on?: boolean }>`
  position: relative;
  width: 40px;
  height: 24px;
  border: none;
  border-radius: 999px;
  background: ${({ $on, theme }) => ($on ? theme.colors.textPrimary : theme.colors.border)};
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
    background: ${({ theme }) => theme.colors.surface};
    transition: left 0.15s;
  }
`;

const ThemeToggle = styled.div`
  display: inline-flex;
  gap: 4px;
  padding: 4px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 999px;
  background: ${({ theme }) => theme.colors.surface};
`;

const ThemeBtn = styled.button<{ $active?: boolean }>`
  width: 32px;
  height: 28px;
  border: none;
  border-radius: 999px;
  background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.06)' : 'transparent')};
  color: ${({ $active, theme }) => ($active ? theme.colors.textPrimary : theme.colors.textSecondary)};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.1s;
  &:hover { background: ${({ theme }) => theme.colors.activeFill}; color: ${({ theme }) => theme.colors.textPrimary}; }
`;

/* ── 이조 악기 목록 ─────────────────────────────────────────────────── */

const InstrumentList = styled.div`
  margin-top: 8px;
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
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
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  transition: background 0.1s;
  &:last-child { border-bottom: none; }
  &:hover { background: ${({ theme }) => theme.colors.hover}; }
`;

const InstrumentKey = styled.span<{ $active?: boolean }>`
  font-size: 19px;
  font-weight: 600;
  color: ${({ $active, theme }) => ($active ? theme.colors.accent : theme.colors.textPrimary)};
  min-width: 28px;
`;

const InstrumentExamples = styled.span`
  flex: 1;
  font-size: 17px;
  color: ${({ theme }) => theme.colors.textPrimary};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const InstrumentCheck = styled.span`
  color: ${({ theme }) => theme.colors.accent};
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
`;

/* ── 릭 추천 범위 — 복수 선택 드롭다운 ──────────────────────────────────
 * 체크박스 목록 + 전체 선택/해제. '주 악기 따라가기'가 켜져 있으면 비활성이다
 * (그때 값은 주 악기에서 파생되므로 직접 고르는 게 의미가 없다). */

const MultiAnchor = styled.div`
  position: relative;
  display: inline-block;
`;

const MultiTrigger = styled.button<{ $open?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 132px;
  padding: 7px 10px;
  border: 1px solid ${({ theme, $open }) => ($open ? theme.colors.textPrimary : theme.colors.border)};
  border-radius: 9px;
  background: ${({ theme }) => theme.colors.surface};
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  &:hover:not(:disabled) { border-color: ${({ theme }) => theme.colors.border}; }
  &:disabled { opacity: 0.45; cursor: default; }
`;

const Caret = styled.span`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  line-height: 1;
`;

const MultiMenu = styled.div`
  position: absolute;
  top: calc(100% + 6px);
  right: 0;
  z-index: 40;
  min-width: 190px;
  padding: 6px;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 11px;
  background: ${({ theme }) => theme.colors.surface};
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.16);
  max-height: 280px;
  overflow-y: auto;
`;

const MultiBulk = styled.div`
  display: flex;
  gap: 6px;
  padding: 2px 2px 7px;
  margin-bottom: 5px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border};
  button {
    flex: 1;
    padding: 5px 0;
    border: 1px solid ${({ theme }) => theme.colors.border};
    border-radius: 7px;
    background: ${({ theme }) => theme.colors.surfaceSunken};
    font-family: ${({ theme }) => theme.fonts.ui};
    font-size: 11.5px;
    font-weight: 600;
    color: ${({ theme }) => theme.colors.textPrimary};
    cursor: pointer;
    &:hover { background: ${({ theme }) => theme.colors.surfaceSunken}; border-color: ${({ theme }) => theme.colors.border}; }
  }
`;

const MultiItem = styled.label`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  border-radius: 7px;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.textPrimary};
  cursor: pointer;
  &:hover { background: ${({ theme }) => theme.colors.surfaceSunken}; }
  input { width: 15px; height: 15px; accent-color: ${({ theme }) => theme.colors.textPrimary}; cursor: pointer; }
`;
