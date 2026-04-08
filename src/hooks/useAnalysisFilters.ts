import { useState, useCallback, useMemo } from 'react';

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

function loadFilters(): AnalysisFilters {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return { ...DEFAULT_FILTERS, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return { ...DEFAULT_FILTERS };
}

function saveFilters(filters: AnalysisFilters) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch { /* ignore */ }
}

export function useAnalysisFilters() {
  const [filters, setFilters] = useState<AnalysisFilters>(loadFilters);

  const toggleFilter = useCallback((key: keyof AnalysisFilters) => {
    setFilters((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveFilters(next);
      return next;
    });
  }, []);

  /** Effective filters: when master is OFF, all sub-filters are effectively OFF */
  const effective = useMemo<AnalysisFilters>(() => {
    if (!filters.showAnalysis) {
      return {
        showAnalysis: false,
        showDegree: false,
        showIIVI: false,
        showArrows: false,
        showColors: false,
      };
    }
    return filters;
  }, [filters]);

  return { filters, effective, toggleFilter } as const;
}
