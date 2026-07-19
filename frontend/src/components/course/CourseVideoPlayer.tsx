import {
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type RefObject,
  type SyntheticEvent,
} from 'react';

import { formatCourseDuration, type CourseVideo } from '../../types/course';
import {
  clampMediaTime,
  getMediaProgressPercent,
  getNextPlaybackRate,
  type CoursePlaybackState,
  type CourseVideoPresentation,
} from '../../utils/coursePlayback';
import s from './CourseVideoPlayer.module.css';

const MEDIA_ERROR_CODE = {
  network: 2,
  decode: 3,
  sourceNotSupported: 4,
} as const;

interface CourseVideoPlayerProps {
  video: CourseVideo;
  courseTitle: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  learningStatus?: CourseVideoPresentation;
  guestHint?: boolean;
  onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onPlaying: () => void;
  onPause: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onEnded: (event: SyntheticEvent<HTMLVideoElement>) => void;
  onPlaybackStateChange: (state: CoursePlaybackState, hasStarted: boolean) => void;
}

function getBufferedPercent(video: HTMLVideoElement): number {
  if (!video.buffered.length) return 0;
  let bufferedEnd = 0;
  for (let index = 0; index < video.buffered.length; index += 1) {
    bufferedEnd = Math.max(bufferedEnd, video.buffered.end(index));
  }
  return getMediaProgressPercent(bufferedEnd, video.duration);
}

function mediaErrorMessage(video: HTMLVideoElement): string {
  if (video.error?.code === MEDIA_ERROR_CODE.network) return '视频加载失败，请检查网络后重试';
  if (video.error?.code === MEDIA_ERROR_CODE.decode) return '当前视频编码无法播放，请联系管理员';
  if (video.error?.code === MEDIA_ERROR_CODE.sourceNotSupported) {
    return '当前视频来源或格式不受浏览器支持';
  }
  return '当前视频无法播放，请稍后重试或联系管理员检查视频来源';
}

export default function CourseVideoPlayer({
  video,
  courseTitle,
  videoRef,
  learningStatus,
  guestHint = false,
  onLoadedMetadata,
  onPlaying,
  onPause,
  onEnded,
  onPlaybackStateChange,
}: CourseVideoPlayerProps) {
  const playerRef = useRef<HTMLDivElement>(null);
  const hasStartedRef = useRef(false);
  const [playbackState, setPlaybackState] = useState<CoursePlaybackState>('idle');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(video.durationSeconds);
  const [bufferedPercent, setBufferedPercent] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [playerError, setPlayerError] = useState('');

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === playerRef.current);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const setPresentationState = (state: CoursePlaybackState, started: boolean) => {
    hasStartedRef.current = started;
    setPlaybackState(state);
    onPlaybackStateChange(state, started);
  };

  const togglePlayback = async () => {
    const media = videoRef.current;
    if (!media) return;
    setPlayerError('');
    if (!media.paused && !media.ended) {
      media.pause();
      return;
    }
    if (media.ended || (Number.isFinite(media.duration) && media.currentTime >= media.duration)) {
      media.currentTime = 0;
      setCurrentTime(0);
    }
    try {
      await media.play();
    } catch {
      setPlayerError('浏览器未能开始播放，请再次点击播放按钮');
    }
  };

  const seekBy = (delta: number) => {
    const media = videoRef.current;
    if (!media) return;
    const next = clampMediaTime(media.currentTime, delta, media.duration);
    media.currentTime = next;
    setCurrentTime(next);
  };

  const handleSeek = (value: number) => {
    const media = videoRef.current;
    if (!media) return;
    const next = Math.max(0, Math.min(value, duration));
    media.currentTime = next;
    setCurrentTime(next);
  };

  const cyclePlaybackRate = () => {
    const media = videoRef.current;
    const next = getNextPlaybackRate(playbackRate);
    if (media) media.playbackRate = next;
    setPlaybackRate(next);
  };

  const toggleMute = () => {
    const media = videoRef.current;
    if (!media) return;
    media.muted = !media.muted;
    setMuted(media.muted);
  };

  const handleVolume = (next: number) => {
    const media = videoRef.current;
    if (!media) return;
    media.volume = Math.max(0, Math.min(1, next));
    if (media.volume > 0 && media.muted) media.muted = false;
    setVolume(media.volume);
    setMuted(media.muted);
  };

  const toggleFullscreen = async () => {
    const player = playerRef.current;
    if (!player) return;
    setPlayerError('');
    if (!document.fullscreenEnabled || typeof player.requestFullscreen !== 'function') {
      setPlayerError('当前浏览器不支持全屏播放');
      return;
    }
    try {
      if (document.fullscreenElement === player) {
        await document.exitFullscreen();
      } else {
        await player.requestFullscreen();
        if (document.fullscreenElement !== player) {
          setPlayerError('浏览器未能进入全屏，请检查权限后重试');
        }
      }
    } catch {
      setPlayerError('浏览器未能切换全屏，请检查权限后重试');
    }
  };

  const handleStageClick = (event: MouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button, input')) return;
    void togglePlayback();
  };

  const handleMetadata = (event: SyntheticEvent<HTMLVideoElement>) => {
    onLoadedMetadata(event);
    const media = event.currentTarget;
    setDuration(Number.isFinite(media.duration) && media.duration > 0
      ? media.duration
      : video.durationSeconds);
    setCurrentTime(media.currentTime);
    setBufferedPercent(getBufferedPercent(media));
  };

  const handleMediaPlaying = () => {
    setPlayerError('');
    setPresentationState('playing', true);
    onPlaying();
  };

  const handleMediaPause = (event: SyntheticEvent<HTMLVideoElement>) => {
    onPause(event);
    if (event.currentTarget.ended || !hasStartedRef.current) return;
    setPresentationState('paused', true);
  };

  const handleMediaEnded = (event: SyntheticEvent<HTMLVideoElement>) => {
    setCurrentTime(Number.isFinite(event.currentTarget.duration)
      ? event.currentTarget.duration
      : video.durationSeconds);
    onEnded(event);
    setPresentationState('ended', true);
  };

  const handleMediaError = (event: SyntheticEvent<HTMLVideoElement>) => {
    setPlayerError(mediaErrorMessage(event.currentTarget));
    setPresentationState('idle', hasStartedRef.current);
  };

  const playedPercent = getMediaProgressPercent(currentTime, duration);
  const progressStyle = {
    '--played-percent': `${playedPercent}%`,
    '--buffered-percent': `${Math.max(playedPercent, bufferedPercent)}%`,
  } as CSSProperties;
  const overlayVisible = playbackState !== 'playing';

  return (
    <section ref={playerRef} className={s.player}>
      <div
        className={s.videoStage}
        data-playback-state={playbackState}
        onClick={handleStageClick}
        role="presentation"
      >
        <video
          ref={videoRef}
          className={s.video}
          src={video.playUrl}
          playsInline
          preload="metadata"
          onLoadedMetadata={handleMetadata}
          onDurationChange={(event) => {
            if (Number.isFinite(event.currentTarget.duration) && event.currentTarget.duration > 0) {
              setDuration(event.currentTarget.duration);
            }
          }}
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          onProgress={(event) => setBufferedPercent(getBufferedPercent(event.currentTarget))}
          onPlaying={handleMediaPlaying}
          onPause={handleMediaPause}
          onEnded={handleMediaEnded}
          onVolumeChange={(event) => {
            setVolume(event.currentTarget.volume);
            setMuted(event.currentTarget.muted);
          }}
          onError={handleMediaError}
        >
          当前浏览器不支持视频播放。
        </video>

        <div className={s.stageWatermark}><span aria-hidden />SG · KNOWLEDGE</div>
        {playbackState === 'playing' ? (
          <div className={s.nowPlaying}><span aria-hidden />正在播放 · {formatCourseDuration(currentTime)}</div>
        ) : null}
        {overlayVisible ? (
          <div className={s.stageOverlay}>
            <div className={s.stagePoster}>
              <div className={s.stageEyebrow}>
                {playbackState === 'paused' ? '课程已暂停 · 继续学习' : '岗位赋能 · 在线课程'}
              </div>
              <div className={s.stageHeadline}>{video.title || courseTitle}</div>
              <div className={s.stageRule} />
            </div>
            <button
              type="button"
              className={s.bigPlay}
              onClick={(event) => { event.stopPropagation(); void togglePlayback(); }}
              aria-label={playbackState === 'paused' ? '继续播放' : '播放'}
            >
              <Play size={36} fill="currentColor" />
            </button>
          </div>
        ) : null}
      </div>

      <div className={s.controls}>
        <button type="button" className={s.controlButton} onClick={() => void togglePlayback()} aria-label={playbackState === 'playing' ? '暂停' : '播放'}>
          {playbackState === 'playing' ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button type="button" className={s.controlButton} onClick={() => seekBy(-10)} aria-label="后退 10 秒"><RotateCcw size={18} /></button>
        <button type="button" className={s.controlButton} onClick={() => seekBy(10)} aria-label="前进 10 秒"><RotateCw size={18} /></button>
        <span className={s.timer}>{formatCourseDuration(currentTime)} / {formatCourseDuration(duration)}</span>
        <input
          className={s.progress}
          style={progressStyle}
          type="range"
          min={0}
          max={Math.max(duration, 0)}
          step={0.1}
          value={Math.min(currentTime, Math.max(duration, 0))}
          onChange={(event) => handleSeek(Number(event.target.value))}
          aria-label="播放进度"
        />
        <button type="button" className={s.speedButton} onClick={cyclePlaybackRate} aria-label="播放速度">{playbackRate}×</button>
        <div className={s.volumeControl}>
          <button type="button" className={s.controlButton} onClick={toggleMute} aria-label={muted ? '取消静音' : '静音'}>
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(event) => handleVolume(Number(event.target.value))} aria-label="音量" />
        </div>
        <button type="button" className={s.controlButton} onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? '退出全屏' : '全屏'} title={isFullscreen ? '退出全屏' : '全屏'}>
          {isFullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </button>
      </div>

      {learningStatus || guestHint ? (
        <div className={s.statusBar} data-state={learningStatus?.state ?? 'guest'}>
          <strong>{video.title}</strong>
          <span>{guestHint ? '登录后可记录学习进度' : learningStatus?.label}</span>
        </div>
      ) : null}
      {playerError ? <div className={s.playerError} role="alert">{playerError}</div> : null}
    </section>
  );
}
