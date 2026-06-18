import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
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
const DEFAULT_DESCRIPTION = '从公开知识空间中选择文档，最多 3 个';
const DEFAULT_EMPTY_SPACE_TEXT = '暂无公开知识空间';
const DEFAULT_EMPTY_FILE_TEXT = '请选择左侧知识空间';
const DEFAULT_LOAD_SPACE_ERROR = '知识空间加载失败，请稍后重试';
const DEFAULT_LOAD_FILE_ERROR = '文件列表加载失败，请稍后重试';
const DEFAULT_LOAD_FOLDER_ERROR = '文件夹加载失败，请稍后重试';
const DEFAULT_MAX_SELECT_COUNT = 3;
const TREE_INDENT_PX = 18;
const TREE_BASE_PADDING_PX = 10;

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
  const [selectedSpaceId, setSelectedSpaceId] = useState<number | null>(null);
  const [currentFiles, setCurrentFiles] = useState<CommonUploadedFile[]>([]);
  const [spaceLoading, setSpaceLoading] = useState(false);
  const [fileLoading, setFileLoading] = useState(false);
  const [spaceError, setSpaceError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);

  const selectedSpace = useMemo(
    () => spaces.find((space) => space.id === selectedSpaceId) ?? null,
    [selectedSpaceId, spaces],
  );

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

  const loadFiles = useCallback(async (spaceId: number) => {
    setFileLoading(true);
    setFileError(null);
    setFiles([]);
    setChildFilesByFolderId({});
    setExpandedFolderIds(new Set());
    setLoadingFolderIds(new Set());
    setFolderErrorById({});

    try {
      const nextFiles = await fetchQaKnowledgeSpaceFiles(spaceId);
      setFiles(nextFiles);
    } catch (err) {
      console.error('知识空间文件加载失败:', err);
      setFileError(err instanceof Error ? err.message : DEFAULT_LOAD_FILE_ERROR);
    } finally {
      setFileLoading(false);
    }
  }, []);

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
      const nextFiles = await fetchQaKnowledgeSpaceFiles(folder.spaceId, folder.fileId);
      setChildFilesByFolderId((current) => ({
        ...current,
        [folder.id]: nextFiles,
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
                spaces.map((space) => (
                  <button
                    key={space.id}
                    type="button"
                    className={`${s.spaceItem} ${
                      space.id === selectedSpaceId ? s.spaceItemActive : ''
                    }`}
                    onClick={() => handleSelectSpace(space)}
                  >
                    <FolderOpen size={16} />
                    <span className={s.spaceName}>{space.name}</span>
                    <span className={s.spaceCount}>{space.fileNum}</span>
                  </button>
                ))
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

            <div className={s.fileList}>
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
                renderFileRows(files)
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
