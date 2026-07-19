import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MAX_COURSE_VIDEO_BYTES,
  formatCourseDate,
  formatCourseDuration,
  getCourseViewMode,
  mapCourseList,
  validateCourseDraft,
  validateUrlVideoInput,
} from '../src/types/course';
import {
  CourseApiError,
  fetchCourseProgress,
  fetchCourses,
  parseCourseEnvelopeText,
  reportVideoProgress,
} from '../src/api/courses';
import {
  buildCourseUploadFormData,
  createAdminCourse,
  validateCourseUpload,
} from '../src/api/adminCourses';

function ok(data: unknown): Response {
  return new Response(
    JSON.stringify({ status_code: 200, status_message: 'ok', data }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const courseDto = (id: string, sortOrder: number, createdAt: string) => ({
  id,
  name: `课程 ${id}`,
  tags: [{ label: '设备', display_type: 'domain' as const }],
  instructor: '王老师',
  organization: '设备部',
  description: '课程说明',
  total_duration_seconds: 120,
  video_count: 1,
  sort_order: sortOrder,
  created_at: createdAt,
});

test('课程 DTO 映射保留全部条目、标签类型并使用稳定顺序', () => {
  const input = [
    courseDto('b'.repeat(32), 2, '2026-01-01T00:00:00'),
    courseDto('c'.repeat(32), 1, '2026-01-01T00:00:00'),
    courseDto('a'.repeat(32), 2, '2026-02-01T00:00:00'),
    courseDto('d'.repeat(32), 3, '2026-01-01T00:00:00'),
    courseDto('e'.repeat(32), 4, '2026-01-01T00:00:00'),
    courseDto('f'.repeat(32), 5, '2026-01-01T00:00:00'),
  ];

  const courses = mapCourseList(input);

  assert.equal(courses.length, 6, '首页数据映射不得固定截断为 5 条');
  assert.deepEqual(courses.slice(0, 3).map((item) => item.id), [
    'c'.repeat(32),
    'a'.repeat(32),
    'b'.repeat(32),
  ]);
  assert.equal(courses[0].tags[0].displayType, 'domain');
});

test('公开详情只按已启用视频数判定单视频或目录模式', () => {
  const base = {
    ...mapCourseList([courseDto('a'.repeat(32), 0, '2026-01-01T00:00:00')])[0],
    videos: [],
  };
  const video = (id: string, enabled = true) => ({
    id,
    title: id,
    sourceType: 'url' as const,
    playUrl: `https://media.example.com/${id}.mp4`,
    durationSeconds: 10,
    enabled,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00',
  });

  assert.equal(getCourseViewMode(base), 'empty');
  assert.equal(getCourseViewMode({ ...base, videos: [video('1')] }), 'single');
  assert.equal(
    getCourseViewMode({ ...base, videos: [video('1'), video('2'), video('off', false)] }),
    'directory',
  );
  assert.equal(getCourseViewMode({ ...base, videos: [video('off', false)] }), 'empty');
});

test('课程时长、发布、外链与上传前置校验符合约束', () => {
  assert.equal(formatCourseDuration(65), '01:05');
  assert.equal(formatCourseDuration(3661), '01:01:01');
  assert.equal(validateCourseDraft({ name: '草稿', enabled: false, playableVideoCount: 0 }), '');
  assert.match(
    validateCourseDraft({ name: '发布课', enabled: true, playableVideoCount: 0 }),
    /至少一个已启用视频/,
  );
  assert.match(validateUrlVideoInput('javascript:alert(1)', 10), /HTTP/);
  assert.match(validateUrlVideoInput('https://user:pass@example.com/a.mp4', 10), /凭据/);
  assert.match(validateUrlVideoInput('https://example.com/a.mp4', 0), /时长/);
  assert.equal(validateUrlVideoInput('https://example.com/a.mp4', 10), '');
  assert.equal(validateCourseUpload({ name: 'a.mp4', size: MAX_COURSE_VIDEO_BYTES }), '');
  assert.match(
    validateCourseUpload({ name: 'a.mp4', size: MAX_COURSE_VIDEO_BYTES + 1 }),
    /1 GiB/,
  );
  assert.match(validateCourseUpload({ name: 'a.mov', size: 10 }), /MP4 或 WebM/);
});

test('课程更新日期优先使用更新时间并回退创建时间', () => {
  assert.equal(
    formatCourseDate('2026-04-12T08:30:00+08:00', '2026-01-01T00:00:00+08:00'),
    '2026-04-12',
  );
  assert.equal(formatCourseDate(undefined, '2026-03-05T09:00:00+08:00'), '2026-03-05');
  assert.equal(formatCourseDate('  ', '2026-02-03'), '2026-02-03');
  assert.equal(formatCourseDate('not-a-date', '2026-02-03'), '—');
  assert.equal(formatCourseDate(undefined, undefined), '—');
});

test('上传媒体校验错误保留上游安全业务文案与错误码', () => {
  assert.throws(
    () => parseCourseEnvelopeText(
      JSON.stringify({
        status_code: 25005,
        status_message: '检测到 HEVC/H.265 视频编码。请转换为 H.264',
        data: { exception: '内部媒体探测异常' },
      }),
      422,
    ),
    (error: unknown) => {
      assert.ok(error instanceof CourseApiError);
      assert.equal(error.message, '检测到 HEVC/H.265 视频编码。请转换为 H.264');
      assert.equal(error.code, 25005);
      assert.doesNotMatch(error.message, /内部媒体探测异常/);
      return true;
    },
  );
});

test('公开课程和进度请求使用约定路径且不提交身份字段', async () => {
  const original = globalThis.fetch;
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const path = String(input);
    calls.push({ path, init });
    if (path.endsWith('/progress') && init?.method !== 'PUT') {
      return ok({ items: [] });
    }
    if (init?.method === 'PUT') {
      return ok({ video_id: 'v'.repeat(32), progress_seconds: 12, completed: false });
    }
    return ok({ items: [] });
  }) as typeof fetch;

  try {
    await fetchCourses('home');
    await fetchCourseProgress('c'.repeat(32));
    await reportVideoProgress(
      'v'.repeat(32),
      { progressSeconds: 12.4, completed: false },
      { keepalive: true },
    );
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(calls[0].path, '/api/v1/courses?placement=home');
  assert.equal(calls[1].path, `/api/v1/courses/${'c'.repeat(32)}/progress`);
  assert.equal(calls[2].path, `/api/v1/course-videos/${'v'.repeat(32)}/progress`);
  assert.equal(calls[2].init?.method, 'PUT');
  assert.equal(calls[2].init?.keepalive, true);
  assert.deepEqual(JSON.parse(String(calls[2].init?.body)), {
    progress_seconds: 12.4,
    completed: false,
  });
});

test('管理课程和 multipart 构造使用独立管理 API', async () => {
  const original = globalThis.fetch;
  let capturedPath = '';
  let capturedBody = '';
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    capturedPath = String(input);
    capturedBody = String(init?.body);
    return ok(courseDto('a'.repeat(32), 0, '2026-01-01T00:00:00'));
  }) as typeof fetch;
  try {
    await createAdminCourse({
      name: '新课',
      tags: [],
      instructor: '',
      organization: '',
      description: '',
      enabled: false,
      showOnHome: true,
      sortOrder: 3,
    });
  } finally {
    globalThis.fetch = original;
  }

  assert.equal(capturedPath, '/api/v1/admin/courses');
  assert.deepEqual(JSON.parse(capturedBody), {
    name: '新课',
    tags: [],
    instructor: '',
    organization: '',
    description: '',
    enabled: false,
    show_on_home: true,
    sort_order: 3,
  });

  const form = buildCourseUploadFormData(
    new Blob(['video'], { type: 'video/mp4' }),
    '课程.mp4',
    { title: '第一讲', enabled: true, sortOrder: 2 },
  );
  assert.equal(form.get('title'), '第一讲');
  assert.equal(form.get('enabled'), 'true');
  assert.equal(form.get('sort_order'), '2');
  assert.ok(form.get('file') instanceof Blob);
});
