/* ─────────────────────────────────────────────────────────────────────────
 * 잇단음표(N연음) 브래킷 렌더 — **에디터·뷰어 공용 단일 소스**.
 *
 * 원래 뷰어(NoteSheet)와 에디터(EditorPage)가 각자 구현을 갖고 있었고, 에디터
 * 쪽에 결함 셋이 남아 있었다(실측: `it-could-happen-to-you` 28마디 — 3:2 두
 * 그룹이 `3`·`3` 이어야 하는데 `3`·`2` 로 나왔다).
 *
 *   ① **표시 숫자를 그룹의 음표 개수로 넘겼다** (`numNotes: group.length`).
 *      3연음이 [8분음표, 4분음표] 두 개로 적히면 "2" 가 찍힌다 — 숫자는 개수가
 *      아니라 **비율의 분자**(N)여야 한다.
 *   ② **그룹 경계를 "최대 N개" 로 끊었다.** 3:2 그룹이 연달아 오면 첫 그룹이
 *      다음 그룹의 첫 음까지 삼키고(3개 채움), 남은 2개가 별도 그룹이 됐다.
 *      경계는 개수가 아니라 **길이**로 판정해야 한다(아래 target).
 *   ③ `tupletNormal`(XML `<normal-notes>`)을 무시해 7:6·5:3 같은 비율이 틀렸다.
 *
 * 경계 판정: 한 브래킷의 무스케일 길이 목표 = **N × (그룹 첫 음의 길이)**.
 * [8,8,8]·[8,4분] 3연음은 1.5, [16×6] 6연음은 1.5, [16×5] 5연음은 1.25 —
 * "첫 음이 브래킷의 기준 단위"라는 표기 관례를 그대로 쓴다. 분할 변형
 * ([8,8,16,16])도 누적 1.5 에서 닫혀 숫자 하나로 나온다.
 * ──────────────────────────────────────────────────────────────────────── */
import { Tuplet, type StaveNote } from 'vexflow';
import type { NoteInfo } from '../../data/sampleMelody';
import { DUR_BEATS } from './melodyTiming';

/** 빔 소속 정보 — 브래킷을 그릴지 말지 정교하게 판단할 때만 쓴다(없어도 동작). */
export interface BeamMembership {
  id: number;
  size: number;
}

export interface DrawTupletsOpts {
  /** 마디의 소스 음표(꾸밈음 포함 가능 — `grace` 는 건너뛴다). */
  notes: NoteInfo[];
  /** VexFlow 음표 배열. */
  vfNotes: StaveNote[];
  /** 소스 인덱스 → `vfNotes` 인덱스. 꾸밈음 등 대응이 없으면 -1.
   *  생략하면 1:1 대응으로 본다. */
  vfIndexOf?: (srcIndex: number) => number;
  /** StaveNote → 빔 소속. 주면 브래킷 규칙이 정교해진다(아래 주석 참고). */
  beamOf?: Map<StaveNote, BeamMembership>;
}

type DrawCtx = Parameters<Tuplet['setContext']>[0];

/** 임시표·점·잇단음표 **보정 전** 순수 음가(브래킷 길이 판정용). */
function rawBeats(src: NoteInfo): number {
  const base = src.duration.replace(/[rd]+$/, '');
  let b = DUR_BEATS[base] ?? 1;
  if (src.dotted) b *= 1.5;
  return b;
}

/** 마디 하나의 잇단음표 브래킷을 전부 그린다. */
export function drawTuplets(opts: DrawTupletsOpts, ctx: DrawCtx): void {
  const { notes, vfNotes, beamOf } = opts;
  const idxOf = opts.vfIndexOf ?? ((i: number) => i);

  let ti = 0;
  while (ti < notes.length) {
    if (notes[ti].grace) { ti++; continue; }
    const n = notes[ti].tuplet;
    if (!n || n < 3) { ti++; continue; }

    const startTi = ti;
    const group: StaveNote[] = [];
    // 브래킷 표시 선호와 비율 분모는 그룹 **첫 음**이 들고 있다.
    const bracketAttr = notes[startTi].tupletBracket;
    const tupletNormalFromData = notes[startTi].tupletNormal;
    const target = n * rawBeats(notes[startTi]);
    let unscaled = 0;

    while (ti < notes.length) {
      const src = notes[ti];
      if (src.grace) { ti++; continue; }
      if (src.tuplet !== n) break;
      const vIdx = idxOf(ti);
      if (vIdx >= 0 && vfNotes[vIdx]) {
        group.push(vfNotes[vIdx]);
        unscaled += rawBeats(src);
      }
      ti++;
      if (unscaled >= target - 1e-6) break;   // 한 브래킷 완결
    }

    if (group.length < 2) continue;

    const stemDown = group[0].getStemDirection() === -1;
    // XML 이 준 normal-notes 를 우선 쓴다(7:6·5:3 같은 비율 대응).
    // 없으면 2의 거듭제곱 추정(3연음→2, 5·6·7연음→4).
    const notesOccupied = tupletNormalFromData ?? Math.pow(2, Math.floor(Math.log2(n - 1)));

    /* 브래킷 규칙:
     *  · 그룹이 자기 빔과 1:1 일치 → 숫자만(관례; XML bracket=yes 면 존중)
     *  · 빔이 전혀 없는 투플렛 → 브래킷 강제(안 그리면 범위가 불명확)
     *  · 더 긴 빔 "안에" 섞인 투플렛 → 숫자만. 여기서 브래킷을 강제하면
     *    VexFlow 가 빔 위로 기울어진 선을 그려 빔과 X 자로 교차한다
     *    (Confirmation m73/m75 에서 실측). */
    const first = beamOf?.get(group[0]);
    const exactSpan = !!first
      && group.length === first.size
      && group.every((g) => beamOf?.get(g)?.id === first.id);
    const anyBeamed = !!beamOf && group.some((g) => beamOf.has(g));

    const tuplet = new Tuplet(group, {
      numNotes: n,
      notesOccupied,
      bracketed: exactSpan
        ? (bracketAttr ?? false)
        : anyBeamed ? false : (bracketAttr ?? true),
    });
    if (stemDown) tuplet.setTupletLocation(-1);
    tuplet.setContext(ctx).draw();
  }
}
