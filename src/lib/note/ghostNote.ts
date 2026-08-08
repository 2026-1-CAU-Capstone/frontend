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
/** MusicXML `<notehead>` 값 → VexFlow `StaveNoteStruct.type` 코드.
 *  여기 없는 값은 일반 머리로 떨어뜨린다(모르는 모양을 억지로 그리지 않는다). */
const HEAD_CODE: Record<string, string> = {
  slash: 's', x: 'x', diamond: 'd',
  'triangle-up': 'tu', 'triangle-down': 'td',
  square: 'sq', 'circle-x': 'cx',
};

export function ghostHead(
  n: { ghost?: boolean; duration: string; notehead?: string },
): { type?: string } {
  if (n.duration.endsWith('r')) return {};
  // 명시 노트헤드가 고스트(X)보다 우선한다 — 원본 조판이 정한 모양이다.
  const code = n.notehead ? HEAD_CODE[n.notehead] : undefined;
  if (code) return { type: code };
  return n.ghost ? { type: 'x' } : {};
}
