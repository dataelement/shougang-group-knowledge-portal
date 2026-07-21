import { createContext, useContext, useState, type ReactNode } from 'react';

import type { PortalUser } from '../api/auth';
import { buildPortalPreviewWatermarkLines } from '../utils/previewWatermark';
import s from './PreviewWatermark.module.css';

interface PreviewWatermarkProps {
  children: ReactNode;
  user: PortalUser;
}

const WATERMARK_TILE_COUNT = 24;
const PreviewWatermarkContext = createContext<string[] | null>(null);

export default function PreviewWatermark({ children, user }: PreviewWatermarkProps) {
  const [viewedAt] = useState(() => new Date());
  const lines = buildPortalPreviewWatermarkLines(user, viewedAt);

  return (
    <PreviewWatermarkContext.Provider value={lines}>
      <div className={s.root}>
        <div className={s.content}>{children}</div>
      </div>
    </PreviewWatermarkContext.Provider>
  );
}

export function PreviewWatermarkOverlay() {
  const lines = useContext(PreviewWatermarkContext);
  if (!lines) return null;

  return (
    <div className={s.overlay} aria-hidden="true">
      {Array.from({ length: WATERMARK_TILE_COUNT }, (_, index) => (
        <div className={s.tile} key={index}>
          {lines.map((line) => <span key={line}>{line}</span>)}
        </div>
      ))}
    </div>
  );
}
