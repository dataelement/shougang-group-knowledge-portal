import assert from 'node:assert/strict';
import test from 'node:test';

import { VideoProgressReporter, type ProgressScheduler } from '../src/utils/videoProgress';

class FakeScheduler implements ProgressScheduler {
  callback: (() => void) | null = null;
  clearCount = 0;

  setInterval(callback: () => void): unknown {
    this.callback = callback;
    return 1;
  }

  clearInterval(): void {
    this.clearCount += 1;
    this.callback = null;
  }

  tick(): void {
    this.callback?.();
  }
}

test('只有 playing 每 10 秒上报，pause 停止并立即上报一次', () => {
  const scheduler = new FakeScheduler();
  const writes: Array<{ seconds: number; completed: boolean; keepalive: boolean }> = [];
  let currentTime = 12;
  const reporter = new VideoProgressReporter({
    scheduler,
    getCurrentTime: () => currentTime,
    report: (seconds, completed, keepalive) => writes.push({ seconds, completed, keepalive }),
  });

  scheduler.tick();
  assert.equal(writes.length, 0);
  reporter.playing();
  scheduler.tick();
  assert.deepEqual(writes, [{ seconds: 12, completed: false, keepalive: false }]);
  currentTime = 20;
  reporter.pause();
  scheduler.tick();
  assert.deepEqual(writes.at(-1), { seconds: 20, completed: false, keepalive: false });
  assert.equal(writes.length, 2);
});

test('hidden 与 pagehide 相邻触发只发送一次 keepalive，倒退值仍会上报', () => {
  const scheduler = new FakeScheduler();
  const writes: Array<{ seconds: number; keepalive: boolean }> = [];
  let currentTime = 80;
  const reporter = new VideoProgressReporter({
    scheduler,
    getCurrentTime: () => currentTime,
    report: (seconds, _completed, keepalive) => writes.push({ seconds, keepalive }),
  });

  reporter.playing();
  reporter.flush(true);
  reporter.flush(true);
  currentTime = 20;
  reporter.playing();
  reporter.pause();

  assert.deepEqual(writes, [
    { seconds: 80, keepalive: true },
    { seconds: 20, keepalive: false },
  ]);
});

test('ended 固化完成终态，完成后重播、暂停和定时器均不再写入', () => {
  const scheduler = new FakeScheduler();
  const writes: Array<{ seconds: number; completed: boolean }> = [];
  const reporter = new VideoProgressReporter({
    scheduler,
    getCurrentTime: () => 99,
    report: (seconds, completed) => writes.push({ seconds, completed }),
  });

  reporter.playing();
  reporter.complete(100);
  reporter.playing();
  scheduler.tick();
  reporter.pause();
  reporter.flush(true);

  assert.deepEqual(writes, [{ seconds: 100, completed: true }]);
  assert.equal(reporter.isCompleted(), true);
});

test('已完成记录初始化后从不创建上报定时器', () => {
  const scheduler = new FakeScheduler();
  let writes = 0;
  const reporter = new VideoProgressReporter({
    scheduler,
    completed: true,
    getCurrentTime: () => 0,
    report: () => { writes += 1; },
  });

  reporter.playing();
  scheduler.tick();
  reporter.destroy();

  assert.equal(writes, 0);
  assert.equal(scheduler.callback, null);
});
