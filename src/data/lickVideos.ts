/**
 * 릭 ID → 원본 영상 매핑 (프론트엔드 전용 테스트).
 * 추후 백엔드로 이전할 수 있음.
 *
 * Key: lick id (frontend = number, backend = publicId string).
 */

export interface LickVideo {
  videoId: string;   // YouTube video id (e.g. "MV8wWjVqCng")
  startSec: number;  // 시작 시각 (초)
}

export const LICK_VIDEOS: Record<string | number, LickVideo> = {
  // Rusty Bryant — That Old Black Magic (lick id 2) → 2:17
  2: { videoId: 'MV8wWjVqCng', startSec: 137 },
};
