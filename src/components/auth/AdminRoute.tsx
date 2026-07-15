import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getCachedUser, isAdminUser, onAuthChange } from '../../api/auth';

/* ─────────────────────────────────────────────────────────────────────────
 * AdminRoute — like ProtectedRoute, but additionally requires the signed-in
 * user to be an admin (isAdminUser). Non-admins are redirected home; logged-
 * out users are sent to /login (carrying the location so they return here).
 * Subscribes to onAuthChange so a logout/downgrade mid-session kicks them out.
 * ──────────────────────────────────────────────────────────────────────── */

export function AdminRoute({ children }: { children: ReactElement }) {
  const location = useLocation();
  const [user, setUser] = useState(() => getCachedUser());

  useEffect(() => onAuthChange((_in, u) => setUser(u)), []);

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (!isAdminUser(user)) {
    return <Navigate to="/" replace />;
  }
  return children;
}
