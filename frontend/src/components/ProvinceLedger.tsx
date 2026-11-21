import React, { useMemo, useState } from 'react';
import { Search, ChevronUp, ChevronDown } from 'lucide-react';
import type { ProvinceRecord, SortColumn, SortDirection, Category } from '../types';
import { formatCurrency, formatPercent, getRatioTone } from '../utils/format';
import { findRegionForProvince, normalizeProvinceName } from '../utils/provinces';

interface ProvinceLedgerProps {
  records: ProvinceRecord[];
  loading: boolean;
  selectedYear: number | null;
  selectedMonth: string;
  categories: Category[];
  selectedCategory: string;
  selectedRegion: string;
  selectedProvince: string | null;
  sortColumn: SortColumn;
  sortDirection: SortDirection;
  onSortChange: (col: SortColumn, dir: SortDirection) => void;
  onSelectProvince: (normalized: string | null) => void;
}

const trCollator = new Intl.Collator('tr-TR', { numeric: true, sensitivity: 'base' });

const SORT_LABELS: Record<SortColumn, string> = {
  province: 'İl',
  accrual: 'Tahakkuk',
  collection: 'Tahsilat',
  ratio: 'Oran (%)',
};

export const ProvinceLedger: React.FC<ProvinceLedgerProps> = ({
  records,
  loading,
  selectedYear,
  selectedMonth,
  categories,
  selectedCategory,
  selectedRegion,
  selectedProvince,
  sortColumn,
  sortDirection,
  onSortChange,
  onSelectProvince,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortAnnouncement, setSortAnnouncement] = useState('');

  const handleSort = (column: SortColumn) => {
    const nextDir: SortDirection =
      sortColumn === column
        ? (sortDirection === 'asc' ? 'desc' : 'asc')
        : (column === 'province' ? 'asc' : 'desc');
    onSortChange(column, nextDir);
    setSortAnnouncement(
      `${SORT_LABELS[column]} sütununa göre ${nextDir === 'asc' ? 'artan' : 'azalan'} sıralandı.`
    );
  };

  const renderSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc' ? (
      <ChevronUp className="w-3.5 h-3.5 ml-1 inline-block" />
    ) : (
      <ChevronDown className="w-3.5 h-3.5 ml-1 inline-block" />
    );
  };

  const sortedRecords = useMemo(() => {
    const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
    const filtered = q
      ? records.filter((r) => r.province.toLocaleLowerCase('tr-TR').includes(q))
      : records;

    return filtered.toSorted((a, b) => {
      if (sortColumn === 'province') {
        return sortDirection === 'asc'
          ? trCollator.compare(a.province, b.province)
          : trCollator.compare(b.province, a.province);
      }
      const valA = a[sortColumn] ?? 0;
      const valB = b[sortColumn] ?? 0;
      return sortDirection === 'desc' ? valB - valA : valA - valB;
    });
  }, [records, searchQuery, sortColumn, sortDirection]);

  const activeCategoryName =
    categories.find((c) => c.id === selectedCategory)?.name || selectedCategory;

  return (
    <section
      id="il-kutugu"
      aria-label="İl Bazlı Tam Dağılım Kütüğü"
      className="bg-white border border-[#D9D4C9] rounded-[4px] p-5 flex flex-col gap-4"
    >
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 border-b border-[#1E242B] pb-3">
        <div>
          <h2 className="text-lg font-bold text-[#1E242B]">
            İl Bazlı Tam Dağılım Kütüğü
          </h2>
          <p className="text-xs text-[#525A63] mt-0.5">
            {selectedYear ?? '—'} · {selectedMonth || '—'} · {selectedRegion} · {activeCategoryName || 'Tüm Kalemler'}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="relative w-full md:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#525A63]" />
            <input
              type="text"
              aria-label="Kütükte il ara"
              placeholder="İl adına göre filtrele…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#FAF9F6] border border-[#857E72] rounded-[4px] pl-9 pr-3 py-1.5 text-sm text-[#1E242B] placeholder-[#525A63] focus:border-[#9E2A2B] transition-colors duration-150"
            />
          </div>
          <span className="text-xs font-semibold text-[#525A63] tabular-nums shrink-0">
            {sortedRecords.length} il
          </span>
        </div>
      </div>

      <div role="status" aria-live="polite" className="sr-only">
        {sortAnnouncement}
      </div>

      <div tabIndex={0} role="region" aria-labelledby="ledger-caption" className="overflow-x-auto border border-[#D9D4C9] rounded-[2px]">
        <table className="w-full text-xs sm:text-sm text-left border-collapse tabular-nums">
          <caption id="ledger-caption" className="sr-only">
            İl bazlı tahakkuk, tahsilat ve tahsilat oranı kütüğü
          </caption>
          <thead className="bg-[#FAF9F6] text-[#525A63] border-b border-[#1E242B]">
            <tr className="text-[11px] font-bold uppercase tracking-[0.04em]">
              <th scope="col" className="py-2.5 px-2 sm:px-3 text-center w-10 sm:w-14">Sıra</th>
              <th
                scope="col"
                aria-sort={sortColumn === 'province' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                className="p-0"
              >
                <button
                  type="button"
                  onClick={() => handleSort('province')}
                  className="w-full min-h-6 py-2.5 px-2 sm:px-3 inline-flex items-center font-bold uppercase tracking-[0.04em] hover:text-[#1E242B] cursor-pointer"
                >
                  İl {renderSortIcon('province')}
                </button>
              </th>
              <th scope="col" className="py-2.5 px-3 hidden md:table-cell">Bölge</th>
              <th
                scope="col"
                aria-sort={sortColumn === 'accrual' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                className="p-0 text-right hidden sm:table-cell"
              >
                <button
                  type="button"
                  onClick={() => handleSort('accrual')}
                  className={`w-full min-h-6 py-2.5 px-3 inline-flex items-center justify-end font-bold uppercase tracking-[0.04em] hover:text-[#1E242B] cursor-pointer ${
                    sortColumn === 'accrual' ? 'text-[#1E242B]' : ''
                  }`}
                >
                  Tahakkuk {renderSortIcon('accrual')}
                </button>
              </th>
              <th
                scope="col"
                aria-sort={sortColumn === 'collection' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                className="p-0 text-right"
              >
                <button
                  type="button"
                  onClick={() => handleSort('collection')}
                  className={`w-full min-h-6 py-2.5 px-2 sm:px-3 inline-flex items-center justify-end font-bold uppercase tracking-[0.04em] hover:text-[#1E242B] cursor-pointer ${
                    sortColumn === 'collection' ? 'text-[#1E242B]' : ''
                  }`}
                >
                  Tahsilat {renderSortIcon('collection')}
                </button>
              </th>
              <th
                scope="col"
                aria-sort={sortColumn === 'ratio' ? (sortDirection === 'asc' ? 'ascending' : 'descending') : undefined}
                className="p-0 text-right"
              >
                <button
                  type="button"
                  onClick={() => handleSort('ratio')}
                  className={`w-full min-h-6 py-2.5 px-2 sm:px-3 inline-flex items-center justify-end font-bold uppercase tracking-[0.04em] hover:text-[#1E242B] cursor-pointer ${
                    sortColumn === 'ratio' ? 'text-[#9E2A2B]' : ''
                  }`}
                >
                  Oran (%) {renderSortIcon('ratio')}
                </button>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#EAE5DA]">
            {loading ? (
              [...Array(8)].map((_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="py-2.5 px-3">
                    <div className="h-5 bg-[#EFECE4] rounded-[2px] motion-safe:animate-pulse" />
                  </td>
                </tr>
              ))
            ) : sortedRecords.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-sm text-[#525A63]">
                  Arama kriterine uygun il bulunamadı. Arama metnini temizleyerek tüm illeri görebilirsiniz.
                </td>
              </tr>
            ) : (
              sortedRecords.map((record, index) => {
                const normalized = normalizeProvinceName(record.province);
                const isSelected = selectedProvince === normalized;
                const region = findRegionForProvince(record.province) ?? '—';
                const ratioTone = getRatioTone(record.ratio).textClass;

                return (
                  <tr
                    key={record.province}
                    onClick={() => onSelectProvince(isSelected ? null : normalized)}
                    className={`cursor-pointer transition-colors duration-150 ${
                      isSelected ? 'bg-[#F9EDED]' : 'hover:bg-[#FCFBF8]'
                    }`}
                  >
                    <td className="py-2.5 px-2 sm:px-3 text-center text-xs text-[#525A63]">{index + 1}</td>
                    <td className="py-2.5 px-2 sm:px-3 font-semibold text-[#1E242B]">
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProvince(isSelected ? null : normalized);
                        }}
                        className="text-left cursor-pointer hover:underline rounded-[2px]"
                      >
                        {record.province.toLocaleUpperCase('tr-TR')}
                      </button>
                      <span className="mt-0.5 block sm:hidden text-[11px] font-normal text-[#525A63]">
                        Tahakkuk: <span className="whitespace-nowrap">{formatCurrency(record.accrual)}</span>
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-[#525A63] hidden md:table-cell">{region}</td>
                    <td className="py-2.5 px-3 text-right text-[#1E242B] hidden sm:table-cell">
                      {formatCurrency(record.accrual)}
                    </td>
                    <td className="py-2.5 px-2 sm:px-3 text-right text-[#1E242B] whitespace-nowrap">
                      {formatCurrency(record.collection)}
                    </td>
                    <td className={`py-2.5 px-2 sm:px-3 text-right font-bold whitespace-nowrap ${ratioTone}`}>
                      {record.ratio !== null ? formatPercent(record.ratio) : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
};
