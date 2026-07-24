import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getCachedUser, onAuthChange, isAdminUser, type AuthUser } from '../../api/auth';

/* ─────────────────────────────────────────────────────────────────────────
 * AdminRoute — ProtectedRoute + admin 등급 검사. 비로그인은 /login 으로,
 * 로그인했지만 비관리자면 홈(/)으로 되돌린다.
 *
 * 주의: role 은 login 응답엔 없고 fetchMe(GET /v1/auth/me) 이후 채워지므로,
 * 초기 렌더에서 isAdminUser 가 잠깐 false 일 수 있다(username==='admin' 폴백은
 * 즉시 통과). onAuthChange 구독이 role 도착 시 재평가한다. 그래서 아직 유저 캐시
 * 자체가 없을 때만(=미로그인 확정) 튕기고, 로그인은 됐는데 role 미도착이면 잠깐
 * 기다리지 않고 홈으로 보내면 admin 도 깜빡 튕기므로 — 로그인 상태면 role 판정을
 * onAuthChange 로 계속 지켜본다.
 * ──────────────────────────────────────────────────────────────────────── */

export function AdminRoute({ children }: { children: ReactElement }) {
  const location = useLocation();
  const [user, setUser] = useState<AuthUser | null>(() => getCachedUser());

  useEffect(() => {
    return onAuthChange((isIn, u) => setUser(isIn ? u : null));
  }, []);

  // 미로그인(캐시 유저 없음) → 로그인 페이지, 원위치 보존.
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  // 로그인했으나 비관리자 → 홈. (role 미도착이어도 username==='admin' 폴백은 통과)
  if (!isAdminUser(user)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
