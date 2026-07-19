import { formatCourseDuration, type CourseProgress } from '../types/course';

export const COURSE_PLAYBACK_RATES = [1, 1.25, 1.5, 2, 0.75] as const;

export type CoursePlaybackState = 'idle' | 'playing' | 'paused' | 'ended';
export type CourseVideoPresentationState =
  | 'completed'
  | 'playing'
  | 'paused'
  | 'learning'
  | 'unplayed';

export interface CourseVideoPresentation {
  state: CourseVideoPresentationState;
  label: string;
}

interface CourseVideoPresentationInput {
  active: boolean;
  playbackState: CoursePlaybackState;
  hasStarted: boolean;
  progress?: CourseProgress;
  durationSeconds: number;
}

export function getCourseVideoPresentation({
  active,
  playbackState,
  hasStarted,
  progress,
  durationSeconds,
}: CourseVideoPresentationInput): CourseVideoPresentation {
  if (active && playbackState === 'playing') {
    return { state: 'playing', label: '正在播放' };
  }
  if (active && playbackState === 'paused' && hasStarted) {
    return { state: 'paused', label: '已暂停' };
  }
  if (progress?.completed) {
    return { state: 'completed', label: '已学完' };
  }
  if ((progress?.progressSeconds ?? 0) > 0) {
    return {
      state: 'learning',
      label: `学习中 · 已学 ${formatCourseDuration(progress?.progressSeconds ?? 0)}`,
    };
  }
  return { state: 'unplayed', label: formatCourseDuration(durationSeconds) };
}

export function getCourseLearningCounts(
  videos: Array<{ id: string }>,
  progressByVideo: Record<string, CourseProgress>,
): { learned: number; unlearned: number } {
  const learned = videos.reduce(
    (count, video) => count + (progressByVideo[video.id]?.completed ? 1 : 0),
    0,
  );
  return { learned, unlearned: Math.max(0, videos.length - learned) };
}

export function clampMediaTime(currentTime: number, delta: number, duration: number): number {
  const next = Math.max(0, currentTime + delta);
  return Number.isFinite(duration) && duration >= 0 ? Math.min(next, duration) : next;
}

export function getMediaProgressPercent(currentTime: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(0, Math.min(100, (currentTime / duration) * 100));
}

export function getNextPlaybackRate(currentRate: number): number {
  const index = COURSE_PLAYBACK_RATES.findIndex((rate) => rate === currentRate);
  return COURSE_PLAYBACK_RATES[(index + 1) % COURSE_PLAYBACK_RATES.length];
}
