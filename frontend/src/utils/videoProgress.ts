export interface ProgressScheduler {
  setInterval(callback: () => void, milliseconds: number): unknown;
  clearInterval(timer: unknown): void;
}

export interface VideoProgressReporterOptions {
  getCurrentTime: () => number;
  report: (progressSeconds: number, completed: boolean, keepalive: boolean) => void;
  scheduler?: ProgressScheduler;
  completed?: boolean;
  intervalMilliseconds?: number;
}

const browserScheduler: ProgressScheduler = {
  setInterval: (callback, milliseconds) => window.setInterval(callback, milliseconds),
  clearInterval: (timer) => window.clearInterval(timer as number),
};

export class VideoProgressReporter {
  private readonly options: VideoProgressReporterOptions;
  private readonly scheduler: ProgressScheduler;
  private readonly intervalMilliseconds: number;
  private timer: unknown | null = null;
  private completed: boolean;
  private lastFlushSecond: number | null = null;

  constructor(options: VideoProgressReporterOptions) {
    this.options = options;
    this.scheduler = options.scheduler ?? browserScheduler;
    this.intervalMilliseconds = options.intervalMilliseconds ?? 10_000;
    this.completed = Boolean(options.completed);
  }

  isCompleted(): boolean {
    return this.completed;
  }

  setCompleted(completed: boolean): void {
    this.completed = completed;
    if (completed) this.stopTimer();
  }

  playing(): void {
    this.lastFlushSecond = null;
    if (this.completed || this.timer !== null) return;
    this.timer = this.scheduler.setInterval(() => this.emit(false, false), this.intervalMilliseconds);
  }

  pause(): void {
    this.stopTimer();
    this.flush(false);
  }

  flush(keepalive: boolean): void {
    if (this.completed) return;
    this.stopTimer();
    const seconds = this.currentSecond();
    if (this.lastFlushSecond === seconds) return;
    this.lastFlushSecond = seconds;
    this.options.report(seconds, false, keepalive);
  }

  complete(durationSeconds: number): void {
    if (this.completed) return;
    this.completed = true;
    this.stopTimer();
    const seconds = Math.max(0, Math.round(durationSeconds));
    this.lastFlushSecond = seconds;
    this.options.report(seconds, true, false);
  }

  destroy(): void {
    this.stopTimer();
  }

  private currentSecond(): number {
    const value = this.options.getCurrentTime();
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  }

  private emit(completed: boolean, keepalive: boolean): void {
    if (this.completed) return;
    this.options.report(this.currentSecond(), completed, keepalive);
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    this.scheduler.clearInterval(this.timer);
    this.timer = null;
  }
}
