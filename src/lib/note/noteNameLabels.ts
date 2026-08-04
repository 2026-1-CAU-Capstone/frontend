/* ─────────────────────────────────────────────────────────────────────────
 * noteNameLabels — 음표 머리 바로 위에 음이름을 찍는다.
 *
 * VexFlow 가 그린 뒤 SVG 에 <text> 를 직접 얹는 방식이다. Annotation modifier 를
 * 쓰면 오선 위/아래로 밀려나 "머리 바로 위"가 되지 않고, 레이아웃(마디 폭)까지
 * 바뀌어 기존 악보가 흔들린다. 그리기만 얹으면 배치는 한 픽셀도 안 변한다.
 *
 * 좌표는 **내부(스케일 전) 좌표**다. 악보 SVG 는 통째로 SHEET_SCALE 로 확대되므로
 * 글자 크기도 같이 커진다 — 설정값 하나가 모든 화면에서 같은 비율로 보인다.
 * ──────────────────────────────────────────────────────────────────────── */

/** 음이름 표기 언어. ko = 계이름(도레미), en = 음이름(CDE). */
export type NoteNameLang = 'ko' | 'en';

/** 머리 위 라벨을 그리는 데 필요한 최소 인터페이스(VexFlow StaveNote 구조). */
export interface HeadedVfNote {
  isRest(): boolean;
  getNoteHeadBeginX(): number;
  getNoteHeadEndX(): number;
  getYs(): number[];
}

export interface NoteNameStyle {
  on: boolean;
  lang: NoteNameLang;
  color: string;
  /** 내부 좌표 기준 글자 크기(px). 악보 배율에 함께 곱해진다. */
  size: number;
}

const KO: Record<string, string> = {
  c: '도', d: '레', e: '미', f: '파', g: '솔', a: '라', b: '시',
};

/**
 * vex key('c#/4', 'bb/3') → 표기 문자열.
 * 옥타브는 붙이지 않는다 — 머리 위 좁은 자리에 숫자까지 넣으면 읽기 어렵다.
 * 알 수 없는 키는 null(그리지 않음) — 드럼처럼 음높이가 아닌 데이터 방어.
 */
export function noteNameOf(vexKey: string, lang: NoteNameLang): string | null {
  const slash = vexKey.indexOf('/');
  const head = (slash >= 0 ? vexKey.slice(0, slash) : vexKey).toLowerCase();
  const letter = head[0];
  if (!letter || !(letter in KO)) return null;

  let acc = '';
  for (const ch of head.slice(1)) {
    if (ch === '#') acc += '♯';
    else if (ch === 'b') acc += '♭';
    else if (ch === 'n') acc += '♮';
  }
  return (lang === 'ko' ? KO[letter] : letter.toUpperCase()) + acc;
}

/** 머리와 라벨 밑변 사이 여백(내부 좌표). 노트헤드 반높이(≈5)를 이미 포함한다. */
const HEAD_CLEARANCE = 9;

export interface NoteNameTarget {
  vfNote: HeadedVfNote;
  /** vfNote 의 머리 순서와 같은 순서의 vex key 목록(화음이면 여러 개). */
  keys: string[];
}

/**
 * 음이름 라벨을 SVG 에 얹는다. `style.on` 이 false 면 아무것도 하지 않는다.
 *
 * 화음은 **머리마다 하나씩** 붙인다(요청: "음표의 머리 바로 위"). 2도처럼
 * 머리가 붙어 있는 화음은 라벨도 가까워지지만, 위치가 어긋나는 것보다는 낫다.
 */
export function drawNoteNameLabels(
  svgEl: SVGElement | null,
  targets: readonly NoteNameTarget[],
  style: NoteNameStyle,
): void {
  if (!svgEl || !style.on || targets.length === 0) return;

  const NS = 'http://www.w3.org/2000/svg';
  const group = document.createElementNS(NS, 'g');
  group.setAttribute('class', 'note-name-labels');
  /* 클릭 판정(음표 선택·마디 클릭)을 라벨이 가로채면 안 된다. */
  group.setAttribute('pointer-events', 'none');

  for (const { vfNote, keys } of targets) {
    let ys: number[];
    let cx: number;
    try {
      if (vfNote.isRest()) continue;
      ys = vfNote.getYs();
      cx = (vfNote.getNoteHeadBeginX() + vfNote.getNoteHeadEndX()) / 2;
    } catch {
      continue; // 아직 포맷되지 않은 음표 등 — 라벨 하나 빠지는 게 크래시보다 낫다
    }
    if (!Number.isFinite(cx)) continue;

    for (let i = 0; i < ys.length; i++) {
      const label = noteNameOf(keys[i] ?? keys[0] ?? '', style.lang);
      if (!label) continue;
      const y = ys[i];
      if (!Number.isFinite(y)) continue;

      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', String(cx));
      t.setAttribute('y', String(y - HEAD_CLEARANCE));
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('font-family', "'Pretendard', sans-serif");
      t.setAttribute('font-size', String(style.size));
      t.setAttribute('font-weight', '700');
      t.setAttribute('fill', style.color);
      t.textContent = label;
      group.appendChild(t);
    }
  }

  if (group.childNodes.length > 0) svgEl.appendChild(group);
}
