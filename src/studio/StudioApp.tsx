import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '../AppShell';
import { AdminRoute } from '../components/auth/AdminRoute';
import { BackendBadge } from '../components/layout/BackendBadge';
import StudioHome from './pages/StudioHome';

/* ─────────────────────────────────────────────────────────────────────────
 * StudioApp — 내부 제작 스튜디오의 진입 컴포넌트.
 *
 * 실서비스(App.tsx)와 **같은 껍데기(AppShell)** 를 쓰고 라우트만 다르다.
 * 여기서 두 번들이 갈린다 — 이 파일이 import 하지 않는 페이지는 스튜디오
 * 번들에 없고, App.tsx 가 import 하지 않는 스튜디오 페이지는 실서비스 번들에
 * 없다. 그게 "어드민 코드가 공개 번들에 한 글자도 없다"의 근거다.
 *
 * 모든 라우트가 AdminRoute 다. 실서비스에서 `/licks`·`/solos`·`/editor`·
 * `/input` 은 ProtectedRoute(로그인만) 인데 여기서는 admin 을 요구한다 —
 * **같은 페이지, 다른 권한**. 이게 "이관이 아니라 복제"의 실제 모습이다.
 * ──────────────────────────────────────────────────────────────────────── */

/* 분석 워크벤치 — ChordPage 는 실서비스의 /mychord 와 공유한다. */
const ChordPage        = lazy(() => import('../pages/ChordPage'));
const NotePage         = lazy(() => import('./pages/NotePage'));
/* 데이터 구축 — 실서비스에도 있는 페이지를 admin 권한으로 다시 태운다. */
const LicksPage        = lazy(() => import('../pages/LicksPage'));
const SolosPage        = lazy(() => import('../pages/SolosPage'));
const EditorPage       = lazy(() => import('../pages/EditorPage'));
const InputPage        = lazy(() => import('../pages/InputPage'));
const CompingPage      = lazy(() => import('./pages/CompingPage'));
/* 파이프라인 */
const YoutubeOnsetPage = lazy(() => import('./pages/YoutubeOnsetPage'));
const LickOnsetPage    = lazy(() => import('./pages/LickOnsetPage'));
const OmrAdminPage     = lazy(() => import('./pages/OmrAdminPage'));
const RagAdminPage     = lazy(() => import('./pages/RagAdminPage'));
/* 로그인 화면은 공유 — 스튜디오도 같은 계정 체계를 쓴다. */
const LoginPage        = lazy(() => import('../pages/LoginPage'));

export default function StudioApp() {
  return (
    <>
      <BackendBadge />
      <AppShell
        routes={
          <Routes>
            <Route path="/" element={<AdminRoute><StudioHome /></AdminRoute>} />

            <Route path="/chord" element={<AdminRoute><ChordPage /></AdminRoute>} />
            <Route path="/note" element={<AdminRoute><NotePage /></AdminRoute>} />

            <Route path="/licks" element={<AdminRoute><LicksPage /></AdminRoute>} />
            <Route path="/solos" element={<AdminRoute><SolosPage /></AdminRoute>} />
            <Route path="/comping" element={<AdminRoute><CompingPage /></AdminRoute>} />
            <Route path="/editor" element={<AdminRoute><EditorPage /></AdminRoute>} />

            <Route path="/youtube-onset" element={<AdminRoute><YoutubeOnsetPage /></AdminRoute>} />
            <Route path="/lickonset" element={<AdminRoute><LickOnsetPage /></AdminRoute>} />
            <Route path="/input" element={<AdminRoute><InputPage /></AdminRoute>} />
            <Route path="/admin/omr" element={<AdminRoute><OmrAdminPage /></AdminRoute>} />
            <Route path="/admin/rag" element={<AdminRoute><RagAdminPage /></AdminRoute>} />

            <Route path="/login" element={<LoginPage />} />

            {/* 실서비스 라우트로 들어온 링크(북마크·이전 주소)는 홈으로 되돌린다.
                스튜디오에는 그 화면이 없다. */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        }
      />
    </>
  );
}
