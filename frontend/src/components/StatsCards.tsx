import React from 'react';
import { ArrowDownWideNarrow } from 'lucide-react';
import { formatCurrency, formatPercent, getRatioTone } from '../utils/format';
import type { Summary, SortColumn } from '../types';

interface StatsCardsProps {
  stats: Summary | null;
  loading: boolean;
  activeSortColumn: SortColumn;
  onMetricClick?: (metric: SortColumn) => void;
}

const StatsCardsComponent: React.FC<StatsCardsProps> = ({
  stats,
  loading,
  activeSortColumn,
  onMetricClick,
}) => {
  const items: {
    key: SortColumn;
    label: string;
    value: string;
    valueClass?: string;
    accentTopClass: string;
  }[] = [
    {
      key: 'accrual',
      label: 'Toplam Tahakkuk',
      value: formatCurrency(stats?.total_accrual),
      accentTopClass: activeSortColumn === 'accrual' ? 'border-t-2 border-t-[#1E242B]' : '',
    },
    {
      key: 'collection',
      label: 'Toplam Tahsilat',
      value: formatCurrency(stats?.total_collection),
      accentTopClass: activeSortColumn === 'collection' ? 'border-t-2 border-t-[#1E242B]' : '',
    },
    {
      key: 'ratio',
      label: 'Tahsilat / Tahakkuk Oranı',
      value: stats ? formatPercent(stats.overall_ratio) : '-%',
      valueClass: getRatioTone(stats?.overall_ratio).textClass,
      accentTopClass: activeSortColumn === 'ratio' ? 'border-t-2 border-t-[#1B6B63]' : '',
    },
  ];

  return (
    <section
      aria-label="Dönem Özet Göstergeleri"
      className="bg-white border border-[#D9D4C9] grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-[#D9D4C9]"
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onMetricClick?.(item.key)}
          className={`group text-left px-5 py-3.5 transition-colors duration-150 hover:bg-[#FCFBF8] cursor-pointer flex items-baseline justify-between gap-4 ${item.accentTopClass}`}
          title="İl kütüğünü bu sütuna göre sırala"
        >
          <div className="min-w-0">
            <span className="block text-[11px] font-bold uppercase tracking-[0.06em] text-[#525A63]">
              {item.label}
            </span>
            <div className={`mt-1 text-2xl font-bold tracking-[-0.02em] tabular-nums ${item.valueClass ?? 'text-[#1E242B]'}`}>
              {loading ? (
                <span className="inline-block w-36 h-7 bg-[#EFECE4] rounded-[2px] animate-pulse align-middle" />
              ) : (
                item.value
              )}
            </div>
          </div>
          <span className="text-[11px] font-semibold text-[#525A63] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity duration-150 inline-flex items-center gap-1 shrink-0">
            <ArrowDownWideNarrow className="w-3.5 h-3.5" />
            Sırala
          </span>
        </button>
      ))}
    </section>
  );
};

export const StatsCards = React.memo(StatsCardsComponent);
