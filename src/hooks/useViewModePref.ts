import { usePref, type Pref } from '../lib/prefsStore';

export type ProjectViewMode = 'grid' | 'list';

/* §8 R6 — 그리드/리스트 보기 선택의 localStorage 영속화 공통 훅.
 * 두 프로젝트 페이지가 동일한 load/save 헬퍼+state+persist effect를 복붙하고
 * 있던 것을 통합. storageKey는 페이지별로 유지(기존 사용자 설정 보존).
 *
 * 이제 값은 Pref 스토어가 들고 있다 — 전체 설정 모달에서도 같은 값을 편집하므로
 * 페이지 툴바와 모달이 서로의 변경을 즉시 반영해야 한다. */
export function useViewModePref(
  pref: Pref<ProjectViewMode>,
): [ProjectViewMode, (v: ProjectViewMode) => void] {
  return usePref(pref);
}
