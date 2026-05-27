import { createContext, useContext, type ReactNode } from 'react';

/* Where the transport bar lives — 'top' (web default) vs 'bottom' (native
 * app, score-column-anchored). Dropdowns inside the bar use this to decide
 * whether they open downward (top) or upward (bottom) so they don't fall
 * off the screen. */
export type PlayerBarPos = 'top' | 'bottom';

const Ctx = createContext<PlayerBarPos>('top');

export function PlayerBarPositionProvider({
  position,
  children,
}: { position: PlayerBarPos; children: ReactNode }) {
  return <Ctx.Provider value={position}>{children}</Ctx.Provider>;
}

export function usePlayerBarPosition(): PlayerBarPos {
  return useContext(Ctx);
}
