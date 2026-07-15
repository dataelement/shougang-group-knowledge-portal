import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  fetchQaKnowledgePublicSpaces,
  fetchQaKnowledgeSpaceFiles,
  type QaKnowledgeFileOption,
  type QaKnowledgeSpaceOption,
} from '../api/expertQa';
import s from './CommonFileUploadModal.module.css';

const DEFAULT_TITLE = '选择知识库附件';
const DEFAULT_DESCRIPTION = '从知识空间中选择文档，最多 3 个';
const DEFAULT_EMPTY_SPACE_TEXT = '暂无知识空间';
const DEFAULT_EMPTY_FILE_TEXT = '请选择左侧知识空间';
const DEFAULT_LOAD_SPACE_ERROR = '知识空间加载失败，请稍后重试';
const DEFAULT_LOAD_FILE_ERROR = '文件列表加载失败，请稍后重试';
const DEFAULT_LOAD_FOLDER_ERROR = '文件夹加载失败，请稍后重试';
const DEFAULT_MAX_SELECT_COUNT = 3;
const TREE_INDENT_PX = 18;
const TREE_BASE_PADDING_PX = 10;

const SPACE_LEVEL_GROUPS = [
  { key: 'public', label: '公共知识库' },
  { key: 'department', label: '部门知识库' },
  { key: 'team', label: '团队知识库' },
  { key: 'personal', label: '个人知识库' },
] as const;

type SpaceLevelKey = typeof SPACE_LEVEL_GROUPS[number]['key'];

function getSpaceLevel(space: QaKnowledgeSpaceOption): SpaceLevelKey {
  const level = (space.spaceLevel || '').trim().toLowerCase();
  return SPACE_LEVEL_GROUPS.some((g) => g.key === level) ? (level as SpaceLevelKey) : 'public';
}

function groupSpacesByLevel(spaces: QaKnowledgeSpaceOption[]) {
  const groups = new Map<SpaceLevelKey, QaKnowledgeSpaceOption[]>();
  for (const group of SPACE_LEVEL_GROUPS) {
    groups.set(group.key, []);
  }
  for (const space of spaces) {
    const level = getSpaceLevel(space);
    groups.get(level)?.push(space);
  }
  return SPACE_LEVEL_GROUPS.map((group) => {
    const groupSpaces = groups.get(group.key) ?? [];
    return {
      ...group,
      spaces: groupSpaces,
      totalFiles: groupSpaces.reduce((sum, space) => sum + space.fileNum, 0),
    };
  });
}

export type CommonUploadedFile = QaKnowledgeFileOption;

export interface CommonFileUploadModalProps {
  visible: boolean;
  selectedFiles?: CommonUploadedFile[];
  maxSelectCount?: number;
  title?: string;
  description?: string;
  onClose: () => void;
  onSelectFiles: (files: CommonUploadedFile[]) => void;
}

function isSameFile(
  left?: Pick<CommonUploadedFile, 'spaceId' | 'fileId'> | null,
  right?: Pick<CommonUploadedFile, 'spaceId' | 'fileId'> | null,
): boolean {
  return Boolean(
    left &&
      right &&
      left.spaceId === right.spaceId &&
      left.fileId === right.fileId,
  );
}

/**
 * 选择知识库文档的通用弹窗：左侧加载公开空间，右侧加载空间下文件。
 */
export default function CommonFileUploadModal({
  visible,
  selectedFiles = [],
  maxSelectCount = DEFAULT_MAX_SELECT_COUNT,
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  onClose,
  onSelectFiles,
}: CommonFileUploadModalProps) {
  const [spaces, setSpaces] = useState<QaKnowledgeSpaceOption[]>([]);
  const [files, setFiles] = useState<CommonUploadedFile[]>([]);
  const [childFilesByFolderId, setChildFilesByFolderId] = useState<
    Record<string, CommonUploadedFile[]>
  >({});
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [loadingFolderIds, setLoadingFolderIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [folderErrorById, setFolderErrorById] = useState<Record<string, string>>({});
  const [folderCursorById, setFolderCursorById] = useState<Record<string, string | null>>({});
  const [folderHasMoreById, setFolderHasMoreById] = useState<Record<string, boolean>>({});
  const [folderLoadingMoreById, setFolderLoadingMoreById] = useState<Record<string, boolean>>({});
  const [folderMetaById, setFolderMetaById] = useState<
    Record<string, { spaceId: number; fileId: number }>
  >({});
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(null);
  const [currentFiles, setCurrentFiles] = useState<CommonUploadedFile[]>([]);
  const [spaceLoading, setSpaceLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileLoadingMore, setFileLoadingMore] = useState(false);
  const [spaceError, setSpaceError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [expandedCategoryKeys, setExpandedCategoryKeys] = useState<Set<SpaceLevelKey>>(
    () => new Set(SPACE_LEVEL_GROUPS.map((group) => group.key)),
  );
  const [fileCursor, setFileCursor] = useState<string | null>(null);
  const [fileHasMore, setFileHasMore] = useState(false);
  const fileListRootRef = useRef<HTMLDivElement | null>(null);
  const fileListSentinelRef = useRef<HTMLDivElement | null>(null);
  const folderSentinelCbRef = useRef<
    (el: HTMLDivElement | null, folderId: string) => void
  >(undefined);

  const selectedSpace = useMemo(
    () => spaces.find((space) => space.id === selectedSpaceId) ?? null,
    [selectedSpaceId, spaces],
  );

  const groupedSpaces = useMemo(() => groupSpacesByLevel(spaces), [spaces]);

  const loadSpaces = useCallback(async () => {
    setSpaceLoading(true);
    setSpaceError(null);

    try {
      const nextSpaces = await fetchQaKnowledgePublicSpaces();
      setSpaces(nextSpaces);
      setSelectedSpaceId((current) => {
        if (current && nextSpaces.some((space) => space.id === current)) {
          return current;
        }
        return nextSpaces[0]?.id ?? null;
      });
    } catch (err) {
      console.error('知识空间加载失败:', err);
      setSpaces([]);
      setSelectedSpaceId(null);
      setSpaceError(err instanceof Error ? err.message : DEFAULT_LOAD_SPACE_ERROR);
    } finally {
      setSpaceLoading(false);
    }
  }, []);

  const loadFiles = useCallback(async (spaceId: number, cursor: string | null = null) => {
    const isFirstPage = cursor === null;
    if (isFirstPage) {
      setFileLoading(true);
      setFiles([]);
      setFileCursor(null);
      setFileHasMore(false);
      setChildFilesByFolderId({});
      setExpandedFolderIds(new Set());
      setLoadingFolderIds(new Set());
      setFolderErrorById({});
      setFolderCursorById({});
      setFolderHasMoreById({});
      setFolderLoadingMoreById({});
      setFolderMetaById({});
    } else {
      setFileLoadingMore(true);
    }
    setFileError(null);

    try {
      const result = await fetchQaKnowledgeSpaceFiles(spaceId, null, cursor);
      setFiles((current) => (isFirstPage ? result.files : [...current, ...result.files]));
      setFileCursor(result.nextCursor);
      setFileHasMore(result.hasMore);
    } catch (err) {
      console.error('知识空间文件加载失败:', err);
      setFileError(err instanceof Error ? err.message : DEFAULT_LOAD_FILE_ERROR);
    } finally {
      setFileLoading(false);
      setFileLoadingMore(false);
    }
  }, []);

  const loadFilesRef = useRef(loadFiles);
  loadFilesRef.current = loadFiles;
  const loadMoreFolderChildrenRef = useRef(loadMoreFolderChildren);
  loadMoreFolderChildrenRef.current = loadMoreFolderChildren;



  const currentSpaceIdRef = useRef(selectedSpaceId);
  currentSpaceIdRef.current = selectedSpaceId;
  const currentCursorRef = useRef(fileCursor);
  currentCursorRef.current = fileCursor;
  const fileHasMoreRef = useRef(fileHasMore);
  fileHasMoreRef.current = fileHasMore;
  const fileLoadingMoreRef = useRef(fileLoadingMore);
  fileLoadingMoreRef.current = fileLoadingMore;
  const fileErrorRef = useRef(fileError);
  fileErrorRef.current = fileError;

  // 通过 IntersectionObserver 监听文件列表底部 sentinel，实现滚动到底自动加载下一页
  useEffect(() => {
    if (!visible) return undefined;
    const root = fileListRootRef.current;
    const sentinel = fileListSentinelRef.current;
    if (!root || !sentinel || typeof IntersectionObserver === 'undefined') return undefined;
    if (!fileHasMoreRef.current || fileLoadingMoreRef.current || fileErrorRef.current) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          if (!fileHasMoreRef.current || fileLoadingMoreRef.current || fileErrorRef.current) continue;
          const spaceId = currentSpaceIdRef.current;
          const cursor = currentCursorRef.current;
          if (spaceId && cursor) void loadFilesRef.current(spaceId, cursor);
        }
      },
      { root, rootMargin: '80px' },
    );
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [visible, selectedSpaceId, fileHasMore, fileLoadingMore, fileError]);

  // 通过 IntersectionObserver 监听文件夹子项底部 sentinel，实现滚动到底自动加载下一页
  useEffect(() => {
    if (!visible) return undefined;
    const root = fileListRootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const folderId = entry.target.getAttribute('data-folder-id');
          if (folderId) void loadMoreFolderChildrenRef.current(folderId);
        }
      },
      { root, rootMargin: '80px' },
    );

    folderSentinelCbRef.current = (el, folderId) => {
      if (!el) return;
      el.setAttribute('data-folder-id', folderId);
      observer.observe(el);
    };

    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    setCurrentFiles(selectedFiles.slice(0, maxSelectCount));
    setSelectError(null);
    void loadSpaces();
  }, [loadSpaces, maxSelectCount, selectedFiles, visible]);

  useEffect(() => {
    if (!visible || !selectedSpaceId) return;
    void loadFiles(selectedSpaceId);
  }, [loadFiles, selectedSpaceId, visible]);

  function handleSelectSpace(space: QaKnowledgeSpaceOption) {
    if (space.id === selectedSpaceId) return;
    setSelectedSpaceId(space.id);
    setSelectError(null);
    // 选中某个知识库后，只保留它所属分类展开，其他分类自动折叠
    setExpandedCategoryKeys(new Set([getSpaceLevel(space)]));
  }

  function toggleCategory(key: SpaceLevelKey) {
    setExpandedCategoryKeys((current) => {
      // 当前分类已展开 -> 全部折叠
      if (current.has(key)) {
        return new Set();
      }
      // 当前分类折叠 -> 只展开它，其他自动折叠
      return new Set([key]);
    });
  }

  function toggleFile(file: CommonUploadedFile) {
    if (file.type === 'folder') return;

    setCurrentFiles((current) => {
      const selected = current.some((item) => isSameFile(item, file));
      if (selected) {
        setSelectError(null);
        return current.filter((item) => !isSameFile(item, file));
      }

      if (current.length >= maxSelectCount) {
        setSelectError(`最多选择 ${maxSelectCount} 个文件`);
        return current;
      }

      setSelectError(null);
      return [...current, file];
    });
  }

  function getTreeRowPadding(depth: number): string {
    return `${TREE_BASE_PADDING_PX + depth * TREE_INDENT_PX}px`;
  }

  function updateLoadingFolder(folderId: string, loading: boolean) {
    setLoadingFolderIds((current) => {
      const next = new Set(current);
      if (loading) next.add(folderId);
      else next.delete(folderId);
      return next;
    });
  }

  async function loadFolderChildren(folder: CommonUploadedFile) {
    updateLoadingFolder(folder.id, true);
    setFolderErrorById((current) => {
      const { [folder.id]: _removed, ...rest } = current;
      return rest;
    });

    try {
      const result = await fetchQaKnowledgeSpaceFiles(folder.spaceId, folder.fileId, null);
      setChildFilesByFolderId((current) => ({
        ...current,
        [folder.id]: result.files,
      }));
      setFolderCursorById((current) => ({ ...current, [folder.id]: result.nextCursor }));
      setFolderHasMoreById((current) => ({ ...current, [folder.id]: result.hasMore }));
      setFolderMetaById((current) => ({
        ...current,
        [folder.id]: { spaceId: folder.spaceId, fileId: folder.fileId },
      }));
    } catch (err) {
      console.error('知识空间文件夹加载失败:', err);
      setFolderErrorById((current) => ({
        ...current,
        [folder.id]: err instanceof Error ? err.message : DEFAULT_LOAD_FOLDER_ERROR,
      }));
    } finally {
      updateLoadingFolder(folder.id, false);
    }
  }

  async function loadMoreFolderChildren(folderId: string) {
    const meta = folderMetaById[folderId];
    const cursor = folderCursorById[folderId];
    if (!meta || !cursor || !folderHasMoreById[folderId] || folderLoadingMoreById[folderId]) return;

    setFolderLoadingMoreById((current) => ({ ...current, [folderId]: true }));
    try {
      const result = await fetchQaKnowledgeSpaceFiles(meta.spaceId, meta.fileId, cursor);
      setChildFilesByFolderId((current) => ({
        ...current,
        [folderId]: [...(current[folderId] ?? []), ...result.files],
      }));
      setFolderCursorById((current) => ({ ...current, [folderId]: result.nextCursor }));
      setFolderHasMoreById((current) => ({ ...current, [folderId]: result.hasMore }));
    } catch (err) {
      console.error('知识空间文件夹加载更多失败:', err);
    } finally {
      setFolderLoadingMoreById((current) => ({ ...current, [folderId]: false }));
    }
  }

  function toggleFolder(folder: CommonUploadedFile) {
    const isExpanded = expandedFolderIds.has(folder.id);
    setSelectError(null);

    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(folder.id);
      else next.add(folder.id);
      return next;
    });

    if (
      !isExpanded &&
      !Object.prototype.hasOwnProperty.call(childFilesByFolderId, folder.id) &&
      !loadingFolderIds.has(folder.id)
    ) {
      void loadFolderChildren(folder);
    }
  }

  function renderFolderState(
    folder: CommonUploadedFile,
    depth: number,
    content: ReactNode,
    error = false,
  ): ReactElement {
    return (
      <div
        key={`${folder.id}-${error ? 'error' : 'state'}`}
        className={`${s.folderState} ${error ? s.folderStateError : ''}`}
        style={{ paddingLeft: getTreeRowPadding(depth + 1) }}
      >
        {content}
      </div>
    );
  }

  function renderFileRows(nodes: CommonUploadedFile[], depth = 0): ReactElement[] {
    return nodes.flatMap((file) => {
      if (file.type === 'folder') {
        const isExpanded = expandedFolderIds.has(file.id);
        const isLoading = loadingFolderIds.has(file.id);
        const childrenLoaded = Object.prototype.hasOwnProperty.call(
          childFilesByFolderId,
          file.id,
        );
        const children = childFilesByFolderId[file.id] ?? [];
        const folderError = folderErrorById[file.id];
        const rows: ReactElement[] = [
          <button
            key={`folder-${file.id}`}
            type="button"
            className={`${s.fileItem} ${s.folderItem} ${
              isExpanded ? s.fileItemActive : ''
            }`}
            style={{ paddingLeft: getTreeRowPadding(depth) }}
            onClick={() => toggleFolder(file)}
            aria-expanded={isExpanded}
          >
            <span className={s.fileCheck}>
              {isLoading ? (
                <Loader2 size={14} className={s.spin} />
              ) : isExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
            </span>
            <FolderOpen size={18} className={s.folderIcon} />
            <span className={s.fileInfo}>
              <strong>{file.title}</strong>
              <span>
                {file.resolvedFileCount > 0
                  ? `${file.resolvedFileCount} 个文件`
                  : '文件夹'}
              </span>
            </span>
          </button>,
        ];

        if (isExpanded) {
          if (isLoading) {
            rows.push(
              renderFolderState(
                file,
                depth,
                <>
                  <Loader2 size={14} className={s.spin} />
                  <span>正在加载文件夹</span>
                </>,
              ),
            );
          } else if (folderError) {
            rows.push(renderFolderState(file, depth, folderError, true));
          } else if (childrenLoaded && children.length === 0) {
            rows.push(renderFolderState(file, depth, '当前文件夹暂无文件'));
          } else {
            rows.push(...renderFileRows(children, depth + 1));
            if (folderLoadingMoreById[file.id]) {
              rows.push(
                <div key={`folder-loading-${file.id}`} className={s.loadingMore}>
                  <Loader2 size={14} className={s.spin} />
                  <span>正在加载更多</span>
                </div>,
              );
            }
            if (folderHasMoreById[file.id] && !folderLoadingMoreById[file.id]) {
              rows.push(
                <div
                  key={`folder-sentinel-${file.id}`}
                  ref={(el) => folderSentinelCbRef.current?.(el, file.id)}
                  className={s.fileListSentinel}
                />,
              );
            }
          }
        }

        return rows;
      }

      const selected = currentFiles.some((item) => isSameFile(item, file));
      const disabled = !selected && currentFiles.length >= maxSelectCount;

      return [
        <button
          key={`file-${file.spaceId}-${file.fileId}`}
          type="button"
          className={`${s.fileItem} ${selected ? s.fileItemActive : ''}`}
          style={{ paddingLeft: getTreeRowPadding(depth) }}
          onClick={() => toggleFile(file)}
          disabled={disabled}
        >
          <span className={s.fileCheck}>
            {selected ? <Check size={14} /> : null}
          </span>
          <FileText size={18} className={s.fileIcon} />
          <span className={s.fileInfo}>
            <strong>{file.title}</strong>
            <span>
              {[file.ext, file.sizeLabel].filter(Boolean).join(' · ') ||
                '知识库文档'}
            </span>
          </span>
        </button>,
      ];
    });
  }

  function handleConfirm() {
    onSelectFiles(currentFiles);
    onClose();
  }

  if (!visible) return null;

  return (
    <div className={s.modalMask} onMouseDown={onClose}>
      <div className={s.modal} onMouseDown={(event) => event.stopPropagation()}>
        <div className={s.modalHead}>
          <div>
            <div className={s.modalTitle}>{title}</div>
            <div className={s.modalSub}>{description}</div>
          </div>
          <button
            type="button"
            className={s.iconButton}
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={18} />
          </button>
        </div>

        <div className={s.modalBody}>
          <aside className={s.spacePane}>
            <div className={s.paneHead}>
              <span>知识空间</span>
              <button
                type="button"
                className={s.refreshButton}
                onClick={() => void loadSpaces()}
                disabled={spaceLoading}
                aria-label="刷新知识空间"
              >
                {spaceLoading ? (
                  <Loader2 size={14} className={s.spin} />
                ) : (
                  <RefreshCw size={14} />
                )}
              </button>
            </div>

            <div className={s.spaceList}>
              {spaceLoading && spaces.length === 0 ? (
                <div className={s.emptyState}>
                  <Loader2 size={16} className={s.spin} />
                  <span>正在加载知识空间</span>
                </div>
              ) : spaceError ? (
                <div className={s.errorState}>{spaceError}</div>
              ) : spaces.length === 0 ? (
                <div className={s.emptyState}>{DEFAULT_EMPTY_SPACE_TEXT}</div>
              ) : (
                groupedSpaces.map((group) => {
                  const isExpanded = expandedCategoryKeys.has(group.key);
                  return (
                    <div key={group.key} className={s.categoryGroup}>
                      <button
                        type="button"
                        className={`${s.categoryHeader} ${
                          isExpanded ? s.categoryHeaderExpanded : ''
                        }`}
                        onClick={() => toggleCategory(group.key)}
                      >
                        <span className={s.categoryIcon}>
                          {isExpanded ? (
                            <ChevronDown size={14} />
                          ) : (
                            <ChevronRight size={14} />
                          )}
                        </span>
                        {isExpanded ? (
                          <FolderOpen size={18} className={s.categoryFolderIcon} />
                        ) : (
                          <Folder size={18} className={s.categoryFolderIcon} />
                        )}
                        <span className={s.categoryName}>{group.label}</span>
                        <span className={s.categoryCount}>{group.totalFiles}</span>
                      </button>
                      {isExpanded && (
                        <div className={s.categoryChildren}>
                          {group.spaces.map((space) => (
                            <button
                              key={space.id}
                              type="button"
                              className={`${s.spaceItem} ${s.spaceItemChild} ${
                                space.id === selectedSpaceId ? s.spaceItemActive : ''
                              }`}
                              onClick={() => handleSelectSpace(space)}
                            >
                              <span className={s.spaceItemIndent} />
                              <span className={s.spaceName}>{space.name}</span>
                              <span className={s.spaceCount}>{space.fileNum}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          <section className={s.filePane}>
            <div className={s.paneHead}>
              <span>{selectedSpace ? selectedSpace.name : '文件列表'}</span>
              {selectedSpaceId ? (
                <button
                  type="button"
                  className={s.refreshButton}
                  onClick={() => void loadFiles(selectedSpaceId)}
                  disabled={fileLoading}
                  aria-label="刷新文件列表"
                >
                  {fileLoading ? (
                    <Loader2 size={14} className={s.spin} />
                  ) : (
                    <RefreshCw size={14} />
                  )}
                </button>
              ) : null}
            </div>

            <div className={s.fileList} ref={fileListRootRef}>
              {fileLoading ? (
                <div className={s.emptyState}>
                  <Loader2 size={16} className={s.spin} />
                  <span>正在加载文件</span>
                </div>
              ) : fileError ? (
                <div className={s.errorState}>{fileError}</div>
              ) : !selectedSpaceId ? (
                <div className={s.emptyState}>{DEFAULT_EMPTY_FILE_TEXT}</div>
              ) : files.length === 0 ? (
                <div className={s.emptyState}>当前知识空间暂无文件或文件夹</div>
              ) : (
                <>
                  {renderFileRows(files)}
                  {fileLoadingMore ? (
                    <div className={s.loadingMore}>
                      <Loader2 size={14} className={s.spin} />
                      <span>正在加载更多</span>
                    </div>
                  ) : null}
                  {fileHasMore && !fileLoadingMore ? (
                    <div ref={fileListSentinelRef} className={s.fileListSentinel} />
                  ) : null}
                </>
              )}
            </div>
          </section>
        </div>

        <div className={s.modalFoot}>
          <span className={s.selectionText}>
            {selectError ??
              (currentFiles.length
                ? `已选择 ${currentFiles.length} / ${maxSelectCount} 个文件`
                : `请选择文件，最多 ${maxSelectCount} 个`)}
          </span>
          <div className={s.primaryActions}>
            <button type="button" className={s.btnGhost} onClick={onClose}>
              取消
            </button>
            <button
              type="button"
              className={s.btnPrimary}
              onClick={handleConfirm}
              disabled={currentFiles.length === 0}
            >
              确定
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
