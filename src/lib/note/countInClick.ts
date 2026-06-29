/* Count-in 인트로용 woodblock 클릭 음.
 *
 * 기존 synthMetro 스타일과 동일하지만, 별도의 공유 AudioContext 를 써서
 * 어떤 플레이어 (BackingPlayer / soundfont-direct) 도 일관된 카운트인을
 * 받을 수 있도록 한다. 카운트인이 끝난 직후 본 재생이 시작되므로 두 ctx 의
 * clock drift 는 신경 쓰지 않아도 됨. */

interface WindowWithWebkit extends Window {
  webkitAudioContext?: typeof AudioContext;
}

let sharedCtx: AudioContext | null = null;

function ensureCtx(): AudioContext {
  if (!sharedCtx) {
    const w = window as WindowWithWebkit;
    const Ctor = window.AudioContext || w.webkitAudioContext;
    if (!Ctor) throw new Error('Web Audio API not supported');
    sharedCtx = new Ctor();
  }
  if (sharedCtx.state === 'suspended') {
    void sharedCtx.resume();
  }
  return sharedCtx;
}

/** 사용자 제스처 안에서 호출해 suspended ctx를 깨운 뒤, running 상태가 될
 *  때까지(최대 ~150ms) 기다린다. iOS에서 resume 직후 currentTime이 잠시
 *  frozen이라 — 그 시각 기준으로 클릭을 스케줄하면 첫 1~2 클릭이 뭉개지던
 *  문제를 막는다. 실패해도 throw하지 않음 (클릭은 best-effort). */
export async function resumeCountInCtx(): Promise<void> {
  const ctx = ensureCtx();
  if (ctx.state === 'running') return;
  try { await ctx.resume(); } catch { /* gesture 밖이면 다음 기회에 */ }
  for (let i = 0; i < 10 && (ctx.state as string) !== 'running'; i++) {
    await new Promise((r) => setTimeout(r, 15));
  }
}

export interface ScheduledClick {
  stop(): void;
}

export type ClickKind = 'accent' | 'normal' | 'snap';

/** Schedule a single click at audio time `when` (in shared ctx clock).
 *   - accent/normal: 스틱 클릭 (sine, 1500/1100 Hz, 짧은 decay)
 *   - snap: 손가락 틩기는 소리 — bandpass 통과 짧은 noise burst (~2.5 kHz 피크) */
export function scheduleCountInClick(
  when: number,
  kind: ClickKind,
  gain = 0.7,
): ScheduledClick {
  const ctx = ensureCtx();

  if (kind === 'snap') {
    // 손가락 틩김 — 짧은 noise burst + bandpass + 빠른 decay.
    // 노이즈 자체에 exponential 감쇠를 baked-in 해서 transient (어택) 부분이
    // 더 sharp 하게 들리도록 함.
    const len = 0.06;
    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * len));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2500;
    filter.Q.value = 6;

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain * 0.85, when);
    env.gain.exponentialRampToValueAtTime(0.001, when + len);

    noise.connect(filter).connect(env).connect(ctx.destination);
    noise.start(when);
    noise.stop(when + len);

    return {
      stop() {
        try {
          noise.stop();
        } catch {
          /* already stopped */
        }
      },
    };
  }

  // 스틱 클릭 — accent (액센트 박) 는 더 높고 큼.
  const accent = kind === 'accent';
  const freq = accent ? 1500 : 1100;
  const len = 0.045;
  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.value = freq;
  const env = ctx.createGain();
  env.gain.setValueAtTime(gain * (accent ? 1.0 : 0.75), when);
  env.gain.exponentialRampToValueAtTime(0.001, when + len);
  osc.connect(env).connect(ctx.destination);
  osc.start(when);
  osc.stop(when + len);
  return {
    stop() {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    },
  };
}

/** Current shared audio-context time, for scheduling. */
export function getCountInTime(): number {
  return ensureCtx().currentTime;
}
