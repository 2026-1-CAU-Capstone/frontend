import { useEffect, useState } from 'react';
import { SettingsModal } from './SettingsModal';
import { getCachedUser, onAuthChange, type AuthUser } from '../../api/auth';
import { onSettingsRequest, type SettingsRequest } from '../../lib/settingsBus';

/* 앱에 하나만 상주하는 설정 모달.
 *
 * 예전엔 UserMenu 안에 있었는데, UserMenu 는 사이드바(IconSidebar) 안에 있고
 * 사이드바는 네이티브 UI 에서 렌더되지 않는다 — 그 모드에선 설정을 열 방법이
 * 아예 없었다. 라우터 위로 올려 어느 화면에서든 settingsBus 로 열 수 있게 한다. */
export function GlobalSettingsModal() {
  /* seq 는 "같은 섹션을 다시 요청"해도 모달이 새 위치에서 열리도록 key 를
   * 갈아끼우는 용도다(모달은 마운트 시점에 시작 탭/섹션을 확정한다). */
  const [req, setReq] = useState<{ value: SettingsRequest; seq: number } | null>(null);
  const [user, setUser] = useState<AuthUser | null>(() => getCachedUser());

  useEffect(() => onAuthChange((_, u) => setUser(u ?? getCachedUser())), []);
  useEffect(() => onSettingsRequest((r) => {
    setReq((prev) => ({ value: r, seq: (prev?.seq ?? 0) + 1 }));
  }), []);

  /* 로그아웃 상태에서는 프로필 정보를 그릴 수 없다. 설정을 여는 화면들은 모두
   * 로그인 전용이라 실제로 걸릴 일은 없지만, 열려 있는 채 세션이 끊기면 닫는다. */
  if (!req || !user) return null;

  return (
    <SettingsModal
      key={req.seq}
      open
      user={user}
      onClose={() => setReq(null)}
      initialTab={req.value.tab}
      initialSection={req.value.section}
    />
  );
}
