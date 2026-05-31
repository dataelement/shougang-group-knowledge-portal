import { useEffect } from 'react';
import { X } from 'lucide-react';
import type { FileItem } from '../api/content';
import s from './FilePreviewModal.module.css';

interface Props {
  file: FileItem | null;
  onClose: () => void;
}

export default function FilePreviewModal({ file, onClose }: Props) {
  useEffect(() => {
    if (!file) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [file, onClose]);

  if (!file) return null;

  const previewUrl = `/space/${file.spaceId}/file/${file.id}?embed=1`;

  return (
    <div className={s.overlay} role="dialog" aria-modal="true" aria-label={file.title} onClick={onClose}>
      <div className={s.modal} onClick={(event) => event.stopPropagation()}>
        <div className={s.header}>
          <div className={s.title} title={file.title}>{file.title}</div>
          <button type="button" className={s.closeButton} aria-label="关闭预览" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className={s.body}>
          <iframe className={s.frame} src={previewUrl} title={`${file.title} 预览`} />
        </div>
      </div>
    </div>
  );
}
