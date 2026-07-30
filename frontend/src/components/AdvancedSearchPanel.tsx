import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { ChevronUp, Loader2 } from 'lucide-react';
import { fetchAggregatedTags, fetchKnowledgeSpaces, type KnowledgeSpace } from '../api/content';
import { FILE_EXT_OPTIONS } from '../constants/fileTypes';
import { usePortalConfig } from '../hooks/usePortalConfig';
import { getBusinessDomainFilterOptions } from '../utils/businessDomains';
import {
  getRuntimeDocumentTypeGroups,
} from '../utils/documentTypes';
import type { AdvancedSearchForm, AdvancedSearchField } from '../utils/advancedSearch';
import DocumentTypeFilterDropdown from './DocumentTypeFilterDropdown';
import s from './AdvancedSearchPanel.module.css';

const SPACE_LEVEL_OPTIONS = [
  { value: 'public', label: '公共知识库' },
  { value: 'department', label: '部门知识库' },
  { value: 'team', label: '团队/科室知识库' },
  { value: 'personal', label: '个人知识库' },
];

const SEARCH_FIELD_OPTIONS: Array<{ value: AdvancedSearchField; label: string }> = [
  { value: 'file_name', label: '文件名' },
  { value: 'summary', label: '摘要' },
  { value: 'tags', label: '标签' },
];

interface AdvancedSearchPanelProps {
  value: AdvancedSearchForm;
  onChange: Dispatch<SetStateAction<AdvancedSearchForm>>;
  onSubmit: () => void;
  onReset: () => void;
  onCollapse: () => void;
  className?: string;
}

export default function AdvancedSearchPanel({
  value,
  onChange,
  onSubmit,
  onReset,
  onCollapse,
  className = '',
}: AdvancedSearchPanelProps) {
  const { config } = usePortalConfig();
  const [spaces, setSpaces] = useState<KnowledgeSpace[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(true);

  const documentTypeGroups = useMemo(
    () => getRuntimeDocumentTypeGroups(config?.document_types),
    [config?.document_types],
  );
  const businessDomainOptions = useMemo(
    () => getBusinessDomainFilterOptions(config?.domains),
    [config?.domains],
  );
  const filteredSpaces = useMemo(
    () => spaces.filter((space) => !value.spaceLevel || space.spaceLevel === value.spaceLevel),
    [spaces, value.spaceLevel],
  );

  useEffect(() => {
    let active = true;
    void fetchKnowledgeSpaces()
      .then((result) => {
        if (active) setSpaces(result.data);
      })
      .catch(() => {
        if (active) setSpaces([]);
      })
      .finally(() => {
        if (active) setLoadingSpaces(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    const selectedSpaceId = Number(value.spaceId);
    void fetchAggregatedTags(
      Number.isFinite(selectedSpaceId) && selectedSpaceId > 0 ? [selectedSpaceId] : undefined,
      value.spaceLevel || undefined,
      value.businessDomainCode || undefined,
    )
      .then((result) => {
        if (active) setTags(result);
      })
      .catch(() => {
        if (active) setTags([]);
      });
    return () => {
      active = false;
    };
  }, [value.businessDomainCode, value.spaceId, value.spaceLevel]);

  const update = <K extends keyof AdvancedSearchForm>(key: K, nextValue: AdvancedSearchForm[K]) => {
    onChange((current) => ({ ...current, [key]: nextValue }));
  };

  return (
    <section className={`${s.panel} ${className}`.trim()} aria-label="高级检索">
      <header className={s.header}>
        <h2>高级检索</h2>
        <button type="button" className={s.collapseButton} onClick={onCollapse}>
          收起 <ChevronUp size={15} />
        </button>
      </header>

      <div className={s.body}>
        <h3>关键词条件</h3>
        <div className={s.keywordGrid}>
          <label className={s.field}>
            <span>包含全部关键词</span>
            <input
              value={value.allKeywords}
              onChange={(event) => update('allKeywords', event.target.value)}
              placeholder="多个关键词请用空格分隔"
              maxLength={200}
            />
          </label>
          <label className={s.field}>
            <span>包含完整短语</span>
            <input
              value={value.exactPhrase}
              onChange={(event) => update('exactPhrase', event.target.value)}
              placeholder="输入需要连续匹配的短语"
              maxLength={200}
            />
          </label>
          <label className={s.field}>
            <span>包含任意关键词</span>
            <input
              value={value.anyKeywords}
              onChange={(event) => update('anyKeywords', event.target.value)}
              placeholder="多个关键词请用空格分隔"
              maxLength={200}
            />
          </label>
          <label className={s.field}>
            <span>排除关键词</span>
            <input
              value={value.excludeKeywords}
              onChange={(event) => update('excludeKeywords', event.target.value)}
              placeholder="多个关键词请用空格分隔"
              maxLength={200}
            />
          </label>
          <div className={`${s.field} ${s.fieldScope}`}>
            <span>字段范围</span>
            <div className={s.segmented} role="radiogroup" aria-label="字段范围">
              {SEARCH_FIELD_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={value.searchField === option.value}
                  className={value.searchField === option.value ? s.segmentActive : ''}
                  onClick={() => update('searchField', option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className={s.divider} />
        <h3>限定条件</h3>
        <div className={s.limitGrid}>
          <label className={s.field}>
            <span>知识库类型</span>
            <select
              value={value.spaceLevel}
              onChange={(event) => {
                onChange((current) => ({
                  ...current,
                  spaceLevel: event.target.value,
                  spaceId: '',
                }));
              }}
            >
              <option value="">全部类型</option>
              {SPACE_LEVEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            <span>知识库</span>
            <select value={value.spaceId} onChange={(event) => update('spaceId', event.target.value)}>
              <option value="">{loadingSpaces ? '加载中...' : '全部知识库'}</option>
              {filteredSpaces.map((space) => (
                <option key={space.id} value={String(space.id)}>{space.name}</option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            <span>业务领域</span>
            <select
              value={value.businessDomainCode}
              onChange={(event) => update('businessDomainCode', event.target.value)}
            >
              <option value="">全部业务领域</option>
              {businessDomainOptions.map((option) => (
                <option key={option.code} value={option.code}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className={s.field}>
            <span>文档分类</span>
            <DocumentTypeFilterDropdown
              groups={documentTypeGroups}
              documentType={value.documentType}
              fileSubcategoryCode={value.fileSubcategoryCode}
              placeholder="全部文档分类"
              onChange={(next) => {
                onChange((current) => ({
                  ...current,
                  documentType: next.documentType,
                  fileSubcategoryCode: next.fileSubcategoryCode,
                }));
              }}
            />
          </div>
          <label className={s.field}>
            <span>文件格式</span>
            <select value={value.fileExt} onChange={(event) => update('fileExt', event.target.value)}>
              <option value="">全部格式</option>
              {FILE_EXT_OPTIONS.map((option) => (
                <option key={option} value={option}>{option.toUpperCase()}</option>
              ))}
            </select>
          </label>
          <label className={s.field}>
            <span>标签</span>
            <select value={value.tag} onChange={(event) => update('tag', event.target.value)}>
              <option value="">全部标签</option>
              {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>
          </label>
          <div className={`${s.field} ${s.dateField}`}>
            <span>更新时间</span>
            <div className={s.dateRange}>
              <input
                type="date"
                value={value.updatedFrom}
                max={value.updatedTo || undefined}
                onChange={(event) => update('updatedFrom', event.target.value)}
                aria-label="更新时间起始日期"
              />
              <span>至</span>
              <input
                type="date"
                value={value.updatedTo}
                min={value.updatedFrom || undefined}
                onChange={(event) => update('updatedTo', event.target.value)}
                aria-label="更新时间结束日期"
              />
            </div>
          </div>
        </div>

        <footer className={s.actions}>
          <button type="button" className={s.resetButton} onClick={onReset}>重置条件</button>
          <button type="button" className={s.submitButton} onClick={onSubmit}>
            {loadingSpaces ? <Loader2 size={15} className={s.spinner} /> : null}
            检索
          </button>
        </footer>
      </div>
    </section>
  );
}
