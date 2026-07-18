import {
  MAX_COURSE_VIDEO_BYTES,
  mapCourseDto,
  mapCourseList,
  type Course,
  type CourseDraftInput,
  type CourseDto,
  type CourseTag,
} from '../types/course';
import {
  CourseApiError,
  parseCourseEnvelopeText,
  requestCourseApi,
} from './courses';

export interface AdminUrlVideoInput {
  title: string;
  sourceUrl: string;
  durationSeconds: number;
  enabled: boolean;
  sortOrder: number;
}

export interface AdminVideoUpdateInput {
  title?: string;
  durationSeconds?: number;
  enabled?: boolean;
  sortOrder?: number;
}

export interface CourseUploadMetadata {
  title: string;
  enabled: boolean;
  sortOrder: number;
}

export interface UploadOperation {
  promise: Promise<Course>;
  cancel: () => void;
}

function tagPayload(tags: CourseTag[]) {
  return tags.map((tag) => ({ label: tag.label, display_type: tag.displayType }));
}

function coursePayload(input: CourseDraftInput) {
  return {
    name: input.name.trim(),
    tags: tagPayload(input.tags),
    instructor: input.instructor.trim(),
    organization: input.organization.trim(),
    description: input.description.trim(),
    enabled: input.enabled,
    show_on_home: input.showOnHome,
    sort_order: input.sortOrder,
  };
}

function videoPayload(input: AdminUrlVideoInput) {
  return {
    title: input.title.trim(),
    source_url: input.sourceUrl.trim(),
    duration_seconds: input.durationSeconds,
    enabled: input.enabled,
    sort_order: input.sortOrder,
  };
}

export async function fetchAdminCourses(): Promise<Course[]> {
  const data = await requestCourseApi<{ items: CourseDto[] }>('/api/v1/admin/courses');
  return mapCourseList(data.items, true);
}

export async function createAdminCourse(input: CourseDraftInput): Promise<Course> {
  const data = await requestCourseApi<CourseDto>('/api/v1/admin/courses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(coursePayload(input)),
  });
  return mapCourseDto(data);
}

export async function updateAdminCourse(courseId: string, input: CourseDraftInput): Promise<Course> {
  const data = await requestCourseApi<CourseDto>(`/api/v1/admin/courses/${encodeURIComponent(courseId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(coursePayload(input)),
  });
  return mapCourseDto(data);
}

export async function deleteAdminCourse(courseId: string): Promise<void> {
  await requestCourseApi(`/api/v1/admin/courses/${encodeURIComponent(courseId)}`, { method: 'DELETE' });
}

export async function orderAdminCourses(items: Array<{ id: string; sortOrder: number }>): Promise<void> {
  await requestCourseApi('/api/v1/admin/courses/order', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: items.map((item) => ({ id: item.id, sort_order: item.sortOrder })),
    }),
  });
}

export async function createAdminUrlVideo(courseId: string, input: AdminUrlVideoInput): Promise<Course> {
  const data = await requestCourseApi<CourseDto>(
    `/api/v1/admin/courses/${encodeURIComponent(courseId)}/videos/url`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(videoPayload(input)),
    },
  );
  return mapCourseDto(data);
}

export async function updateAdminVideo(videoId: string, input: AdminVideoUpdateInput): Promise<Course> {
  const payload: Record<string, unknown> = {};
  if (input.title !== undefined) payload.title = input.title.trim();
  if (input.durationSeconds !== undefined) payload.duration_seconds = input.durationSeconds;
  if (input.enabled !== undefined) payload.enabled = input.enabled;
  if (input.sortOrder !== undefined) payload.sort_order = input.sortOrder;
  const data = await requestCourseApi<CourseDto>(`/api/v1/admin/course-videos/${encodeURIComponent(videoId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return mapCourseDto(data);
}

export async function deleteAdminVideo(videoId: string): Promise<void> {
  await requestCourseApi(`/api/v1/admin/course-videos/${encodeURIComponent(videoId)}`, { method: 'DELETE' });
}

export async function orderAdminVideos(
  courseId: string,
  items: Array<{ id: string; sortOrder: number }>,
): Promise<void> {
  await requestCourseApi(`/api/v1/admin/courses/${encodeURIComponent(courseId)}/videos/order`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: items.map((item) => ({ id: item.id, sort_order: item.sortOrder })),
    }),
  });
}

export async function replaceAdminVideoUrl(videoId: string, input: AdminUrlVideoInput): Promise<Course> {
  const data = await requestCourseApi<CourseDto>(
    `/api/v1/admin/course-videos/${encodeURIComponent(videoId)}/source/url`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(videoPayload(input)),
    },
  );
  return mapCourseDto(data);
}

export function validateCourseUpload(file: Pick<File, 'name' | 'size'>): string {
  if (file.size > MAX_COURSE_VIDEO_BYTES) return '视频文件不能超过 1 GiB';
  if (file.size <= 0) return '视频文件不能为空';
  if (!/\.(mp4|webm)$/i.test(file.name)) return '仅支持浏览器兼容的 MP4 或 WebM 文件';
  return '';
}

export function buildCourseUploadFormData(
  file: Blob,
  filename: string,
  metadata: CourseUploadMetadata,
): FormData {
  const form = new FormData();
  form.append('file', file, filename);
  form.append('title', metadata.title.trim());
  form.append('enabled', String(metadata.enabled));
  form.append('sort_order', String(metadata.sortOrder));
  return form;
}

function uploadWithProgress(
  path: string,
  file: File,
  metadata: CourseUploadMetadata,
  onProgress?: (percent: number) => void,
): UploadOperation {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Course>((resolve, reject) => {
    xhr.open('POST', path);
    xhr.withCredentials = true;
    xhr.timeout = 1_800_000;
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      onProgress?.(Math.min(100, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onerror = () => reject(new CourseApiError('课程视频上传失败，请稍后重试', 502));
    xhr.ontimeout = () => reject(new CourseApiError('课程视频上传超时，请稍后重试', 504));
    xhr.onabort = () => reject(new DOMException('上传已取消', 'AbortError'));
    xhr.onload = () => {
      try {
        resolve(mapCourseDto(parseCourseEnvelopeText<CourseDto>(xhr.responseText, xhr.status)));
      } catch (error) {
        reject(error);
      }
    };
    xhr.send(buildCourseUploadFormData(file, file.name, metadata));
  });
  return { promise, cancel: () => xhr.abort() };
}

export function uploadAdminVideo(
  courseId: string,
  file: File,
  metadata: CourseUploadMetadata,
  onProgress?: (percent: number) => void,
): UploadOperation {
  return uploadWithProgress(
    `/api/v1/admin/courses/${encodeURIComponent(courseId)}/videos/upload`,
    file,
    metadata,
    onProgress,
  );
}

export function replaceAdminVideoUpload(
  videoId: string,
  file: File,
  metadata: CourseUploadMetadata,
  onProgress?: (percent: number) => void,
): UploadOperation {
  return uploadWithProgress(
    `/api/v1/admin/course-videos/${encodeURIComponent(videoId)}/source/upload`,
    file,
    metadata,
    onProgress,
  );
}

export function preflightExternalVideo(sourceUrl: string, timeoutMs = 15_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      video.removeAttribute('src');
      video.load();
      if (error) reject(error);
    };
    const timer = window.setTimeout(
      () => finish(new Error('浏览器加载视频元数据超时，请检查链接或跨域策略')),
      timeoutMs,
    );
    video.preload = 'metadata';
    video.onloadedmetadata = () => {
      const duration = Math.ceil(video.duration);
      if (!Number.isFinite(duration) || duration <= 0) {
        finish(new Error('无法读取有效视频时长'));
        return;
      }
      finish();
      resolve(duration);
    };
    video.onerror = () => finish(new Error('当前浏览器无法播放该视频链接'));
    video.src = sourceUrl;
    video.load();
  });
}
