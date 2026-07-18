import {
  BookOpen,
  Building2,
  CheckCircle2,
  Clock3,
  PlayCircle,
  UserCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { fetchCourse } from '../api/courses';
import PageShell from '../components/PageShell';
import { useAuth } from '../hooks/useAuth';
import { useVideoProgress } from '../hooks/useVideoProgress';
import {
  formatCourseDuration,
  getCourseViewMode,
  getPlayableCourseVideos,
  type Course,
} from '../types/course';
import s from './CoursePage.module.css';

export default function CoursePage() {
  const { courseId = '' } = useParams<{ courseId: string }>();
  const { user } = useAuth();
  const [loadState, setLoadState] = useState<{ courseId: string; course: Course | null; error: string }>({
    courseId: '',
    course: null,
    error: '',
  });
  const [selectedVideoId, setSelectedVideoId] = useState('');
  const [playError, setPlayError] = useState('');

  useEffect(() => {
    let active = true;
    void fetchCourse(courseId)
      .then((item) => {
        if (!active) return;
        setLoadState({ courseId, course: item, error: '' });
        setSelectedVideoId(getPlayableCourseVideos(item)[0]?.id ?? '');
        setPlayError('');
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
    setPlayError('');
    setSelectedVideoId(videoId);
  };

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
              <section className={s.playerCard}>
                <div className={s.videoWrap}>
                  <video
                    key={selectedVideo.id}
                    ref={videoRef}
                    className={s.video}
                    src={selectedVideo.playUrl}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={handleLoadedMetadata}
                    onPlaying={handlePlaying}
                    onPause={handlePause}
                    onEnded={handleEnded}
                    onError={() => setPlayError('当前视频无法播放，请稍后重试或联系管理员检查视频来源。')}
                  >
                    当前浏览器不支持视频播放。
                  </video>
                </div>
                <div className={s.playerMeta}>
                  <div>
                    <span className={s.nowPlaying}>正在播放</span>
                    <h2>{selectedVideo.title}</h2>
                  </div>
                  {user ? (
                    <div className={s.learningState}>
                      {progressByVideo[selectedVideo.id]?.completed ? (
                        <><CheckCircle2 size={16} />已学完</>
                      ) : (
                        <><Clock3 size={16} />已学 {formatCourseDuration(progressByVideo[selectedVideo.id]?.progressSeconds ?? 0)}</>
                      )}
                    </div>
                  ) : <span className={s.guestHint}>登录后可记录学习进度</span>}
                </div>
                {playError ? <div className={s.playerError} role="alert">{playError}</div> : null}
                {progressError ? <div className={s.progressHint}>{progressError}</div> : null}
              </section>

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
                  <span>{videos.length} 个视频</span>
                </div>
                <div className={s.videoList}>
                  {videos.map((video, index) => {
                    const progress = progressByVideo[video.id];
                    const active = video.id === selectedVideo.id;
                    return (
                      <button
                        type="button"
                        key={video.id}
                        className={`${s.videoItem} ${active ? s.videoItemActive : ''}`}
                        onClick={() => switchVideo(video.id)}
                      >
                        <span className={s.videoIndex}>{String(index + 1).padStart(2, '0')}</span>
                        <span className={s.videoInfo}>
                          <strong>{video.title}</strong>
                          <small>
                            {progress?.completed ? (
                              <><CheckCircle2 size={12} />已学完</>
                            ) : active ? (
                              <><PlayCircle size={12} />正在播放</>
                            ) : progress?.progressSeconds ? (
                              <>已学 {formatCourseDuration(progress.progressSeconds)}</>
                            ) : (
                              <>{formatCourseDuration(video.durationSeconds)}</>
                            )}
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
