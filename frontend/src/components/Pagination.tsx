import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getPaginationPages } from '../utils/pagination';
import s from './Pagination.module.css';

interface Props {
  page: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
  alwaysShow?: boolean;
}

export default function Pagination({ page, total, pageSize, onChange, alwaysShow }: Props) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1 && !alwaysShow) return null;
  const pages = getPaginationPages(page, totalPages);

  return (
    <div className={s.wrap}>
      <button
        className={`${s.btn} ${page <= 1 ? s.disabled : ''}`}
        onClick={() => page > 1 && onChange(page - 1)}
      >
        <ChevronLeft size={16} />
      </button>
      {pages.map((p, i) =>
        p === '...' ? (
          <span key={`e${i}`} className={s.ellipsis}>...</span>
        ) : (
          <button
            key={p}
            className={`${s.btn} ${p === page ? s.active : ''}`}
            onClick={() => onChange(p)}
          >
            {p}
          </button>
        )
      )}
      <button
        className={`${s.btn} ${page >= totalPages ? s.disabled : ''}`}
        onClick={() => page < totalPages && onChange(page + 1)}
      >
        <ChevronRight size={16} />
      </button>
    </div>
  );
}
