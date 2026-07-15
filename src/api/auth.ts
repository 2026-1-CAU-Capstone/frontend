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

/* dev: Vite proxy(/api → jazzify.p-e.kr)를 거쳐 same-origin 으로 요청 →
 * RefreshToken HTTP-only 쿠키가 first-party 로 저장/전송된다.
 * prod: 빌드 결과는 절대 URL 로 백엔드를 직접 호출. */
import type { components } from './schema';

const API_BASE = import.meta.env.DEV ? '/api' : 'https://jazzify.p-e.kr/api';
const ACCESS_TOKEN_KEY = 'jazzify.auth.accessToken';
const USER_CACHE_KEY = 'jazzify.auth.userCache';

export interface AuthUser {
  publicId: string;
  username: string;
  name?: string;
  /** 사용자 등급 — GET /v1/auth/me 응답에서 채워진다 (예: 'ADMIN'/'USER').
   *  login 응답(TokenResponse)에는 없으므로 login() 직후 fetchMe()로 보강. */
  role?: string;
}

/** Admin 여부 — /v1/auth/me 의 등급(role)이 판별 기준. 백엔드가 아직 role을
 *  안 내려주는 동안은 아이디 'admin'을 임시 인정(role 배포 시 자동 대체). */
export function isAdminUser(user: AuthUser | null): boolean {
  if (!user) return false;
  if (user.role) return user.role.toUpperCase().includes('ADMIN');
  return user.username === 'admin';
}

// 타입 원천 = 생성 스키마(브릿지, BR-23 참조). 항상 오는 필드만 Required로 좁힘.
// (AuthUser는 TokenResponse + /me 를 합친 프론트 합성 타입이라 손글씨 유지.)
type TokenResponse = Required<components['schemas']['TokenResponse']>;
type SignUpResponse = Required<components['schemas']['SignUpResponse']>;

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
  scheduleProactiveRefresh(token);
}

/* ── proactive silent refresh ────────────────────────────────
 * Backend access tokens are short-lived; without this the user would hit a
 * 401 the moment a token expires mid-action. Decode the JWT's `exp` claim and
 * schedule a background refresh shortly before it dies — the next API call
 * sees a fresh token instead. As long as the refresh cookie is alive, the
 * session effectively never logs out on its own. */

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function decodeJwtExpMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    /* base64url → base64 padding for atob. */
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64)) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch { return null; }
}

function scheduleProactiveRefresh(token: string | null): void {
  if (refreshTimer) { clearTimeout(refreshTimer); refreshTimer = null; }
  if (!token || typeof window === 'undefined') return;
  const expMs = decodeJwtExpMs(token);
  if (!expMs) return;
  /* Fire 60s before expiry; clamp to a 5s minimum so we never busy-loop on an
   * already-expired token (authFetch's reactive path will pick it up). */
  const delay = Math.max(5_000, expMs - Date.now() - 60_000);
  refreshTimer = setTimeout(() => {
    refreshAccessToken().catch(() => { /* reactive authFetch path retries on next 401 */ });
  }, delay);
}

/* Resume the silent-refresh timer on module load — covers the case where a
 * persisted token already sits in localStorage from a previous tab session.
 * MUST live BELOW `let refreshTimer` + scheduleProactiveRefresh: it used to
 * sit above them, so the call hit the `let` in its temporal dead zone →
 * ReferenceError, silently swallowed by the catch — returning users got NO
 * proactive refresh until their first 401 (exactly what this exists to
 * prevent). The catch now logs so a regression can't hide again. */
if (typeof window !== 'undefined') {
  try { scheduleProactiveRefresh(window.localStorage.getItem(ACCESS_TOKEN_KEY)); }
  catch (e) { console.warn('[auth] proactive-refresh init failed:', e); }
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

/* ── user-scoped cache reset (account switch / logout / expiry) ──────────
 * SECURITY: chat list + chart-meta caches are keyed by NOTHING (single
 * localStorage entry), so without an explicit wipe at every auth transition
 * one account could flash the previous account's chats. We clear the keys
 * DIRECTLY here (works even on the login screen where no subscriber is
 * mounted) and also fire onAuthReset so a mounted RecentChatsList drops its
 * in-memory copy. */
const authResetListeners = new Set<() => void>();
export function onAuthReset(cb: () => void): () => void {
  authResetListeners.add(cb);
  return () => { authResetListeners.delete(cb); };
}
const USER_SCOPED_CACHE_KEYS = [
  'jazzify.chat.listCache',
  'jazzify.chat.chartMeta',
  // 프로젝트/업로드 목록 — 이전 계정의 차트 제목·업로드 항목이 다음 계정에 노출되던 키들
  'jazzify.myCharts.mock-v4',
  'jazzify.mySheets.uploaded.v1',
  // 사용자 저장 릭/솔로 미러
  'jazzify_user_licks',
  'jazzify_user_solos',
  // 에디터 초안 (이전 사용자의 작업 내용 노출 방지)
  'lickInput.draft.v1',
  'leadSheetGenerator.draft.v1',
];
/** localStorage prefixes wiped wholesale (per-song keys, unbounded set). */
const USER_SCOPED_CACHE_PREFIXES = ['jazzify.chartEdit.'];
function clearUserScopedCaches(): void {
  for (const k of USER_SCOPED_CACHE_KEYS) {
    try { window.localStorage.removeItem(k); } catch { /* private mode */ }
  }
  try {
    // Collect first, then remove — deleting while iterating shifts key indices.
    const doomed: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key && USER_SCOPED_CACHE_PREFIXES.some((p) => key.startsWith(p))) doomed.push(key);
    }
    doomed.forEach((k) => window.localStorage.removeItem(k));
  } catch { /* private mode */ }
  // IndexedDB: 업로드한 악보 원본 이미지 전체 삭제 — 비동기 best-effort
  // (auth 흐름을 IDB에 블록시키지 않음). dynamic import라 auth 모듈이
  // IDB 코드를 eager하게 끌고 오지도 않는다.
  void import('../lib/omrImageStore')
    .then((m) => m.clearAllOmrSourceImages())
    .catch(() => { /* best-effort */ });
  authResetListeners.forEach((cb) => { try { cb(); } catch { /* swallow */ } });
}

/* ── unauth → login redirect ─────────────────────────────── */

/** When an auth-required call definitively fails (refresh exhausted),
 *  log a clear diagnostic and bounce the user to the login screen. Uses
 *  hash navigation so it works with HashRouter without importing
 *  react-router. Skips the redirect when already on /login to avoid an
 *  endless reload loop. */
function redirectToLogin(reason: string): void {
  console.warn(`[Jazzify auth] ${reason} → /login`);
  if (typeof window === 'undefined') return;
  if (window.location.hash.startsWith('#/login')) return;
  window.location.hash = '#/login';
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
    /* ── 멀티탭 단일화 ──
     * proactive 타이머는 탭마다 독립적으로 걸리고 refreshInFlight는 탭 내부
     * 변수라, 같은 토큰을 가진 두 탭이 만료 60초 전 거의 동시에 refresh를
     * 쏘면 동일 refresh 쿠키가 중복 사용된다 — 백엔드가 RTR 재사용 감지를
     * 하면 세션 패밀리 전체 무효화(전 탭 강제 로그아웃)로 이어질 수 있다.
     * Web Locks로 탭 간 직렬화하고, 락 획득 후 다른 탭이 이미 갱신했으면
     * (localStorage의 exp가 미래) 네트워크 호출 없이 그 토큰을 재사용한다. */
    const doRefresh = async (): Promise<string> => {
      const current = getAccessToken();
      const exp = current ? decodeJwtExpMs(current) : null;
      if (exp && exp - Date.now() > 90_000) {
        // 다른 탭이 방금 갱신함 — 그대로 사용 + 내 타이머 재스케줄.
        scheduleProactiveRefresh(current);
        return current!;
      }
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
    };
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (locks?.request) {
      // LockManager.request의 제네릭이 콜백 반환을 Promise로 한 번 더 감싸도
      // await가 평탄화한다 — 타입만 명시적으로 풀어준다.
      return (await locks.request('jazzify.auth.refresh', doRefresh)) as string;
    }
    return doRefresh(); // Web Locks 미지원 브라우저 — 기존 동작
  })();
  try {
    return await refreshInFlight;
  } finally {
    refreshInFlight = null;
  }
}

/* 다른 탭이 토큰을 갱신/삭제하면 storage 이벤트로 통지된다 — 내 proactive
 * 타이머를 새 exp 기준으로 재스케줄하고, 로그아웃(null)이면 타이머를 멈춰
 * 잔여 타이머가 의미 없는 refresh를 쏘지 않게 한다. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== ACCESS_TOKEN_KEY) return;
    scheduleProactiveRefresh(e.newValue);
  });
}

/** Soft refresh for background loaders (no /login redirect on failure).
 *  fetchAllLicks류가 만료 토큰으로 즉시 폴백하지 않고 한 번 갱신을 시도할 수
 *  있게 한다. 실패 시 null — 호출부가 자체 폴백을 진행. */
export async function tryRefreshAccessToken(): Promise<string | null> {
  try { return await refreshAccessToken(); } catch { return null; }
}

/** Authenticated fetch — attaches Bearer token and refreshes once on 401.
 *  Other code can import this to call any protected endpoint. */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  // Resolve the URL. `input` may be:
  //   - absolute ('http…')                         → use as-is
  //   - already base-prefixed ('/api/v1/…' in dev) → use as-is (callers that
  //     build `${API_BASE}${path}` themselves) — DON'T re-prepend or we'd get
  //     a doubled '/api/api/…' that 500s through the dev proxy
  //   - a bare path ('/v1/…')                       → prepend API_BASE
  const isComplete =
    input.startsWith('http') || input === API_BASE || input.startsWith(`${API_BASE}/`);
  const url = isComplete ? input : `${API_BASE}${input}`;
  const token = getAccessToken();
  const headers = new Headers(init.headers);
  // JWT는 우리 API origin에만 부착 — 절대 URL이 다른 도메인이면(미래의 실수/
  // 서버가 내려준 URL 패스스루) 토큰이 외부로 새지 않게 한다.
  const sameOrigin = (() => {
    try {
      // dev의 API_BASE('/api')는 상대경로 — location.origin을 base로 해석해야
      // 비교가 성립한다 (안 그러면 new URL이 throw → dev 전체 토큰 미부착).
      const base = new URL(API_BASE, window.location.origin).origin;
      return new URL(url, window.location.origin).origin === base;
    } catch { return false; }
  })();
  if (token && sameOrigin) headers.set('Authorization', `Bearer ${token}`);
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
    // Refresh failed → drop auth state and send the user to /login. The
    // calling code still receives the original 401 response (so a caller
    // mid-stream can clean up its UI), but by the time it does, the URL is
    // already heading to the login page.
    setAccessToken(null);
    setCachedUser(null);
    notifyAuth(false, null);
    redirectToLogin('refresh failed — session expired or invalid');
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
  // A 502 (Bad Gateway) means the backend is down/unreachable, not a bad
  // credential — surface a clear "server problem" message in-place instead of a
  // raw "HTTP 502". The login UIs render thrown error messages in their form.
  if (res.status === 502) {
    throw new Error('서버에 문제가 생겼습니다. 잠시 후 다시 시도해 주세요.');
  }
  const data = await rawJson<TokenResponse>(res);
  setAccessToken(data.accessToken);
  const user: AuthUser = { publicId: data.publicId, username: data.username };
  setCachedUser(user);
  /* Drop the prior account's caches BEFORE notifying — covers "switch account
   * without logging out" (loggedIn stays true, so RecentChatsList's loggedIn
   * effect wouldn't otherwise re-run). onAuthReset makes it refetch for the
   * new user. */
  clearUserScopedCaches();
  notifyAuth(true, user);
  /* login 응답에는 role(등급)이 없다 — /v1/auth/me 로 백그라운드 보강.
   * fetchMe가 setCachedUser + notifyAuth 를 다시 호출하므로 role 을 쓰는
   * UI(admin 사이드바 등)는 도착 즉시 갱신된다. 실패해도 로그인은 유효. */
  fetchMe().catch(() => { /* 다음 bootstrapAuth 에서 재시도 */ });
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
  clearUserScopedCaches();
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
 *  (cleared). Either way the auth state ends up correct.
 *
 *  Important: any failure path here MUST clear the cached user and notify,
 *  otherwise a stale localStorage entry from a prior session keeps the UI
 *  rendering as "logged in" until the next protected API call surfaces a 401.
 *  Users have reported the exact symptom — looks logged in, then errors. */
export async function bootstrapAuth(): Promise<AuthUser | null> {
  // Even with no access token, the refresh cookie may still be valid.
  if (!getAccessToken()) {
    // Never-logged-in clients have no refresh cookie either, so calling
    // /v1/auth/refresh is guaranteed to 401 with USER_005 — pure noise on
    // every first visit. Skip the round-trip and resolve as logged-out.
    if (!getCachedUser()) {
      notifyAuth(false, null);
      return null;
    }
    try {
      await refreshAccessToken();
    } catch {
      // No valid session at all (no access token, refresh failed).
      // Wipe any cached user so the UI drops to logged-out immediately.
      setAccessToken(null);
      setCachedUser(null);
      clearUserScopedCaches();
      notifyAuth(false, null);
      return null;
    }
  }
  try {
    return await fetchMe();
  } catch {
    // /me failed even after authFetch's automatic refresh attempt.
    // authFetch already cleared state on a refresh-failure path, but be
    // defensive for the other /me failure modes (network, server 5xx, etc.)
    // — we'd rather show a logged-out UI than a stale logged-in one.
    setAccessToken(null);
    setCachedUser(null);
    clearUserScopedCaches();
    notifyAuth(false, null);
    return null;
  }
}
