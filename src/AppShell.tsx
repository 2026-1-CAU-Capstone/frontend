import { Suspense, type ReactNode } from 'react';
import { HashRouter } from 'react-router-dom';
import { AppPreviewProvider } from './contexts/AppPreviewContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { UploadQueueProvider } from './contexts/UploadQueueContext';
import { UploadQueueDock } from './components/common/UploadQueueDock';
import { GlobalPlayerProvider } from './lib/player';
import { AudioErrorBoundary } from './components/common/AudioErrorBoundary';
import { AudioLifecycleGuard } from './components/common/AudioLifecycleGuard';
import { GlobalSettingsModal } from './components/auth/GlobalSettingsModal';

/* ─────────────────────────────────────────────────────────────────────────
 * AppShell — 실서비스와 스튜디오가 **공유하는** 껍데기.
 *
 * 라우터·프로바이더 스택·오디오 수명주기·업로드 큐·설정 모달은 두 앱이 똑같이
 * 필요하다. 각자 적어두면 한쪽에 프로바이더를 추가할 때 다른 쪽을 빼먹어 조용히
 * 갈라진다 — 그래서 한 곳에 둔다.
 *
 * 다른 점은 `routes` 와 `extras` 로만 들어온다:
 *   routes — 각 앱의 <Routes> (여기서 두 번들이 갈린다)
 *   extras — 앱에만 있는 전역 UI(네이티브 하단바·AI 시트·Admin 독 등)
 * ──────────────────────────────────────────────────────────────────────── */

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

export function AppShell({ routes, extras }: { routes: ReactNode; extras?: ReactNode }) {
  return (
    <HashRouter>
      <NotificationProvider>
      <AppPreviewProvider>
      <GlobalPlayerProvider>
      {/* 업로드(자동 인식) 큐 — 라우트보다 위에 두어야 페이지를 옮겨도
          백그라운드 분석이 계속된다. 진행 상황은 우측 상단 독에 뜬다. */}
      <UploadQueueProvider>
      <AudioLifecycleGuard />
      <AudioErrorBoundary>
      <UploadQueueDock />
      {/* 전체 설정 모달 — 라우트 위에 상주해야 사이드바가 없는
          네이티브 UI 에서도 열린다(settingsBus 로 요청). */}
      <GlobalSettingsModal />
      <Suspense fallback={<RouteFallback />}>
        {routes}
      </Suspense>
      </AudioErrorBoundary>
      {extras}
      </UploadQueueProvider>
      </GlobalPlayerProvider>
      </AppPreviewProvider>
      </NotificationProvider>
    </HashRouter>
  );
}
