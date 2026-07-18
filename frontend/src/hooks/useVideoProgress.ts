import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';

import { fetchCourseProgress, reportVideoProgress } from '../api/courses';
import type { CourseProgress, CourseVideo } from '../types/course';
import { VideoProgressReporter } from '../utils/videoProgress';

interface UseVideoProgressOptions {
  courseId: string;
  videos: CourseVideo[];
  selectedVideoId: string;
  loggedIn: boolean;
  userKey: string | null;
}

interface ProgressState {
  contextKey: string;
  items: Record<string, CourseProgress>;
  ready: boolean;
  error: string;
}

function toProgressMap(items: CourseProgress[]): Record<string, CourseProgress> {
  return Object.fromEntries(items.map((item) => [item.videoId, item]));
}

export function useVideoProgress({
  courseId,
  videos,
  selectedVideoId,
  loggedIn,
  userKey,
}: UseVideoProgressOptions) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const reporterRef = useRef<VideoProgressReporter | null>(null);
  const progressRef = useRef<Record<string, CourseProgress>>({});
  const activeUserKeyRef = useRef(userKey);
  const resumeAppliedRef = useRef('');
  const contextKey = loggedIn && userKey ? `${courseId}:${userKey}` : `guest:${courseId}`;
  const [progressState, setProgressState] = useState<ProgressState>({
    contextKey: '',
    items: {},
    ready: false,
    error: '',
  });
  const progressByVideo = useMemo(
    () => progressState.contextKey === contextKey ? progressState.items : {},
    [contextKey, progressState.contextKey, progressState.items],
  );
  const progressReady = !loggedIn || (
    progressState.contextKey === contextKey && progressState.ready
  );
  const progressError = progressState.contextKey === contextKey ? progressState.error : '';

  useLayoutEffect(() => {
    activeUserKeyRef.current = userKey;
  }, [userKey]);

  const selectedVideo = useMemo(
    () => videos.find((video) => video.id === selectedVideoId),
    [selectedVideoId, videos],
  );

  const replaceProgressMap = useCallback((next: Record<string, CourseProgress>) => {
    progressRef.current = next;
    setProgressState({ contextKey, items: next, ready: true, error: '' });
  }, [contextKey]);

  const setContextError = useCallback((message: string) => {
    setProgressState((current) => ({
      contextKey,
      items: current.contextKey === contextKey ? current.items : {},
      ready: true,
      error: message,
    }));
  }, [contextKey]);

  const upsertProgress = useCallback((next: CourseProgress) => {
    const updated = { ...progressRef.current, [next.videoId]: next };
    replaceProgressMap(updated);
  }, [replaceProgressMap]);

  useEffect(() => {
    reporterRef.current?.destroy();
    reporterRef.current = null;
    resumeAppliedRef.current = '';
    progressRef.current = {};
    if (!loggedIn || !userKey) return undefined;

    let active = true;
    void fetchCourseProgress(courseId)
      .then((items) => {
        if (!active || activeUserKeyRef.current !== userKey) return;
        const mapped = toProgressMap(items);
        replaceProgressMap(mapped);
      })
      .catch(() => {
        if (active) setContextError('学习进度加载失败，本次播放仍可继续');
      });
    return () => {
      active = false;
    };
  }, [courseId, loggedIn, replaceProgressMap, setContextError, userKey]);

  useEffect(() => {
    reporterRef.current?.destroy();
    reporterRef.current = null;
    resumeAppliedRef.current = '';
    if (!loggedIn || !userKey || !selectedVideo) return undefined;

    const reporterUserKey = userKey;
    const reporter = new VideoProgressReporter({
      completed: Boolean(progressRef.current[selectedVideo.id]?.completed),
      getCurrentTime: () => videoRef.current?.currentTime ?? 0,
      report: (progressSeconds, completed, keepalive) => {
        if (activeUserKeyRef.current !== reporterUserKey) return;
        if (completed) {
          upsertProgress({
            videoId: selectedVideo.id,
            progressSeconds: selectedVideo.durationSeconds,
            completed: true,
          });
        }
        void reportVideoProgress(
          selectedVideo.id,
          { progressSeconds, completed },
          { keepalive },
        )
          .then((stored) => {
            if (activeUserKeyRef.current === reporterUserKey) upsertProgress(stored);
          })
          .catch(() => {
            if (activeUserKeyRef.current === reporterUserKey) {
              setContextError('学习进度保存失败，稍后将继续尝试');
            }
          });
      },
    });
    reporterRef.current = reporter;
    return () => {
      if (activeUserKeyRef.current === reporterUserKey) reporter.flush(true);
      reporter.destroy();
      if (reporterRef.current === reporter) reporterRef.current = null;
    };
  }, [loggedIn, selectedVideo, setContextError, upsertProgress, userKey]);

  useEffect(() => {
    reporterRef.current?.setCompleted(Boolean(progressByVideo[selectedVideoId]?.completed));
  }, [progressByVideo, selectedVideoId]);

  const applyResumePosition = useCallback((video: HTMLVideoElement) => {
    if (!loggedIn || !userKey || !progressReady || !selectedVideo) return;
    const resumeKey = `${userKey}:${selectedVideo.id}`;
    if (resumeAppliedRef.current === resumeKey) return;
    const stored = progressRef.current[selectedVideo.id];
    if (stored?.completed) {
      video.currentTime = 0;
    } else if (stored && stored.progressSeconds > 0) {
      const upperBound = Number.isFinite(video.duration)
        ? Math.max(0, video.duration)
        : selectedVideo.durationSeconds;
      video.currentTime = Math.min(stored.progressSeconds, upperBound);
    }
    resumeAppliedRef.current = resumeKey;
  }, [loggedIn, progressReady, selectedVideo, userKey]);

  useEffect(() => {
    const video = videoRef.current;
    if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA) applyResumePosition(video);
  }, [applyResumePosition, progressByVideo]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        reporterRef.current?.flush(true);
        return;
      }
      const video = videoRef.current;
      if (video && !video.paused && !video.ended) reporterRef.current?.playing();
    };
    const handlePageHide = () => reporterRef.current?.flush(true);
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, []);

  const handleLoadedMetadata = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    applyResumePosition(event.currentTarget);
  }, [applyResumePosition]);

  const handlePlaying = useCallback(() => reporterRef.current?.playing(), []);

  const handlePause = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    if (event.currentTarget.ended) return;
    reporterRef.current?.pause();
  }, []);

  const handleEnded = useCallback((event: SyntheticEvent<HTMLVideoElement>) => {
    const duration = Number.isFinite(event.currentTarget.duration)
      ? event.currentTarget.duration
      : selectedVideo?.durationSeconds ?? 0;
    reporterRef.current?.complete(duration);
  }, [selectedVideo?.durationSeconds]);

  const flushBeforeVideoSwitch = useCallback(() => reporterRef.current?.flush(false), []);

  return {
    videoRef,
    progressByVideo,
    progressReady,
    progressError,
    handleLoadedMetadata,
    handlePlaying,
    handlePause,
    handleEnded,
    flushBeforeVideoSwitch,
  };
}
