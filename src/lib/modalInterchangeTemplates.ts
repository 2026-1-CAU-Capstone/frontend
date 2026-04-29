/**
 * Modal interchange explanation templates.
 * Keyed by (sourceMode, borrowedDegree). Falls back to a generic template.
 */

interface MITemplate {
  short: string;   // hover tooltip — 1줄
  long: string;    // modal body — 1~2 문단
}

const TEMPLATES: Record<string, MITemplate> = {
  // ── from parallel minor ────────────────────────────────────────────
  'parallel minor|iv': {
    short: 'IVm — 평행 단조에서 차용한 마이너 IV',
    long: '메이저 키의 IV를 평행 단조의 IVm으로 빌려온 형태입니다. 메이저 IV의 밝은 서브도미넌트를 어둡게 비틀어 멜랑꼴리하고 향수적인 색채를 만들어냅니다. 재즈 스탠다드에서 가장 자주 쓰이는 모달 인터체인지 중 하나로, 보통 IV → IVm → I 진행으로 부드러운 하강 보이스 리딩을 형성합니다.',
  },
  'parallel minor|bVII': {
    short: '♭VII — 평행 단조의 ♭VII 차용',
    long: '평행 단조에서 빌려온 ♭VII 코드입니다. 록과 팝에서 매우 흔하며, 메이저 키에 모달(믹솔리디안) 색채를 더해줍니다. 보통 IV → ♭VII → I 진행으로 플레이갈 케이던스 효과를 냅니다.',
  },
  'parallel minor|bVI': {
    short: '♭VI — 평행 단조의 ♭VI 차용',
    long: '평행 단조에서 빌려온 ♭VI 코드. 강한 어두운 색채를 만들며, 영화 음악적/서사적 분위기에 자주 사용됩니다. ♭VI → ♭VII → I 진행은 epic한 케이던스로 잘 알려져 있습니다.',
  },
  'parallel minor|bIII': {
    short: '♭III — 평행 단조의 ♭III 차용',
    long: '평행 단조에서 빌려온 ♭III 메이저 코드입니다. 갑작스럽고 인상적인 모달 색채를 만들며, 일시적인 단조 느낌을 강하게 줍니다.',
  },
  'parallel minor|i': {
    short: 'im — 평행 단조의 i (토닉 마이너)',
    long: '메이저 키에서 일시적으로 토닉 마이너를 차용한 형태입니다. 같은 루트지만 어두운 정서로의 급격한 전환을 만들며, 곡의 분위기 전환점에서 자주 사용됩니다.',
  },

  // ── from dorian ────────────────────────────────────────────────────
  'dorian|IV': {
    short: 'IV (Dorian) — 도리안의 메이저 IV',
    long: '도리안 모드에서 빌려온 메이저 IV입니다. 마이너 키에서 자연스러운 모달 색채를 만들며, 재즈에서 마이너 토닉 위에 메이저 IV가 머무르는 모달 사운드의 핵심입니다.',
  },

  // ── from mixolydian ───────────────────────────────────────────────
  'mixolydian|bVII': {
    short: '♭VII (Mixolydian) — 믹솔리디안의 ♭VII',
    long: '믹솔리디안 모드에서 차용한 ♭VII 코드. 메이저 키의 V7을 약화시키며 모달, 록적 사운드를 만들어냅니다.',
  },

  // ── from phrygian ──────────────────────────────────────────────────
  'phrygian|bII': {
    short: '♭II (Phrygian) — 프리지안의 ♭II',
    long: '프리지안 모드에서 차용한 ♭II 코드. 강하고 이국적인 어두운 색채를 만들며, 플라멩코나 스페인 재즈 분위기에 자주 등장합니다. V7의 트라이톤 대리(tritone substitution)와 코드톤이 공유되어 V7 대체로도 분석됩니다.',
  },

  // ── from parallel major (in minor key) ────────────────────────────
  'parallel major|IV': {
    short: 'IV — 평행 장조에서 차용한 메이저 IV',
    long: '마이너 키에서 평행 장조의 메이저 IV를 차용한 형태. 어두운 마이너 키에 잠시 빛이 드는 듯한 효과를 줍니다.',
  },

  // ── from lydian ────────────────────────────────────────────────────
  'lydian|II': {
    short: 'II (Lydian) — 리디안의 II',
    long: '리디안 모드에서 차용한 II 메이저 코드. 떠오르는 듯한 밝고 신비로운 색채를 만듭니다.',
  },
};

export function getModalInterchangeTemplate(
  sourceMode: string,
  borrowedDegree: string,
): MITemplate {
  const key = `${sourceMode}|${borrowedDegree}`;
  if (TEMPLATES[key]) return TEMPLATES[key];

  // Fallback: generic template
  return {
    short: `${borrowedDegree} — ${sourceMode}에서 차용`,
    long: `${sourceMode}(평행 모드)에서 빌려온 ${borrowedDegree} 코드입니다. 메인 키의 다이아토닉이 아닌 모달 인터체인지로, 일반적인 진행에 색다른 색채와 텐션을 더해줍니다. 진행의 맥락에 따라 분위기 전환이나 보이스 리딩의 부드러움을 만드는 역할을 합니다.`,
  };
}
