/* ─────────────────────────────────────────────────────────────────────────
 * 음이름 스펠링(♯/♭ 선택)의 **단일 원칙 구현**.
 *
 * 대원칙: 이름은 소리가 아니라 **기능**을 적는다. C♯ 과 D♭ 은 같은 건반이지만
 * 조성 안에서 다른 역할이므로 다른 이름을 갖는다. 여기서 두 규칙이 파생된다.
 *
 *   1) **음계는 글자를 하나씩만 쓴다.** D장조 = D E F♯ G A B C♯ — G♭ 로 쓰면
 *      G 가 두 번 나오고 F 가 빠져 3도 쌓기(C-E-G)가 무너진다.
 *   2) **도수가 글자를 정한다.** 으뜸음에서 몇 도인지가 글자를 결정하고,
 *      임시표는 그 글자를 실제 음높이에 맞추는 보정일 뿐이다.
 *
 * 그래서 "샤프 조성이면 전부 ♯" 같은 고정 테이블은 틀린다. 예:
 *   • D장조의 ♭II = **E♭**  (D♯ 아님 — 2도는 E 계열이어야 하므로)
 *   • B장조의 vi  = **G♯**  (A♭ 아님 — 6도는 G 계열이어야 하므로)
 * 두 경우 모두 아래 도수 규칙 하나로 자동으로 맞는다.
 *
 * 참고: Elaine Gould, *Behind Bars* (표준 기보 레퍼런스).
 * ──────────────────────────────────────────────────────────────────────── */

export type SpellAcc = '#' | 'b' | '##' | 'bb' | undefined;   // undefined = 내추럴

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const;
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** 으뜸음에서의 반음 거리 → **음계 도수**(1~7). 장·단조 공통이다.
 *  단조도 글자 배치는 같다 — 으뜸음 글자가 기준점을 잡아주기 때문.
 *  예) 단조 11반음 → 7도 → 이끔음이 자동으로 ♯7(A단조의 G♯)로 나온다. */
const DEGREE_OF_OFFSET = [1, 2, 2, 3, 3, 4, 4, 5, 6, 6, 7, 7];

const ALTER_GLYPH: Record<number, SpellAcc> = { 0: undefined, 1: '#', 2: '##', [-1]: 'b', [-2]: 'bb' };

/** 'Eb' 'F#m' 'G-maj' 'Bb-min' 등 → 으뜸음 글자 + 음높이 클래스. */
export function parseKeyTonic(rawKey: string | undefined | null): { letter: string; pc: number } {
  const k = (rawKey ?? 'C').trim();
  // 'G-maj' / 'Eb-min' 하이픈 표기 흡수
  const hy = k.match(/^([A-Ga-g][b#♭♯]?)-?(?:maj|min|major|minor)$/i);
  const core = (hy ? hy[1] : k).replace('♭', 'b').replace('♯', '#');
  const letter = (core[0] ?? 'C').toUpperCase();
  const accCh = core[1] === 'b' || core[1] === '#' ? core[1] : '';
  const base = LETTER_PC[letter] ?? 0;
  const pc = (((base + (accCh === '#' ? 1 : accCh === 'b' ? -1 : 0)) % 12) + 12) % 12;
  return { letter: letter in LETTER_PC ? letter : 'C', pc };
}

/**
 * 음높이 클래스(0~11)를 **주어진 조성 안에서의 도수**에 맞게 스펠링한다.
 *
 * 절차: 으뜸음에서의 반음 거리 → 도수 → 그 도수의 **글자** → 글자의 내추럴
 * 음높이와의 차이만큼 임시표. 고정 테이블이 아니라 매번 조성으로부터 계산한다.
 */
export function spellPitchClass(pc: number, key: string | undefined | null): { letter: string; acc: SpellAcc } {
  const tonic = parseKeyTonic(key);
  const target = (((pc % 12) + 12) % 12);
  const offset = (((target - tonic.pc) % 12) + 12) % 12;
  const degree = DEGREE_OF_OFFSET[offset];
  const letter = LETTERS[(LETTERS.indexOf(tonic.letter as typeof LETTERS[number]) + degree - 1) % 7];
  const alter = alterFor(letter, target);
  // 도수가 정한 글자가 **겹임시표**(♯♯/♭♭)를 요구하면 관례상 쓰지 않는다.
  // 으뜸음에 임시표가 있는 조성에서 생긴다 — 예) D♭장조의 D♮ 를 도수대로
  // 2도(E 계열)로 적으면 E♭♭ 이 된다. 사람은 그냥 D♮ 로 쓴다.
  // 이럴 때만 **임시표가 가장 작은 글자**로 물러선다(같으면 조성 방향을 따른다).
  if (Math.abs(alter) >= 2) return minimalSpelling(target, tonic.pc);
  return { letter, acc: ALTER_GLYPH[alter] };
}

/** 글자의 내추럴 음높이에서 목표까지의 반음차(-5..6). */
function alterFor(letter: string, targetPc: number): number {
  let a = (((targetPc - LETTER_PC[letter]) % 12) + 12) % 12;
  if (a > 6) a -= 12;
  return a;
}

/** 겹임시표 회피용 — 임시표 크기가 가장 작은 글자를 고른다.
 *  동률이면 조성 방향(샤프 계열이면 ♯, 플랫 계열이면 ♭)을 따른다. */
function minimalSpelling(pc: number, tonicPc: number): { letter: string; acc: SpellAcc } {
  // 5도권상 으뜸음이 샤프 쪽인지(G D A E B F#…) 대략 판정.
  const sharpSide = [7, 2, 9, 4, 11, 6, 1].includes(tonicPc);
  let best: { letter: string; alter: number } | null = null;
  for (const letter of LETTERS) {
    const alter = alterFor(letter, pc);
    if (Math.abs(alter) > 1) continue;
    if (!best
      || Math.abs(alter) < Math.abs(best.alter)
      || (Math.abs(alter) === Math.abs(best.alter) && (sharpSide ? alter > best.alter : alter < best.alter))) {
      best = { letter, alter };
    }
  }
  return best ? { letter: best.letter, acc: ALTER_GLYPH[best.alter] } : { letter: 'C', acc: undefined };
}

/** 코드 심볼 루트/베이스용 이름 ('Eb' 'F#' 'C'). 도수 규칙을 그대로 따른다. */
export function spellChordRoot(pc: number, key: string | undefined | null): string {
  const { letter, acc } = spellPitchClass(pc, key);
  return `${letter}${acc ?? ''}`;
}

/** 반음 변화량(-2~+2). vexKey 옥타브 역산에 쓴다. */
export function alterOf(acc: SpellAcc): number {
  return acc === '#' ? 1 : acc === 'b' ? -1 : acc === '##' ? 2 : acc === 'bb' ? -2 : 0;
}

/**
 * MIDI 번호를 조성에 맞춰 `{ vexKey, acc }` 로 스펠링한다.
 * 옥타브는 **글자 기준으로 역산**한다 — C♭ / B♯ 처럼 옥타브 경계를 넘는
 * 스펠링에서 단순 `floor(midi/12)` 는 한 옥타브 어긋난다.
 */
export function spellMidi(midi: number, key: string | undefined | null): { vexKey: string; acc: SpellAcc } {
  const { letter, acc } = spellPitchClass(((midi % 12) + 12) % 12, key);
  const octave = Math.round((midi - alterOf(acc) - LETTER_PC[letter]) / 12) - 1;
  return { vexKey: `${letter.toLowerCase()}/${octave}`, acc };
}
