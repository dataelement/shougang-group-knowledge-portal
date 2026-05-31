import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { fetchFilePreview, type FileItem } from '../api/content';
import s from './FilePreviewModal.module.css';

interface Props {
  file: FileItem | null;
  onClose: () => void;
}

export default function FilePreviewModal({ file, onClose }: Props) {
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!file) return;
    let active = true;
    setLoading(true);
    setSrc('');
    // Prefer the original-file viewer stream so the modal shows the real
    // document (PDF/image/webpage/...) just like the knowledge base preview,
    // instead of the parsed markdown/chunk content. Only fall back to the
    // embedded detail page when there is no directly previewable resource.
    void fetchFilePreview(file.spaceId, file.id)
      .then((manifest) => {
        if (!active) return;
        setSrc(manifest?.viewerUrl || `/space/${file.spaceId}/file/${file.id}?embed=1`);
      })
      .catch(() => {
        if (active) setSrc(`/space/${file.spaceId}/file/${file.id}?embed=1`);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [file]);

  useEffect(() => {
    if (!file) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [file, onClose]);

  if (!file) return null;

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
          {loading || !src ? (
            <div className={s.state}>正在加载预览...</div>
          ) : (
            <iframe className={s.frame} src={src} title={`${file.title} 预览`} />
          )}
        </div>
      </div>
    </div>
  );
}
