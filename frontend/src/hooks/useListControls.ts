import { useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

export function useListControls() {
  const [params, setParams] = useSearchParams();
  const resultsTopRef = useRef<HTMLDivElement | null>(null);

  const setFilter = (key: string, value: string, resetPage = true) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (resetPage) next.delete('page');
    setParams(next);
  };

  return {
    params,
    resultsTopRef,
    setFilter,
    setParams,
  };
}
