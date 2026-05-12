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
  width: 116px;
  height: 116px;
  border-radius: 28px;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.14);
  animation: ${fadeUp} 0.55s ease both;
`;

const Title = styled.h1`
  margin: 0;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 2.4rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.textPrimary};
  animation: ${fadeUp} 0.55s 0.12s ease both;
`;

const Tagline = styled.p`
  margin: 0;
  font-family: ${({ theme }) => theme.fonts.ui};
  font-size: 0.86rem;
  font-weight: 500;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.textSecondary};
  animation: ${fadeUp} 0.55s 0.24s ease both;
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
      <Logo src="/jazzifylogo.png" alt="Jazzify" />
      <Title>Jazzify</Title>
      <Tagline>Jazz · Licks · Analysis</Tagline>
    </Screen>
  );
}
