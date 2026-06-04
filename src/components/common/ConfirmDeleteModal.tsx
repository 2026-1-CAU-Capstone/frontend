/* Shared confirm-delete modal — one design + one interaction model reused
 * wherever the app deletes a user resource (chat sessions, chord charts, …).
 *
 * Behaviour: the danger button stays dimmed + disabled (and shows `busyLabel`)
 * from the moment it's pressed until `onConfirm` fully resolves, so the user
 * can't double-fire a delete or dismiss mid-request. The caller closes the
 * modal (open=false) in its own onConfirm on success; on failure it may leave
 * it open (busy auto-resets) to allow a retry.
 */
import { useState, type ReactNode } from 'react';
import styled from 'styled-components';

interface Props {
  open: boolean;
  title: string;
  body: ReactNode;
  confirmLabel?: string;   // default '삭제'
  busyLabel?: string;      // default '삭제 중…'
  cancelLabel?: string;    // default 'Cancel'
  /** Awaited; buttons stay disabled+dimmed until it settles. */
  onConfirm: () => Promise<void> | void;
  onCancel: () => void;
}

export function ConfirmDeleteModal({
  open,
  title,
  body,
  confirmLabel = '삭제',
  busyLabel = '삭제 중…',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
}: Props) {
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalBackdrop onClick={() => { if (!busy) onCancel(); }}>
      <ModalCard onClick={(e) => e.stopPropagation()}>
        <ModalTitle>{title}</ModalTitle>
        <ModalBody>{body}</ModalBody>
        <ModalActions>
          <ModalBtn $variant="ghost" type="button" disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </ModalBtn>
          <ModalBtn
            $variant="danger"
            type="button"
            disabled={busy}
            onClick={() => void handleConfirm()}
          >
            {busy ? busyLabel : confirmLabel}
          </ModalBtn>
        </ModalActions>
      </ModalCard>
    </ModalBackdrop>
  );
}

/* ── styles (kept identical to the original chat-delete modal) ─────────── */

const ModalBackdrop = styled.div`
  position: fixed;
  inset: 0;
  z-index: 1100;
  background: rgba(20, 20, 20, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
`;
const ModalCard = styled.div`
  background: #fff;
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.24);
  padding: 22px 24px 18px;
  width: 100%;
  max-width: 420px;
  font-family: ${({ theme }) => theme.fonts.ui};
`;
const ModalTitle = styled.h2`
  margin: 0 0 6px;
  font-size: 19px;
  font-weight: 800;
  color: #1a1a1a;
  letter-spacing: -0.01em;
`;
const ModalBody = styled.p`
  margin: 0 0 18px;
  font-size: 14px;
  color: rgba(0, 0, 0, 0.55);
`;
const ModalActions = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 8px;
`;
const ModalBtn = styled.button<{ $variant?: 'ghost' | 'danger' }>`
  border: 1px solid ${({ $variant }) => ($variant === 'danger' ? 'transparent' : 'rgba(0, 0, 0, 0.12)')};
  border-radius: 10px;
  padding: 9px 18px;
  font-family: inherit;
  font-size: 14.5px;
  font-weight: 700;
  cursor: pointer;
  background: ${({ $variant }) => ($variant === 'danger' ? '#d44a3a' : '#fff')};
  color: ${({ $variant }) => ($variant === 'danger' ? '#fff' : '#1a1a1a')};
  transition: background 0.12s, opacity 0.12s;
  &:hover:not(:disabled) { opacity: 0.92; }
  &:disabled { opacity: 0.5; cursor: not-allowed; }
`;
