/* 재생 UI 소유권 클레임.
 *
 * GlobalPlayer는 싱글톤이라 카드 B가 재생을 시작하면 카드 A의 오디오는 자연히
 * 넘어가지만(엔진 재사용 경로의 stop()은 'done'을 emit하지 않음) A의 UI —
 * 재생 버튼 상태, SVG 하이라이트, bar/note/done 리스너 — 는 그대로 남아
 * B의 하이라이트가 A 카드에 그려지고 A 버튼이 '재생 중'에 고착됐다.
 *
 * 각 재생 표면은 시작 직전에 claimPlaybackUi(자기 release)를 호출한다.
 * 이전 클레이머가 있으면 그 release(리스너 해제 + UI 리셋)가 먼저 실행된다.
 * 자연 종료/수동 정지 시에는 releasePlaybackUi로 클레임을 반납한다. */

let current: (() => void) | null = null;

/** 재생 시작 직전 호출 — 이전 재생 표면의 UI를 정리하고 소유권을 가져온다. */
export function claimPlaybackUi(release: () => void): void {
  if (current && current !== release) {
    try { current(); } catch { /* release는 UI 정리라 실패해도 무시 */ }
  }
  current = release;
}

/** 자연 종료/수동 정지/언마운트 시 호출 — 내 클레임일 때만 반납. */
export function releasePlaybackUi(release: () => void): void {
  if (current === release) current = null;
}
