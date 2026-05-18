import type { FileItem } from '../api/content';
import TagPill from './TagPill';
import { CalendarClock, Download, FileText, FolderTree, HardDrive, Hash, MessageCircle, Share2, Star, Tag } from 'lucide-react';
import { buildFileListItemView } from '../utils/fileListItemView';
import s from './FileListItem.module.css';

interface Props {
  file: FileItem;
  onFavorite?: (file: FileItem) => void;
  onDownload?: (file: FileItem) => void | Promise<void>;
  onShare?: (file: FileItem) => void;
  onAsk?: (file: FileItem) => void;
  visibleTagCount?: number;
}

export default function FileListItem({ file, onFavorite, onDownload, onShare, onAsk, visibleTagCount = 2 }: Props) {
  const view = buildFileListItemView(file, {
    visibleTagCount,
    canFavorite: Boolean(onFavorite),
    canDownload: Boolean(onDownload),
    canShare: Boolean(onShare),
    canAsk: Boolean(onAsk),
  });

  return (
    <article className={s.item}>
      <div className={s.body}>
        <div className={s.header}>
          <div className={s.heading}>
            <div className={s.title}>{file.title}</div>
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
              <span className={s.metaItem}>
                <FolderTree size={15} />
                {view.sourcePath}
              </span>
              {file.sizeLabel ? (
                <span className={s.metaItem}>
                  <HardDrive size={15} />
                  {file.sizeLabel}
                </span>
              ) : null}
              {file.fileEncoding ? (
                <span className={s.metaItem}>
                  <Hash size={15} />
                  {file.fileEncoding}
                </span>
              ) : null}
            </div>
          </div>
          {view.actions.length > 0 ? (
            <div className={s.actions}>
              {view.actions.includes('favorite') ? (
                <button
                  type="button"
                  className={`${s.actionButton} ${s.favoriteButton}`}
                  title="收藏文档"
                  aria-label="收藏文档"
                  onClick={(event) => {
                    event.stopPropagation();
                    onFavorite?.(file);
                  }}
                >
                  <Star size={19} />
                </button>
              ) : null}
              {view.actions.includes('download') ? (
                <button
                  type="button"
                  className={`${s.actionButton} ${s.downloadButton}`}
                  title="下载文档"
                  aria-label="下载文档"
                  onClick={(event) => {
                    event.stopPropagation();
                    void onDownload?.(file);
                  }}
                >
                  <Download size={19} />
                </button>
              ) : null}
              {view.actions.includes('share') ? (
                <button
                  type="button"
                  className={`${s.actionButton} ${s.shareButton}`}
                  title="分享文档"
                  aria-label="分享文档"
                  onClick={(event) => {
                    event.stopPropagation();
                    onShare?.(file);
                  }}
                >
                  <Share2 size={19} />
                </button>
              ) : null}
              {view.actions.includes('qa') ? (
                <button
                  type="button"
                  className={`${s.actionButton} ${s.qaButton}`}
                  title="文档问答"
                  aria-label="文档问答"
                  onClick={(event) => {
                    event.stopPropagation();
                    onAsk?.(file);
                  }}
                >
                  <MessageCircle size={19} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        {view.summaryText ? (
          <section className={s.textBlock}>
            <div className={s.blockTitle}>文档摘要</div>
            <div className={s.summary}>{view.summaryText}</div>
          </section>
        ) : null}

        {view.visibleTags.length > 0 ? (
          <div className={s.tags}>
            <Tag size={17} className={s.tagsIcon} />
            <div className={s.tagList}>
              {view.visibleTags.map((tag) => (
                <TagPill key={tag} name={tag} neutral />
              ))}
              {view.hiddenTagCount > 0 ? <span className={s.moreTag}>+{view.hiddenTagCount}</span> : null}
            </div>
          </div>
        ) : null}
      </div>
    </article>
  );
}
