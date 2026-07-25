/**
 * 고스트(데드) 노트 표기 — **X 노트헤드** 하나로 앱 전체를 통일한다.
 *
 * VexFlow 는 `StaveNoteStruct.type` 으로 노트헤드 종류를 정한다('x' = 크로스).
 * 모든 VexFlow 렌더러(NoteSheet · LickCard · LickCreator · Lick12Key · Editor ·
 * SoloGenerator · LickInput · 채팅 릭 프리뷰)가 **반드시 이 헬퍼를 거쳐** 같은
 * 표기를 내도록 한다. 예전엔 LickCard 만 노트헤드 옆에 괄호 `( )` 를 덧그렸고
 * 나머지는 아무 표시도 없어 화면마다 표기가 갈렸다.
 *
 * 쉼표에는 적용하지 않는다(쉼표 글리프에 X는 의미가 없다).
 */
export function ghostHead(n: { ghost?: boolean; duration: string }): { type?: string } {
  return n.ghost && !n.duration.endsWith('r') ? { type: 'x' } : {};
}
