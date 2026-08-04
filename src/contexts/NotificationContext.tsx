/* Global toast notifications.
 *
 * App-wide, route-independent: mounted once at the app root so any page can
 * push a transient message that floats in the TOP-RIGHT corner regardless of
 * where the user navigates. Built because the app had no toast/snackbar
 * system — errors were shown only as in-page banners or window.alert().
 *
 * Usage:
 *   const { notify } = useNotification();
 *   notify({ kind: 'success', title: 'OMR 완료', message: '…', action: { label: '열기', onClick } });
 *
 * Durations: success/info auto-dismiss; error is sticky (stays until the user
 * closes it) so a failure can't scroll away unseen. Pass `durationMs` to
 * override (0 = sticky).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import styled, { keyframes } from 'styled-components';

export type NotificationKind = 'success' | 'error' | 'info';

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface NotificationInput {
  kind?: NotificationKind;           // default 'info'
  title: string;
  message?: string;
  /** ms before auto-dismiss. Omit → kind default. 0 → sticky. */
  durationMs?: number;
  action?: NotificationAction;
}

interface Notification extends NotificationInput {
  id: number;
  kind: NotificationKind;
}

interface NotificationApi {
  /** Push a toast; returns its id (use with `dismiss`). */
  notify: (input: NotificationInput) => number;
  dismiss: (id: number) => void;
}

const NotificationContext = createContext<NotificationApi | null>(null);

export function useNotification(): NotificationApi {
  const ctx = useContext(NotificationContext);
  if (!ctx) {
    throw new Error('useNotification must be used within <NotificationProvider>');
  }
  return ctx;
}

const DEFAULT_DURATION_MS: Record<NotificationKind, number> = {
  success: 6000,
  info: 5000,
  error: 0, // sticky
};

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Notification[]>([]);
  const idRef = useRef(0);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((n) => n.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const notify = useCallback(
    (input: NotificationInput): number => {
      const id = (idRef.current += 1);
      const kind = input.kind ?? 'info';
      const duration = input.durationMs ?? DEFAULT_DURATION_MS[kind];
      setItems((prev) => [...prev, { ...input, kind, id }]);
      if (duration > 0) {
        timers.current.set(id, setTimeout(() => dismiss(id), duration));
      }
      return id;
    },
    [dismiss],
  );

  // Clear any pending timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of map.values()) clearTimeout(t);
      map.clear();
    };
  }, []);

  const api = useMemo<NotificationApi>(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <NotificationContext.Provider value={api}>
      {children}
      <ToastViewport role="region" aria-label="알림">
        {items.map((n) => (
          <Toast key={n.id} $kind={n.kind}>
            <Accent $kind={n.kind} />
            <Body>
              <Title>{n.title}</Title>
              {n.message && <Message>{n.message}</Message>}
              {n.action && (
                <ActionButton
                  type="button"
                  $kind={n.kind}
                  onClick={() => {
                    n.action!.onClick();
                    dismiss(n.id);
                  }}
                >
                  {n.action.label}
                </ActionButton>
              )}
            </Body>
            <CloseButton type="button" onClick={() => dismiss(n.id)} aria-label="닫기">
              ×
            </CloseButton>
          </Toast>
        ))}
      </ToastViewport>
    </NotificationContext.Provider>
  );
}

/* ── styles ──────────────────────────────────────────────────────────── */

const slideIn = keyframes`
  from { opacity: 0; transform: translateX(16px); }
  to   { opacity: 1; transform: translateX(0); }
`;

// Above the OMR modal backdrop (z-index 500) but below the preview badge (9999).
const ToastViewport = styled.div`
  position: fixed;
  top: calc(env(safe-area-inset-top, 0px) + 16px);
  right: calc(env(safe-area-inset-right, 0px) + 16px);
  z-index: 650;
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: min(360px, calc(100vw - 32px));
  pointer-events: none;
`;

function accentColor(kind: NotificationKind, theme: { colors: Record<string, string> }): string {
  if (kind === 'success') return theme.colors.tonic;
  if (kind === 'error') return theme.colors.dominant;
  return theme.colors.gold;
}

const Toast = styled.div<{ $kind: NotificationKind }>`
  pointer-events: auto;
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px 12px 12px 16px;
  border-radius: 12px;
  background: ${({ theme }) => theme.colors.bgPrimary};
  box-shadow: ${({ theme }) => theme.shadows.xl};
  border: 1px solid ${({ theme }) => theme.colors.border};
  font-family: ${({ theme }) => theme.fonts.ui};
  animation: ${slideIn} 0.18s ease-out;
  overflow: hidden;
`;

const Accent = styled.div<{ $kind: NotificationKind }>`
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: ${({ $kind, theme }) => accentColor($kind, theme)};
`;

const Body = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
`;

const Title = styled.div`
  font-size: 14px;
  font-weight: 700;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

const Message = styled.div`
  font-size: 12.5px;
  line-height: 1.45;
  color: ${({ theme }) => theme.colors.textSecondary};
  word-break: keep-all;
`;

const ActionButton = styled.button<{ $kind: NotificationKind }>`
  align-self: flex-start;
  margin-top: 4px;
  border: none;
  border-radius: 999px;
  padding: 5px 12px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  color: #fff;
  background: ${({ $kind, theme }) => accentColor($kind, theme)};
`;

const CloseButton = styled.button`
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: ${({ theme }) => theme.colors.textSecondary};
  font-size: 18px;
  line-height: 1;
  padding: 0 2px;
  cursor: pointer;
`;
