import {
  mapCourseDto,
  mapCourseList,
  mapCourseProgress,
  type Course,
  type CourseDto,
  type CourseProgress,
  type CourseProgressDto,
} from '../types/course';

interface ApiEnvelope<T> {
  status_code: number;
  status_message: string;
  data: T;
  detail?: string;
}

export class CourseApiError extends Error {
  readonly status: number;
  readonly code?: number;

  constructor(
    message: string,
    status: number,
    code?: number,
  ) {
    super(message);
    this.name = 'CourseApiError';
    this.status = status;
    this.code = code;
  }
}

function fallbackMessage(status: number): string {
  if (status === 401) return '登录状态已失效，请重新登录';
  if (status === 403) return '当前账号没有课程管理权限';
  if (status === 404) return '课程或视频不存在';
  if (status === 413) return '视频文件不能超过 1 GiB';
  return '课程服务请求失败，请稍后重试';
}

export function parseCourseEnvelopeText<T>(text: string, status: number): T {
  let payload: ApiEnvelope<T> | null = null;
  try {
    payload = text ? JSON.parse(text) as ApiEnvelope<T> : null;
  } catch {
    throw new CourseApiError(fallbackMessage(status), status);
  }
  if (!payload) throw new CourseApiError(fallbackMessage(status), status);
  if (status < 200 || status >= 300 || payload.status_code !== 200) {
    throw new CourseApiError(
      payload.status_message || payload.detail || fallbackMessage(status),
      status,
      payload.status_code,
    );
  }
  return payload.data;
}

export async function requestCourseApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'include', ...init });
  return parseCourseEnvelopeText<T>(await response.text(), response.status);
}

export async function fetchCourses(placement: 'all' | 'home' = 'all'): Promise<Course[]> {
  const data = await requestCourseApi<{ items: CourseDto[] }>(
    `/api/v1/courses?placement=${placement}`,
  );
  return mapCourseList(data.items);
}

export async function fetchCourse(courseId: string): Promise<Course> {
  const data = await requestCourseApi<CourseDto>(`/api/v1/courses/${encodeURIComponent(courseId)}`);
  return mapCourseDto(data);
}

export async function fetchCourseProgress(courseId: string): Promise<CourseProgress[]> {
  const data = await requestCourseApi<{ items: CourseProgressDto[] }>(
    `/api/v1/courses/${encodeURIComponent(courseId)}/progress`,
  );
  return data.items.map(mapCourseProgress);
}

export async function reportVideoProgress(
  videoId: string,
  progress: { progressSeconds: number; completed: boolean },
  options: { keepalive?: boolean } = {},
): Promise<CourseProgress> {
  const data = await requestCourseApi<CourseProgressDto>(
    `/api/v1/course-videos/${encodeURIComponent(videoId)}/progress`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        progress_seconds: progress.progressSeconds,
        completed: progress.completed,
      }),
      keepalive: options.keepalive,
    },
  );
  return mapCourseProgress(data);
}
