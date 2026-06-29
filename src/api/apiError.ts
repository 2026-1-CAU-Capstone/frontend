/* 백엔드 에러 응답 → 사용자에게 보여줄 메시지.
 *
 * 이전엔 api 클라이언트 6곳이 제각각 `JSON.stringify(envelope)` 또는
 * `detail || message` 를 Error 메시지로 던졌고, 이는 그대로 UI 배너/말풍선에
 * 렌더됐다 — `detail` 은 백엔드 내부 예외 문자열(스택/쿼리 흔적)일 수 있어
 * 내부 구현이 사용자에게 노출됐다 (Fable.md Low 보안/UX finding).
 *
 * 규칙:
 *  - `message`(사용자용)를 우선, 없으면 `code`, 그것도 없으면 호출부 fallback.
 *  - `detail` 은 dev 콘솔에만 (디버깅용) — 절대 반환 메시지에 포함하지 않음.
 *  - 본문이 JSON이 아니면 fallback만. */
export async function readApiErrorMessage(
  res: Response,
  fallback: string,
): Promise<string> {
  try {
    const j = (await res.json()) as { code?: string; message?: string; detail?: string };
    if (import.meta.env.DEV && j.detail) {
      console.debug(`[api ${res.status}] detail:`, j.detail);
    }
    return j.message || j.code || fallback;
  } catch {
    return fallback;
  }
}
