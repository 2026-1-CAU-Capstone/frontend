const MOCK_RESPONSES: Record<string, string> = {
  '2-5-1': '이 구간은 **Dm7(ii) → G7(V) → Cmaj7(I)**의 전형적인 ii-V-I 진행입니다. 재즈에서 가장 기본적이고 중요한 화성 진행으로, 서브도미넌트에서 도미넌트를 거쳐 토닉으로 해결되는 강한 종지감을 만들어냅니다.',
  'ii-v-i': '이 구간은 **Dm7(ii) → G7(V) → Cmaj7(I)**의 전형적인 ii-V-I 진행입니다. 재즈에서 가장 기본적이고 중요한 화성 진행으로, 서브도미넌트에서 도미넌트를 거쳐 토닉으로 해결되는 강한 종지감을 만들어냅니다.',
  'secondary dominant': 'E7은 C key의 다이아토닉 코드가 아니라, **vi(Am)로 해결하기 위한 Secondary Dominant(V/vi)**입니다. 원래 자리의 Em 대신 E7을 사용하여 Am으로의 진행에 강한 이끎음(leading tone)을 만들어냅니다.',
  'tritone': 'Db7은 G7의 **tritone substitution**으로, 두 코드가 같은 tritone interval(B-F)을 공유합니다. 반음 하행(Db7 → Cmaj7)으로 부드럽게 해결되어, 더 세련된 사운드를 만들어냅니다.',
  'modal interchange': 'Fm6는 C 메이저 키에서 **동명 단조(C minor/aeolian)**로부터 빌려온 코드입니다. IV(F) → iv(Fm)의 진행은 밝은 느낌에서 살짝 어두운 색채를 더하며, 재즈 스탠다드에서 매우 자주 사용됩니다.',
  'dominant': '도미넌트(Dominant) 기능은 토닉으로 해결하려는 강한 경향성을 가진 코드입니다. V7 코드의 tritone(3음-7음)이 반음씩 움직여 I 코드로 해결됩니다.',
  'tonic': '토닉(Tonic) 기능의 코드는 조성의 중심이 되는 안정적인 코드입니다. I, iii, vi 코드가 토닉 기능을 수행하며, 화성 진행의 출발점이자 도착점 역할을 합니다.',
  'subdominant': '서브도미넌트(Subdominant) 기능은 도미넌트로의 진행을 준비하는 역할을 합니다. ii, IV 코드가 대표적이며, 토닉에서 벗어나 긴장을 만들기 시작하는 지점입니다.',
};

const DEFAULT_RESPONSE = '해당 코드 진행에 대해 분석 중입니다. (실제 서비스에서는 fine-tuned LLaMA가 RAG를 통해 응답합니다)';

export function getMockResponse(query: string): string {
  const lower = query.toLowerCase();
  for (const [keyword, response] of Object.entries(MOCK_RESPONSES)) {
    if (lower.includes(keyword)) {
      return response;
    }
  }
  return DEFAULT_RESPONSE;
}
