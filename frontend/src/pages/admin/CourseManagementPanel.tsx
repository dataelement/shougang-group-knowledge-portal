import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  FileVideo2,
  Link2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import {
  createAdminCourse,
  createAdminUrlVideo,
  deleteAdminCourse,
  deleteAdminVideo,
  fetchAdminCourses,
  orderAdminCourses,
  orderAdminVideos,
  preflightExternalVideo,
  replaceAdminVideoUpload,
  replaceAdminVideoUrl,
  updateAdminCourse,
  updateAdminVideo,
  uploadAdminVideo,
  validateCourseUpload,
  type AdminUrlVideoInput,
  type UploadOperation,
} from '../../api/adminCourses';
import {
  formatCourseDuration,
  validateCourseDraft,
  validateUrlVideoInput,
  type Course,
  type CourseDraftInput,
  type CourseTagDisplayType,
  type CourseVideo,
} from '../../types/course';
import s from './CourseManagementPanel.module.css';

const EMPTY_COURSE: CourseDraftInput = {
  name: '',
  tags: [],
  instructor: '',
  organization: '',
  description: '',
  enabled: false,
  showOnHome: false,
  sortOrder: 0,
};

interface VideoFormState {
  title: string;
  sourceUrl: string;
  enabled: boolean;
  file: File | null;
}

const EMPTY_VIDEO_FORM: VideoFormState = {
  title: '',
  sourceUrl: '',
  enabled: false,
  file: null,
};

function courseToDraft(course: Course): CourseDraftInput {
  return {
    name: course.name,
    tags: course.tags,
    instructor: course.instructor,
    organization: course.organization,
    description: course.description,
    enabled: Boolean(course.enabled),
    showOnHome: Boolean(course.showOnHome),
    sortOrder: course.sortOrder,
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return '上传已取消';
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
}

function moveItem<T>(items: T[], index: number, direction: -1 | 1): T[] {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  const [moved] = next.splice(index, 1);
  next.splice(nextIndex, 0, moved);
  return next;
}

export default function CourseManagementPanel() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<CourseDraftInput>(EMPTY_COURSE);
  const [tagLabel, setTagLabel] = useState('');
  const [tagType, setTagType] = useState<CourseTagDisplayType>('gray');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [notice, setNotice] = useState('');
  const [addMode, setAddMode] = useState<'url' | 'upload'>('url');
  const [videoForm, setVideoForm] = useState<VideoFormState>(EMPTY_VIDEO_FORM);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<CourseVideo | null>(null);
  const [replaceMode, setReplaceMode] = useState<'url' | 'upload'>('url');
  const uploadOperationRef = useRef<UploadOperation | null>(null);

  const selectedCourse = useMemo(
    () => courses.find((course) => course.id === selectedId) ?? null,
    [courses, selectedId],
  );

  const setSelectedCourse = (course: Course) => {
    setCourses((current) => current.map((item) => item.id === course.id ? course : item));
    setSelectedId(course.id);
    setCreating(false);
    setDraft(courseToDraft(course));
  };

  const loadCourses = async (preferredId?: string) => {
    setLoading(true);
    setError('');
    try {
      const items = await fetchAdminCourses();
      setCourses(items);
      const targetId = preferredId && items.some((item) => item.id === preferredId)
        ? preferredId
        : items[0]?.id ?? '';
      setSelectedId(targetId);
      setCreating(false);
      setDraft(targetId ? courseToDraft(items.find((item) => item.id === targetId)!) : EMPTY_COURSE);
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCourses();
    return () => uploadOperationRef.current?.cancel();
  }, []);

  useEffect(() => {
    if (creating || !selectedCourse) return;
    setDraft(courseToDraft(selectedCourse));
    setReplaceTarget(null);
    setVideoForm(EMPTY_VIDEO_FORM);
  }, [creating, selectedCourse]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = window.setTimeout(() => setNotice(''), 2400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await operation();
    } catch (operationError) {
      setError(errorMessage(operationError));
    } finally {
      setBusy(false);
    }
  };

  const saveCourse = () => void run(async () => {
    const validation = validateCourseDraft({
      name: draft.name,
      enabled: draft.enabled,
      playableVideoCount: selectedCourse?.videos?.filter((video) => video.enabled).length ?? 0,
    });
    if (validation) throw new Error(validation);
    const saved = creating
      ? await createAdminCourse(draft)
      : await updateAdminCourse(selectedId, draft);
    if (creating) setCourses((current) => [...current, saved]);
    setSelectedCourse(saved);
    setNotice(creating ? '课程草稿已创建' : '课程信息已保存');
  });

  const removeCourse = () => {
    if (!selectedCourse) return;
    const confirmed = window.confirm(
      `确认永久删除课程“${selectedCourse.name}”吗？课程视频、全部用户学习进度及上传文件清理任务都会一并处理，此操作不可恢复。`,
    );
    if (!confirmed) return;
    void run(async () => {
      await deleteAdminCourse(selectedCourse.id);
      setNotice('课程已删除');
      await loadCourses();
    });
  };

  const addTag = () => {
    const label = tagLabel.trim();
    if (!label) return;
    if (label.length > 50) {
      setError('标签名称不能超过 50 个字符');
      return;
    }
    setDraft((current) => ({
      ...current,
      tags: [...current.tags, { label, displayType: tagType }],
    }));
    setTagLabel('');
  };

  const reorderCourses = (index: number, direction: -1 | 1) => void run(async () => {
    const next = moveItem(courses, index, direction).map((course, order) => ({
      ...course,
      sortOrder: order,
    }));
    if (next === courses) return;
    await orderAdminCourses(next.map((course) => ({ id: course.id, sortOrder: course.sortOrder })));
    setCourses(next);
    setNotice('课程顺序已更新');
  });

  const reorderVideos = (index: number, direction: -1 | 1) => {
    if (!selectedCourse?.videos) return;
    void run(async () => {
      const nextVideos = moveItem(selectedCourse.videos ?? [], index, direction).map((video, order) => ({
        ...video,
        sortOrder: order,
      }));
      await orderAdminVideos(
        selectedCourse.id,
        nextVideos.map((video) => ({ id: video.id, sortOrder: video.sortOrder })),
      );
      setSelectedCourse({ ...selectedCourse, videos: nextVideos });
      setNotice('视频顺序已更新');
    });
  };

  const saveVideo = (video: CourseVideo, patch: { title: string; durationSeconds: number; enabled: boolean }) => {
    void run(async () => {
      const updated = await updateAdminVideo(video.id, patch);
      setSelectedCourse(updated);
      setNotice('视频信息已保存');
    });
  };

  const removeVideo = (video: CourseVideo) => {
    if (!window.confirm(`确认永久删除视频“${video.title}”吗？该视频全部用户学习进度会被清除，上传文件将进入清理队列。`)) return;
    void run(async () => {
      await deleteAdminVideo(video.id);
      await loadCourses(selectedCourse?.id);
      setNotice('视频已删除');
    });
  };

  const addUrlVideo = () => void run(async () => {
    if (!selectedCourse) return;
    if (!videoForm.title.trim()) throw new Error('视频标题不能为空');
    const urlError = validateUrlVideoInput(videoForm.sourceUrl, 1);
    if (urlError) throw new Error(urlError);
    setNotice('正在使用浏览器预检视频链接...');
    const durationSeconds = await preflightExternalVideo(videoForm.sourceUrl);
    const saved = await createAdminUrlVideo(selectedCourse.id, {
      title: videoForm.title,
      sourceUrl: videoForm.sourceUrl,
      durationSeconds,
      enabled: videoForm.enabled,
      sortOrder: selectedCourse.videos?.length ?? 0,
    });
    setSelectedCourse(saved);
    setVideoForm(EMPTY_VIDEO_FORM);
    setNotice('外链视频已添加');
  });

  const startUpload = (replacement = false) => {
    const targetCourse = selectedCourse;
    const file = videoForm.file;
    setUploadError('');
    if (!targetCourse || !file) {
      setUploadError('请选择视频文件');
      return;
    }
    const validation = validateCourseUpload(file);
    if (validation) {
      setUploadError(validation);
      return;
    }
    if (!videoForm.title.trim()) {
      setUploadError('视频标题不能为空');
      return;
    }
    if (replacement && replaceTarget && !window.confirm(
      `确认替换“${replaceTarget.title}”的视频来源吗？替换成功后会清除所有用户对该视频的学习进度。`,
    )) return;

    setBusy(true);
    setError('');
    setUploadProgress(0);
    const metadata = {
      title: videoForm.title,
      enabled: videoForm.enabled,
      sortOrder: replacement && replaceTarget
        ? replaceTarget.sortOrder
        : targetCourse.videos?.length ?? 0,
    };
    const operation = replacement && replaceTarget
      ? replaceAdminVideoUpload(replaceTarget.id, file, metadata, setUploadProgress)
      : uploadAdminVideo(targetCourse.id, file, metadata, setUploadProgress);
    uploadOperationRef.current = operation;
    void operation.promise
      .then((saved) => {
        setSelectedCourse(saved);
        setVideoForm(EMPTY_VIDEO_FORM);
        setReplaceTarget(null);
        setNotice(replacement ? '视频来源已替换，原学习进度已清除' : '视频已上传并通过媒体校验');
      })
      .catch((uploadFailure) => setUploadError(errorMessage(uploadFailure)))
      .finally(() => {
        setBusy(false);
        setUploadProgress(null);
        uploadOperationRef.current = null;
      });
  };

  const replaceWithUrl = () => void run(async () => {
    if (!replaceTarget) return;
    if (!videoForm.title.trim()) throw new Error('视频标题不能为空');
    const urlError = validateUrlVideoInput(videoForm.sourceUrl, 1);
    if (urlError) throw new Error(urlError);
    const durationSeconds = await preflightExternalVideo(videoForm.sourceUrl);
    if (!window.confirm(
      `确认替换“${replaceTarget.title}”的视频来源吗？替换成功后会清除所有用户对该视频的学习进度。`,
    )) return;
    const input: AdminUrlVideoInput = {
      title: videoForm.title,
      sourceUrl: videoForm.sourceUrl,
      durationSeconds,
      enabled: videoForm.enabled,
      sortOrder: replaceTarget.sortOrder,
    };
    const saved = await replaceAdminVideoUrl(replaceTarget.id, input);
    setSelectedCourse(saved);
    setReplaceTarget(null);
    setVideoForm(EMPTY_VIDEO_FORM);
    setNotice('视频来源已替换，原学习进度已清除');
  });

  const openReplacement = (video: CourseVideo) => {
    setUploadError('');
    setReplaceTarget(video);
    setReplaceMode(video.sourceType === 'url' ? 'url' : 'upload');
    setVideoForm({
      title: video.title,
      sourceUrl: video.sourceUrl ?? '',
      enabled: Boolean(video.enabled),
      file: null,
    });
  };

  return (
    <div className={s.panel}>
      <div className={s.header}>
        <div>
          <h2>课程管理</h2>
          <p>维护“专业课程 · 岗位赋能”模块的课程信息、视频目录、首页展示与顺序。</p>
        </div>
        <button type="button" className={s.secondaryButton} onClick={() => void loadCourses(selectedId)} disabled={loading || busy}>
          <RefreshCw size={15} />刷新
        </button>
      </div>

      {error ? <div className={s.error} role="alert">{error}</div> : null}
      {notice ? <div className={s.notice}><CheckCircle2 size={15} />{notice}</div> : null}

      <div className={s.workspace}>
        <aside className={s.courseList}>
          <div className={s.listHeader}>
            <strong>课程列表</strong>
            <button
              type="button"
              className={s.iconButton}
              title="新建课程"
              onClick={() => {
                setCreating(true);
                setSelectedId('');
                setDraft({ ...EMPTY_COURSE, sortOrder: courses.length });
                setError('');
              }}
            ><Plus size={16} /></button>
          </div>
          {loading ? <div className={s.listState}><Loader2 className={s.spin} size={18} />加载中</div> : null}
          {!loading && !courses.length && !creating ? <div className={s.listState}>暂无课程</div> : null}
          {creating ? <div className={`${s.courseEntry} ${s.courseEntryActive}`}>新建课程草稿</div> : null}
          {courses.map((course, index) => (
            <div key={course.id} className={`${s.courseEntryWrap} ${course.id === selectedId ? s.courseEntryWrapActive : ''}`}>
              <button
                type="button"
                className={s.courseEntry}
                onClick={() => {
                  setCreating(false);
                  setSelectedId(course.id);
                  setDraft(courseToDraft(course));
                }}
              >
                <span>{course.name}</span>
                <small>{course.enabled ? '已启用' : '草稿'} · {course.videos?.length ?? 0} 个视频</small>
              </button>
              <div className={s.orderButtons}>
                <button type="button" onClick={() => reorderCourses(index, -1)} disabled={busy || index === 0}><ArrowUp size={12} /></button>
                <button type="button" onClick={() => reorderCourses(index, 1)} disabled={busy || index === courses.length - 1}><ArrowDown size={12} /></button>
              </div>
            </div>
          ))}
        </aside>

        <div className={s.editor}>
          {!creating && !selectedCourse ? (
            <div className={s.emptyEditor}><FileVideo2 size={34} />请选择课程或新建课程草稿</div>
          ) : (
            <>
              <section className={s.section}>
                <div className={s.sectionTitle}>
                  <div><h3>{creating ? '新建课程' : '课程信息'}</h3><span>课程作为目录，可包含一个或多个视频。</span></div>
                  <div className={s.actionRow}>
                    {!creating ? <button type="button" className={s.dangerButton} onClick={removeCourse} disabled={busy}><Trash2 size={14} />删除</button> : null}
                    <button type="button" className={s.primaryButton} onClick={saveCourse} disabled={busy}><Save size={14} />保存课程</button>
                  </div>
                </div>

                <div className={s.formGrid}>
                  <label className={s.fullField}><span>课程名称 *</span><input value={draft.name} maxLength={200} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
                  <label><span>讲师</span><input value={draft.instructor} maxLength={100} onChange={(event) => setDraft({ ...draft, instructor: event.target.value })} /></label>
                  <label><span>所属单位</span><input value={draft.organization} maxLength={200} onChange={(event) => setDraft({ ...draft, organization: event.target.value })} /></label>
                  <label className={s.fullField}><span>课程描述</span><textarea rows={4} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
                  <label><span>排序值</span><input type="number" value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: Number(event.target.value) || 0 })} /></label>
                  <div className={s.switches}>
                    <label><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />启用课程</label>
                    <label><input type="checkbox" checked={draft.showOnHome} onChange={(event) => setDraft({ ...draft, showOnHome: event.target.checked })} />展示在首页</label>
                  </div>
                </div>

                <div className={s.tagEditor}>
                  <span className={s.fieldCaption}>课程标签</span>
                  <div className={s.tagList}>
                    {draft.tags.map((tag, index) => (
                      <span key={`${tag.displayType}-${tag.label}-${index}`} data-tone={tag.displayType}>
                        {tag.label}
                        <button type="button" onClick={() => setDraft({ ...draft, tags: draft.tags.filter((_, itemIndex) => itemIndex !== index) })}><X size={11} /></button>
                      </span>
                    ))}
                  </div>
                  <div className={s.tagInputs}>
                    <input value={tagLabel} maxLength={50} placeholder="输入标签" onChange={(event) => setTagLabel(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); addTag(); } }} />
                    <select value={tagType} onChange={(event) => setTagType(event.target.value as CourseTagDisplayType)}>
                      <option value="domain">专业域</option><option value="level">难度</option><option value="gray">普通</option>
                    </select>
                    <button type="button" className={s.secondaryButton} onClick={addTag}>添加标签</button>
                  </div>
                </div>
              </section>

              {!creating && selectedCourse ? (
                <section className={s.section}>
                  <div className={s.sectionTitle}>
                    <div><h3>视频目录</h3><span>公开详情仅有一个已启用视频时自动隐藏目录；多个时显示目录。</span></div>
                  </div>

                  <div className={s.videoTable}>
                    {(selectedCourse.videos ?? []).map((video, index) => (
                      <VideoRow
                        key={video.id}
                        video={video}
                        index={index}
                        count={selectedCourse.videos?.length ?? 0}
                        busy={busy}
                        onMove={reorderVideos}
                        onSave={saveVideo}
                        onDelete={removeVideo}
                        onReplace={openReplacement}
                      />
                    ))}
                    {!selectedCourse.videos?.length ? <div className={s.videoEmpty}>暂无视频，可先保存课程草稿，再添加上传文件或外链视频。</div> : null}
                  </div>

                  <div className={s.addVideo}>
                    <div className={s.modeTabs}>
                      <button type="button" className={addMode === 'url' ? s.modeActive : ''} onClick={() => { setAddMode('url'); setVideoForm(EMPTY_VIDEO_FORM); setUploadError(''); }}><Link2 size={14} />添加外链</button>
                      <button type="button" className={addMode === 'upload' ? s.modeActive : ''} onClick={() => { setAddMode('upload'); setVideoForm(EMPTY_VIDEO_FORM); setUploadError(''); }}><Upload size={14} />上传视频</button>
                    </div>
                    <VideoSourceForm form={videoForm} mode={addMode} onChange={setVideoForm} />
                    {uploadProgress !== null ? (
                      <div className={s.uploadStatus}>
                        <div><span style={{ width: `${uploadProgress}%` }} /></div>
                        <strong>{uploadProgress}%</strong>
                        <button type="button" onClick={() => uploadOperationRef.current?.cancel()}>取消上传</button>
                      </div>
                    ) : null}
                    {uploadError && !replaceTarget ? <div className={s.uploadError} role="alert">{uploadError}</div> : null}
                    <button type="button" className={s.primaryButton} disabled={busy} onClick={addMode === 'url' ? addUrlVideo : () => startUpload(false)}>
                      {busy ? <Loader2 className={s.spin} size={14} /> : addMode === 'url' ? <Link2 size={14} /> : <Upload size={14} />}
                      {addMode === 'url' ? '预检并添加' : '上传并校验'}
                    </button>
                    <p className={s.help}>上传仅支持实际编码兼容浏览器的 MP4（H.264/AAC）或 WebM（VP8/VP9、Vorbis/Opus），最大 1 GiB；最终以服务端探测结果为准。</p>
                  </div>
                </section>
              ) : null}
            </>
          )}
        </div>
      </div>

      {replaceTarget ? (
        <div className={s.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setReplaceTarget(null); }}>
          <div className={s.modal} role="dialog" aria-modal="true" aria-label="替换视频来源">
            <div className={s.modalHeader}><div><h3>替换视频来源</h3><p>替换“{replaceTarget.title}”成功后，会清除所有用户对该视频的学习进度。</p></div><button type="button" onClick={() => setReplaceTarget(null)} disabled={busy}><X size={18} /></button></div>
            <div className={s.modeTabs}>
              <button type="button" className={replaceMode === 'url' ? s.modeActive : ''} onClick={() => { setReplaceMode('url'); setVideoForm((current) => ({ ...current, file: null })); setUploadError(''); }}><Link2 size={14} />外链</button>
              <button type="button" className={replaceMode === 'upload' ? s.modeActive : ''} onClick={() => { setReplaceMode('upload'); setVideoForm((current) => ({ ...current, sourceUrl: '' })); setUploadError(''); }}><Upload size={14} />上传文件</button>
            </div>
            <VideoSourceForm form={videoForm} mode={replaceMode} onChange={setVideoForm} />
            {uploadProgress !== null ? <div className={s.uploadStatus}><div><span style={{ width: `${uploadProgress}%` }} /></div><strong>{uploadProgress}%</strong><button type="button" onClick={() => uploadOperationRef.current?.cancel()}>取消上传</button></div> : null}
            {uploadError ? <div className={s.uploadError} role="alert">{uploadError}</div> : null}
            <div className={s.modalActions}><button type="button" className={s.secondaryButton} onClick={() => setReplaceTarget(null)} disabled={busy}>取消</button><button type="button" className={s.dangerPrimaryButton} onClick={replaceMode === 'url' ? replaceWithUrl : () => startUpload(true)} disabled={busy}>确认替换并清除进度</button></div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VideoSourceForm({
  form,
  mode,
  onChange,
}: {
  form: VideoFormState;
  mode: 'url' | 'upload';
  onChange: (next: VideoFormState) => void;
}) {
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    onChange({ ...form, file, title: form.title || file?.name.replace(/\.(mp4|webm)$/i, '') || '' });
  };
  return (
    <div className={s.sourceFields}>
      <label><span>视频标题 *</span><input value={form.title} maxLength={200} onChange={(event) => onChange({ ...form, title: event.target.value })} /></label>
      {mode === 'url' ? (
        <label className={s.wideField}><span>视频链接 *</span><input type="url" value={form.sourceUrl} placeholder="https://.../video.mp4" onChange={(event) => onChange({ ...form, sourceUrl: event.target.value })} /></label>
      ) : (
        <label className={s.wideField}><span>视频文件 *</span><input type="file" accept="video/mp4,video/webm,.mp4,.webm" onChange={handleFile} /></label>
      )}
      <label className={s.checkField}><input type="checkbox" checked={form.enabled} onChange={(event) => onChange({ ...form, enabled: event.target.checked })} />添加后启用</label>
    </div>
  );
}

function VideoRow({
  video,
  index,
  count,
  busy,
  onMove,
  onSave,
  onDelete,
  onReplace,
}: {
  video: CourseVideo;
  index: number;
  count: number;
  busy: boolean;
  onMove: (index: number, direction: -1 | 1) => void;
  onSave: (video: CourseVideo, patch: { title: string; durationSeconds: number; enabled: boolean }) => void;
  onDelete: (video: CourseVideo) => void;
  onReplace: (video: CourseVideo) => void;
}) {
  const [title, setTitle] = useState(video.title);
  const [durationSeconds, setDurationSeconds] = useState(video.durationSeconds);
  const [enabled, setEnabled] = useState(Boolean(video.enabled));
  useEffect(() => {
    setTitle(video.title);
    setDurationSeconds(video.durationSeconds);
    setEnabled(Boolean(video.enabled));
  }, [video]);
  return (
    <div className={s.videoRow}>
      <div className={s.videoOrder}><button type="button" onClick={() => onMove(index, -1)} disabled={busy || index === 0}><ArrowUp size={13} /></button><button type="button" onClick={() => onMove(index, 1)} disabled={busy || index === count - 1}><ArrowDown size={13} /></button></div>
      <div className={s.videoFields}>
        <input aria-label="视频标题" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        <div className={s.videoMeta}><span>{video.sourceType === 'upload' ? 'MinIO 上传' : '外链'}</span><span>{formatCourseDuration(durationSeconds)}</span>{video.originalFilename ? <span title={video.originalFilename}>{video.originalFilename}</span> : null}</div>
      </div>
      {video.sourceType === 'url' ? <label className={s.durationInput}>时长（秒）<input type="number" min={1} value={durationSeconds} onChange={(event) => setDurationSeconds(Math.max(1, Number(event.target.value) || 1))} /></label> : null}
      <label className={s.rowSwitch}><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />启用</label>
      <div className={s.rowActions}><button type="button" onClick={() => onSave(video, { title, durationSeconds, enabled })} disabled={busy}>保存</button><button type="button" onClick={() => onReplace(video)} disabled={busy}>替换来源</button><button type="button" className={s.deleteText} onClick={() => onDelete(video)} disabled={busy}>删除</button></div>
    </div>
  );
}
