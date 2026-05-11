import Soundfont from 'soundfont-player';

/* ─────────────────────────────────────────────────────────────────────────
 * Player asset warmup.
 *
 * 첫 재생 지연의 원인 = 카운트인이 끝나기 전에 다음이 끝나야 함:
 *   - acoustic_grand_piano-mp3.js soundfont (~200-500KB, CDN 에서 다운로드)
 *   - 13개 드럼 샘플 wav (각 ~50KB)
 *   - decode (~100-300ms)
 *
 * 카운트인 (1.2~2초) 보다 위 자산 로딩 (2-4초) 이 길면, preload 를 카운트인
 * 시작과 동시에 호출해도 카운트인 끝나고 추가 대기 발생.
 *
 * 해결: 앱 시작 시점에 자산들을 미리 fetch → 브라우저 HTTP 캐시 적재. 사용자가
 * 재생 클릭할 즈음엔 모든 게 캐시에 있어서 NotePlayer.preload() 가 빠르게 (~수십
 * ms decode 만) 끝남.
 *
 * - AudioContext 는 user gesture 없이 만들면 suspended 상태로 생성됨 (정상).
 *   warmup 단계에선 decode 까지만 하고 resume 안 함. 실제 재생은 사용자 클릭에서
 *   NotePlayer 가 자기 ctx 로 재진행 (이번엔 HTTP 캐시 hit).
 * - 동일 URL 을 두 번째 fetch 하면 브라우저는 disk cache 에서 즉시 응답.
 * - 이미 실패해도 silent — 재생 시점에 다시 시도하니까 functional 영향 없음.
 * ──────────────────────────────────────────────────────────────────────── */

const DRUM_SAMPLE_PATHS = [
  '/samples/drums/jazz/kick.wav',
  '/samples/drums/jazz/snare.wav',
  '/samples/drums/jazz/snare-ghost.wav',
  '/samples/drums/jazz/snare-hard.wav',
  '/samples/drums/jazz/hihat-closed.wav',
  '/samples/drums/jazz/hihat-closed-hard.wav',
  '/samples/drums/jazz/hihat-foot.wav',
  '/samples/drums/jazz/hihat-open.wav',
  '/samples/drums/jazz/ride.wav',
  '/samples/drums/jazz/ride-bell.wav',
  '/samples/drums/jazz/crash.wav',
  '/samples/drums/jazz/tom-low.wav',
  '/samples/drums/jazz/tom-high.wav',
];

let warmupPromise: Promise<void> | null = null;

/** 앱 시작 시 한 번 호출. idempotent — 이미 진행 중이면 기존 promise 반환. */
export function warmupPlayerAssets(): Promise<void> {
  if (warmupPromise) return warmupPromise;

  warmupPromise = (async () => {
    try {
      const Ctor = window.AudioContext;
      if (!Ctor) return;
      // throwaway ctx — soundfont 다운로드 + decode 트리거. user gesture 가 없어서
      // suspended 로 생성되지만 fetch + decodeAudioData 는 가능.
      const tmpCtx = new Ctor();

      await Promise.allSettled([
        // piano soundfont (NotePlayer 가 melody/comp 둘 다 같은 instrument 사용)
        Soundfont.instrument(
          tmpCtx,
          'acoustic_grand_piano' as Soundfont.InstrumentName,
        ),
        // drum samples — 단순 fetch 로 HTTP 캐시만 채움 (decode 는 재생 시점 NotePlayer 가)
        ...DRUM_SAMPLE_PATHS.map((p) =>
          fetch(p, { cache: 'force-cache' }).catch(() => undefined),
        ),
      ]);

      try {
        await tmpCtx.close();
      } catch {
        /* already closed */
      }
    } catch (err) {
      console.warn('[playerWarmup] failed (재생 시점에 정상 로드):', err);
    }
  })();

  return warmupPromise;
}
