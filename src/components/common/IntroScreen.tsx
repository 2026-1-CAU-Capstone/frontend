import { useEffect, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';

/* ─────────────────────────────────────────────────────────────────────────
 * Splash / intro screen shown once when the app boots.
 *
 * Behaviour:
 *   - Auto-dismisses after `durationMs` (default 1700ms).
 *   - Tap anywhere to skip immediately.
 *   - Fades out (~420ms), then calls `onDone` so the parent can unmount.
 *
 * The screen is a position:fixed overlay over everything, including the safe-
 * area, so it works the same on web and inside the iOS Capacitor WebView.
 * ──────────────────────────────────────────────────────────────────────── */

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
`;

const fadeOut = keyframes`
  to { opacity: 0; }
`;

const Screen = styled.div<{ $exiting: boolean }>`
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  background:
    radial-gradient(circle at 50% 32%, rgba(212, 168, 67, 0.10), transparent 55%),
    ${({ theme }) => theme.colors.bgPrimary};
  padding:
    env(safe-area-inset-top, 0px)
    env(safe-area-inset-right, 0px)
    env(safe-area-inset-bottom, 0px)
    env(safe-area-inset-left, 0px);
  cursor: pointer;
  user-select: none;
  ${({ $exiting }) =>
    $exiting &&
    css`
      animation: ${fadeOut} 0.42s ease forwards;
      pointer-events: none;
    `}
`;

const Logo = styled.img`
  width: min(70vw, 280px);
  height: auto;
  animation: ${fadeUp} 0.55s ease both;
`;

interface IntroScreenProps {
  onDone: () => void;
  /** Auto-dismiss delay in milliseconds (default 1700). */
  durationMs?: number;
}

export function IntroScreen({ onDone, durationMs = 1700 }: IntroScreenProps) {
  const [exiting, setExiting] = useState(false);

  /* Auto-dismiss after `durationMs`. Capacitor / native apps re-mount the
   * whole React tree on cold start, so this fires once per app session. */
  useEffect(() => {
    if (exiting) return;
    const t = window.setTimeout(() => setExiting(true), durationMs);
    return () => window.clearTimeout(t);
  }, [exiting, durationMs]);

  /* Once we've started the exit animation, give it a beat to play out
   * (matches the 0.42s fadeOut), then unmount. */
  useEffect(() => {
    if (!exiting) return;
    const t = window.setTimeout(onDone, 450);
    return () => window.clearTimeout(t);
  }, [exiting, onDone]);

  return (
    <Screen $exiting={exiting} onClick={() => setExiting(true)}>
      <Logo src="/intro.png" alt="Jazzify" />
    </Screen>
  );
}
