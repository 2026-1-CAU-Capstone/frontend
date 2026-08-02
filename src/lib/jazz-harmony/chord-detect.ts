/**
 * chord-detect — 동시에 울린 음(MIDI 건반 화음)에서 코드 심볼을 역추적한다.
 *
 * 파서(ChordSymbol.parse)의 반대 방향이다. ChordTypeDatabase 의 62개 코드 타입은
 * 각자 구성음을 루트 기준 상대 피치(0..11)로 갖고 있으므로, 연주된 피치클래스
 * 집합을 12개 루트 × 62타입과 대조해 가장 잘 맞는 하나를 고르면 된다.
 *
 * 판정 규칙:
 *  - 연주한 음은 **전부** 코드 구성음이어야 한다(설명 못 한 음이 있으면 탈락).
 *    → 텐션을 마구 눌러도 아무 코드나 갖다 붙이는 오검출을 막는다.
 *  - 구성음이 빠진 것(생략)은 허용하되 감점한다(5음 생략 보이싱이 흔하다).
 *  - 최저음이 루트인 기본형을 전위형보다 우대하고, 같은 점수면 단순한 코드를
 *    고른다. 최저음이 루트가 아니면 슬래시 코드("C/E")로 표기한다.
 *  - 같은 음 집합을 여러 코드로 부를 수 있으므로(E-G-C = C 전위 = Em+ 기본형)
 *    실사용 빈도로 가중치를 준다. 이 감점은 **후보 사이의 순위**만 바꾸므로,
 *    희귀 코드밖에 설명하지 못하는 음 집합은 그대로 그 코드로 인식된다.
 */
import { getChordTypeDatabase } from './chord-type-database';
import type { ChordType } from './chord-type';

const PC_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const PC_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** 코드로 인정할 최소 서로 다른 음 개수. 2음(음정)은 모호해서 제외한다. */
const MIN_DISTINCT = 3;
/** 이만큼 이상 구성음이 비면 그 코드로 보지 않는다. */
const MAX_MISSING = 3;

/** 재즈에서 일상적으로 쓰는 코드 — 감점 없음. (ChordType.name 기준) */
const COMMON = new Set([
  '', 'm', '6', 'm6', '69', 'm69', 'dim', 'dim7',
  '7', '9', '13', 'm7', 'm9', 'm11', 'm13', 'M7', 'M9', 'M13',
  'm7b5', 'sus', '7sus', '9sus', '13sus',
  '7b9', '7#9', '7b5', '7#5', '7#11', '9#11', 'M7#11', 'M9#11', '7#9#5',
]);
/** 실제로는 거의 그 이름으로 부르지 않는 코드 — 다른 해석이 있으면 뒤로 민다. */
const RARE = new Set(['+', '2', 'm2', 'm+', 'm7#5', 'M7b5', 'M7#5', 'm7M', 'm97M', 'dim7M']);

/** 상용도 감점: 흔한 코드 0, 보통 −2, 희귀 −5. */
function rarityPenalty(name: string): number {
  if (COMMON.has(name)) return 0;
  if (RARE.has(name)) return 5;
  return 2;
}

export interface DetectChordOptions {
  /** 루트/베이스 음이름을 ♭으로 적을지(기본 true — 재즈 관례). false 면 ♯. */
  flats?: boolean;
}

const pc = (n: number) => ((n % 12) + 12) % 12;

/**
 * MIDI 음번호 배열 → 코드 심볼 문자열(예: "CM7", "Dm7", "G7", "C/E").
 * 인식하지 못하면 null. 반환 문자열은 사용자가 코드칸에 타이핑한 것과 같은
 * 형식이라 normalizeChord/formatChordDisplay 를 그대로 통과한다.
 */
export function detectChordFromMidi(
  midiNotes: number[],
  opts: DetectChordOptions = {},
): string | null {
  if (midiNotes.length < MIN_DISTINCT) return null;
  const played = new Set(midiNotes.map(pc));
  if (played.size < MIN_DISTINCT) return null;

  const bassPc = pc(Math.min(...midiNotes));
  const names = opts.flats === false ? PC_SHARP : PC_FLAT;

  let best: { score: number; root: number; ct: ChordType; missing: number } | null = null;

  for (const ct of getChordTypeDatabase().getAllChordTypes()) {
    for (let root = 0; root < 12; root++) {
      const required = new Set(ct.degrees.map((d) => pc(root + d.pitch)));

      // 연주한 음 중 이 코드로 설명 안 되는 것이 하나라도 있으면 탈락.
      let extra = false;
      for (const p of played) if (!required.has(p)) { extra = true; break; }
      if (extra) continue;

      let missing = 0;
      for (const p of required) if (!played.has(p)) missing++;
      if (missing >= MAX_MISSING) continue;

      // 생략음이 적을수록, 최저음이 루트일수록, 흔한 코드일수록, 단순할수록 좋다.
      // 생략 감점(6)은 희귀 감점(5)보다 커야 한다 — 그래야 "정확히 다 맞는 희귀
      // 코드"가 "한 음 빠진 흔한 코드"에 밀리지 않는다(C-E-G♯ → C+ vs C7♯5).
      const score = -missing * 6
        + (root === bassPc ? 3 : 0)
        - rarityPenalty(ct.name)
        - required.size * 0.1;

      if (!best || score > best.score) best = { score, root, ct, missing };
    }
  }

  if (!best) return null;

  const symbol = names[best.root] + best.ct.name;
  // 최저음이 루트가 아니면 전위 → 슬래시 코드. (extra 를 막았으므로 최저음은
  // 반드시 구성음 중 하나다.)
  return best.root === bassPc ? symbol : `${symbol}/${names[bassPc]}`;
}
