import { useEffect, useState, type ReactElement } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { getCachedUser, onAuthChange } from '../../api/auth';

/* ─────────────────────────────────────────────────────────────────────────
 * ProtectedRoute — wraps a route element and redirects to /login when the
 * user isn't authenticated. Subscribes to onAuthChange so a logout that
 * happens while the user sits on a gated page kicks them out immediately.
 * The current location is passed as state so /login can route the user
 * back here after a successful sign-in.
 * ──────────────────────────────────────────────────────────────────────── */

export function ProtectedRoute({ children }: { children: ReactElement }) {
  const location = useLocation();
  const [loggedIn, setLoggedIn] = useState<boolean>(() => !!getCachedUser());

  useEffect(() => {
    return onAuthChange((isIn) => setLoggedIn(isIn));
  }, []);

  if (!loggedIn) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}
