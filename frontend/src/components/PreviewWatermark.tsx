import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { PortalUser } from '../api/auth';
import { usePortalConfig } from '../hooks/usePortalConfig';
import {
  buildPortalPreviewWatermarkLines,
  calculatePortalPreviewWatermarkLayout,
  calculatePortalPreviewWatermarkPositions,
  measurePortalPreviewWatermarkLineWidths,
} from '../utils/previewWatermark';
import { resolvePortalWatermarkHorizontalText } from '../utils/adminWatermarkConfig';
import s from './PreviewWatermark.module.css';

interface PreviewWatermarkProps {
  children: ReactNode;
  user: PortalUser;
}

interface PreviewWatermarkProviderProps {
  children: ReactNode;
  user?: PortalUser | null;
}

const PreviewWatermarkContext = createContext<string[] | null>(null);

export function PreviewWatermarkProvider({
  children,
  user,
}: PreviewWatermarkProviderProps) {
  const [viewedAt] = useState(() => new Date());
  const { config } = usePortalConfig();
  const horizontalText = resolvePortalWatermarkHorizontalText(config?.watermark?.horizontal_text);
  const lines = user ? buildPortalPreviewWatermarkLines(user, viewedAt, horizontalText) : null;

  return (
    <PreviewWatermarkContext.Provider value={lines}>
      {children}
    </PreviewWatermarkContext.Provider>
  );
}

export default function PreviewWatermark({ children, user }: PreviewWatermarkProps) {
  return (
    <PreviewWatermarkProvider user={user}>
      <div className={s.root}>
        <div className={s.content}>{children}</div>
      </div>
    </PreviewWatermarkProvider>
  );
}

export function PreviewWatermarkOverlay() {
  const lines = useContext(PreviewWatermarkContext);
  const overlayRef = useRef<HTMLDivElement>(null);
  const fallbackLayout = useMemo(
    () => calculatePortalPreviewWatermarkLayout(
      measurePortalPreviewWatermarkLineWidths(lines ?? []),
    ),
    [lines],
  );
  const [layout, setLayout] = useState(fallbackLayout);
  const [surfaceSize, setSurfaceSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    if (!lines) return undefined;
    let active = true;
    const updateLayout = () => {
      const next = calculatePortalPreviewWatermarkLayout(
        measurePortalPreviewWatermarkLineWidths(lines),
      );
      if (active) setLayout(next);
    };
    updateLayout();
    void document.fonts?.ready.then(updateLayout);
    return () => { active = false; };
  }, [lines]);

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return undefined;

    const updateSize = (width: number, height: number) => {
      setSurfaceSize((current) => (
        current.width === width && current.height === height
          ? current
          : { width, height }
      ));
    };
    const measure = () => {
      const rect = overlay.getBoundingClientRect();
      updateSize(rect.width, rect.height);
    };

    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(overlay);
    return () => observer.disconnect();
  }, [lines]);

  const positions = useMemo(
    () => calculatePortalPreviewWatermarkPositions(
      surfaceSize.width,
      surfaceSize.height,
      layout,
    ),
    [layout, surfaceSize.height, surfaceSize.width],
  );

  if (!lines) return null;

  return (
    <div ref={overlayRef} className={s.overlay} aria-hidden="true">
      <svg className={s.canvas} width="100%" height="100%">
        {positions.map((position) => (
          <g
            key={`${position.rowIndex}-${position.columnIndex}`}
            transform={`translate(${position.x} ${position.y}) rotate(${layout.rotation})`}
          >
            <text className={s.text} fillOpacity={layout.opacity} x="0" y={layout.fontSize}>{lines[0]}</text>
            <text className={s.text} fillOpacity={layout.opacity} x="0" y={layout.fontSize + layout.lineHeight}>{lines[1]}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}
