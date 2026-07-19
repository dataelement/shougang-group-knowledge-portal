import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const homeSource = readFileSync('src/pages/HomePage.tsx', 'utf8');
const detailSource = readFileSync('src/pages/CoursePage.tsx', 'utf8');
const adminSource = readFileSync('src/pages/AdminPage.tsx', 'utf8');
const courseManagementSource = readFileSync('src/pages/admin/CourseManagementPanel.tsx', 'utf8');
const courseManagementStyle = readFileSync('src/pages/admin/CourseManagementPanel.module.css', 'utf8');
const progressHookSource = readFileSync('src/hooks/useVideoProgress.ts', 'utf8');

test('课程列表与详情使用独立路由并完全移除 mock 数据源', () => {
  assert.match(appSource, /path="\/course" element={<CourseListPage \/>}/);
  assert.match(appSource, /path="\/course\/:courseId" element={<CoursePage \/>}/);
  assert.equal(existsSync('src/data/courseMock.ts'), false);
  assert.doesNotMatch(homeSource, /courseMock|COURSE_LIST_ITEMS/);
  assert.doesNotMatch(detailSource, /courseMock|setInterval\(.*pct/);
});

test('首页课程读取全部 home placement 数据且访客可直接进入课程', () => {
  assert.match(homeSource, /fetchCourses\('home'\)/);
  assert.doesNotMatch(homeSource, /homeCourses\.slice\(/);
  const coursePanelStart = homeSource.lastIndexOf('专业课程 · 岗位赋能');
  const coursePanelEnd = homeSource.indexOf('积分榜单', coursePanelStart);
  const coursePanel = homeSource.slice(coursePanelStart, coursePanelEnd);
  assert.match(coursePanel, /navigate\(`\/course\/\$\{course\.id\}`\)/);
  assert.doesNotMatch(coursePanel, /buildGuestLoginPath/);
});

test('详情使用原生 video 并按视频数切换单视频与目录视图', () => {
  assert.match(detailSource, /<video/);
  assert.match(detailSource, /controls/);
  assert.match(detailSource, /getCourseViewMode\(course\)/);
  assert.match(detailSource, /viewMode === 'directory'/);
  assert.doesNotMatch(detailSource, /subtitle/);
});

test('进度 hook 接线 playing、pause、ended、hidden 与 pagehide', () => {
  assert.match(progressHookSource, /handlePlaying/);
  assert.match(progressHookSource, /handlePause/);
  assert.match(progressHookSource, /handleEnded/);
  assert.match(progressHookSource, /visibilitychange/);
  assert.match(progressHookSource, /pagehide/);
  assert.match(progressHookSource, /flushBeforeVideoSwitch/);
});

test('课程管理入口紧随首页 Banner 且使用独立管理面板', () => {
  const bannerPosition = adminSource.indexOf("{ key: 'banners', label: '首页 Banner'");
  const coursePosition = adminSource.indexOf("{ key: 'courses', label: '课程管理'");
  assert.ok(bannerPosition >= 0 && coursePosition > bannerPosition);
  assert.match(adminSource, /active === 'courses' && <CourseManagementPanel \/>/);
});

test('课程上传错误在普通上传区和替换弹窗内就近展示', () => {
  assert.match(courseManagementSource, /const \[uploadError, setUploadError\] = useState\(''\)/);
  assert.match(
    courseManagementSource,
    /\.catch\(\(uploadFailure\) => setUploadError\(errorMessage\(uploadFailure\)\)\)/,
  );
  const localAlerts = courseManagementSource.match(
    /className=\{s\.uploadError\} role="alert"/g,
  ) ?? [];
  assert.equal(localAlerts.length, 2);
  assert.match(courseManagementStyle, /\.uploadError\s*\{/);
});
