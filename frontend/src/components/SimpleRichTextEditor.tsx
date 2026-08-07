/**
 * Lightweight contenteditable rich-text editor (bold / italic / list).
 * Reuses questionRichText sanitize helpers; no new npm dependency.
 */

import { Bold, Italic, List } from 'lucide-react';
import { useEffect, useRef, type ClipboardEvent } from 'react';
import {
  normalizeQuestionDescriptionEditorHtml,
  toQuestionDescriptionEditorHtml,
} from '../utils/questionRichText';
import s from './SimpleRichTextEditor.module.css';

interface SimpleRichTextEditorProps {
  /** Stored HTML or legacy plain text. */
  value: string;
  onChange: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  'aria-label'?: string;
}

/**
 * Admin-facing rich text box; emits sanitized HTML on input/blur.
 */
export default function SimpleRichTextEditor({
  value,
  onChange,
  disabled = false,
  placeholder = '',
  'aria-label': ariaLabel,
}: SimpleRichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmittedRef = useRef(value);

  // Sync external value when not actively typing in this editor.
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (document.activeElement === el) return;
    if (value === lastEmittedRef.current && el.innerHTML) return;
    const html = toQuestionDescriptionEditorHtml(value);
    if (el.innerHTML !== html) {
      el.innerHTML = html || '';
    }
    lastEmittedRef.current = value;
  }, [value]);

  function emitFromEditor() {
    const raw = editorRef.current?.innerHTML || '';
    const html = normalizeQuestionDescriptionEditorHtml(raw);
    lastEmittedRef.current = html;
    onChange(html);
  }

  function runCommand(command: 'bold' | 'italic' | 'insertUnorderedList') {
    if (disabled) return;
    editorRef.current?.focus();
    document.execCommand(command);
    emitFromEditor();
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const plain = event.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, plain);
    emitFromEditor();
  }

  return (
    <div className={`${s.root} ${disabled ? s.disabled : ''}`}>
      <div className={s.toolbar} role="toolbar" aria-label="Formatting">
        <button
          type="button"
          className={s.toolBtn}
          disabled={disabled}
          title="Bold"
          aria-label="Bold"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('bold')}
        >
          <Bold size={15} />
        </button>
        <button
          type="button"
          className={s.toolBtn}
          disabled={disabled}
          title="Italic"
          aria-label="Italic"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('italic')}
        >
          <Italic size={15} />
        </button>
        <button
          type="button"
          className={s.toolBtn}
          disabled={disabled}
          title="Bullet list"
          aria-label="Bullet list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => runCommand('insertUnorderedList')}
        >
          <List size={15} />
        </button>
      </div>
      <div
        ref={editorRef}
        className={s.editor}
        contentEditable={!disabled}
        role="textbox"
        aria-multiline="true"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={emitFromEditor}
        onBlur={emitFromEditor}
        onPaste={handlePaste}
      />
    </div>
  );
}
