/* 채팅 자연어 → 스템 분리 인텐트 (rule-based).
 *
 * 오디오 파일이 첨부된 채팅 메시지에서 무엇을 원하는지 파싱한다:
 *   - "스템 분리해줘 / 음원 분리"            → split (전체 분리)
 *   - "피아노만 빼줘 / 보컬만 분리해줘"       → extract (해당 악기 추출)
 *   - "피아노 빼고 / 보컬 제거 / MR 만들어줘"  → remove (해당 악기 제거본)
 *
 * LLM 호출 없이 정규식만으로 판정한다 — 오디오 입력은 현행 채팅 LLM이
 * 처리하지 못하므로, 오디오 첨부 + 애매한 문장은 split으로 폴백한다. */
import type { StemPresetId } from './mockSeparate';

export type StemTargetId = 'vocals' | 'drums' | 'bass' | 'piano' | 'guitar';

export interface StemIntent {
  kind: 'split' | 'extract' | 'remove';
  /** extract/remove 대상 악기. */
  target?: StemTargetId;
  preset: StemPresetId;
}

const TARGET_PATTERNS: Array<[RegExp, StemTargetId]> = [
  [/보컬|목소리|노래\s*소리|vocals?/i, 'vocals'],
  [/드럼|drums?/i, 'drums'],
  [/베이스|bass/i, 'bass'],
  [/피아노|건반|piano|keys/i, 'piano'],
  [/기타|guitar/i, 'guitar'],
];

function detectTarget(text: string): StemTargetId | undefined {
  for (const [re, id] of TARGET_PATTERNS) {
    if (re.test(text)) return id;
  }
  return undefined;
}

/** 대상 악기에 필요한 최소 프리셋 — 피아노/기타는 6-스템 모델에서만 나온다. */
function presetFor(target: StemTargetId | undefined): StemPresetId {
  return target === 'piano' || target === 'guitar' ? '6' : '4';
}

const REMOVE_RE = /제거|없애|지워|삭제|빼\s*고|뮤트|remove|없는|mr\b|엠알|반주만|인스트루?멘탈|instrumental|노래방/i;
const EXTRACT_ONLY_RE = /([가-힣a-zA-Z]+)\s*만\s*(빼|줘|분리|추출|따로|들려|남겨|뽑|골라|다운)/i;
const EXTRACT_RE = /추출|따로|뽑아|분리해?\s*(해)?줘|isolate|extract|solo/i;
const SPLIT_RE = /스템|stem|분리|나눠|쪼개|나누|split|separate|악기\s*별|트랙\s*별/i;

/**
 * 스템 인텐트 파싱. 스템 관련 신호가 전혀 없으면 null.
 * (호출부는 오디오 첨부 시 null이면 split으로 폴백한다.)
 */
export function parseStemIntent(text: string): StemIntent | null {
  const t = (text ?? '').trim();
  if (!t) return null;

  const target = detectTarget(t);

  // "MR/반주만/보컬 제거" — 보컬 제거 관용구 우선.
  if (/mr\b|엠알|반주만|인스트루?멘탈|instrumental|노래방/i.test(t)) {
    return { kind: 'remove', target: 'vocals', preset: '2' };
  }

  // "X만 …" — 해당 악기 추출. ("빼줘"는 'X만'과 붙으면 추출 의미)
  if (target && EXTRACT_ONLY_RE.test(t)) {
    return { kind: 'extract', target, preset: presetFor(target) };
  }

  // 제거 계열 ("피아노 빼고", "보컬 없애줘")
  if (target && REMOVE_RE.test(t)) {
    return { kind: 'remove', target, preset: presetFor(target) };
  }

  // 추출 계열 (악기 언급 + 추출/분리 동사)
  if (target && EXTRACT_RE.test(t)) {
    return { kind: 'extract', target, preset: presetFor(target) };
  }

  // 전체 분리
  if (SPLIT_RE.test(t)) {
    return { kind: 'split', preset: target ? presetFor(target) : '4' };
  }

  return null;
}

/** 카드 헤더/어시스턴트 말풍선용 인텐트 설명. */
export function describeStemIntent(intent: StemIntent): string {
  const NAMES: Record<StemTargetId, string> = {
    vocals: '보컬', drums: '드럼', bass: '베이스', piano: '피아노', guitar: '기타',
  };
  if (intent.kind === 'extract' && intent.target) return `${NAMES[intent.target]}만 추출`;
  if (intent.kind === 'remove' && intent.target) {
    return intent.target === 'vocals' ? '보컬 제거 (MR 만들기)' : `${NAMES[intent.target]} 제거`;
  }
  return `${intent.preset}스템 분리`;
}
