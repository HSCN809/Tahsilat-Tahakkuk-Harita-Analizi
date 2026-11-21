import React, { useMemo, useState } from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatCurrency, formatPercent } from '../utils/format';
import { normalizeProvinceName } from '../utils/provinces';
import type { ProvinceRecord } from '../types';

interface LeaderboardProps {
  data: ProvinceRecord[];
  loading: boolean;
  selectedProvince: string | null;
  onSelectProvince: (normalized: string | null) => void;
}

const LeaderboardComponent: React.FC<LeaderboardProps> = ({
  data,
  loading,
  selectedProvince,
  onSelectProvince,
}) => {
  const [activeTab, setActiveTab] = useState<'top' | 'bottom'>('top');

  const { topProvinces, bottomProvinces } = useMemo(() => {
    const validData = data.filter(
      (item) => item.ratio !== null && item.ratio !== undefined
    ) as (ProvinceRecord & { ratio: number })[];

    return {
      topProvinces: [...validData].sort((a, b) => b.ratio - a.ratio).slice(0, 5),
      bottomProvinces: [...validData].sort((a, b) => a.ratio - b.ratio).slice(0, 5),
    };
  }, [data]);

  const rows = activeTab === 'top' ? topProvinces : bottomProvinces;

  return (
    <section
      aria-label="İl Performans Sıralaması"
      className="bg-white border border-[#D9D4C9] rounded-[4px] p-5 flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#1E242B] pb-2.5">
        <h2 className="text-base font-bold text-[#1E242B] flex items-center gap-1.5">
          {activeTab === 'top' ? (
            <ArrowUpRight className="w-4 h-4 text-[#1B6B63]" />
          ) : (
            <ArrowDownRight className="w-4 h-4 text-[#9E2A2B]" />
          )}
          <span>Oran Sıralaması</span>
        </h2>

        <div
          role="group"
          aria-label="Sıralama yönü"
          className="inline-flex border border-[#857E72] rounded-[3px] overflow-hidden bg-[#FAF9F6]"
        >
          <button
            type="button"
            aria-pressed={activeTab === 'top'}
            onClick={() => setActiveTab('top')}
            className={`px-2.5 py-1 text-xs font-semibold transition-colors duration-150 cursor-pointer border-r border-[#D9D4C9] ${
              activeTab === 'top'
                ? 'bg-[#1B6B63] text-white'
                : 'text-[#525A63] hover:text-[#1E242B]'
            }`}
          >
            En Yüksek 5
          </button>
          <button
            type="button"
            aria-pressed={activeTab === 'bottom'}
            onClick={() => setActiveTab('bottom')}
            className={`px-2.5 py-1 text-xs font-semibold transition-colors duration-150 cursor-pointer ${
              activeTab === 'bottom'
                ? 'bg-[#9E2A2B] text-white'
                : 'text-[#525A63] hover:text-[#1E242B]'
            }`}
          >
            En Düşük 5
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2.5">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-9 bg-[#EFECE4] rounded-[2px] motion-safe:animate-pulse" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-[#525A63] text-xs py-6 text-center">
          Seçili filtre için il verisi bulunamadı.
        </p>
      ) : (
        <div tabIndex={0} role="region" aria-labelledby="leaderboard-caption" className="overflow-x-auto">
          <table className="w-full text-[13px] text-left border-collapse tabular-nums">
            <caption id="leaderboard-caption" className="sr-only">
              {activeTab === 'top' ? 'Tahsilat oranı en yüksek 5 il' : 'Tahsilat oranı en düşük 5 il'}
            </caption>
            <thead>
              <tr className="text-[11px] font-bold uppercase tracking-[0.04em] text-[#525A63] border-b border-[#1E242B]">
                <th scope="col" className="pb-2 pr-2">İl</th>
                <th scope="col" className="pb-2 px-2 text-right">Tahsilat</th>
                <th scope="col" className="pb-2 pl-2 text-right">Oran</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#EAE5DA]">
              {rows.map((item, idx) => {
                const normalized = normalizeProvinceName(item.province);
                const isSelected = selectedProvince === normalized;
                return (
                  <tr
                    key={item.province}
                    onClick={() => onSelectProvince(isSelected ? null : normalized)}
                    className={`cursor-pointer transition-colors duration-150 ${
                      isSelected
                        ? 'bg-[#F9EDED]'
                        : 'hover:bg-[#FCFBF8]'
                    }`}
                  >
                    <td className="py-2.5 pr-2 font-semibold text-[#1E242B]">
                      <button
                        type="button"
                        aria-pressed={isSelected}
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectProvince(isSelected ? null : normalized);
                        }}
                        className="text-left cursor-pointer hover:underline rounded-[2px]"
                      >
                        <span className="inline-block w-5 text-[#525A63] font-normal">
                          {idx + 1}.
                        </span>
                        {item.province.toLocaleUpperCase('tr-TR')}
                      </button>
                    </td>
                    <td className="py-2.5 px-2 text-right text-[#525A63]">
                      {formatCurrency(item.collection)}
                    </td>
                    <td
                      className={`py-2.5 pl-2 text-right font-bold ${
                        activeTab === 'top' ? 'text-[#1B6B63]' : 'text-[#9E2A2B]'
                      }`}
                    >
                      {formatPercent(item.ratio)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export const Leaderboard = React.memo(LeaderboardComponent);
