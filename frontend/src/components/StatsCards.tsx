import React from 'react';
import { Coins, TrendingUp, Percent } from 'lucide-react';

interface Stats {
  total_accrual: number;
  total_collection: number;
  overall_ratio: number;
}

interface StatsCardsProps {
  stats: Stats | null;
  loading: boolean;
  onCardClick?: (metric: 'accrual' | 'collection' | 'ratio') => void;
}

import { formatCurrency } from '../utils/format';


export const StatsCards: React.FC<StatsCardsProps> = ({ stats, loading, onCardClick }) => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
      {/* Card 1: Accrual */}
      <div 
        onClick={() => onCardClick?.('accrual')}
        className="relative overflow-hidden bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-5 flex items-center justify-between group transition-all duration-300 hover:border-blue-500/50 hover:shadow-[0_0_20px_rgba(59,130,246,0.1)] cursor-pointer hover:scale-[1.02]"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-all duration-500"></div>
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Toplam Tahakkuk</p>
          <h3 className="text-[18px] font-bold mt-0.5 text-slate-100 tracking-tight">
            {loading ? (
              <span className="inline-block w-24 h-6 bg-slate-850 rounded animate-pulse"></span>
            ) : (
              formatCurrency(stats?.total_accrual)
            )}
          </h3>
        </div>
        <div className="p-3 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl group-hover:scale-115 transition-all duration-300">
          <Coins className="w-6 h-6" />
        </div>
      </div>

      {/* Card 2: Collection */}
      <div 
        onClick={() => onCardClick?.('collection')}
        className="relative overflow-hidden bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-5 flex items-center justify-between group transition-all duration-300 hover:border-emerald-500/50 hover:shadow-[0_0_20px_rgba(16,185,129,0.1)] cursor-pointer hover:scale-[1.02]"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-500/5 rounded-full blur-2xl group-hover:bg-emerald-500/10 transition-all duration-500"></div>
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Toplam Tahsilat</p>
          <h3 className="text-[18px] font-bold mt-0.5 text-slate-100 tracking-tight">
            {loading ? (
              <span className="inline-block w-24 h-6 bg-slate-850 rounded animate-pulse"></span>
            ) : (
              formatCurrency(stats?.total_collection)
            )}
          </h3>
        </div>
        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl group-hover:scale-115 transition-all duration-300">
          <TrendingUp className="w-6 h-6" />
        </div>
      </div>

      {/* Card 3: Ratio */}
      <div 
        onClick={() => onCardClick?.('ratio')}
        className="relative overflow-hidden bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-5 flex items-center justify-between group transition-all duration-300 hover:border-purple-500/50 hover:shadow-[0_0_20px_rgba(168,85,247,0.1)] cursor-pointer hover:scale-[1.02]"
      >
        <div className="absolute top-0 right-0 w-32 h-32 bg-purple-500/5 rounded-full blur-2xl group-hover:bg-purple-500/10 transition-all duration-500"></div>
        <div>
          <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Tahsilat Oranı</p>
          <h3 className="text-[18px] font-bold mt-0.5 text-purple-400 tracking-tight">
            {loading ? (
              <span className="inline-block w-24 h-6 bg-slate-850 rounded animate-pulse"></span>
            ) : stats ? (
              `%${stats.overall_ratio.toFixed(2)}`
            ) : (
              '-%'
            )}
          </h3>
        </div>
        <div className="p-3 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-xl group-hover:scale-115 transition-all duration-300">
          <Percent className="w-6 h-6" />
        </div>
      </div>
    </div>
  );
};
