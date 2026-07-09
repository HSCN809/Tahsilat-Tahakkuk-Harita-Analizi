import React, { useMemo, useState } from 'react';
import { X, Search, ChevronUp, ChevronDown } from 'lucide-react';
import type { ProvinceRecord, SortColumn, SortDirection, ModalMetric, Category } from '../types';
import { formatCurrency } from '../utils/format';

interface ProvinceModalProps {
  metric: ModalMetric;
  records: ProvinceRecord[];
  selectedYear: number | null;
  selectedMonth: string;
  categories: Category[];
  selectedCategory: string;
  onClose: () => void;
}

export const ProvinceModal: React.FC<ProvinceModalProps> = ({
  metric,
  records,
  selectedYear,
  selectedMonth,
  categories,
  selectedCategory,
  onClose,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortColumn, setSortColumn] = useState<SortColumn>(metric);
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection(column === 'province' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (column: SortColumn) => {
    if (sortColumn !== column) return null;
    return sortDirection === 'asc'
      ? <ChevronUp className="w-3.5 h-3.5 ml-1 inline-block" />
      : <ChevronDown className="w-3.5 h-3.5 ml-1 inline-block" />;
  };

  const sortedRecords = useMemo(() => {
    const filtered = records.filter(r =>
      r.province.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return [...filtered].sort((a, b) => {
      if (sortColumn === 'province') {
        const valA = a.province.toLowerCase();
        const valB = b.province.toLowerCase();
        return sortDirection === 'asc'
          ? valA.localeCompare(valB, 'tr')
          : valB.localeCompare(valA, 'tr');
      } else {
        const valA = a[sortColumn] ?? 0;
        const valB = b[sortColumn] ?? 0;
        return sortDirection === 'desc' ? valB - valA : valA - valB;
      }
    });
  }, [records, searchQuery, sortColumn, sortDirection]);

  const title = metric === 'accrual'
    ? 'Tüm İller - Toplam Tahakkuk Detayları'
    : metric === 'collection'
      ? 'Tüm İller - Toplam Tahsilat Detayları'
      : 'Tüm İller - Tahsilat Oranı Detayları';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
      <div className="relative w-full max-w-4xl bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col gap-5 max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-100">{title}</h3>
            <p className="text-xs text-slate-400 mt-1">
              {selectedYear} Yılı - {selectedMonth} Dönemi | Kategori: {categories.find(c => c.id === selectedCategory)?.name || selectedCategory}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="relative w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <input
            type="text"
            placeholder="İl adına göre filtrele..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950/60 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 transition-all"
          />
        </div>

        {/* Table */}
        <div className="overflow-auto border border-slate-800 rounded-2xl bg-slate-950/40 scrollbar-thin">
          <table className="w-full text-sm text-left border-collapse">
            <thead className="sticky top-0 bg-slate-950 text-slate-400 z-10">
              <tr className="border-b border-slate-800">
                <th className="py-3 px-4 font-semibold text-center w-16 select-none bg-slate-950">Sıra</th>
                <th
                  onClick={() => handleSort('province')}
                  className="py-3 px-4 font-semibold cursor-pointer select-none hover:text-slate-200 transition-colors bg-slate-950"
                >
                  İl {renderSortIcon('province')}
                </th>
                <th
                  onClick={() => handleSort('accrual')}
                  className={`py-3 px-4 font-semibold text-right cursor-pointer select-none hover:text-slate-200 transition-colors ${sortColumn === 'accrual' ? 'text-blue-400 bg-[#0f1626]' : 'bg-slate-950'}`}
                >
                  Tahakkuk {renderSortIcon('accrual')}
                </th>
                <th
                  onClick={() => handleSort('collection')}
                  className={`py-3 px-4 font-semibold text-right cursor-pointer select-none hover:text-slate-200 transition-colors ${sortColumn === 'collection' ? 'text-emerald-400 bg-[#0b1b15]' : 'bg-slate-950'}`}
                >
                  Tahsilat {renderSortIcon('collection')}
                </th>
                <th
                  onClick={() => handleSort('ratio')}
                  className={`py-3 px-4 font-semibold text-right cursor-pointer select-none hover:text-slate-200 transition-colors ${sortColumn === 'ratio' ? 'text-purple-400 bg-[#161224]' : 'bg-slate-950'}`}
                >
                  Oran {renderSortIcon('ratio')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {sortedRecords.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-500 text-xs">Aradığınız kriterde il bulunamadı.</td>
                </tr>
              ) : (
                sortedRecords.map((record, index) => (
                  <tr key={record.province} className="hover:bg-slate-800/20 transition-all">
                    <td className="py-2.5 px-4 text-center font-mono text-xs text-slate-500 bg-slate-900/10">{index + 1}</td>
                    <td className="py-2.5 px-4 font-semibold text-slate-200">{record.province.toUpperCase()}</td>
                    <td className={`py-2.5 px-4 text-right font-mono text-slate-300 ${sortColumn === 'accrual' ? 'text-blue-400 font-bold bg-[#0f1626]' : ''}`}>
                      {formatCurrency(record.accrual)}
                    </td>
                    <td className={`py-2.5 px-4 text-right font-mono text-slate-300 ${sortColumn === 'collection' ? 'text-emerald-400 font-bold bg-[#0b1b15]' : ''}`}>
                      {formatCurrency(record.collection)}
                    </td>
                    <td className={`py-2.5 px-4 text-right font-mono font-bold ${sortColumn === 'ratio' ? 'text-purple-400 bg-[#161224]' : (record.ratio ?? 0) >= 75 ? 'text-emerald-400' : (record.ratio ?? 0) >= 50 ? 'text-yellow-400' : 'text-rose-400'}`}>
                      %{record.ratio?.toFixed(2)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center text-xs text-slate-500 border-t border-slate-800 pt-3">
          <span>Toplam: {sortedRecords.length} il gösteriliyor</span>
        </div>

      </div>
    </div>
  );
};
