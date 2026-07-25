import type { StaveNote } from 'vexflow';

/** 스쿱/폴(재즈 슬라이드) 곡선을 한 음표 노트헤드에 그린다.
 *
 *  **에디터(EditorPage)와 뷰어(NoteSheet)가 반드시 이 함수 하나를 공유한다** —
 *  한쪽에만 그리거나 곡선을 따로 고치면 "에디터에서 본 악보"와 "사용자에게
 *  보여주는 악보"의 표기가 갈린다. 스쿱/폴 렌더는 여기서만 정의한다.
 *
 *  - scoop = 음표 앞에서 아래→위로 끌어올려 진입. 곡선은 **아래로 볼록**
 *    (제어점을 시작점과 같은 높이의 오른쪽에 둬 바닥을 훑다가 노트헤드로 솟는다).
 *  - fall  = 음표 뒤에서 아래로 떨어짐.
 */

/** 스쿱 곡선 높이(px). 노트헤드 중심에서 아래로 이만큼 내려간 지점에서 시작한다. */
const SCOOP_HEIGHT = 16;

export function drawScoopFall(
  svgEl: SVGElement,
  vfNote: StaveNote,
  kind: 'scoop' | 'fall',
) {
  const ys = vfNote.getYs();
  if (!ys.length) return;
  const y = ys[0];
  const beginX = vfNote.getNoteHeadBeginX();
  const endX = vfNote.getNoteHeadEndX();
  const d = kind === 'scoop'
    // 아래로 볼록: 제어점을 시작점과 같은 높이(y+H)의 오른쪽에 둬서 곡선이
    // 바닥을 따라 흐르다가 노트헤드 왼쪽 가장자리로 솟아오른다.
    ? `M ${beginX - 13} ${y + SCOOP_HEIGHT} Q ${beginX - 3} ${y + SCOOP_HEIGHT} ${beginX - 1} ${y - 2}`
    // 노트헤드 오른쪽에서 시작해 아래로 떨어짐.
    : `M ${endX + 1} ${y - 1} Q ${endX + 11} ${y + 1} ${endX + 12} ${y + 10}`;
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('stroke', '#333');
  path.setAttribute('stroke-width', '2');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-linecap', 'round');
  svgEl.appendChild(path);
}
