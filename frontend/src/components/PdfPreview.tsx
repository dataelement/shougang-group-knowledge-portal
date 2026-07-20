import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getDocument,
  PDFWorker,
  type PDFDocumentProxy,
  type RenderTask,
} from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker';
import s from './DocumentPreview.module.css';

const PDF_RANGE_CHUNK_SIZE = 1024 * 1024;
const PDF_RENDER_CONCURRENCY = 2;
const PDF_RENDER_SCALE = 1.25;
const PDF_MAX_DEVICE_PIXEL_RATIO = 1.5;
const PDF_PAGE_PLACEHOLDER_HEIGHT = 1040;

interface Props {
  sourceUrl: string;
  onPreviewFailure: () => void;
}

interface PageSize {
  height: number;
  width: number;
}

interface QueueEntry {
  reject: (reason?: unknown) => void;
  resolve: () => void;
  run: () => Promise<void>;
  signal: AbortSignal;
}

interface RenderQueue {
  enqueue: (run: () => Promise<void>, signal: AbortSignal) => Promise<void>;
}

function createRenderQueue(concurrency: number): RenderQueue {
  const pending: QueueEntry[] = [];
  let activeCount = 0;

  const drain = () => {
    while (activeCount < concurrency && pending.length > 0) {
      const entry = pending.shift();
      if (!entry) return;
      if (entry.signal.aborted) {
        entry.reject(new DOMException('PDF page render aborted', 'AbortError'));
        continue;
      }

      activeCount += 1;
      void entry.run()
        .then(entry.resolve, entry.reject)
        .finally(() => {
          activeCount -= 1;
          drain();
        });
    }
  };

  return {
    enqueue(run, signal) {
      return new Promise<void>((resolve, reject) => {
        pending.push({ reject, resolve, run, signal });
        drain();
      });
    },
  };
}

function isCancelledRender(error: unknown, signal: AbortSignal): boolean {
  if (signal.aborted) return true;
  if (error instanceof DOMException && error.name === 'AbortError') return true;
  return error instanceof Error && error.name === 'RenderingCancelledException';
}

function releaseCanvas(canvas: HTMLCanvasElement | null) {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
  canvas.removeAttribute('style');
}

function PdfPage({
  pdfDocument,
  pageNumber,
  queue,
  onFirstPageReady,
  onRenderFailure,
}: {
  pdfDocument: PDFDocumentProxy;
  pageNumber: number;
  queue: RenderQueue;
  onFirstPageReady: () => void;
  onRenderFailure: () => void;
}) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(pageNumber === 1);
  const [pageSize, setPageSize] = useState<PageSize | null>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || typeof IntersectionObserver === 'undefined') {
      setIsNearViewport(true);
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry) setIsNearViewport(entry.isIntersecting);
      },
      { root: null, rootMargin: '1200px 0px' },
    );
    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isNearViewport) return;
    releaseCanvas(canvasRef.current);
    setRendered(false);
  }, [isNearViewport]);

  useEffect(() => {
    if (!isNearViewport) return undefined;

    const controller = new AbortController();
    let renderTask: RenderTask | null = null;

    void queue.enqueue(async () => {
      const page = await pdfDocument.getPage(pageNumber);
      if (controller.signal.aborted) return;

      const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
      setPageSize({ height: viewport.height, width: viewport.width });

      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context || controller.signal.aborted) return;

      const pixelRatio = Math.min(window.devicePixelRatio || 1, PDF_MAX_DEVICE_PIXEL_RATIO);
      canvas.width = Math.ceil(viewport.width * pixelRatio);
      canvas.height = Math.ceil(viewport.height * pixelRatio);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      renderTask = page.render({ canvas, canvasContext: context, viewport });
      const cancelRender = () => renderTask?.cancel();
      controller.signal.addEventListener('abort', cancelRender, { once: true });
      try {
        await renderTask.promise;
        if (controller.signal.aborted) return;
        setRendered(true);
        if (pageNumber === 1) onFirstPageReady();
      } finally {
        controller.signal.removeEventListener('abort', cancelRender);
      }
    }, controller.signal).catch((error: unknown) => {
      if (!isCancelledRender(error, controller.signal)) {
        console.error(`[portal][pdf-preview] Failed to render page ${pageNumber}`, error);
        onRenderFailure();
      }
    });

    return () => {
      controller.abort();
      renderTask?.cancel();
    };
  }, [isNearViewport, onFirstPageReady, onRenderFailure, pageNumber, pdfDocument, queue]);

  const minHeight = pageSize ? pageSize.height + 62 : PDF_PAGE_PLACEHOLDER_HEIGHT;
  const width = pageSize ? pageSize.width + 34 : undefined;

  return (
    <section
      ref={sectionRef}
      className={s.pdfPage}
      style={{ minHeight, width }}
      aria-label={`PDF 第 ${pageNumber} 页`}
    >
      <div className={s.pageLabel}>第 {pageNumber} 页</div>
      <canvas ref={canvasRef} />
      {!rendered ? <div className={s.pdfPagePlaceholder}>正在加载第 {pageNumber} 页...</div> : null}
    </section>
  );
}

export default function PdfPreview({ sourceUrl, onPreviewFailure }: Props) {
  const [pdfDocument, setPdfDocument] = useState<PDFDocumentProxy | null>(null);
  const [firstPageReady, setFirstPageReady] = useState(false);
  const [renderQueue] = useState(() => createRenderQueue(PDF_RENDER_CONCURRENCY));

  useEffect(() => {
    let active = true;
    let pdfWorker: PDFWorker | null = null;

    pdfWorker = PDFWorker.create({ port: new PdfWorker() });
    const loadingTask = getDocument({
      url: sourceUrl,
      worker: pdfWorker,
      withCredentials: true,
      rangeChunkSize: PDF_RANGE_CHUNK_SIZE,
      disableStream: true,
      disableAutoFetch: true,
    });

    void loadingTask.promise
      .then((document) => {
        if (!active) return;
        setPdfDocument(document);
      })
      .catch((error: unknown) => {
        if (!active) return;
        console.error('[portal][pdf-preview] Failed to load document', error);
        onPreviewFailure();
      });

    return () => {
      active = false;
      void loadingTask.destroy();
      pdfWorker?.destroy();
    };
  }, [onPreviewFailure, sourceUrl]);

  const handleFirstPageReady = useCallback(() => setFirstPageReady(true), []);
  const handleRenderFailure = useCallback(() => onPreviewFailure(), [onPreviewFailure]);

  if (!pdfDocument) return <div className={s.state}>正在加载 PDF 文档...</div>;

  return (
    <div className={`${s.scrollSurface} ${s.pdfScrollSurface}`}>
      {!firstPageReady ? <div className={s.pdfLoadingBadge}>正在渲染首页...</div> : null}
      <div className={s.pdfDocument}>
        {Array.from({ length: pdfDocument.numPages }, (_, index) => (
          <PdfPage
            key={index + 1}
            pdfDocument={pdfDocument}
            pageNumber={index + 1}
            queue={renderQueue}
            onFirstPageReady={handleFirstPageReady}
            onRenderFailure={handleRenderFailure}
          />
        ))}
      </div>
    </div>
  );
}
