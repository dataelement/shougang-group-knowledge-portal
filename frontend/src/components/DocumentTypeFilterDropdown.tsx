import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, X } from 'lucide-react';
import {
  findRuntimeDocumentTypeChild,
  findRuntimeDocumentTypeGroup,
  getDocumentTypeFilterLabel,
  normalizeDocumentTypeCode,
  type RuntimeDocumentTypeGroupOption,
} from '../utils/documentTypes';
import s from './DocumentTypeFilterDropdown.module.css';

interface DocumentTypeFilterDropdownProps {
  groups: RuntimeDocumentTypeGroupOption[];
  documentType?: string | null;
  fileSubcategoryCode?: string | null;
  placeholder?: string;
  compact?: boolean;
  onChange: (next: { documentType: string; fileSubcategoryCode: string }) => void;
}

export default function DocumentTypeFilterDropdown({
  groups,
  documentType,
  fileSubcategoryCode,
  placeholder = '文件分类',
  compact = false,
  onChange,
}: DocumentTypeFilterDropdownProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const normalizedDocumentType = normalizeDocumentTypeCode(documentType);
  const normalizedSubcategory = normalizeDocumentTypeCode(fileSubcategoryCode);
  const selectedChild = useMemo(
    () => findRuntimeDocumentTypeChild(groups, normalizedSubcategory),
    [groups, normalizedSubcategory],
  );
  const selectedGroup = useMemo(
    () => findRuntimeDocumentTypeGroup(groups, selectedChild?.parentCode || normalizedDocumentType),
    [groups, normalizedDocumentType, selectedChild?.parentCode],
  );
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState<string[]>(() => (selectedGroup ? [selectedGroup.code] : []));
  const hasValue = Boolean(normalizedDocumentType || normalizedSubcategory);
  const displayLabel = getDocumentTypeFilterLabel(
    groups,
    normalizedDocumentType,
    normalizedSubcategory,
    placeholder,
  );

  useEffect(() => {
    if (!open || !selectedGroup) return;
    setExpanded((current) => (current.includes(selectedGroup.code) ? current : [...current, selectedGroup.code]));
  }, [open, selectedGroup]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
    };
  }, [open]);

  const toggleGroup = (code: string) => {
    setExpanded((current) => (
      current.includes(code) ? current.filter((item) => item !== code) : [...current, code]
    ));
  };

  const triggerClassName = [
    s.trigger,
    compact ? s.compact : '',
    open ? s.open : '',
    hasValue ? s.hasValue : '',
  ].filter(Boolean).join(' ');

  return (
    <div ref={rootRef} className={s.root}>
      <button
        type="button"
        className={triggerClassName}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={s.triggerText}>{displayLabel}</span>
        {hasValue ? (
          <span
            role="button"
            tabIndex={0}
            className={s.clearButton}
            aria-label="清空文件分类"
            onClick={(event) => {
              event.stopPropagation();
              onChange({ documentType: '', fileSubcategoryCode: '' });
              setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              event.stopPropagation();
              onChange({ documentType: '', fileSubcategoryCode: '' });
              setOpen(false);
            }}
          >
            <X size={14} />
          </span>
        ) : null}
        <ChevronDown size={compact ? 14 : 16} className={s.triggerIcon} />
      </button>

      {open ? (
        <div className={s.menu} role="listbox">
          {groups.length === 0 ? (
            <div className={s.empty}>暂无文件分类</div>
          ) : groups.map((group) => {
            const isExpanded = expanded.includes(group.code);
            const parentActive = normalizedDocumentType === group.code && !normalizedSubcategory;
            return (
              <div key={group.code} className={s.group}>
                <div className={s.groupRow}>
                  <button
                    type="button"
                    className={s.expandButton}
                    onClick={() => toggleGroup(group.code)}
                    aria-label={`${isExpanded ? '收起' : '展开'}${group.label}`}
                  >
                    {isExpanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </button>
                  <button
                    type="button"
                    className={`${s.optionButton} ${parentActive ? s.active : ''}`}
                    onClick={() => {
                      onChange({ documentType: group.code, fileSubcategoryCode: '' });
                      setOpen(false);
                    }}
                  >
                    {group.code} / {group.label}
                  </button>
                </div>
                {isExpanded ? (
                  <div className={s.children}>
                    {group.children.map((child) => {
                      const childActive = normalizedSubcategory === child.code;
                      return (
                        <button
                          type="button"
                          key={child.code}
                          className={`${s.optionButton} ${s.childButton} ${childActive ? s.active : ''}`}
                          onClick={() => {
                            onChange({ documentType: child.parentCode, fileSubcategoryCode: child.code });
                            setOpen(false);
                          }}
                        >
                          {child.code} / {child.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
