import { useEffect, useState } from 'react';
import styled from 'styled-components';
import { getCachedUser, onAuthChange, isAdminUser, type AuthUser } from '../../api/auth';

/* 관리자 전용 개발 표시 — dev proxy(/api)가 지금 어느 백엔드를 보는지 좌상단에
 * 네모로 띄운다.
 *   npm run dev        → 백엔드: 실제 운영서버 (https://jazzify.p-e.kr)
 *   npm run dev:local  → 백엔드: 로컬 서버 (http://localhost:8080)
 * 대상값은 vite.config 의 define(import.meta.env.VITE_API_TARGET)로 주입된다.
 * DEV 모드 + admin 계정에서만 렌더된다(프로덕션 빌드/일반 유저엔 안 보임). */
export function BackendBadge() {
  const [authUser, setAuthUser] = useState<AuthUser | null>(() => getCachedUser());
  useEffect(() => onAuthChange((loggedIn, user) => setAuthUser(loggedIn ? user : null)), []);

  if (!import.meta.env.DEV) return null;
  if (!isAdminUser(authUser)) return null;

  const target = (import.meta.env.VITE_API_TARGET as string | undefined) ?? '';
  const isLocal = /localhost|127\.0\.0\.1/.test(target);

  return (
    <Box $local={isLocal} title={`dev proxy: /api → ${target}`}>
      백엔드: {isLocal ? '로컬 서버' : '실제 운영서버'}
    </Box>
  );
}

const Box = styled.div<{ $local: boolean }>`
  position: fixed;
  top: 8px;
  left: 8px;
  z-index: 7000;
  padding: 4px 9px;
  border-radius: 5px;
  font: 600 11px/1.2 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
  letter-spacing: 0.01em;
  color: #fff;
  background: ${({ $local }) => ($local ? '#1f7a4d' : '#c0392b')};
  border: 1px solid rgba(0, 0, 0, 0.18);
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
  user-select: none;
  pointer-events: none;
`;
