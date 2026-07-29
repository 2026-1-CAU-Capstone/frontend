import { useCallback, useMemo } from 'react';
import { createPref, usePref } from '../lib/prefsStore';

const STORAGE_KEY = 'jazzify-analysis-filters';

export interface AnalysisFilters {
  showAnalysis: boolean;   // 분석 보기 (master)
  showDegree: boolean;     // 도수 표시
  showIIVI: boolean;       // 2-5-1 하이라이트 + 브라켓
  showArrows: boolean;     // 해결 화살표
  showColors: boolean;     // 비화성음 / 모달 인터체인지 색상
}

const DEFAULT_FILTERS: AnalysisFilters = {
  showAnalysis: true,
  showDegree: true,
  showIIVI: true,
  showArrows: true,
  showColors: true,
};

/* 전체 설정 모달(악보/연주 → 코드 분석)과 코드 페이지의 전구 토글이 같은 값을
 * 편집한다. 그래서 값은 구독 가능한 Pref 스토어가 들고 있다 — 한쪽에서 바꾸면
 * 다른 쪽도 즉시 반영된다. */
export const analysisFiltersPref = createPref<AnalysisFilters>(
  STORAGE_KEY,
  DEFAULT_FILTERS,
  (raw) => {
    try {
      return { ...DEFAULT_FILTERS, ...JSON.parse(raw) } as AnalysisFilters;
    } catch {
      return null;
    }
  },
  (v) => JSON.stringify(v),
);

/** 마스터가 꺼져 있으면 하위 필터도 모두 꺼진 것으로 본다. */
export function effectiveFilters(filters: AnalysisFilters): AnalysisFilters {
  if (filters.showAnalysis) return filters;
  return {
    showAnalysis: false,
    showDegree: false,
    showIIVI: false,
    showArrows: false,
    showColors: false,
  };
}

export function useAnalysisFilters() {
  const [filters, setFilters] = usePref(analysisFiltersPref);

  const toggleFilter = useCallback((key: keyof AnalysisFilters) => {
    setFilters({ ...analysisFiltersPref.get(), [key]: !analysisFiltersPref.get()[key] });
  }, [setFilters]);

  const effective = useMemo(() => effectiveFilters(filters), [filters]);

  return { filters, effective, toggleFilter } as const;
}
