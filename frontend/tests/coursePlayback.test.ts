import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COURSE_PLAYBACK_RATES,
  clampMediaTime,
  getCourseLearningCounts,
  getCourseVideoPresentation,
  getMediaProgressPercent,
  getNextPlaybackRate,
} from '../src/utils/coursePlayback';

const completed = { videoId: 'done', progressSeconds: 120, completed: true };
const partial = { videoId: 'partial', progressSeconds: 30, completed: false };

test('课程目录按真实播放事件和持久化进度推导五种状态', () => {
  assert.deepEqual(
    getCourseVideoPresentation({
      active: false,
      playbackState: 'idle',
      hasStarted: false,
      progress: completed,
      durationSeconds: 120,
    }),
    { state: 'completed', label: '已学完' },
  );
  assert.deepEqual(
    getCourseVideoPresentation({
      active: true,
      playbackState: 'playing',
      hasStarted: true,
      progress: completed,
      durationSeconds: 120,
    }),
    { state: 'playing', label: '正在播放' },
  );
  assert.deepEqual(
    getCourseVideoPresentation({
      active: true,
      playbackState: 'paused',
      hasStarted: true,
      progress: completed,
      durationSeconds: 120,
    }),
    { state: 'paused', label: '已暂停' },
  );
  assert.deepEqual(
    getCourseVideoPresentation({
      active: false,
      playbackState: 'idle',
      hasStarted: false,
      progress: partial,
      durationSeconds: 120,
    }),
    { state: 'learning', label: '学习中 · 已学 00:30' },
  );
  assert.deepEqual(
    getCourseVideoPresentation({
      active: true,
      playbackState: 'idle',
      hasStarted: false,
      durationSeconds: 120,
    }),
    { state: 'unplayed', label: '02:00' },
  );
});

test('完成视频只在真实播放或暂停时临时覆盖已学完视觉', () => {
  assert.equal(getCourseVideoPresentation({
    active: true,
    playbackState: 'paused',
    hasStarted: false,
    progress: completed,
    durationSeconds: 120,
  }).state, 'completed');
  assert.equal(getCourseVideoPresentation({
    active: true,
    playbackState: 'ended',
    hasStarted: true,
    progress: completed,
    durationSeconds: 120,
  }).state, 'completed');
});

test('已学只统计 completed，部分学习仍计入未学', () => {
  const counts = getCourseLearningCounts(
    [{ id: 'done' }, { id: 'partial' }, { id: 'new' }],
    { done: completed, partial },
  );
  assert.deepEqual(counts, { learned: 1, unlearned: 2 });
});

test('自定义播放器控制纯函数处理边界和旧版倍速顺序', () => {
  assert.deepEqual(COURSE_PLAYBACK_RATES, [1, 1.25, 1.5, 2, 0.75]);
  assert.equal(clampMediaTime(5, -10, 100), 0);
  assert.equal(clampMediaTime(95, 10, 100), 100);
  assert.equal(clampMediaTime(20, 10, Number.NaN), 30);
  assert.equal(getMediaProgressPercent(25, 100), 25);
  assert.equal(getMediaProgressPercent(10, 0), 0);
  assert.equal(getNextPlaybackRate(1), 1.25);
  assert.equal(getNextPlaybackRate(2), 0.75);
  assert.equal(getNextPlaybackRate(0.75), 1);
});
