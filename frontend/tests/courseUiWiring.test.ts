import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync('src/App.tsx', 'utf8');
const homeSource = readFileSync('src/pages/HomePage.tsx', 'utf8');
const detailSource = readFileSync('src/pages/CoursePage.tsx', 'utf8');
const detailStyle = readFileSync('src/pages/CoursePage.module.css', 'utf8');
const adminSource = readFileSync('src/pages/AdminPage.tsx', 'utf8');
const coursePlayerPath = 'src/components/course/CourseVideoPlayer.tsx';
const coursePlayerStylePath = 'src/components/course/CourseVideoPlayer.module.css';
const coursePlayerSource = existsSync(coursePlayerPath) ? readFileSync(coursePlayerPath, 'utf8') : '';
const coursePlayerStyle = existsSync(coursePlayerStylePath) ? readFileSync(coursePlayerStylePath, 'utf8') : '';
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

test('详情使用真实自定义播放器并按视频数切换单视频与目录视图', () => {
  assert.equal(existsSync(coursePlayerPath), true);
  assert.equal(existsSync(coursePlayerStylePath), true);
  assert.match(detailSource, /import CourseVideoPlayer from/);
  assert.match(detailSource, /<CourseVideoPlayer/);
  assert.doesNotMatch(detailSource, /<video/);
  assert.match(detailSource, /getCourseViewMode\(course\)/);
  assert.match(detailSource, /viewMode === 'directory'/);
  assert.doesNotMatch(detailSource, /subtitle/);

  assert.match(coursePlayerSource, /<video/);
  const videoTagStart = coursePlayerSource.indexOf('<video');
  const videoTagEnd = coursePlayerSource.indexOf('>', videoTagStart);
  assert.doesNotMatch(coursePlayerSource.slice(videoTagStart, videoTagEnd), /\bcontrols\b/);
  assert.match(coursePlayerSource, /onTimeUpdate=/);
  assert.match(coursePlayerSource, /onPlaying=/);
  assert.match(coursePlayerSource, /onPause=/);
  assert.match(coursePlayerSource, /onEnded=/);
  assert.match(coursePlayerSource, /aria-label="后退 10 秒"/);
  assert.match(coursePlayerSource, /aria-label="前进 10 秒"/);
  assert.match(coursePlayerSource, /aria-label="播放进度"/);
  assert.match(coursePlayerSource, /aria-label=\{isFullscreen \? '退出全屏' : '全屏'\}/);
  assert.match(coursePlayerSource, /document\.fullscreenEnabled/);
  assert.match(coursePlayerSource, /当前浏览器不支持全屏播放/);
  assert.match(coursePlayerStyle, /\.videoStage/);
  assert.match(coursePlayerStyle, /\.controls/);
});

test('课程目录接线五态、登录学习统计和访客提示', () => {
  assert.match(detailSource, /getCourseVideoPresentation/);
  assert.match(detailSource, /getCourseLearningCounts/);
  assert.match(detailSource, /data-state=\{presentation\.state\}/);
  assert.match(detailSource, /已学 \{learningCounts\.learned\}/);
  assert.match(detailSource, /未学 \{learningCounts\.unlearned\}/);
  assert.match(detailSource, /登录后可记录学习进度/);
});

test('课程目录以 aria-current 独立呈现选中态并保留学习状态颜色', () => {
  assert.match(detailSource, /aria-current=\{active \? 'true' : undefined\}/);
  assert.match(detailStyle, /\.videoItem\[aria-current="true"\]\s*\{/);
  assert.match(detailStyle, /\.videoItem\[aria-current="true"\] \.videoIndex\s*\{/);
  assert.match(detailStyle, /\.videoItem\[aria-current="true"\] \.videoInfo strong\s*\{/);
  assert.match(detailStyle, /\.videoItem\[data-state="completed"\] \.videoInfo small/);
  assert.match(detailStyle, /\.videoItem\[data-state="learning"\] \.videoInfo small/);
  assert.match(detailStyle, /\.videoItem\[data-state="playing"\] \.videoInfo small/);
  assert.match(detailStyle, /\.videoItem\[data-state="paused"\] \.videoInfo small/);
});

test('课程信息卡恢复标签、四栏统计、日期和描述且不含副标题', () => {
  assert.match(detailSource, /formatCourseDate/);
  assert.match(detailSource, /className=\{s\.metaTags\}/);
  assert.match(detailSource, /className=\{s\.metaTitle\}/);
  assert.match(detailSource, /className=\{s\.metaStats\}/);
  assert.match(detailSource, /className=\{s\.metaStat\}/);
  assert.match(detailSource, /className=\{s\.metaDesc\}/);
  assert.match(detailSource, />课程时长</);
  assert.match(detailSource, />主讲</);
  assert.match(detailSource, />所属单位</);
  assert.match(detailSource, />更新日期</);
  assert.match(detailSource, /formatCourseDate\(course\.updatedAt, course\.createdAt\)/);
  assert.doesNotMatch(detailSource, /subtitle/);

  assert.match(detailStyle, /\.infoCard\s*\{[^}]*border-top:\s*3px solid var\(--primary-700\)/s);
  assert.match(detailStyle, /\.metaStats\s*\{/);
  assert.match(detailStyle, /\.metaStat\s*\{/);
  assert.match(detailStyle, /\.metaDesc\s*\{/);
  assert.match(detailStyle, /@media \(max-width: 720px\)/);
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
