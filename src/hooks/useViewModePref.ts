import { useEffect, useState } from 'react';

export type ProjectViewMode = 'grid' | 'list';

/* §8 R6 — 그리드/리스트 보기 선택의 localStorage 영속화 공통 훅.
 * 두 프로젝트 페이지가 동일한 load/save 헬퍼+state+persist effect를 복붙하고
 * 있던 것을 통합. storageKey는 페이지별로 유지(기존 사용자 설정 보존). */
export function useViewModePref(
  storageKey: string,
): [ProjectViewMode, (v: ProjectViewMode) => void] {
  const [viewMode, setViewMode] = useState<ProjectViewMode>(() => {
    try {
      const v = localStorage.getItem(storageKey);
      if (v === 'grid' || v === 'list') return v;
    } catch { /* private mode */ }
    return 'grid';
  });
  useEffect(() => {
    try { localStorage.setItem(storageKey, viewMode); } catch { /* ignore */ }
  }, [storageKey, viewMode]);
  return [viewMode, setViewMode];
}
