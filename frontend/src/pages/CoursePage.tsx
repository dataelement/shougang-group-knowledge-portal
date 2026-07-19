import {
  BookOpen,
  Building2,
  CheckCircle2,
  Clock3,
  PauseCircle,
  PlayCircle,
  UserCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { fetchCourse } from '../api/courses';
import CourseVideoPlayer from '../components/course/CourseVideoPlayer';
import PageShell from '../components/PageShell';
import { useAuth } from '../hooks/useAuth';
import { useVideoProgress } from '../hooks/useVideoProgress';
import {
  formatCourseDuration,
  getCourseViewMode,
  getPlayableCourseVideos,
  type Course,
} from '../types/course';
import {
  getCourseLearningCounts,
  getCourseVideoPresentation,
  type CoursePlaybackState,
  type CourseVideoPresentationState,
} from '../utils/coursePlayback';
import s from './CoursePage.module.css';

function DirectoryStateIcon({ state }: { state: CourseVideoPresentationState }) {
  if (state === 'completed') return <CheckCircle2 size={12} />;
  if (state === 'playing') return <PlayCircle size={12} />;
  if (state === 'paused') return <PauseCircle size={12} />;
  return <Clock3 size={12} />;
}

export default function CoursePage() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const { user } = useAuth();
  const [loadState, setLoadState] = useState<{ courseId: string; course: Course | null; error: string }>({
    courseId: '',
    course: null,
    error: '',
  });
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [playbackView, setPlaybackView] = useState<{
    videoId: string;
    state: CoursePlaybackState;
    hasStarted: boolean;
  }>({ videoId: '', state: 'idle', hasStarted: false });

  useEffect(() => {
    let active = true;
    void fetchCourse(courseId)
      .then((item) => {
        if (!active) return;
        setLoadState({ courseId, course: item, error: '' });
        const firstVideoId = getPlayableCourseVideos(item)[0]?.id ?? '';
        setSelectedVideoId(firstVideoId);
        setPlaybackView({ videoId: firstVideoId, state: 'idle', hasStarted: false });
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setLoadState({
          courseId,
          course: null,
          error: loadError instanceof Error ? loadError.message : '课程加载失败',
        });
      });
    return () => {
      active = false;
    };
  }, [courseId]);

  const loading = loadState.courseId !== courseId;
  const course = loading ? null : loadState.course;
  const error = loading ? '' : loadState.error;
  const videos = useMemo(() => course ? getPlayableCourseVideos(course) : [], [course]);
  const selectedVideo = videos.find((video) => video.id === selectedVideoId) ?? videos[0];
  const viewMode = course ? getCourseViewMode(course) : 'empty';
  const {
    videoRef,
    progressByVideo,
    progressReady,
    progressError,
    handleLoadedMetadata,
    handlePlaying,
    handlePause,
    handleEnded,
    flushBeforeVideoSwitch,
  } = useVideoProgress({
    courseId,
    videos,
    selectedVideoId: selectedVideo?.id ?? '',
    loggedIn: Boolean(user),
    userKey: user?.account ?? null,
  });

  const switchVideo = (videoId: string) => {
    if (videoId === selectedVideo?.id) return;
    flushBeforeVideoSwitch();
    setPlaybackView({ videoId, state: 'idle', hasStarted: false });
    setSelectedVideoId(videoId);
  };

  const learningCounts = useMemo(
    () => getCourseLearningCounts(videos, progressByVideo),
    [progressByVideo, videos],
  );
  const selectedPresentation = selectedVideo ? getCourseVideoPresentation({
    active: true,
    playbackState: playbackView.videoId === selectedVideo.id ? playbackView.state : 'idle',
    hasStarted: playbackView.videoId === selectedVideo.id && playbackView.hasStarted,
    progress: progressByVideo[selectedVideo.id],
    durationSeconds: selectedVideo.durationSeconds,
  }) : undefined;

  if (loading) {
    return <PageShell><div className={s.pageState}>正在加载课程...</div></PageShell>;
  }
  if (error || !course) {
    return (
      <PageShell>
        <div className={`${s.pageState} ${s.errorState}`}>
          <BookOpen size={34} />
          <strong>{error || '课程不存在'}</strong>
          <Link to="/course">返回全部课程</Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <section className={s.hero}>
        <div className={s.heroInner}>
          <nav aria-label="面包屑">
            <Link to="/">首页</Link><span>/</span><Link to="/course">专业课程</Link>
          </nav>
          <div className={s.eyebrow}>SHOUGANG · 岗位赋能课程</div>
          <h1>{course.name}</h1>
        </div>
      </section>

      <div className={s.container}>
        {viewMode === 'empty' || !selectedVideo ? (
          <div className={s.pageState}>该课程暂时没有可播放视频。</div>
        ) : (
          <div className={viewMode === 'directory' ? s.layout : s.singleLayout}>
            <div className={s.mainColumn}>
              <CourseVideoPlayer
                key={selectedVideo.id}
                video={selectedVideo}
                courseTitle={course.name}
                videoRef={videoRef}
                learningStatus={viewMode === 'single' && user && progressReady && !progressError
                  ? selectedPresentation
                  : undefined}
                guestHint={viewMode === 'single' && !user}
                onLoadedMetadata={handleLoadedMetadata}
                onPlaying={handlePlaying}
                onPause={handlePause}
                onEnded={handleEnded}
                onPlaybackStateChange={(state, hasStarted) => {
                  setPlaybackView({ videoId: selectedVideo.id, state, hasStarted });
                }}
              />
              {progressError ? <div className={s.progressHint}>{progressError}</div> : null}

              <section className={s.infoCard}>
                <div className={s.tags}>
                  {course.tags.map((tag) => (
                    <span key={`${tag.displayType}-${tag.label}`} data-tone={tag.displayType}>{tag.label}</span>
                  ))}
                </div>
                <h2>{course.name}</h2>
                <div className={s.courseMeta}>
                  <span><Clock3 size={15} />总时长 {formatCourseDuration(course.totalDurationSeconds)}</span>
                  {course.instructor ? <span><UserCircle size={15} />讲师 {course.instructor}</span> : null}
                  {course.organization ? <span><Building2 size={15} />所属单位 {course.organization}</span> : null}
                </div>
                {course.description ? <p>{course.description}</p> : <p className={s.muted}>暂无课程描述。</p>}
              </section>
            </div>

            {viewMode === 'directory' ? (
              <aside className={s.directory}>
                <div className={s.directoryHead}>
                  <div><BookOpen size={17} />课程目录</div>
                  {user ? (
                    progressReady && !progressError ? (
                      <span className={s.directoryStats}>
                        <strong>已学 {learningCounts.learned}</strong>
                        <em>未学 {learningCounts.unlearned}</em>
                      </span>
                    ) : <span>{progressError ? '学习进度暂不可用' : '学习进度加载中...'}</span>
                  ) : <span>登录后可记录学习进度</span>}
                </div>
                <div className={s.videoList}>
                  {videos.map((video, index) => {
                    const progress = progressByVideo[video.id];
                    const active = video.id === selectedVideo.id;
                    const presentation = getCourseVideoPresentation({
                      active,
                      playbackState: active && playbackView.videoId === video.id
                        ? playbackView.state
                        : 'idle',
                      hasStarted: active && playbackView.videoId === video.id && playbackView.hasStarted,
                      progress,
                      durationSeconds: video.durationSeconds,
                    });
                    return (
                      <button
                        type="button"
                        key={video.id}
                        className={s.videoItem}
                        data-state={presentation.state}
                        aria-current={active ? 'true' : undefined}
                        onClick={() => switchVideo(video.id)}
                      >
                        <span className={s.videoIndex}>{String(index + 1).padStart(2, '0')}</span>
                        <span className={s.videoInfo}>
                          <strong>{video.title}</strong>
                          <small>
                            <DirectoryStateIcon state={presentation.state} />
                            {presentation.label}
                          </small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </aside>
            ) : null}
          </div>
        )}
      </div>
    </PageShell>
  );
}
