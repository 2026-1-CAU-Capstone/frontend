/* 스템 분리 — 프론트엔드 데모 엔진 (EQ 대역 근사).
 *
 * 실제 소스 분리(Demucs/Spleeter 급)는 GPU 백엔드가 필요하다(음원분리_백엔드
 * 요구사항.md). 이 모듈은 백엔드 연동 전까지 UI/믹서/다운로드 플로우를 실제
 * 오디오로 시연하기 위한 근사: 원본을 스템별 EQ 대역으로 OfflineAudioContext
 * 렌더링해 "분리된 것처럼" 들리는 트랙을 만든다. 합치면 대략 원본 스펙트럼이
 * 복원되도록 대역을 나눴다.
 *
 * 백엔드 연동 시 separate()만 API 호출로 갈아끼우면 페이지는 그대로 동작한다
 * (반환 형태 동일: 스템별 AudioBuffer). */

export type StemPresetId = '2' | '4' | '6';

export interface StemDef {
  id: string;
  label: string;
  emoji: string;
  /** 파형/스트립 포인트 컬러. */
  color: string;
  /** 직렬 biquad 체인들의 병렬 합 — [[하이패스,로우패스], [...]] */
  chains: Array<Array<{ type: BiquadFilterType; freq: number }>>;
  gain?: number;
}

/* 대역 분할 근사 — 저역(베이스) / 중저역(피아노) / 중역(보컬) / 중고역(기타)
 * / 고역(드럼 심벌즈) / 나머지. 진짜 분리가 아니라 데모용 근사라는 점을 UI에
 * 명시한다. */
const VOCALS: StemDef = { id: 'vocals', label: '보컬', emoji: '🎤', color: '#e07a9b', chains: [[{ type: 'highpass', freq: 350 }, { type: 'lowpass', freq: 3200 }]], gain: 1.15 };
const DRUMS: StemDef = { id: 'drums', label: '드럼', emoji: '🥁', color: '#caa24b', chains: [[{ type: 'highpass', freq: 6000 }]], gain: 1.3 };
const BASS: StemDef = { id: 'bass', label: '베이스', emoji: '🎸', color: '#7a9bd6', chains: [[{ type: 'lowpass', freq: 180 }]], gain: 1.2 };
const PIANO: StemDef = { id: 'piano', label: '피아노', emoji: '🎹', color: '#6aaa7e', chains: [[{ type: 'highpass', freq: 180 }, { type: 'lowpass', freq: 900 }]], gain: 1.1 };
const GUITAR: StemDef = { id: 'guitar', label: '기타', emoji: '🎻', color: '#b58ad0', chains: [[{ type: 'highpass', freq: 900 }, { type: 'lowpass', freq: 2600 }]] };
const OTHER: StemDef = { id: 'other', label: '기타 악기', emoji: '🎼', color: '#9a9a9a', chains: [[{ type: 'highpass', freq: 3200 }, { type: 'lowpass', freq: 6000 }]] };
/* 2-스템 반주(Instrumental): 보컬 대역을 뺀 저역+고역의 병렬 합. */
const INSTRUMENTAL: StemDef = {
  id: 'instrumental', label: '반주 (MR)', emoji: '🎼', color: '#7a9bd6',
  chains: [[{ type: 'lowpass', freq: 350 }], [{ type: 'highpass', freq: 3200 }]],
};

export const STEM_PRESETS: Record<StemPresetId, { label: string; desc: string; stems: StemDef[] }> = {
  '2': { label: '2 스템', desc: '보컬 / 반주(MR)', stems: [VOCALS, INSTRUMENTAL] },
  '4': { label: '4 스템', desc: '보컬 / 드럼 / 베이스 / 나머지', stems: [VOCALS, DRUMS, BASS, { ...OTHER, chains: [[{ type: 'highpass', freq: 180 }, { type: 'lowpass', freq: 6000 }]], label: '나머지' }] },
  '6': { label: '6 스템', desc: '보컬 / 드럼 / 베이스 / 피아노 / 기타 / 나머지', stems: [VOCALS, DRUMS, BASS, PIANO, GUITAR, OTHER] },
};

export interface SeparatedStem {
  def: StemDef;
  buffer: AudioBuffer;
}

/** 스템 하나를 EQ 체인(병렬 합)으로 오프라인 렌더링. */
async function renderStem(src: AudioBuffer, def: StemDef): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(
    Math.min(2, src.numberOfChannels),
    src.length,
    src.sampleRate,
  );
  for (const chain of def.chains) {
    const source = ctx.createBufferSource();
    source.buffer = src;
    let node: AudioNode = source;
    for (const f of chain) {
      const biq = ctx.createBiquadFilter();
      biq.type = f.type;
      biq.frequency.value = f.freq;
      node.connect(biq);
      node = biq;
    }
    const g = ctx.createGain();
    g.gain.value = def.gain ?? 1;
    node.connect(g);
    g.connect(ctx.destination);
    source.start(0);
  }
  return ctx.startRendering();
}

/**
 * 모의 분리 실행. onProgress(0..1)는 스템 하나 렌더될 때마다 갱신.
 * 백엔드 연동 시 이 함수만 `POST /v1/stems` 업로드 + 결과 다운로드로 교체.
 */
export async function separate(
  src: AudioBuffer,
  preset: StemPresetId,
  onProgress?: (ratio: number) => void,
): Promise<SeparatedStem[]> {
  const defs = STEM_PRESETS[preset].stems;
  const out: SeparatedStem[] = [];
  for (let i = 0; i < defs.length; i++) {
    const buffer = await renderStem(src, defs[i]);
    out.push({ def: defs[i], buffer });
    onProgress?.((i + 1) / defs.length);
    // 데모 UX: 진행 단계가 눈에 보이도록 아주 짧게 양보.
    await new Promise((r) => setTimeout(r, 120));
  }
  return out;
}
