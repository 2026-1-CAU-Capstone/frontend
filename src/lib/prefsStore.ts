import { useSyncExternalStore } from 'react';

/* localStorage 에 저장되는 "설정값" 하나를 감싸는 최소 스토어.
 *
 * 왜 필요한가: 같은 설정을 **두 곳에서** 편집하게 됐다 — 페이지 툴바(보기 방식
 * 등)와 전체 설정 모달. 기존 훅들은 각자 useState + localStorage 라, 모달에서
 * 바꿔도 이미 떠 있는 페이지는 그대로였다(반대도 마찬가지). 구독을 붙여 어느
 * 쪽에서 바꾸든 모든 소비자가 즉시 같은 값을 본다.
 *
 * 다른 탭과의 동기화까지는 하지 않는다(storage 이벤트 미사용) — 한 탭 안에서
 * 두 UI가 어긋나는 것만이 실제로 겪던 문제다. */

export interface Pref<T> {
  get(): T;
  set(value: T): void;
  subscribe(cb: () => void): () => void;
}

export function createPref<T>(
  storageKey: string,
  fallback: T,
  /** 저장된 문자열 → 값. 유효하지 않으면 null 을 반환해 fallback 을 쓰게 한다. */
  parse: (raw: string) => T | null,
  /** 값 → 저장 문자열. 기본은 String(v) — 객체 설정이면 JSON.stringify 를 넘긴다. */
  serialize: (value: T) => string = (v) => String(v),
): Pref<T> {
  const listeners = new Set<() => void>();
  let cached: T | undefined;

  const read = (): T => {
    if (cached !== undefined) return cached;
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw == null ? null : parse(raw);
      cached = parsed ?? fallback;
    } catch {
      cached = fallback; // private mode 등 — 메모리 값으로만 동작
    }
    return cached;
  };

  return {
    get: read,
    set(value: T) {
      if (read() === value) return;
      cached = value;
      try { localStorage.setItem(storageKey, serialize(value)); } catch { /* ignore */ }
      listeners.forEach((l) => { try { l(); } catch { /* 소비자 오류가 저장을 막지 않게 */ } });
    },
    subscribe(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
  };
}

/** Pref 를 React 상태처럼 쓴다. 값이 바뀌면 구독 중인 모든 컴포넌트가 갱신된다. */
export function usePref<T>(pref: Pref<T>): [T, (value: T) => void] {
  const value = useSyncExternalStore(pref.subscribe, pref.get, pref.get);
  return [value, pref.set];
}

/** 문자열 리터럴 유니온용 parse 헬퍼 — 허용 목록에 없으면 fallback 을 쓴다. */
export function oneOf<T extends string>(allowed: readonly T[]): (raw: string) => T | null {
  return (raw) => (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}
