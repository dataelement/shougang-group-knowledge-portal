import s from './FilterBar.module.css';

interface FilterDef {
  label: string;
  value: string;
  options: Array<{ label: string; value: string }>;
  onChange: (v: string) => void;
}

interface Props {
  filters: FilterDef[];
  className?: string;
}

export default function FilterBar({ filters, className = '' }: Props) {
  return (
    <div className={`${s.bar} ${className}`.trim()}>
      {filters.map((f) => (
        <select
          key={f.label}
          className={s.select}
          value={f.value}
          onChange={(e) => f.onChange(e.target.value)}
          aria-label={f.label}
        >
          {f.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      ))}
    </div>
  );
}
