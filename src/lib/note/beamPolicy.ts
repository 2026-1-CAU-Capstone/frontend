/* 빔 그룹핑 조판 규칙 — 절대 박 위치 기반.
 *
 * 배경: 기존 렌더러들은 "그룹 시작점부터의 상대 박"으로 2박 경계를 끊어서,
 * 쉼표 뒤에 시작하는 8분음표 런이 실제 박과 어긋난 채 묶였다.
 *   예) 4/4 [8쉼 8 8 8 | 8 8 8 8]
 *       잘못: 쉼표 뒤 3개가 한 빔(박 경계 무시)
 *       정석: 쉼표 · 8분(플래그) · [8 8] · [8 8 8 8]
 *
 * 규칙(단순박자, 분모 4):
 *   - 빔 스팬 = 2박(분자가 짝수) / 1박(3/4 등 홀수 분자). 스팬 경계는 마디
 *     시작부터 절대 위치로 고정되며, 빔은 스팬을 넘지 못한다.
 *   - 스팬 안에서: 런이 스팬 시작에 정확히 정박(anchored)하고 순수 8분뿐이면
 *     통짜로 묶는다(→ 8분 4개 한 빔, 쉼표로 3개가 되어도 유지 — 통상 조판).
 *     그렇지 않으면(오프비트 시작 또는 16분 이하 포함) 정수 박마다 끊는다.
 *   - 16분 이하가 섞이면 박 단위(→ 16분 4개씩)가 되어 박 명료성이 보장된다.
 * 겹박자(분모 8): 스팬 = 점4분(1.5박). 스팬 경계로만 끊는다(6/8 = 3+3).
 *
 * 투플렛·쉼표·8va·수동 beamBreak 는 여기서 다루지 않는다 — 각 렌더러 루프가
 * 기존대로 처리하고, 이 유틸은 "직선(비-투플렛) 빔 가능 음 사이를 어디서
 * 끊어야 하는가"만 답한다(인덱스는 입력 배열 기준, break-before).
 */

const BEAT_OF_BASE: Record<string, number> = {
  w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, '32': 0.125, '64': 0.0625, '128': 0.03125,
};

const EPS = 1e-3;

export interface BeamPolicyNote {
  duration: string;        // 'q' | '8' | '8r' | '8d' | '16' ...
  dotted?: boolean;
  tuplet?: number;
  tupletNormal?: number;
  grace?: boolean;
}

/** 음표 하나의 메트릭 길이(박). 장식음은 0. */
function beatsOf(n: BeamPolicyNote): number {
  if (n.grace) return 0;
  const base = n.duration.replace(/[rd]+$/, '');
  let b = BEAT_OF_BASE[base] ?? 1;
  // 점: dotted 플래그 또는 duration 접미('8d'·'8dr' — 'r'을 떼고 'd' 확인)
  if (n.dotted || n.duration.replace(/r$/, '').endsWith('d')) b *= 1.5;
  const t = n.tuplet ?? 0;
  if (t >= 2) {
    const denom = n.tupletNormal ?? Math.pow(2, Math.floor(Math.log2(t - 1)));
    b *= denom / t;
  }
  return b;
}

/**
 * 마디 하나에 대해 "이 인덱스의 음표 앞에서 빔 그룹을 끊어라" 집합을 돌려준다.
 * 렌더러 루프는 직선 빔 가능 음을 그룹에 push 하기 전에
 * `breaks.has(index)` 를 확인해 flush 하면 된다.
 */
export function computeBeamBreaks(
  notes: readonly BeamPolicyNote[],
  timeSignature?: string | null,
): Set<number> {
  const breaks = new Set<number>();
  const parts = (timeSignature || '4/4').split('/');
  const num = Math.max(1, parseInt(parts[0] ?? '4', 10) || 4);
  const den = Math.max(1, parseInt(parts[1] ?? '4', 10) || 4);
  const compound = den === 8;
  const span = compound ? 1.5 : num % 2 === 0 ? 2 : 1;

  /* 1) 절대 위치를 걸으며 "직선(비-투플렛) 빔 가능 음" 런을 수집.
   *    쉼표·4분 이상·투플렛 멤버가 런을 끊는다(렌더러 루프도 그 지점에서
   *    어차피 flush 한다). 장식음은 시간 0으로 투명 통과. */
  type RunNote = { idx: number; pos: number; is16: boolean };
  const runs: RunNote[][] = [];
  let run: RunNote[] = [];
  const flushRun = () => { if (run.length > 1) runs.push(run); run = []; };
  let pos = 0;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.grace) continue;
    const isRest = n.duration.endsWith('r');
    const base = n.duration.replace(/[rd]+$/, '');
    const beamable = !isRest && BEAT_OF_BASE[base] !== undefined && BEAT_OF_BASE[base] < 0.5 + EPS && base !== 'q';
    const straight = beamable && (n.tuplet ?? 0) < 3;
    if (straight) run.push({ idx: i, pos, is16: base !== '8' });
    else flushRun();
    pos += beatsOf(n);
  }
  flushRun();

  /* 2) 런 → 스팬 경계 1차 분할 → 스팬 세그먼트별 박 단위 2차 분할. */
  for (const r of runs) {
    const segs: RunNote[][] = [];
    let seg: RunNote[] = [r[0]];
    for (let k = 1; k < r.length; k++) {
      const cross =
        Math.floor((r[k].pos + EPS) / span) !== Math.floor((r[k - 1].pos + EPS) / span);
      if (cross) { segs.push(seg); breaks.add(r[k].idx); seg = [r[k]]; }
      else seg.push(r[k]);
    }
    segs.push(seg);
    if (compound) continue; // 겹박자: 스팬 경계로 충분 (6/8 = 3+3)

    for (const s of segs) {
      const rem = s[0].pos % span;
      const anchored = rem < EPS || span - rem < EPS;
      const has16 = s.some((x) => x.is16);
      if (anchored && !has16) continue; // 정박 시작 + 순수 8분 → 통짜 유지
      for (let k = 1; k < s.length; k++) {
        if (Math.floor(s[k].pos + EPS) !== Math.floor(s[k - 1].pos + EPS)) {
          breaks.add(s[k].idx);
        }
      }
    }
  }
  return breaks;
}
