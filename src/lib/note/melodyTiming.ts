/* §8 R8 — EditorPage/SoloGeneratorPage에 복붙돼 있던 동일 음표-타이밍/코드
 * 헬퍼를 한 곳으로 모은 순수 모듈. 두 페이지와 useNoteSheetPlayback 훅이 공유.
 * (두 페이지의 정의가 글자까지 동일함을 diff로 확인하고 추출.) */

// 음이름 → 한 옥타브 내 반음 인덱스 (vexToMidi/chordToMidi 내부 전용).
const SEMI_MAP: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

export const DUR_BEATS: Record<string, number> = {
  w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, '32': 0.125, '64': 0.0625,
};

export function vexToMidi(key: string, acc?: '#' | 'b' | 'n' | '##' | 'bb'): number {
  const [n, o] = key.split('/');
  // 'eb/4' 같은 baked 표기(글자에 임시표 포함)도 지원 — 첫 글자만 음이름.
  let s = SEMI_MAP[n[0]] ?? 0;
  const baked = n.slice(1);
  if (baked === '#') s += 1;
  else if (baked === 'b') s -= 1;
  else if (baked === '##') s += 2;
  else if (baked === 'bb') s -= 2;
  if (acc === '#') s += 1;
  else if (acc === 'b') s -= 1;
  else if (acc === '##') s += 2;
  else if (acc === 'bb') s -= 2;
  return (parseInt(o) + 1) * 12 + s;
}

export function getBeats(dur: string, dotted?: boolean, tuplet?: number, tupletNormal?: number): number {
  // 'r'(쉼표)·'d'(점 축약 표기) 접미는 길이 계산에서 제거 — dotted 는 별도 플래그.
  const base = dur.replace(/[rd]+$/, '');
  let b = DUR_BEATS[base] ?? 1;
  if (dotted) b *= 1.5;
  if (tuplet && tuplet >= 2) {
    // XML의 normal-notes(예: 5:3, 7:6)를 우선, 없으면 2의 거듭제곱 휴리스틱.
    const denom = tupletNormal ?? Math.pow(2, Math.floor(Math.log2(tuplet - 1)));
    b *= denom / tuplet;
  }
  return b;
}

/** 메트릭 박 길이 — 꾸밈음(grace)은 시간을 훔치지 않으므로 0박.
 *  (렌더러가 다음 실음의 GraceNoteGroup 수식으로 그려 0박 소비.) 마디 길이·
 *  분할·픽업 감지 등 "박 합"이 필요한 모든 곳은 이 헬퍼를 써야 정박이 안 밀린다. */
export function noteMetricBeats(n: {
  duration: string; dotted?: boolean; tuplet?: number; tupletNormal?: number; grace?: boolean;
}): number {
  if (n.grace) return 0;
  return getBeats(n.duration, n.dotted, n.tuplet, n.tupletNormal);
}

export function chordToMidi(chord: string): number[] {
  if (!chord) return [];
  // Root note
  const rootMatch = chord.match(/^([A-Ga-g])([#b♯♭]?)/);
  if (!rootMatch) return [];
  const rootLetter = rootMatch[1].toLowerCase();
  const rootAcc = rootMatch[2];
  let root = SEMI_MAP[rootLetter] ?? 0;
  if (rootAcc === '#' || rootAcc === '♯') root += 1;
  if (rootAcc === 'b' || rootAcc === '♭') root -= 1;
  const rest = chord.slice(rootMatch[0].length);

  // Determine chord quality → intervals from root
  let intervals: number[];
  if (/^[mM-](?!aj)/i.test(rest) && !/^min.*maj/i.test(rest)) {
    // minor
    if (/7/.test(rest)) intervals = [0, 3, 7, 10]; // m7
    else intervals = [0, 3, 7];
  } else if (/dim|[oø°]/.test(rest)) {
    if (/ø|half/i.test(rest) || /7/.test(rest)) intervals = [0, 3, 6, 10]; // half-dim
    else intervals = [0, 3, 6]; // dim
  } else if (/aug|\+/.test(rest)) {
    if (/7/.test(rest)) intervals = [0, 4, 8, 10];
    else intervals = [0, 4, 8];
  } else if (/[Δ△]|[Mm]aj7/i.test(rest)) {
    intervals = [0, 4, 7, 11]; // maj7
  } else if (/7/.test(rest)) {
    intervals = [0, 4, 7, 10]; // dom7
  } else if (/sus4/.test(rest)) {
    intervals = [0, 5, 7];
  } else if (/sus2/.test(rest)) {
    intervals = [0, 2, 7];
  } else {
    intervals = [0, 4, 7]; // major triad
  }

  // Voice around C3 (MIDI 48) - rootless voicing style
  const base = 48 + root; // C3 range
  return intervals.map((iv) => base + iv);
}
