import { useState, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { AppPreviewProvider } from './contexts/AppPreviewContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { GlobalPlayerProvider } from './lib/player';
import { NativeBottomBar } from './components/native/NativeBottomBar';
import { AiChatSheet } from './components/native/AiChatSheet';
import HomePage from './pages/HomePage';
import { IntroScreen } from './components/common/IntroScreen';
import { AudioErrorBoundary } from './components/common/AudioErrorBoundary';
import { AudioLifecycleGuard } from './components/common/AudioLifecycleGuard';
import { ProtectedRoute } from './components/auth/ProtectedRoute';

/* Sheet-music tab pages — split out of the initial bundle so that vexflow
 * (~1.1 MB) and OSMD only load when the user navigates into a chord/note/
 * licks/solos screen. HomePage and /login stay free of the dependency. */
const ChordPage           = lazy(() => import('./pages/ChordPage'));
const NotePage            = lazy(() => import('./pages/NotePage'));
const LicksPage           = lazy(() => import('./pages/LicksPage'));
const SolosPage           = lazy(() => import('./pages/SolosPage'));

/* Secondary routes — code-split to keep the initial bundle small. */
const MyLicksPage         = lazy(() => import('./pages/MyLicksPage'));
const MyChordChartsPage   = lazy(() => import('./pages/MyChordChartsPage'));
const MySheetProjectsPage = lazy(() => import('./pages/MySheetProjectsPage'));
const Lick12KeyPage       = lazy(() => import('./pages/Lick12KeyPage'));
const InputPage           = lazy(() => import('./pages/InputPage'));
const EditorPage          = lazy(() => import('./pages/EditorPage'));
const YoutubeOnsetPage    = lazy(() => import('./pages/YoutubeOnsetPage'));
const StemSplitterPage    = lazy(() => import('./pages/StemSplitterPage'));
const IntroPage           = lazy(() => import('./pages/IntroPage'));
const LoginPage           = lazy(() => import('./pages/LoginPage'));
const SharedChartPage     = lazy(() => import('./pages/SharedChartPage'));
const UserProfilePage     = lazy(() => import('./pages/UserProfilePage'));

/* Recent-Chats(사이드바)에서 코드차트 → 코드차트로 이동하면 `/mychord` 라우트는
 * 그대로고 `?project=`(또는 `?song=`) 쿼리만 바뀐다. 같은 라우트라 React Router는
 * 기존 ChordPage를 리마운트하지 않는데, ChordPage는 project/chat을 마운트 시 1회만
 * 캡처하므로 쿼리만 바뀐 전환에선 새 차트·채팅이 로드되지 않는다. project/song id로
 * key를 주어 전환마다 강제 리마운트시킨다. */
function KeyedChordPage(props: { mychordMode?: boolean }) {
  const [sp] = useSearchParams();
  // `empty`(빈 시트로 시작)도 key에 포함 — empty ↔ 일반 차트 전환이 쿼리만
  // 바뀌는 전환이라 리마운트가 필요하긴 마찬가지다.
  const key = sp.get('project') ?? sp.get('song') ?? (sp.get('empty') === '1' ? 'empty' : 'default');
  return <ChordPage key={key} {...props} />;
}

function RouteFallback() {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      color: '#888', fontSize: 14,
    }}>
      Loading…
    </div>
  );
}

/* Per-tab session key — the splash plays on the FIRST page load of a browser
 * session (or app cold start) and then stays out of the way on every refresh
 * until the tab/app is closed. Use localStorage instead if you want it to
 * fire only on the very first ever visit, never again. */
const SPLASH_SHOWN_KEY = 'jazzify.splashShown';

function readSplashShown(): boolean {
  try { return window.sessionStorage.getItem(SPLASH_SHOWN_KEY) === '1'; }
  catch { return false; }
}

function markSplashShown(): void {
  try { window.sessionStorage.setItem(SPLASH_SHOWN_KEY, '1'); }
  catch { /* private mode */ }
}

export default function App() {
  /* The standalone /intro marketing page is its own self-contained landing —
     skip the saxophone splash there so it loads clean for first-time visitors. */
  const isIntroRoute = window.location.hash.startsWith('#/intro');
  const [showIntro, setShowIntro] = useState(() => !readSplashShown() && !isIntroRoute);

  const handleIntroDone = () => {
    markSplashShown();
    setShowIntro(false);
  };

  return (
    <>
      {showIntro && <IntroScreen onDone={handleIntroDone} />}
      <HashRouter>
        <NotificationProvider>
        <AppPreviewProvider>
        <GlobalPlayerProvider>
        <AudioLifecycleGuard />
        <AudioErrorBoundary>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          {/* Gated routes — require an authenticated user. Direct URL access
           * (deep-link, refresh, share) without a session redirects to /login,
           * passing the original location so the user lands back here after
           * signing in. */}
          <Route path="/chord" element={<ProtectedRoute><ChordPage /></ProtectedRoute>} />
          <Route path="/mychord" element={<ProtectedRoute><KeyedChordPage mychordMode /></ProtectedRoute>} />
          <Route path="/note" element={<ProtectedRoute><NotePage /></ProtectedRoute>} />
          <Route path="/licks" element={<ProtectedRoute><LicksPage /></ProtectedRoute>} />
          <Route path="/solos" element={<ProtectedRoute><SolosPage /></ProtectedRoute>} />
          <Route path="/input" element={<ProtectedRoute><InputPage /></ProtectedRoute>} />
          <Route path="/youtube-onset" element={<ProtectedRoute><YoutubeOnsetPage /></ProtectedRoute>} />
          <Route path="/stems" element={<ProtectedRoute><StemSplitterPage /></ProtectedRoute>} />
          <Route path="/my-licks" element={<ProtectedRoute><MyLicksPage /></ProtectedRoute>} />
          <Route path="/my-charts" element={<ProtectedRoute><MyChordChartsPage /></ProtectedRoute>} />
          <Route path="/my-sheets" element={<ProtectedRoute><MySheetProjectsPage /></ProtectedRoute>} />
          <Route path="/lick-practice/:id" element={<ProtectedRoute><Lick12KeyPage /></ProtectedRoute>} />
          <Route path="/editor" element={<ProtectedRoute><EditorPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><UserProfilePage /></ProtectedRoute>} />
          <Route path="/login" element={<LoginPage />} />
          {/* Public shared-chart viewer — chart data rides in the URL hash
              (#/v?d=…), so anyone with the link can view it read-only without
              logging in. No ProtectedRoute. */}
          <Route path="/v" element={<SharedChartPage />} />
          {/* Standalone public marketing page — not linked from any in-app
              navigation. Reachable only via the direct URL (#/intro). */}
          <Route path="/intro" element={<IntroPage />} />
          {/* /preview/* — browser-side design preview of app-only screens.
              AppPreviewProvider at the app root flips when pathname starts
              with /preview, so isNativeUi/isNativeLandscape pick it up
              globally (including the bottom tab bar). */}
          <Route path="/preview/chord" element={<ChordPage />} />
          <Route path="/preview/mychord" element={<KeyedChordPage mychordMode />} />
          <Route path="/preview/note" element={<NotePage />} />
          {/* 새 네이티브 홈(F14.8) 프리뷰 — 설치 없이 브라우저/폰 사파리로 검수 */}
          <Route path="/preview/home" element={<HomePage />} />
          <Route path="/preview" element={<Navigate to="/preview/home" replace />} />
          {/* Legacy routes — SoloGeneratorPage & LickInputPage merged into
              the unified EditorPage (mode=solo|lick). Keep redirects so old
              bookmarks / external links still land in the right place. */}
          <Route path="/note/sologenerator" element={<Navigate to="/editor?mode=solo" replace />} />
          <Route path="/lick-input" element={<Navigate to="/editor?mode=lick" replace />} />
        </Routes>
        </Suspense>
        </AudioErrorBoundary>
        {/* Native-only bottom bar (검색 · AI에게 질문하기 · +) — 기존 5탭
         *  BottomTabBar 전면 대체. No-ops on web; the component reads
         *  useIsNativeUi() which is also true under /preview/*. */}
        <NativeBottomBar />
        {/* AI 채팅 풀하이트 시트 — 하단 바와 달리 라우트 숨김 없이 상주해
         *  채팅 중 페이지 이동에도 대화가 유지된다. 라우트 트리의
         *  AudioErrorBoundary 밖에 있어 자체 바운더리 없이는 렌더 크래시가
         *  앱 전체를 흰 화면으로 날렸다 — 여기서 따로 감싼다. */}
        <AudioErrorBoundary>
          <AiChatSheet />
        </AudioErrorBoundary>
        </GlobalPlayerProvider>
        </AppPreviewProvider>
        </NotificationProvider>
      </HashRouter>
    </>
  );
}
