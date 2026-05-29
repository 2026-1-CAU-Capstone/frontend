import { useState, lazy, Suspense } from 'react';
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppPreviewProvider } from './contexts/AppPreviewContext';
import { GlobalPlayerProvider } from './lib/player';
import { BottomTabBar } from './components/layout/BottomTabBar';
import HomePage from './pages/HomePage';
import ChordPage from './pages/ChordPage';
import NotePage from './pages/NotePage';
import LicksPage from './pages/LicksPage';
import SolosPage from './pages/SolosPage';
import { IntroScreen } from './components/common/IntroScreen';

/* Secondary routes — code-split to keep the initial bundle small. The five
 * bottom-tab pages above stay eagerly imported because they render on first
 * paint or are one tap away. Everything else is reached less frequently and
 * can afford a brief async load. */
const MyLicksPage         = lazy(() => import('./pages/MyLicksPage'));
const MyChordChartsPage   = lazy(() => import('./pages/MyChordChartsPage'));
const MySheetProjectsPage = lazy(() => import('./pages/MySheetProjectsPage'));
const Lick12KeyPage       = lazy(() => import('./pages/Lick12KeyPage'));
const InputPage           = lazy(() => import('./pages/InputPage'));
const StyPocPage          = lazy(() => import('./pages/StyPocPage'));
const StyDemoPage         = lazy(() => import('./pages/StyDemoPage'));
const EditorPage          = lazy(() => import('./pages/EditorPage'));
const YoutubeOnsetPage    = lazy(() => import('./pages/YoutubeOnsetPage'));
const IntroPage           = lazy(() => import('./pages/IntroPage'));
const LoginPage           = lazy(() => import('./pages/LoginPage'));

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
        <AppPreviewProvider>
        <GlobalPlayerProvider>
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/chord" element={<ChordPage />} />
          <Route path="/mychord" element={<ChordPage mychordMode />} />
          <Route path="/note" element={<NotePage />} />
          <Route path="/licks" element={<LicksPage />} />
          <Route path="/solos" element={<SolosPage />} />
          <Route path="/input" element={<InputPage />} />
          <Route path="/youtube-onset" element={<YoutubeOnsetPage />} />
          <Route path="/my-licks" element={<MyLicksPage />} />
          <Route path="/my-charts" element={<MyChordChartsPage />} />
          <Route path="/my-sheets" element={<MySheetProjectsPage />} />
          <Route path="/lick-practice/:id" element={<Lick12KeyPage />} />
          <Route path="/sty-poc" element={<StyPocPage />} />
          <Route path="/sty-demo" element={<StyDemoPage />} />
          <Route path="/editor" element={<EditorPage />} />
          <Route path="/login" element={<LoginPage />} />
          {/* Standalone public marketing page — not linked from any in-app
              navigation. Reachable only via the direct URL (#/intro). */}
          <Route path="/intro" element={<IntroPage />} />
          {/* /preview/* — browser-side design preview of app-only screens.
              AppPreviewProvider at the app root flips when pathname starts
              with /preview, so isNativeUi/isNativeLandscape pick it up
              globally (including the bottom tab bar). */}
          <Route path="/preview/chord" element={<ChordPage />} />
          <Route path="/preview/mychord" element={<ChordPage mychordMode />} />
          <Route path="/preview/note" element={<NotePage />} />
          <Route path="/preview" element={<Navigate to="/preview/chord" replace />} />
          {/* Legacy routes — SoloGeneratorPage & LickInputPage merged into
              the unified EditorPage (mode=solo|lick). Keep redirects so old
              bookmarks / external links still land in the right place. */}
          <Route path="/note/sologenerator" element={<Navigate to="/editor?mode=solo" replace />} />
          <Route path="/lick-input" element={<Navigate to="/editor?mode=lick" replace />} />
        </Routes>
        </Suspense>
        {/* Native-only 5-tab bottom navigation. No-ops on web; the component
         *  reads useIsNativeUi() which is also true under /preview/*. */}
        <BottomTabBar />
        </GlobalPlayerProvider>
        </AppPreviewProvider>
      </HashRouter>
    </>
  );
}
