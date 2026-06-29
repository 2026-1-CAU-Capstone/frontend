/* ─────────────────────────────────────────────────────────────────────────
 * 두 프로젝트 페이지(MyChordChartsPage ↔ MySheetProjectsPage)의 공통 styled.
 *
 * §8 9-1: 두 파일에 이름·본문이 완전히 동일한 styled가 31개 복붙돼 있었고,
 * 운영 규칙("두 페이지 카드는 항상 동일하게 수정")과 코드가 어긋나 비대칭
 * 버그가 실제로 발생했다. 본문까지 100% 동일한 것만 기계적으로 추출했다 —
 * 여기 있는 컴포넌트를 고치면 두 페이지가 함께 바뀐다.
 *
 * 이름만 같고 본문이 다른 것들은 §8 R9에서 전수 diff로 검토했다:
 *   · R5 — 차이가 주석/무해 superset/등장애니뿐인 5개(Grid/KebabMenu/SortMenu/
 *     PageBody/ListThumb)는 chord판 기준으로 여기 통합.
 *   · 나머지 카드/모달 10개(NewCard/NewLabel/CardTitle/CardTitleRow/CardCheckbox/
 *     ModalCard/ModalTitle/ModalInput/ModalActions/ModalBtn)는 **시각적으로 다른
 *     디자인**이라 의도적으로 각 페이지에 분리 유지한다 — 예: NewCard는 Chord가
 *     aspect-ratio 전용 카드, Sheet는 CardBase+점선 테두리; 모달 크기/버튼/입력
 *     치수도 페이지별로 다름. props로 전부 흡수하면 프롭 10개짜리 과한 추상화가
 *     되어 두 정의로 두는 것보다 나쁘다. **통합 금지**(외형이 갈림).
 * (Fable.md §10 R4/R5/R9 참조)
 * ──────────────────────────────────────────────────────────────────────── */
import styled from 'styled-components';
import { mq } from '../../styles/theme';

export const CardMeta = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px 12px;
`;

export const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: calc(env(safe-area-inset-top, 0px) + 14px) 28px 12px;
  ${mq.mobile} {
    padding: calc(env(safe-area-inset-top, 0px) + 10px) 14px 10px;
  }
`;

export const HeaderActions = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
`;

export const HoverArrowBox = styled.div`
  width: 56px;
  height: 56px;
  border-radius: 12px;
  background: rgba(20, 20, 20, 0.78);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
`;

export const HoverOverlay = styled.div`
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
`;

export const IconOnlyBtn = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: #1a1a1a;
  cursor: pointer;
  transition: background 0.12s;
  &:hover { background: rgba(0, 0, 0, 0.06); }
`;

export const Kebab = styled.button`
  position: absolute;
  right: 8px;
  bottom: 10px;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  &:hover { background: rgba(0, 0, 0, 0.05); }
`;

export const KebabDot = styled.span`
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.5);
`;

export const KebabMenuIcon = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  color: currentColor;
  flex-shrink: 0;
`;

export const KebabMenuItem = styled.button<{ $danger?: boolean }>`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 500;
  text-align: left;
  color: ${({ $danger }) => ($danger ? '#e74c3c' : '#1a1a1a')};
  transition: background 0.1s;
  &:hover { background: ${({ $danger }) => ($danger ? 'rgba(231, 76, 60, 0.08)' : 'rgba(0, 0, 0, 0.04)')}; }
`;

export const KeyChip = styled.span`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(214, 152, 18, 0.16);
  color: #9a6800;
  letter-spacing: 0.01em;
`;

export const List = styled.div`
  flex: 1;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  padding: 4px 22px 24px;
  ${mq.mobile} { padding: 2px 14px 20px; }
`;

export const ListMain = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

export const ListNewRow = styled.button`
  display: flex;
  align-items: center;
  gap: 16px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  color: rgba(0, 0, 0, 0.6);
  transition: background 0.1s, color 0.1s;
  &:hover { background: rgba(0, 0, 0, 0.03); color: #1a1a1a; }
`;

export const ListRow = styled.div<{ $selected?: boolean }>`
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  cursor: pointer;
  background: ${({ $selected }) => ($selected ? 'rgba(43, 138, 239, 0.07)' : 'transparent')};
  transition: background 0.1s;
  &:hover { background: ${({ $selected }) => ($selected ? 'rgba(43, 138, 239, 0.1)' : 'rgba(0, 0, 0, 0.03)')}; }
`;

export const ListSubtitle = styled.div`
  font-size: 12px;
  color: rgba(0, 0, 0, 0.42);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const ListTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: #1a1a1a;
  letter-spacing: -0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

export const MetaRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

export const ModalLabel = styled.span`
  font-size: 12px;
  font-weight: 700;
  color: rgba(0, 0, 0, 0.55);
`;

export const Page = styled.div`
  display: flex;
  flex-direction: row;
  height: 100vh;
  height: 100dvh;
  width: 100%;
  background: ${({ theme }) => theme.colors.bgPrimary};
  font-family: 'Pretendard', sans-serif;
`;

export const PillBtn = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(0, 0, 0, 0.05);
  border: none;
  border-radius: 999px;
  padding: 8px 14px;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  color: #1a1a1a;
  cursor: pointer;
  transition: background 0.12s;
  &:hover { background: rgba(0, 0, 0, 0.08); }
`;

export const SbBtn = styled.button<{ $danger?: boolean }>`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  border: none;
  background: transparent;
  border-radius: 999px;
  font-family: inherit;
  font-size: 13.5px;
  font-weight: 600;
  color: ${({ $danger }) => ($danger ? '#e74c3c' : '#1a1a1a')};
  cursor: pointer;
  transition: background 0.12s, opacity 0.12s;
  &:hover:not(:disabled) { background: rgba(0, 0, 0, 0.04); }
  &:disabled { opacity: 0.4; cursor: not-allowed; }
`;

export const SelectionBar = styled.div`
  position: fixed;
  bottom: max(20px, env(safe-area-inset-bottom, 0px));
  left: 50%;
  transform: translateX(-50%);
  z-index: ${({ theme }) => theme.zIndex.modal};
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 999px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.14);
`;

export const SheetCardInner = styled.div`
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 10px 0 10px;
`;

export const SortItem = styled.button<{ $active?: boolean }>`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: none;
  background: transparent;
  border-radius: 9px;
  cursor: pointer;
  font-family: inherit;
  text-align: left;
  color: ${({ $active }) => ($active ? '#1a1a1a' : 'rgba(0, 0, 0, 0.45)')};
  transition: background 0.1s;
  &:hover { background: rgba(0, 0, 0, 0.04); }
`;

export const SortLabel = styled.span<{ $active?: boolean }>`
  font-size: 14.5px;
  font-weight: ${({ $active }) => ($active ? 700 : 500)};
`;

export const SortWrap = styled.div`
  position: relative;
  display: inline-flex;
`;

export const TimeChip = styled.span`
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  font-size: 9.5px;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(43, 138, 239, 0.14);
  color: #2570c8;
  letter-spacing: 0.01em;
`;

export const Title = styled.h1`
  margin: 0;
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.01em;
  color: #1a1a1a;
`;

export const ViewToggle = styled.div`
  display: inline-flex;
  align-items: center;
  border: 1px solid rgba(0, 0, 0, 0.12);
  border-radius: 999px;
  padding: 2px;
  gap: 2px;
  background: #fff;
`;

export const ViewToggleBtn = styled.button<{ $active?: boolean }>`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 28px;
  border: none;
  border-radius: 999px;
  cursor: pointer;
  background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.06)' : 'transparent')};
  color: ${({ $active }) => ($active ? '#2a73d9' : 'rgba(0, 0, 0, 0.55)')};
  transition: background 0.12s, color 0.12s;
  &:hover { background: ${({ $active }) => ($active ? 'rgba(0, 0, 0, 0.08)' : 'rgba(0, 0, 0, 0.04)')}; }
`;


/* ── R5: 본문이 사실상 동일(주석/무해한 superset 차이)해 통일한 5종 ── */
/* 주석만 다르던 쌍 — chord판으로 통일 */
export const Grid = styled.div`
  flex: 1;
  overflow-y: auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(195px, 1fr));
  /* align-items: start prevents the grid from stretching shorter cards
   * (folders, "신규") to match the tallest card in their row. Without it,
   * a tall chord-chart card would force every folder next to it to grow
   * non-square. With start, each card honors its own aspect-ratio. */
  align-items: start;
  align-content: start;
  gap: 16px 10px;
  padding: 10px 22px 24px;
  ${mq.mobile} {
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 12px 8px;
    padding: 6px 14px 20px;
  }
`;

/* sheet판엔 등장 애니메이션이 없던 것뿐 — 애니 포함판으로 통일(시각 개선) */
export const KebabMenu = styled.div`
  position: absolute;
  right: 6px;
  top: calc(100% + 4px);
  min-width: 132px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.16);
  padding: 6px;
  z-index: 20;
  animation: kebabIn 0.1s ease both;
  @keyframes kebabIn {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
`;

/* 동일 — 주석+등장 애니 차이뿐 */
export const SortMenu = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  /* Anchor under the sort icon button (36px wide) — shift right so the menu's
   * right edge lines up with the button's right edge. */
  right: 0;
  min-width: 180px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.14);
  padding: 6px;
  z-index: 50;
  animation: menuIn 0.12s ease both;
  @keyframes menuIn {
    from { opacity: 0; transform: translateY(-4px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
`;

/* chord판의 position:relative 는 sheet에도 무해(앵커 컨텍스트) — 통일 */
export const PageBody = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  min-width: 0;
  position: relative;
`;

/* chord판이 $tone:'folder' superset — sheet 사용처('sheet'/'new')와 완전 호환 */
export const ListThumb = styled.div<{ $tone?: 'folder' | 'sheet' | 'new' }>`
  position: relative;
  flex-shrink: 0;
  width: 64px;
  height: 44px;
  border-radius: 6px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  background: ${({ $tone }) =>
    $tone === 'folder' ? '#f2f2f3'
      : $tone === 'sheet' ? '#fff'
      : $tone === 'new' ? 'transparent'
      : '#e5e5e5'};
  ${({ $tone }) => $tone === 'new' && `
    border-style: dashed;
    border-color: rgba(0, 0, 0, 0.22);
  `}
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: rgba(0, 0, 0, 0.55);
`;
