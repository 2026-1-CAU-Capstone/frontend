/* Jazzify backend auth — wraps /v1/auth/{signup,login,logout,refresh,me}.
 *
 * Design notes:
 *   - Backend issues a short-lived AccessToken (body) + a long-lived
 *     RefreshToken (HTTP-only cookie). We persist the access token in
 *     localStorage and attach it as `Authorization: Bearer …` on every
 *     authenticated call.
 *   - All requests pass `credentials: 'include'` so the browser/WebView
 *     stores & sends the RefreshToken cookie cross-origin.
 *   - `authFetch()` transparently calls /v1/auth/refresh once on a 401 and
 *     retries the original request with the new access token — implements
 *     the RTR (Refresh Token Rotation) pattern the backend advertises.
 *   - On final auth failure it clears the cached token and notifies any
 *     subscribers via `onAuthChange` so the UI can drop back to logged-out. */

const API_BASE = 'https://jazzify.p-e.kr/api';
const ACCESS_TOKEN_KEY = 'jazzify.auth.accessToken';
const USER_CACHE_KEY = 'jazzify.auth.userCache';

export interface AuthUser {
  publicId: string;
  username: string;
  name?: string;
}

interface TokenResponse {
  accessToken: string;
  publicId: string;
  username: string;
}

interface SignUpResponse {
  publicId: string;
  name: string;
  username: string;
}

interface ApiEnvelope<T> { data: T }
interface ApiError { code: string; message: string; detail?: string }

/* ── token storage ───────────────────────────────────────── */

export function getAccessToken(): string | null {
  try { return window.localStorage.getItem(ACCESS_TOKEN_KEY); } catch { return null; }
}
function setAccessToken(token: string | null) {
  try {
    if (token) window.localStorage.setItem(ACCESS_TOKEN_KEY, token);
    else window.localStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch { /* private mode */ }
}

export function getCachedUser(): AuthUser | null {
  try {
    const raw = window.localStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch { return null; }
}
function setCachedUser(user: AuthUser | null) {
  try {
    if (user) window.localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
    else window.localStorage.removeItem(USER_CACHE_KEY);
  } catch { /* noop */ }
}

/* ── pub/sub for auth state changes ─────────────────────── */

type AuthListener = (loggedIn: boolean, user: AuthUser | null) => void;
const listeners = new Set<AuthListener>();
export function onAuthChange(cb: AuthListener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function notifyAuth(loggedIn: boolean, user: AuthUser | null) {
  listeners.forEach((cb) => { try { cb(loggedIn, user); } catch { /* swallow */ } });
}

/* ── low-level fetch with bearer + auto-refresh on 401 ──── */

async function rawJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let err: ApiError | undefined;
    try { err = JSON.parse(text) as ApiError; } catch { /* not json */ }
    const msg = err?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  const json = text ? JSON.parse(text) : {};
  return (json as ApiEnvelope<T>).data ?? (json as T);
}

let refreshInFlight: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const res = await fetch(`${API_BASE}/v1/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) throw new Error('refresh failed');
    const data = await rawJson<TokenResponse>(res);
    setAccessToken(data.accessToken);
    const user: AuthUser = { publicId: data.publicId, username: data.username };
    setCachedUser({ ...(getCachedUser() ?? {} as AuthUser), ...user });
    return data.accessToken;
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/** Authenticated fetch — attaches Bearer token and refreshes once on 401.
 *  Other code can import this to call any protected endpoint. */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const url = input.startsWith('http') ? input : `${API_BASE}${input}`;
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const opts: RequestInit = { ...init, headers, credentials: 'include' };
  let res = await fetch(url, opts);
  if (res.status !== 401) return res;
  // Try one refresh + retry.
  try {
    const fresh = await refreshAccessToken();
    headers.set('Authorization', `Bearer ${fresh}`);
    res = await fetch(url, { ...opts, headers });
    return res;
  } catch {
    // Refresh failed → drop auth state.
    setAccessToken(null);
    setCachedUser(null);
    notifyAuth(false, null);
    return res;
  }
}

/* ── public auth surface ─────────────────────────────────── */

export async function signup(name: string, username: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/v1/auth/signup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name, username, password }),
  });
  const data = await rawJson<SignUpResponse>(res);
  const user: AuthUser = { publicId: data.publicId, username: data.username, name: data.name };
  // Backend signup endpoint returns user info but no token. The spec says
  // login flow is separate, so we immediately call login to get tokens.
  await login(username, password);
  return user;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const res = await fetch(`${API_BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  });
  const data = await rawJson<TokenResponse>(res);
  setAccessToken(data.accessToken);
  const user: AuthUser = { publicId: data.publicId, username: data.username };
  setCachedUser(user);
  notifyAuth(true, user);
  return user;
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_BASE}/v1/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: getAccessToken() ? { Authorization: `Bearer ${getAccessToken()!}` } : undefined,
    });
  } catch { /* best-effort */ }
  setAccessToken(null);
  setCachedUser(null);
  notifyAuth(false, null);
}

export async function fetchMe(): Promise<AuthUser> {
  const res = await authFetch('/v1/auth/me');
  const data = await rawJson<AuthUser>(res);
  setCachedUser(data);
  notifyAuth(true, data);
  return data;
}

/** Check session at app start. If we have a stale access token, /me will
 *  401 → authFetch tries refresh → either succeeds (logged in) or fails
 *  (cleared). Either way the auth state ends up correct. */
export async function bootstrapAuth(): Promise<AuthUser | null> {
  // Even with no access token, the refresh cookie may still be valid.
  if (!getAccessToken()) {
    try { await refreshAccessToken(); } catch { return null; }
  }
  try {
    return await fetchMe();
  } catch {
    return null;
  }
}
