import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { getCachedUser, onAuthChange, type AuthUser } from '../../api/auth';
import { SettingsModal, type DisplaySetting } from './SettingsModal';

/**
 * A standalone gear button that opens the global SettingsModal. Drop it next
 * to a page's "분석 보기" toggle (chord/note pages). Tracks the cached auth
 * user so the modal's profile fields populate; falls back to a guest when
 * signed out. Pass `displaySettings` to surface page-specific display toggles
 * under the modal's 디스플레이 tab.
 */
export function SettingsGearButton({
  className,
  displaySettings,
}: {
  className?: string;
  displaySettings?: DisplaySetting[];
}) {
  const [user, setUser] = useState<AuthUser | null>(() => getCachedUser());
  const [open, setOpen] = useState(false);

  useEffect(() => onAuthChange((_, nextUser) => setUser(nextUser)), []);

  return (
    <>
      <GearBtn
        type="button"
        aria-label="설정"
        title="설정"
        className={className}
        onClick={() => setOpen(true)}
      >
        <CogIcon />
      </GearBtn>
      <SettingsModal
        open={open}
        user={user ?? { publicId: '', username: '게스트' }}
        onClose={() => setOpen(false)}
        displaySettings={displaySettings}
      />
    </>
  );
}

const CogIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const GearBtn = styled.button`
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  background: transparent;
  color: rgba(0, 0, 0, 0.5);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.12s, color 0.12s;
  &:hover { background: rgba(0, 0, 0, 0.06); color: #000; }
`;
