/* ─────────────────────────────────────────────────────────────────────────
 * drumAudition — 드럼 킷 "눌러서 듣기" 싱글턴.
 *
 * GlobalKeyboard(피아노 클릭 사운드)와 같은 결의 모듈 싱글턴이다. 재생 타임라인
 * (BackingPlayer)과는 별개로, 에디터에서 드럼 패드를 눌렀을 때 그 자리에서 한 방
 * 울리는 용도만 담당한다.
 *
 * 음색은 재생과 **같은 샘플 킷**(loadSampledDrumKit — /public/samples/drums/jazz)
 * 을 쓴다. 그래서 패드로 들은 소리와 저장 후 재생되는 소리가 같다.
 * ──────────────────────────────────────────────────────────────────────── */

import type { DrumPiece } from '../backing/types';
import type { TriggerableInstrument } from '../backing/soundfont';
import { loadSampledDrumKit } from '../backing/sampledDrumKit';
import { gmPercToDrumPiece } from './gmInstruments';
import { registerAudioStopper } from '../player/audioStopRegistry';

let ctx: AudioContext | null = null;
let kit: TriggerableInstrument | null = null;
let loading: Promise<TriggerableInstrument> | null = null;

registerAudioStopper(() => {
  try { kit?.stopAll(); } catch { /* 아직 로드 전 */ }
});

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** 샘플 13개(~6MB)를 미리 받아 둔다 — 첫 타를 놓치지 않으려면 킷 UI가 뜰 때 부른다. */
export function preloadDrumKit(): Promise<TriggerableInstrument> {
  if (kit) return Promise.resolve(kit);
  if (!loading) {
    loading = loadSampledDrumKit(getCtx()).then((k) => {
      kit = k;
      return k;
    });
  }
  return loading;
}

/**
 * 드럼 한 방. 샘플이 아직 안 왔으면 로드가 끝난 직후 울린다(첫 클릭도 소리 남).
 *
 * velocity 기본값 0.7 은 "보통 세기로 한 대" 다 — 샘플 킷이 세기 구간으로
 * 아티큘레이션을 고르는데(고스트 <0.3, 일반, 강타 >0.8 / 하이햇 강타 >0.7),
 * 0.7 이면 모든 조각이 일반 타에 떨어진다. 더 세게/약하게 들려주려면 넘긴다.
 */
export function auditionDrum(piece: DrumPiece, velocity = 0.7): void {
  const c = getCtx();
  void preloadDrumKit()
    .then((k) => k.trigger({ note: piece, time: c.currentTime, duration: 0.5, velocity }))
    .catch(() => undefined); // 샘플 로드 실패는 조용히 — 입력(악보)은 계속돼야 한다
}

/** GM 퍼커션 MIDI 로 오디션 (드럼 파트의 keys 는 GM 절대값이라 이 경로를 쓴다). */
export function auditionDrumGm(gm: number, velocity = 0.7): void {
  const piece = gmPercToDrumPiece(gm);
  if (piece) auditionDrum(piece, velocity);
}
