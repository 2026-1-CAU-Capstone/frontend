/* ─────────────────────────────────────────────────────────────────────────
 * 에디터가 만들 수 있는 자료 종류 — **저장 대상 DB 가 이 값으로 갈린다.**
 *
 *   solo      → Solo Database        (기보)
 *   lick      → Lick Database        (기보)
 *   comping   → Comping Database     (기보 · 백엔드 미구현 #57)
 *   leadsheet → Lead Sheet Database  (코드 진행 · 백엔드 미구현 #60)
 *
 * 배열을 여기 한 곳에만 둔다. 예전엔 `['solo','lick','comping']` 이 타입 칩·상태
 * 초기화·URL 파싱 세 군데에 하드코딩돼 있어서, 종류를 하나 더 붙이면 한 곳만
 * 고치고 나머지를 빼먹기 쉬웠다.
 *
 * EditorPage 가 아니라 별도 모듈에 두는 이유: 컴포넌트 파일이 컴포넌트 아닌 값을
 * 함께 export 하면 react-refresh 가 동작하지 않는다(린트가 잡는다).
 * ──────────────────────────────────────────────────────────────────────── */

export const EDITOR_MODES = ['solo', 'lick', 'comping', 'leadsheet'] as const;
export type EditorMode = typeof EDITOR_MODES[number];

export const EDITOR_MODE_LABEL: Record<EditorMode, string> = {
  solo: 'Solo', lick: 'Lick', comping: 'Comping', leadsheet: 'Lead Sheet',
};

/** URL·localStorage 에서 읽은 값이 유효한 모드인가. */
export function isEditorMode(v: unknown): v is EditorMode {
  return typeof v === 'string' && (EDITOR_MODES as readonly string[]).includes(v);
}
