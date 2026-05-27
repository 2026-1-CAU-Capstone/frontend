import { useEffect, useState } from 'react';

/* Mount + enter/exit transition helper. Returns `mounted` (whether to keep
 * the element in the DOM) and `entered` (whether to apply the visible-state
 * styles). Drive your CSS off `entered` and gate JSX on `mounted`:
 *
 *   const { mounted, entered } = useTransitionState(open);
 *   if (!mounted) return null;
 *   return <Overlay $entered={entered}>…</Overlay>;
 *
 *   const Overlay = styled.div<{ $entered: boolean }>`
 *     opacity: ${({$entered}) => $entered ? 1 : 0};
 *     transition: opacity 0.3s ease;
 *   `;
 *
 * The component stays mounted through the exit animation (default 300 ms)
 * before unmounting. Pass a different duration if your CSS transition is
 * slower. */
export function useTransitionState(open: boolean, durationMs = 300) {
  const [mounted, setMounted] = useState(false);
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      // Next frame so the initial `entered=false` styles paint before we
      // flip to `entered=true` — otherwise the transition is skipped.
      const raf = requestAnimationFrame(() => setEntered(true));
      return () => cancelAnimationFrame(raf);
    }
    setEntered(false);
    const t = setTimeout(() => setMounted(false), durationMs);
    return () => clearTimeout(t);
  }, [open, durationMs]);

  return { mounted, entered };
}
