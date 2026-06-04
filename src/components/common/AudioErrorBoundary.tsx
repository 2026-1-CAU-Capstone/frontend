import { Component, type ErrorInfo, type ReactNode } from 'react';
// Import the zero-dependency registry directly (not the `lib/player`
// barrel) so this app-root component never drags smplr into the startup
// chunk — mirrors why GlobalPlayerContext imports the lazy proxy directly.
import { stopAllAudio } from '../../lib/player/audioStopRegistry';

/* ─────────────────────────────────────────────────────────────────────────
 * AudioErrorBoundary — catches render/lifecycle crashes in the page tree
 * and cuts all audio immediately before showing a recovery screen.
 *
 * Without a boundary, a crash inside a page that is mid-playback leaves the
 * audio engine running with no UI left to stop it. Catching here lets us
 * call `stopAllAudio()` (the process-wide kill switch) the instant the tree
 * unwinds, so sound stops the moment the screen breaks.
 * ──────────────────────────────────────────────────────────────────── */

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

export class AudioErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kill sound first — this is the whole point of the boundary.
    stopAllAudio();
    console.error('[AudioErrorBoundary] caught render error:', error, info);
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          color: '#888',
          fontSize: 14,
          textAlign: 'center',
          padding: 24,
        }}
      >
        <div>문제가 발생해 화면을 다시 불러와야 합니다.</div>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            padding: '8px 18px',
            fontSize: 14,
            borderRadius: 8,
            border: '1px solid #2a6e3f',
            background: '#2a6e3f',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          다시 불러오기
        </button>
      </div>
    );
  }
}
