import { Check, FolderOpen, Loader2, X } from 'lucide-react';
import type { FileItem, PersonalKnowledgeSpace } from '../api/content';
import s from './FavoriteDocumentModal.module.css';

interface Props {
  open: boolean;
  file: FileItem | null;
  spaces: PersonalKnowledgeSpace[];
  selectedSpaceId: number | null;
  loading: boolean;
  saving: boolean;
  error: string;
  success: string;
  onSelectSpace: (spaceId: number) => void;
  onClose: () => void;
  onConfirm: () => void;
}

export default function FavoriteDocumentModal({
  open,
  file,
  spaces,
  selectedSpaceId,
  loading,
  saving,
  error,
  success,
  onSelectSpace,
  onClose,
  onConfirm,
}: Props) {
  if (!open || !file) return null;

  const canConfirm = Boolean(selectedSpaceId) && !loading && !saving;

  return (
    <div className={s.overlay} role="presentation" onMouseDown={onClose}>
      <section
        className={s.modal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="favorite-document-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className={s.closeButton} aria-label="关闭" onClick={onClose}>
          <X size={24} />
        </button>

        <header className={s.header}>
          <h2 id="favorite-document-title" className={s.title}>收藏文档</h2>
          <p className={s.subtitle}>选择要将文档添加到哪个个人知识库</p>
        </header>

        <div className={s.fieldGroup}>
          <div className={s.label}>文档名称</div>
          <div className={s.documentName}>{file.title}</div>
        </div>

        <div className={s.fieldGroup}>
          <div className={s.requiredLabel}>选择个人知识库</div>
          {loading ? (
            <div className={s.loadingState}>
              <Loader2 size={28} className={s.spin} />
              正在加载个人知识库
            </div>
          ) : null}

          {!loading && spaces.length === 0 ? (
            <div className={s.emptyState}>
              <FolderOpen size={44} />
              <div className={s.emptyTitle}>您还没有个人知识库</div>
              <div className={s.emptyDesc}>请先创建个人知识库</div>
            </div>
          ) : null}

          {!loading && spaces.length > 0 ? (
            <div className={s.spaceList}>
              {spaces.map((space) => {
                const selected = selectedSpaceId === space.id;
                return (
                  <button
                    type="button"
                    key={space.id}
                    className={`${s.spaceOption} ${selected ? s.spaceOptionSelected : ''}`}
                    onClick={() => onSelectSpace(space.id)}
                  >
                    <span className={s.radio}>{selected ? <Check size={15} /> : null}</span>
                    <span className={s.spaceInfo}>
                      <span className={s.spaceName}>{space.name}</span>
                      <span className={s.spaceMeta}>{space.fileCount} 篇文档</span>
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {error ? <div className={s.errorText}>{error}</div> : null}
        {success ? <div className={s.successText}>{success}</div> : null}

        <footer className={s.footer}>
          <button type="button" className={s.cancelButton} onClick={onClose} disabled={saving}>取消</button>
          <button type="button" className={s.confirmButton} onClick={onConfirm} disabled={!canConfirm}>
            {saving ? '收藏中...' : '确认收藏'}
          </button>
        </footer>
      </section>
    </div>
  );
}
