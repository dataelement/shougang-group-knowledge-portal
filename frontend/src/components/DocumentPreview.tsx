import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import * as mammoth from 'mammoth';
import { marked } from 'marked';
import * as XLSX from 'xlsx';
import type { FileChunkItem } from '../api/content';
import type { ResolvedFilePreview } from '../utils/filePreview';
import s from './DocumentPreview.module.css';
import PdfPreview from './PdfPreview';

interface Props {
  chunks: FileChunkItem[];
  onPreviewFailure: () => void;
  preview: ResolvedFilePreview;
  title: string;
}

interface PreviewAsset {
  buffer: ArrayBuffer;
  contentType: string;
}

async function fetchPreviewAsset(sourceUrl: string, signal?: AbortSignal): Promise<PreviewAsset> {
  const response = await fetch(sourceUrl, { credentials: 'include', signal });
  if (!response.ok) throw new Error('预览资源请求失败');
  const buffer = await response.arrayBuffer();
  return {
    buffer,
    contentType: detectContentType(buffer, response.headers.get('content-type')),
  };
}

function detectContentType(buffer: ArrayBuffer, contentTypeHeader: string | null): string {
  const headerContentType = (contentTypeHeader ?? '').split(';')[0].trim().toLowerCase();
  if (headerContentType && headerContentType !== 'application/octet-stream') {
    return headerContentType;
  }

  const bytes = new Uint8Array(buffer.slice(0, 16));
  const textStart = decodeAscii(buffer.slice(0, 256)).trimStart().toLowerCase();
  if (textStart.startsWith('%pdf-')) return 'application/pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (textStart.startsWith('gif87a') || textStart.startsWith('gif89a')) return 'image/gif';
  if (textStart.startsWith('<svg') || textStart.startsWith('<?xml')) return 'image/svg+xml';
  if (textStart.startsWith('<!doctype html') || textStart.startsWith('<html')) return 'text/html';
  if (textStart.startsWith('riff') && textStart.slice(8, 12) === 'webp') return 'image/webp';
  if (textStart.startsWith('bm')) return 'image/bmp';
  return headerContentType || 'application/octet-stream';
}

function decodeAscii(buffer: ArrayBuffer): string {
  return String.fromCharCode(...new Uint8Array(buffer));
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function sanitizeHtml(value: string): string {
  return DOMPurify.sanitize(value, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['iframe', 'object', 'embed', 'script', 'style'],
  });
}

function decodeTextBuffer(buffer: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buffer);
  if (!utf8.includes('\ufffd')) return utf8;
  try {
    return new TextDecoder('gb18030').decode(buffer);
  } catch {
    return utf8;
  }
}

function isZipContainer(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 4));
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isCompoundOfficeDocument(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer.slice(0, 8));
  return (
    bytes[0] === 0xd0
    && bytes[1] === 0xcf
    && bytes[2] === 0x11
    && bytes[3] === 0xe0
    && bytes[4] === 0xa1
    && bytes[5] === 0xb1
    && bytes[6] === 0x1a
    && bytes[7] === 0xe1
  );
}

function LoadingState({ label }: { label: string }) {
  return <div className={s.state}>{label}</div>;
}

function FallbackState({ reason }: { reason: string }) {
  return (
    <div className={s.state}>
      <strong>暂不支持在线预览</strong>
      <span>{reason}</span>
    </div>
  );
}

function ChunkFallbackPreview({ chunks, reason }: { chunks: FileChunkItem[]; reason: string }) {
  if (!chunks.length) return <FallbackState reason={reason || '当前文件没有可展示的正文分段内容。'} />;
  return (
    <div className={s.scrollSurface}>
      <div className={s.textContent}>
        {chunks.map((chunk) => (
          <section key={chunk.chunkIndex} className={s.textBlock}>
            <h3 className={s.textTitle}>第 {chunk.chunkIndex + 1} 段</h3>
            <pre className={s.textBody}>{chunk.text}</pre>
          </section>
        ))}
      </div>
    </div>
  );
}

function ImagePreview({ title, viewerUrl, onPreviewFailure }: { title: string; viewerUrl: string; onPreviewFailure: () => void }) {
  const [imageUrl, setImageUrl] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    const controller = new AbortController();
    setLoading(true);
    setImageUrl('');
    void (async () => {
      try {
        const asset = await fetchPreviewAsset(viewerUrl, controller.signal);
        objectUrl = URL.createObjectURL(new Blob([asset.buffer], { type: asset.contentType }));
        if (!active) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setImageUrl(objectUrl);
      } catch (error) {
        if (!active || isAbortError(error)) return;
        onPreviewFailure();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [onPreviewFailure, viewerUrl]);

  if (loading) return <LoadingState label="正在加载图片预览..." />;
  if (!imageUrl) return <FallbackState reason="图片预览资源不可用。" />;
  return (
    <div className={s.imageSurface}>
      <img
        className={s.image}
        src={imageUrl}
        alt={`${title} 预览`}
        onError={onPreviewFailure}
      />
    </div>
  );
}

function HtmlPreview({
  sourceUrl,
  onPreviewFailure,
}: {
  sourceUrl: string;
  onPreviewFailure: () => void;
}) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setHtml('');
    void (async () => {
      try {
        const { buffer } = await fetchPreviewAsset(sourceUrl, controller.signal);
        if (!active) return;
        setHtml(sanitizeHtml(decodeTextBuffer(buffer)));
      } catch (error) {
        if (!active || isAbortError(error)) return;
        onPreviewFailure();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [onPreviewFailure, sourceUrl]);

  if (loading) return <LoadingState label="正在加载 HTML 预览..." />;
  return <div className={s.richContent} dangerouslySetInnerHTML={{ __html: html }} />;
}

function MarkdownPreview({
  sourceUrl,
  onPreviewFailure,
}: {
  sourceUrl: string;
  onPreviewFailure: () => void;
}) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setHtml('');
    void (async () => {
      try {
        const { buffer } = await fetchPreviewAsset(sourceUrl, controller.signal);
        const rendered = marked.parse(decodeTextBuffer(buffer));
        if (!active) return;
        setHtml(sanitizeHtml(typeof rendered === 'string' ? rendered : ''));
      } catch (error) {
        if (!active || isAbortError(error)) return;
        onPreviewFailure();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [onPreviewFailure, sourceUrl]);

  if (loading) return <LoadingState label="正在加载 Markdown 预览..." />;
  return <div className={s.richContent} dangerouslySetInnerHTML={{ __html: html }} />;
}

function TextPreview({
  sourceUrl,
  onPreviewFailure,
}: {
  sourceUrl: string;
  onPreviewFailure: () => void;
}) {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setContent('');
    void (async () => {
      try {
        const { buffer } = await fetchPreviewAsset(sourceUrl, controller.signal);
        if (!active) return;
        setContent(decodeTextBuffer(buffer));
      } catch (error) {
        if (!active || isAbortError(error)) return;
        onPreviewFailure();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [onPreviewFailure, sourceUrl]);

  if (loading) return <LoadingState label="正在加载文本预览..." />;
  return (
    <div className={s.scrollSurface}>
      <div className={s.textContent}>
        <pre className={s.textBody}>{content}</pre>
      </div>
    </div>
  );
}

function DocxPreview({
  sourceUrl,
  onPreviewFailure,
}: {
  sourceUrl: string;
  onPreviewFailure: () => void;
}) {
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setHtml('');
    void (async () => {
      try {
        const { buffer } = await fetchPreviewAsset(sourceUrl, controller.signal);
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer });
        if (!active) return;
        setHtml(sanitizeHtml(result.value));
      } catch (error) {
        if (!active || isAbortError(error)) return;
        onPreviewFailure();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
    };
  }, [onPreviewFailure, sourceUrl]);

  if (loading) return <LoadingState label="正在加载 DOCX 预览..." />;
  return <div className={s.richContent} dangerouslySetInnerHTML={{ __html: html }} />;
}

function SpreadsheetPreview({
  sourceUrl,
  onPreviewFailure,
}: {
  sourceUrl: string;
  onPreviewFailure: () => void;
}) {
  const workbookRef = useRef<XLSX.WorkBook | null>(null);
  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(true);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [selectedSheet, setSelectedSheet] = useState('');

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    workbookRef.current = null;
    setLoading(true);
    setSheetNames([]);
    setSelectedSheet('');
    setHtml('');
    void (async () => {
      try {
        const { buffer } = await fetchPreviewAsset(sourceUrl, controller.signal);
        const workbook = (isZipContainer(buffer) || isCompoundOfficeDocument(buffer))
          ? XLSX.read(buffer, { dense: true, type: 'array' })
          : XLSX.read(decodeTextBuffer(buffer), { dense: true, type: 'string' });
        const nextSheetNames = workbook.SheetNames;
        if (!nextSheetNames.length) throw new Error('表格预览为空');
        if (!active) return;
        workbookRef.current = workbook;
        setSheetNames(nextSheetNames);
        setSelectedSheet(nextSheetNames[0]);
      } catch (error) {
        if (!active || isAbortError(error)) return;
        onPreviewFailure();
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      controller.abort();
      workbookRef.current = null;
    };
  }, [onPreviewFailure, sourceUrl]);

  useEffect(() => {
    if (!selectedSheet || !workbookRef.current) return;
    const worksheet = workbookRef.current.Sheets[selectedSheet];
    if (!worksheet) {
      setHtml('');
      return;
    }
    setHtml(sanitizeHtml(XLSX.utils.sheet_to_html(worksheet)));
  }, [selectedSheet]);

  if (loading) return <LoadingState label="正在加载表格预览..." />;
  return (
    <div className={s.scrollSurface}>
      {sheetNames.length > 1 && (
        <div className={s.sheetTabs}>
          {sheetNames.map((sheetName) => (
            <button
              key={sheetName}
              type="button"
              className={`${s.sheetTab} ${sheetName === selectedSheet ? s.sheetTabActive : ''}`}
              onClick={() => setSelectedSheet(sheetName)}
            >
              {sheetName}
            </button>
          ))}
        </div>
      )}
      <div className={s.sheetContent} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

export default function DocumentPreview({ chunks, onPreviewFailure, preview, title }: Props) {
  if (preview.mode === 'chunks') {
    return <ChunkFallbackPreview chunks={chunks} reason={preview.reason} />;
  }

  if (preview.mode === 'unsupported') {
    return <FallbackState reason={preview.reason} />;
  }

  if (!preview.viewerUrl) {
    return <FallbackState reason={preview.reason || '当前文件缺少可用的预览资源。'} />;
  }

  switch (preview.mode) {
    case 'pdf':
      return <PdfPreview key={preview.viewerUrl} sourceUrl={preview.viewerUrl} onPreviewFailure={onPreviewFailure} />;
    case 'docx':
      return <DocxPreview sourceUrl={preview.viewerUrl} onPreviewFailure={onPreviewFailure} />;
    case 'spreadsheet':
      return <SpreadsheetPreview sourceUrl={preview.viewerUrl} onPreviewFailure={onPreviewFailure} />;
    case 'markdown':
      return <MarkdownPreview sourceUrl={preview.viewerUrl} onPreviewFailure={onPreviewFailure} />;
    case 'html':
      return <HtmlPreview sourceUrl={preview.viewerUrl} onPreviewFailure={onPreviewFailure} />;
    case 'text':
      return <TextPreview sourceUrl={preview.viewerUrl} onPreviewFailure={onPreviewFailure} />;
    case 'image':
      return <ImagePreview title={title} viewerUrl={preview.viewerUrl} onPreviewFailure={onPreviewFailure} />;
    default:
      return <ChunkFallbackPreview chunks={chunks} reason={preview.reason} />;
  }
}
