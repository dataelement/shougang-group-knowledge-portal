import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { FileItem } from '../api/content';
import { resolvePreviewModalFrameUrl } from '../utils/filePreview';
import s from './FilePreviewModal.module.css';

interface Props {
  file: FileItem | null;
  onClose: () => void;
}

export default function FilePreviewModal({ file, onClose }: Props) {
  const navigate = useNavigate();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [src, setSrc] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!file) return;
    setLoading(true);
    setSrc(resolvePreviewModalFrameUrl(file));
    setLoading(false);
  }, [file]);

  useEffect(() => {
    if (!file) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [file, onClose]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      if (event.data?.type === 'OPEN_KNOWLEDGE_READ') {
        const { spaceId, fileId, openChat } = event.data;
        onClose();
        const openChatParam = openChat ? '&openChat=1' : '';
        navigate(`/knowledge-spaces?spaceId=${spaceId}&fileId=${fileId}${openChatParam}`);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [navigate, onClose]);

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
            <iframe
              ref={frameRef}
              className={s.frame}
              src={src}
              title={`${file.title} 预览`}
            />
          )}
        </div>
      </div>
    </div>
  );
}
