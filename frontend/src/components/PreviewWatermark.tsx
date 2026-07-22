import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { PortalUser } from '../api/auth';
import {
  buildPortalPreviewWatermarkLines,
  calculatePortalPreviewWatermarkGrid,
} from '../utils/previewWatermark';
import s from './PreviewWatermark.module.css';

interface PreviewWatermarkProps {
  children: ReactNode;
  user: PortalUser;
}

const WATERMARK_HORIZONTAL_STEP = 240;
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
  const overlayRef = useRef<HTMLDivElement>(null);
  const [grid, setGrid] = useState(() => calculatePortalPreviewWatermarkGrid(0, 0));

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return undefined;

    const updateGrid = (width: number, height: number) => {
      const next = calculatePortalPreviewWatermarkGrid(width, height);
      setGrid((current) => (
        current.columns === next.columns && current.rows === next.rows ? current : next
      ));
    };
    const initialRect = overlay.getBoundingClientRect();
    updateGrid(initialRect.width, initialRect.height);

    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect ?? overlay.getBoundingClientRect();
      updateGrid(rect.width, rect.height);
    });
    observer.observe(overlay);
    return () => observer.disconnect();
  }, []);

  if (!lines) return null;

  return (
    <div
      ref={overlayRef}
      className={s.overlay}
      aria-hidden="true"
      style={{ gridTemplateColumns: `repeat(${grid.columns}, ${WATERMARK_HORIZONTAL_STEP}px)` }}
    >
      {Array.from({ length: grid.tileCount }, (_, index) => (
        <div className={s.tile} key={index}>
          {lines.map((line) => <span className={s.line} key={line}>{line}</span>)}
        </div>
      ))}
    </div>
  );
}
