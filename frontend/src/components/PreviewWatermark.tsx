import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { PortalUser } from '../api/auth';
import {
  buildPortalPreviewWatermarkLines,
  calculatePortalPreviewWatermarkPatternLayout,
  measurePortalPreviewWatermarkLineWidths,
} from '../utils/previewWatermark';
import s from './PreviewWatermark.module.css';

interface PreviewWatermarkProps {
  children: ReactNode;
  user: PortalUser;
}

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
  const patternId = `portal-preview-watermark-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const fallbackLayout = useMemo(
    () => calculatePortalPreviewWatermarkPatternLayout(
      measurePortalPreviewWatermarkLineWidths(lines ?? []),
    ),
    [lines],
  );
  const [layout, setLayout] = useState(fallbackLayout);

  useEffect(() => {
    if (!lines) return undefined;
    let active = true;
    const updateLayout = () => {
      const next = calculatePortalPreviewWatermarkPatternLayout(
        measurePortalPreviewWatermarkLineWidths(lines),
      );
      if (active) setLayout(next);
    };
    updateLayout();
    void document.fonts?.ready.then(updateLayout);
    return () => { active = false; };
  }, [lines]);

  if (!lines) return null;

  return (
    <div className={s.overlay} aria-hidden="true">
      <svg className={s.patternCanvas} width="100%" height="100%">
        <defs>
          <pattern
            id={patternId}
            patternUnits="userSpaceOnUse"
            width={layout.cellWidth}
            height={layout.patternHeight}
            overflow="visible"
          >
            <g transform={`translate(${layout.anchorX} ${layout.anchorY}) rotate(${layout.rotation})`}>
              <text className={s.text} x="0" y={layout.fontSize}>{lines[0]}</text>
              <text className={s.text} x="0" y={layout.fontSize + layout.lineHeight}>{lines[1]}</text>
            </g>
            <g transform={`translate(${layout.anchorX + layout.secondRowOffsetX} ${layout.cellHeight + layout.anchorY}) rotate(${layout.rotation})`}>
              <text className={s.text} x="0" y={layout.fontSize}>{lines[0]}</text>
              <text className={s.text} x="0" y={layout.fontSize + layout.lineHeight}>{lines[1]}</text>
            </g>
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
    </div>
  );
}
