import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { FileItem } from '../api/content';
import TagPill from './TagPill';
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  FileText,
  FolderTree,
  Loader2,
  Network,
  PencilLine,
  Share2,
  Tag,
} from 'lucide-react';
import { buildFileListItemView } from '../utils/fileListItemView';
import iconFavorite from '../assets/icon-favorite.svg';
import iconDownload from '../assets/icon-download.svg';
import iconAi from '../assets/icon-ai.svg';
import { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent } from './ui/Tooltip';
import s from './FileListItem.module.css';
import tooltipS from './ui/Tooltip.module.css';

interface Props {
  file: FileItem;
  onFavorite?: (file: FileItem) => void;
  favorited?: boolean;
  favoritePending?: boolean;
  onDownload?: (file: FileItem) => void | Promise<void>;
  onShare?: (file: FileItem) => void;
  onAsk?: (file: FileItem) => void;
  onOpen?: (file: FileItem) => void;
  visibleTagCount?: number;
}

export default function FileListItem({ file, onFavorite, favorited, favoritePending, onDownload, onShare, onAsk, onOpen, visibleTagCount = 2 }: Props) {
  const view = buildFileListItemView(file, {
    visibleTagCount,
    canFavorite: Boolean(onFavorite),
    canDownload: Boolean(onDownload),
    canShare: Boolean(onShare),
    canAsk: Boolean(onAsk),
  });

  const summaryRef = useRef<HTMLDivElement>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [summaryOverflowing, setSummaryOverflowing] = useState(false);
  const [downloadPending, setDownloadPending] = useState(false);

  // Detect whether the clamped (2-line) summary actually overflows so the
  // expand toggle only shows when there is hidden text. Skip measuring while
  // expanded (clamp removed → scrollHeight === clientHeight) to keep the last
  // known overflow state, and re-measure on resize since wrapping is width-based.
  useEffect(() => {
    if (summaryExpanded) return;
    const el = summaryRef.current;
    if (!el) return;
    const measure = () => setSummaryOverflowing(el.scrollHeight > el.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [view.summaryText, summaryExpanded]);

  const handleDownloadClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!onDownload || downloadPending) return;
    setDownloadPending(true);
    void Promise.resolve()
      .then(() => onDownload(file))
      .finally(() => setDownloadPending(false));
  };

  return (
    <article className={s.item}>
      <div className={s.body}>
        <div className={s.header}>
          <div className={s.heading}>
            {onOpen ? (
              <button
                type="button"
                className={`${s.title} ${s.titleButton}`}
                title={file.title}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(file);
                }}
              >
                {file.title}
              </button>
            ) : (
              <div className={s.title}>{file.title}</div>
            )}
            <div className={s.meta}>
              <span className={s.metaItem}>
                <FileText size={15} />
                {view.documentTypeLabel}
              </span>
              {view.dateLabel ? (
                <span className={s.metaItem}>
                  <CalendarClock size={15} />
                  {view.dateLabel}
                </span>
              ) : null}
              {view.sourcePath ? (
                <span className={s.metaItem}>
                  <FolderTree size={15} />
                  {view.sourcePath}
                </span>
              ) : null}
            </div>
          </div>
          {view.actions.length > 0 ? (
            <div className={s.actions}>
              {view.actions.includes('favorite') ? (
                <button
                  type="button"
                  className={`${s.actionButton} ${s.actionFavorite}`}
                  title={favorited ? '取消收藏' : '收藏文档'}
                  aria-pressed={favorited}
                  disabled={favoritePending}
                  onClick={(event) => {
                    event.stopPropagation();
                    onFavorite?.(file);
                  }}
                >
                  <img className={s.actionIcon} src={iconFavorite} alt="" aria-hidden="true" />
                  {favorited ? '已收藏' : '收藏'}
                </button>
              ) : null}
              {view.actions.includes('download') ? (
                <button
                  type="button"
                  className={s.actionButton}
                  title={downloadPending ? '正在获取下载链接' : '下载文档'}
                  aria-busy={downloadPending}
                  disabled={downloadPending}
                  onClick={handleDownloadClick}
                >
                  {downloadPending ? (
                    <Loader2 size={16} className={`${s.actionIcon} ${s.spinner}`} />
                  ) : (
                    <img className={s.actionIcon} src={iconDownload} alt="" aria-hidden="true" />
                  )}
                  下载
                </button>
              ) : null}
              {view.actions.includes('share') ? (
                <button
                  type="button"
                  className={s.actionButton}
                  title="分享文档"
                  onClick={(event) => {
                    event.stopPropagation();
                    onShare?.(file);
                  }}
                >
                  <Share2 size={16} className={s.actionIcon} />
                  分享
                </button>
              ) : null}
              {view.actions.includes('qa') ? (
                <button
                  type="button"
                  className={s.actionButton}
                  title="辅助阅读"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAsk?.(file);
                  }}
                >
                  <img className={s.actionIcon} src={iconAi} alt="" aria-hidden="true" />
                  辅助阅读
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {view.summaryText ? (
          <section className={s.textBlock}>
            <div className={s.summaryBox}>
              <div className={s.blockTitle}>文档摘要</div>
              <div
                ref={summaryRef}
                className={`${s.summary} ${summaryExpanded ? s.summaryExpanded : ''}`}
              >
                {view.summaryText}
              </div>
            </div>
            {summaryOverflowing || summaryExpanded ? (
              <button
                type="button"
                className={s.summaryToggle}
                aria-expanded={summaryExpanded}
                onClick={(event) => {
                  event.stopPropagation();
                  setSummaryExpanded((prev) => !prev);
                }}
              >
                {summaryExpanded ? '收起' : '展开'}
                {summaryExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </button>
            ) : null}
          </section>
        ) : null}

        {view.tagGroups.length > 0 ? (
          <TooltipProvider delayDuration={100}>
            <div className={s.tagSection}>
              {view.tagGroups.map((group) => {
                const Icon =
                  group.label === '系统标签'
                    ? Network
                    : group.label === 'AI标签'
                      ? Tag
                      : PencilLine;
                return (
                  <div key={group.label} className={s.tagRow}>
                    <Icon size={17} className={s.tagRowIcon} />
                    <div className={s.tagList}>
                      {group.tags.map((tag) => (
                        <TagPill key={`${group.label}-${tag}`} name={tag} neutral />
                      ))}
                      {group.hiddenCount > 0 ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={s.moreTag}>+{group.hiddenCount}</span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className={tooltipS.tooltipContent}>
                            <div className={tooltipS.tooltipInner}>
                              {group.hiddenTags.map((tag) => (
                                <span key={tag} className={tooltipS.tooltipTag}>
                                  {tag}
                                </span>
                              ))}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </TooltipProvider>
        ) : null}
      </div>
    </article>
  );
}
