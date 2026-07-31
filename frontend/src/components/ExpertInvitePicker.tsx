import { useCallback, useEffect, useRef, useState } from 'react';
import {
  RotateCcw,
  Search,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import {
  fetchExpertFilterOptions,
  fetchExpertProfiles,
  type ExpertFilterOptions,
  type ExpertProfileResponse,
} from '../api/expertQa';
import { getExpertAvatarColor, getExpertInitial } from '../utils/expertInvite';
import s from './ExpertInvitePicker.module.css';

const EXPERT_PAGE_SIZE = 20;
const SORT_ICON_BASE = '/assets/channel';

function getSortIconSrc(active: boolean, desc: boolean | null) {
  const direction = active && desc === true ? 'down' : 'up';
  return `${SORT_ICON_BASE}/sort-amount-${direction}${active ? '-blue' : ''}.svg`;
}

interface ExpertPickerFilters {
  jobFamily: string;
  jobCategory: string;
  position: string;
  major: string;
}

const EMPTY_FILTERS: ExpertPickerFilters = {
  jobFamily: '',
  jobCategory: '',
  position: '',
  major: '',
};

const EMPTY_FILTER_OPTIONS: ExpertFilterOptions = {
  departments: [],
  job_families: [],
  job_categories: [],
  positions: [],
  majors: [],
};

interface Props {
  invited: ExpertProfileResponse[];
  onClose: () => void;
  onToggle: (expert: ExpertProfileResponse) => void;
}

export default function ExpertInvitePicker({
  invited,
  onClose,
  onToggle,
}: Props) {
  const [experts, setExperts] = useState<ExpertProfileResponse[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<ExpertPickerFilters>(EMPTY_FILTERS);
  const [sorts, setSorts] = useState({
    answerDesc: null as boolean | null,
    adoptionDesc: null as boolean | null,
    voteDesc: null as boolean | null,
  });
  const [filterOptions, setFilterOptions] = useState<ExpertFilterOptions>(
    EMPTY_FILTER_OPTIONS,
  );
  const [filterOptionsLoading, setFilterOptionsLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const requestSequenceRef = useRef(0);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const hasActiveSort = sorts.answerDesc != null
    || sorts.adoptionDesc != null
    || sorts.voteDesc != null;
  const hasMoreExperts = experts.length < total;

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timeoutId);
  }, [searchInput]);

  useEffect(() => {
    const controller = new AbortController();
    setFilterOptionsLoading(true);
    fetchExpertFilterOptions(controller.signal)
      .then(setFilterOptions)
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFilterOptions(EMPTY_FILTER_OPTIONS);
      })
      .finally(() => {
        if (!controller.signal.aborted) setFilterOptionsLoading(false);
      });
    return () => controller.abort();
  }, []);

  const loadExperts = useCallback(
    async (
      targetPage: number,
      append: boolean,
      signal?: AbortSignal,
    ) => {
      const requestId = ++requestSequenceRef.current;
      setLoading(true);
      setLoadError('');
      try {
        const filterLabels = {
          jobFamily: filterOptions.job_families.find((item) => item.dict_key === filters.jobFamily)?.dict_value,
          jobCategory: filterOptions.job_categories.find((item) => item.dict_key === filters.jobCategory)?.dict_value,
          position: filterOptions.positions.find((item) => item.dict_key === filters.position)?.dict_value,
          major: filterOptions.majors.find((item) => item.dict_key === filters.major)?.dict_value,
        };
        const result = await fetchExpertProfiles(
          targetPage,
          EXPERT_PAGE_SIZE,
          search || undefined,
          signal,
          {
            ...filters,
            sortBy: 'expert_score',
            sortOrder: 'desc',
            answerDesc: sorts.answerDesc,
            adoptionDesc: sorts.adoptionDesc,
            voteDesc: sorts.voteDesc,
            filterLabels,
          },
        );
        if (signal?.aborted || requestId !== requestSequenceRef.current) return;
        setExperts((current) => (append ? [...current, ...result.experts] : result.experts));
        setTotal(result.total);
        setPage(targetPage);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (requestId !== requestSequenceRef.current) return;
        if (!append) setExperts([]);
        setLoadError('专家列表加载失败，请稍后重试');
      } finally {
        if (requestId === requestSequenceRef.current) setLoading(false);
      }
    },
    [filters, search, sorts, filterOptions],
  );

  useEffect(() => {
    const controller = new AbortController();
    setExperts([]);
    setPage(1);
    void loadExperts(1, false, controller.signal);
    return () => controller.abort();
  }, [loadExperts]);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  function handleFilterChange(key: keyof ExpertPickerFilters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleClearSearch() {
    setSearchInput('');
    setSearch('');
  }

  function handleResetFilters() {
    setFilters(EMPTY_FILTERS);
    setSorts({ answerDesc: null, adoptionDesc: null, voteDesc: null });
  }

  function handleSortToggle(key: 'answerDesc' | 'adoptionDesc' | 'voteDesc') {
    setSorts((current) => {
      const nextValue = current[key] === null ? true : current[key] === true ? false : null;
      return { ...current, [key]: nextValue };
    });
  }

  function handleListScroll() {
    const list = listRef.current;
    if (!list || loading || !hasMoreExperts) return;
    if (list.scrollTop + list.clientHeight >= list.scrollHeight - 32) {
      void loadExperts(page + 1, true);
    }
  }

  return (
    <div
      ref={panelRef}
      className={s.panel}
      role="dialog"
      aria-label="邀请专家"
    >
      <div className={s.toolbar}>
        <div className={s.searchWrap}>
          <Search size={16} className={s.searchIcon} aria-hidden />
          <input
            autoFocus
            type="search"
            className={s.searchInput}
            placeholder="搜索专家姓名或简介"
            aria-label="搜索专家姓名或简介"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
          />
          {searchInput ? (
            <button
              type="button"
              className={s.searchClear}
              onClick={handleClearSearch}
              aria-label="清空专家搜索"
            >
              <X size={14} />
            </button>
          ) : null}
        </div>
      </div>

      <div className={s.filterBar}>
        <div className={s.filterTitle}>
          <SlidersHorizontal size={14} aria-hidden />
          <span>筛选</span>
          {activeFilterCount ? (
            <span className={s.filterBadge}>{activeFilterCount}</span>
          ) : null}
        </div>
        <label className={s.filterField}>
          <span>职位族</span>
          <select
            className={s.filterSelect}
            value={filters.jobFamily}
            disabled={filterOptionsLoading}
            onChange={(event) => handleFilterChange('jobFamily', event.target.value)}
          >
            <option value="">全部职位族</option>
            {filterOptions.job_families.map((item) => (
              <option key={item.dict_key} value={item.dict_key}>{item.dict_value}</option>
            ))}
          </select>
        </label>
        <label className={s.filterField}>
          <span>职位类</span>
          <select
            className={s.filterSelect}
            value={filters.jobCategory}
            disabled={filterOptionsLoading}
            onChange={(event) => handleFilterChange('jobCategory', event.target.value)}
          >
            <option value="">全部职位类</option>
            {filterOptions.job_categories.map((item) => (
              <option key={item.dict_key} value={item.dict_key}>{item.dict_value}</option>
            ))}
          </select>
        </label>
        <label className={s.filterField}>
          <span>职务</span>
          <select
            className={s.filterSelect}
            value={filters.position}
            disabled={filterOptionsLoading}
            onChange={(event) => handleFilterChange('position', event.target.value)}
          >
            <option value="">全部职务</option>
            {filterOptions.positions.map((item) => (
              <option key={item.dict_key} value={item.dict_key}>{item.dict_value}</option>
            ))}
          </select>
        </label>
        <label className={s.filterField}>
          <span>岗位</span>
          <select
            className={s.filterSelect}
            value={filters.major}
            disabled={filterOptionsLoading}
            onChange={(event) => handleFilterChange('major', event.target.value)}
          >
            <option value="">全部岗位</option>
            {filterOptions.majors.map((item) => (
              <option key={item.dict_key} value={item.dict_key}>{item.dict_value}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={`${s.sortButton} ${sorts.answerDesc != null ? s.sortButtonActive : ''}`}
          onClick={() => handleSortToggle('answerDesc')}
        >
          <span>回答</span>
          <img
            className={s.sortIcon}
            src={getSortIconSrc(sorts.answerDesc != null, sorts.answerDesc)}
            alt="回答数排序"
            aria-hidden
          />
        </button>
        <button
          type="button"
          className={`${s.sortButton} ${sorts.adoptionDesc != null ? s.sortButtonActive : ''}`}
          onClick={() => handleSortToggle('adoptionDesc')}
        >
          <span>采纳</span>
          <img
            className={s.sortIcon}
            src={getSortIconSrc(sorts.adoptionDesc != null, sorts.adoptionDesc)}
            alt="采纳数排序"
            aria-hidden
          />
        </button>
        <button
          type="button"
          className={`${s.sortButton} ${sorts.voteDesc != null ? s.sortButtonActive : ''}`}
          onClick={() => handleSortToggle('voteDesc')}
        >
          <span>获赞</span>
          <img
            className={s.sortIcon}
            src={getSortIconSrc(sorts.voteDesc != null, sorts.voteDesc)}
            alt="获赞数排序"
            aria-hidden
          />
        </button>
        <button
          type="button"
          className={s.resetFilters}
          disabled={!activeFilterCount && !hasActiveSort}
          onClick={handleResetFilters}
        >
          <RotateCcw size={13} aria-hidden />
          重置筛选
        </button>
      </div>

      <div
        ref={listRef}
        className={s.list}
        onScroll={handleListScroll}
      >
        {!loading && loadError ? (
          <div className={s.empty}>{loadError}</div>
        ) : null}
        {!loading && !loadError && experts.length === 0 ? (
          <div className={s.empty}>未找到符合搜索或筛选条件的专家</div>
        ) : null}
        {experts.map((expert) => {
          const isSelected = invited.some((item) => item.id === expert.id);
          const maxReached = !isSelected && invited.length >= 3;
          return (
            <button
              key={expert.id}
              type="button"
              disabled={maxReached}
              className={`${s.row} ${isSelected ? s.rowSelected : ''}`}
              onClick={() => onToggle(expert)}
            >
              <span
                className={s.avatar}
                style={{ backgroundColor: getExpertAvatarColor(expert.expert_name) }}
              >
                {getExpertInitial(expert.expert_name)}
              </span>
              <span className={s.identity}>
                <span className={s.name}>{expert.expert_name}</span>
                <span className={s.department}>
                  {expert.depart_ment || '部门未填写'}
                  <i aria-hidden>·</i>
                  {expert.position || '职务未填写'}
                  <em>
                    （{expert.job_family?.replace(/族$/, '') || '职位族未填写'} - {expert.job_category?.replace(/类$/, '') || '职位类未填写'}）
                  </em>
                </span>
              </span>
              <span className={s.rowRight}>
                <span
                  className={s.stats}
                  aria-label={`回答数 ${expert.answer_count ?? 0}，采纳数 ${expert.adoption_count ?? 0}，获赞数 ${expert.vote_count ?? 0}`}
                >
                  <span>回答 <strong>{expert.answer_count ?? 0}</strong></span>
                  <span>采纳 <strong>{expert.adoption_count ?? 0}</strong></span>
                  <span>获赞 <strong>{expert.vote_count ?? 0}</strong></span>
                </span>
                <span className={s.major} title={expert.major || '岗位未填写'}>
                  {expert.major || '岗位未填写'}
                </span>
              </span>
              <span className={`${s.check} ${isSelected ? s.checkSelected : ''}`}>
                {isSelected ? '✓' : ''}
              </span>
            </button>
          );
        })}
        {loading ? <div className={s.loading}>加载中…</div> : null}
        {!loading && hasMoreExperts ? (
          <div className={s.scrollHint}>下滑加载更多</div>
        ) : null}
      </div>

      <div className={s.footer}>
        <span className={s.count}>
          已选 {invited.length} / 3
          <i aria-hidden>·</i>
          共 {total} 位专家
        </span>
        <button type="button" className={s.closeButton} onClick={onClose}>
          关闭
        </button>
      </div>
    </div>
  );
}
