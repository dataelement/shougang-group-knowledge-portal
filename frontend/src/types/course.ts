export const MAX_COURSE_VIDEO_BYTES = 1_073_741_824;

export type CourseTagDisplayType = 'domain' | 'level' | 'gray';
export type CourseSourceType = 'upload' | 'url';
export type CourseViewMode = 'empty' | 'single' | 'directory';

export interface CourseTagDto {
  label: string;
  display_type: CourseTagDisplayType;
}

export interface CourseVideoDto {
  id: string;
  title: string;
  source_type: CourseSourceType;
  play_url: string;
  duration_seconds: number;
  enabled?: boolean;
  sort_order: number;
  created_at: string;
  updated_at?: string | null;
  source_url?: string | null;
  original_filename?: string | null;
}

export interface CourseDto {
  id: string;
  name: string;
  tags: CourseTagDto[];
  instructor: string;
  organization: string;
  description: string;
  total_duration_seconds: number;
  video_count: number;
  sort_order: number;
  created_at: string;
  updated_at?: string | null;
  enabled?: boolean;
  show_on_home?: boolean;
  videos?: CourseVideoDto[] | null;
}

export interface CourseProgressDto {
  video_id: string;
  progress_seconds: number;
  completed: boolean;
  completed_at?: string | null;
  updated_at?: string | null;
}

export interface CourseTag {
  label: string;
  displayType: CourseTagDisplayType;
}

export interface CourseVideo {
  id: string;
  title: string;
  sourceType: CourseSourceType;
  playUrl: string;
  durationSeconds: number;
  enabled?: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt?: string;
  sourceUrl?: string;
  originalFilename?: string;
}

export interface Course {
  id: string;
  name: string;
  tags: CourseTag[];
  instructor: string;
  organization: string;
  description: string;
  totalDurationSeconds: number;
  videoCount: number;
  sortOrder: number;
  createdAt: string;
  updatedAt?: string;
  enabled?: boolean;
  showOnHome?: boolean;
  videos?: CourseVideo[];
}

export interface CourseProgress {
  videoId: string;
  progressSeconds: number;
  completed: boolean;
  completedAt?: string;
  updatedAt?: string;
}

export interface CourseDraftInput {
  name: string;
  tags: CourseTag[];
  instructor: string;
  organization: string;
  description: string;
  enabled: boolean;
  showOnHome: boolean;
  sortOrder: number;
}

function optionalText(value: string | null | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function compareVideos(left: CourseVideo, right: CourseVideo): number {
  return left.sortOrder - right.sortOrder
    || left.createdAt.localeCompare(right.createdAt)
    || left.id.localeCompare(right.id);
}

function compareCourses(left: Course, right: Course): number {
  return left.sortOrder - right.sortOrder
    || right.createdAt.localeCompare(left.createdAt)
    || left.id.localeCompare(right.id);
}

export function mapCourseVideo(dto: CourseVideoDto): CourseVideo {
  return {
    id: dto.id,
    title: dto.title,
    sourceType: dto.source_type,
    playUrl: dto.play_url,
    durationSeconds: Math.max(0, Math.round(dto.duration_seconds)),
    enabled: dto.enabled,
    sortOrder: dto.sort_order,
    createdAt: dto.created_at,
    updatedAt: optionalText(dto.updated_at),
    sourceUrl: optionalText(dto.source_url),
    originalFilename: optionalText(dto.original_filename),
  };
}

export function mapCourseDto(dto: CourseDto): Course {
  return {
    id: dto.id,
    name: dto.name,
    tags: dto.tags.map((tag) => ({ label: tag.label, displayType: tag.display_type })),
    instructor: dto.instructor,
    organization: dto.organization,
    description: dto.description,
    totalDurationSeconds: Math.max(0, Math.round(dto.total_duration_seconds)),
    videoCount: Math.max(0, Math.round(dto.video_count)),
    sortOrder: dto.sort_order,
    createdAt: dto.created_at,
    updatedAt: optionalText(dto.updated_at),
    enabled: dto.enabled,
    showOnHome: dto.show_on_home,
    videos: dto.videos?.map(mapCourseVideo).sort(compareVideos) ?? undefined,
  };
}

export function mapCourseList(dtos: CourseDto[], includeDisabled = false): Course[] {
  return dtos
    .filter((dto) => includeDisabled || dto.enabled !== false)
    .map(mapCourseDto)
    .sort(compareCourses);
}

export function mapCourseProgress(dto: CourseProgressDto): CourseProgress {
  return {
    videoId: dto.video_id,
    progressSeconds: Math.max(0, Math.round(dto.progress_seconds)),
    completed: dto.completed,
    completedAt: optionalText(dto.completed_at),
    updatedAt: optionalText(dto.updated_at),
  };
}

export function getPlayableCourseVideos(course: Course): CourseVideo[] {
  return (course.videos ?? []).filter((video) => video.enabled !== false && Boolean(video.playUrl));
}

export function getCourseViewMode(course: Course): CourseViewMode {
  const count = getPlayableCourseVideos(course).length;
  if (count === 0) return 'empty';
  return count === 1 ? 'single' : 'directory';
}

export function formatCourseDuration(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  const minuteSecond = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${minuteSecond}` : minuteSecond;
}

export function formatCourseDate(updatedAt?: string, createdAt?: string): string {
  const value = optionalText(updatedAt) ?? optionalText(createdAt);
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function validateCourseDraft(input: {
  name: string;
  enabled: boolean;
  playableVideoCount: number;
}): string {
  if (!input.name.trim()) return '课程名称不能为空';
  if (input.name.trim().length > 200) return '课程名称不能超过 200 个字符';
  if (input.enabled && input.playableVideoCount < 1) return '启用课程前至少一个已启用视频必须可播放';
  return '';
}

export function validateUrlVideoInput(sourceUrl: string, durationSeconds: number): string {
  const value = sourceUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return '视频链接必须是绝对 HTTP(S) 地址';
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return '视频链接必须使用 HTTP(S) 协议';
  if (parsed.username || parsed.password) return '视频链接不能包含用户名或密码凭据';
  if (value.length > 2048 || [...value].some((character) => character.charCodeAt(0) < 32)) {
    return '视频链接格式无效或过长';
  }
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) return '视频时长必须是正整数秒';
  return '';
}
