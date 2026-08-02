/* YouTube IFrame Player API — shared global typing.
 *
 * Two components (YoutubeEmbed for playback, YoutubeOnsetParser for admin
 * tagging) talk to the same `window.YT` global, so we declare it once here
 * to avoid the "Subsequent property declarations must have the same type"
 * error TS produces when each file redeclares it. */

declare global {
  interface YTPlayer {
    getCurrentTime(): number;
    getDuration(): number;
    getPlayerState(): -1 | 0 | 1 | 2 | 3 | 5;
    pauseVideo(): void;
    playVideo(): void;
    seekTo(sec: number, allowSeekAhead?: boolean): void;
    setPlaybackRate(rate: number): void;
    getPlaybackRate(): number;
    getAvailablePlaybackRates(): number[];
    destroy(): void;
  }

  interface YTPlayerOpts {
    videoId: string;
    width?: number | string;
    height?: number | string;
    playerVars?: Record<string, string | number>;
    events?: {
      onReady?: (e: { target: YTPlayer }) => void;
      onStateChange?: (e: { data: number; target: YTPlayer }) => void;
    };
  }

  interface YTConstructor {
    new (el: HTMLElement | string, opts: YTPlayerOpts): YTPlayer;
  }

  interface YTNamespace {
    Player: YTConstructor;
    PlayerState: { PLAYING: number };
    loaded?: number;
  }

  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

export {};
