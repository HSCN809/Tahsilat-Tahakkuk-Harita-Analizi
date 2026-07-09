import React, { useMemo } from 'react';
import { ArrowUpRight, ArrowDownRight } from 'lucide-react';
import { formatCurrency } from '../utils/format';
import type { ProvinceRecord } from '../types';

interface LeaderboardProps {
  data: ProvinceRecord[];
  loading: boolean;
}


const LeaderboardComponent: React.FC<LeaderboardProps> = ({ data, loading }) => {
  // Filter ve sort işlemlerini sadece data değiştiğinde hesapla
  const { topProvinces, bottomProvinces } = useMemo(() => {
    const validData = data.filter((item) => item.ratio !== null && item.ratio !== undefined) as (ProvinceRecord & { ratio: number })[];

    return {
      topProvinces: [...validData].sort((a, b) => b.ratio - a.ratio).slice(0, 5),
      bottomProvinces: [...validData].sort((a, b) => a.ratio - b.ratio).slice(0, 5),
    };
  }, [data]);

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* Top 5 */}
      <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2 mb-4">
          <span className="p-1.5 bg-emerald-500/10 text-emerald-400 rounded-lg">
            <ArrowUpRight className="w-4 h-4" />
          </span>
          Tahsilat Oranı En Yüksek İller
        </h3>
        
        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 bg-slate-800/40 rounded-lg animate-pulse"></div>
            ))}
          </div>
        ) : topProvinces.length === 0 ? (
          <p className="text-slate-500 text-sm py-4 text-center">Veri yok</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-slate-400 border-b border-slate-800">
                  <th className="pb-2 font-medium">İl</th>
                  <th className="pb-2 font-medium text-right">Tahsilat</th>
                  <th className="pb-2 font-medium text-right">Oran</th>
                </tr>
              </thead>
              <tbody>
                {topProvinces.map((item, idx) => (
                  <tr key={item.province} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20">
                    <td className="py-2.5 font-medium text-slate-200">
                      <span className="inline-block w-5 text-slate-500 text-xs">{idx + 1}.</span>
                      {item.province.toUpperCase()}
                    </td>
                    <td className="py-2.5 text-right text-slate-300 font-mono">{formatCurrency(item.collection)}</td>
                    <td className="py-2.5 text-right font-semibold text-emerald-400 font-mono">%{item.ratio.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Bottom 5 */}
      <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2 mb-4">
          <span className="p-1.5 bg-rose-500/10 text-rose-400 rounded-lg">
            <ArrowDownRight className="w-4 h-4" />
          </span>
          Tahsilat Oranı En Düşük İller
        </h3>

        {loading ? (
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 bg-slate-800/40 rounded-lg animate-pulse"></div>
            ))}
          </div>
        ) : bottomProvinces.length === 0 ? (
          <p className="text-slate-500 text-sm py-4 text-center">Veri yok</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead>
                <tr className="text-slate-400 border-b border-slate-800">
                  <th className="pb-2 font-medium">İl</th>
                  <th className="pb-2 font-medium text-right">Tahsilat</th>
                  <th className="pb-2 font-medium text-right">Oran</th>
                </tr>
              </thead>
              <tbody>
                {bottomProvinces.map((item, idx) => (
                  <tr key={item.province} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20">
                    <td className="py-2.5 font-medium text-slate-200">
                      <span className="inline-block w-5 text-slate-500 text-xs">{idx + 1}.</span>
                      {item.province.toUpperCase()}
                    </td>
                    <td className="py-2.5 text-right text-slate-300 font-mono">{formatCurrency(item.collection)}</td>
                    <td className="py-2.5 text-right font-semibold text-rose-400 font-mono">%{item.ratio.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export const Leaderboard = React.memo(LeaderboardComponent);
