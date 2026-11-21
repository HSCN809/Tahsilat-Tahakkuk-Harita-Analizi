import React, { useMemo } from 'react';
import { MapPin, X } from 'lucide-react';
import { formatCurrency, formatPercent, getRatioTone } from '../utils/format';
import { REGIONS, findRegionForProvince, normalizeProvinceName } from '../utils/provinces';
import type { ProvinceRecord } from '../types';

interface ProvinceInspectorProps {
  selectedProvince: string | null;
  allRecords: ProvinceRecord[];
  nationalRatio: number | null;
  loading: boolean;
  onSelectProvince: (normalized: string | null) => void;
}

const formatDelta = (delta: number): { text: string; toneClass: string } => {
  const formatted = Math.abs(delta).toLocaleString('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (delta > 0.005) {
    return { text: `+${formatted} puan`, toneClass: 'text-[#1B6B63]' };
  }
  if (delta < -0.005) {
    return { text: `-${formatted} puan`, toneClass: 'text-[#9E2A2B]' };
  }
  return { text: '0,00 puan', toneClass: 'text-[#525A63]' };
};

export const ProvinceInspector: React.FC<ProvinceInspectorProps> = ({
  selectedProvince,
  allRecords,
  nationalRatio,
  loading,
  onSelectProvince,
}) => {
  const quickSuggestions = useMemo(() => {
    const valid = allRecords.filter((r) => r.ratio !== null);
    if (valid.length === 0) return [];
    const byRatio = [...valid].sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))[0];
    const byAccrual = [...valid].sort((a, b) => (b.accrual ?? 0) - (a.accrual ?? 0))[0];
    const ankara = valid.find((r) => normalizeProvinceName(r.province) === 'ankara');
    const picks = [byAccrual, ankara, byRatio].filter(Boolean) as ProvinceRecord[];
    const seen = new Set<string>();
    return picks.filter((item) => {
      const key = normalizeProvinceName(item.province);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [allRecords]);

  const inspection = useMemo(() => {
    if (!selectedProvince || allRecords.length === 0) return null;

    const record = allRecords.find((r) => normalizeProvinceName(r.province) === selectedProvince);
    if (!record) return null;

    const regionName = findRegionForProvince(record.province);
    const rankedAll = allRecords
      .filter((r) => r.ratio !== null)
      .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));

    const nationalRankIndex = rankedAll.findIndex(
      (r) => normalizeProvinceName(r.province) === selectedProvince
    );
    const nationalRank = nationalRankIndex >= 0 ? nationalRankIndex + 1 : null;

    let regionalRank: number | null = null;
    let regionalTotal = 0;
    let regionalAvgRatio: number | null = null;

    if (regionName && REGIONS[regionName]) {
      const allowed = REGIONS[regionName];
      const regionRecords = allRecords.filter((r) =>
        allowed.includes(normalizeProvinceName(r.province))
      );
      const rankedRegion = regionRecords
        .filter((r) => r.ratio !== null)
        .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));

      const regIdx = rankedRegion.findIndex(
        (r) => normalizeProvinceName(r.province) === selectedProvince
      );
      regionalRank = regIdx >= 0 ? regIdx + 1 : null;
      regionalTotal = rankedRegion.length;

      let regAccrual = 0;
      let regCollection = 0;
      regionRecords.forEach((r) => {
        regAccrual += r.accrual ?? 0;
        regCollection += r.collection ?? 0;
      });
      regionalAvgRatio = regAccrual > 0 ? (regCollection / regAccrual) * 100 : null;
    }

    return {
      record,
      regionName,
      nationalRank,
      nationalTotal: rankedAll.length,
      regionalRank,
      regionalTotal,
      regionalAvgRatio,
    };
  }, [selectedProvince, allRecords]);

  if (loading) {
    return (
      <section className="bg-white border border-[#D9D4C9] rounded-[4px] p-5 flex flex-col gap-3">
        <div className="h-5 w-40 bg-[#EFECE4] rounded-[2px] motion-safe:animate-pulse" />
        <div className="h-16 bg-[#EFECE4] rounded-[2px] motion-safe:animate-pulse" />
        <div className="h-12 bg-[#EFECE4] rounded-[2px] motion-safe:animate-pulse" />
      </section>
    );
  }

  if (!inspection) {
    return (
      <section
        aria-label="İl İnceleme ve Kıyaslama"
        className="bg-white border border-[#D9D4C9] rounded-[4px] p-5 flex flex-col gap-3"
      >
        <div className="flex items-center justify-between border-b border-[#1E242B] pb-2.5">
          <h2 className="text-base font-bold text-[#1E242B]">İl İnceleme &amp; Kıyaslama</h2>
          <MapPin className="w-4 h-4 text-[#9E2A2B]" />
        </div>
        <p className="text-xs text-[#525A63] leading-relaxed">
          Haritadan veya sıralama listelerinden bir il seçin; seçilen ilin tahsilat oranı kendi bölgesi ve Türkiye ortalamasıyla yan yana sabitlenir.
        </p>
        {quickSuggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            {quickSuggestions.map((item) => (
              <button
                key={item.province}
                type="button"
                onClick={() => onSelectProvince(normalizeProvinceName(item.province))}
                className="px-2.5 py-1 text-xs font-semibold bg-[#FCFBF8] hover:bg-[#EFECE4] text-[#1E242B] border border-[#857E72] rounded-[3px] transition-colors duration-150 cursor-pointer"
              >
                {item.province.toLocaleUpperCase('tr-TR')}
              </button>
            ))}
          </div>
        )}
      </section>
    );
  }

  const { record, regionName, nationalRank, nationalTotal, regionalRank, regionalTotal, regionalAvgRatio } =
    inspection;
  const provRatio = record.ratio ?? 0;
  const natDelta = nationalRatio !== null ? formatDelta(provRatio - nationalRatio) : null;
  const regDelta = regionalAvgRatio !== null ? formatDelta(provRatio - regionalAvgRatio) : null;

  return (
    <section
      aria-label="Seçili İl Kıyaslama Paneli"
      className="bg-white border border-[#D9D4C9] border-t-2 border-t-[#9E2A2B] p-5 flex flex-col gap-3.5"
    >
      <div className="flex items-start justify-between gap-2 border-b border-[#D9D4C9] pb-3">
        <div>
          <h2 className="text-lg font-bold text-[#1E242B] leading-tight">
            {record.province.toLocaleUpperCase('tr-TR')}
          </h2>
          <p className="text-xs text-[#525A63] mt-0.5 tabular-nums">
            {regionName ? `${regionName} Bölgesi` : 'Türkiye'}
            {nationalRank ? ` · Türkiye #${nationalRank}/${nationalTotal}` : ''}
            {regionalRank && regionalTotal > 0 ? ` · Bölge #${regionalRank}/${regionalTotal}` : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={() => onSelectProvince(null)}
          aria-label="Sabitlenen ili temizle"
          className="p-1 text-[#525A63] hover:text-[#1E242B] hover:bg-[#EFECE4] rounded-[2px] transition-colors duration-150 cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tahakkuk ve Tahsilat Satırı */}
      <div className="grid grid-cols-2 gap-3 text-xs bg-[#FCFBF8] border border-[#EAE5DA] rounded-[2px] p-3">
        <div>
          <span className="block text-[11px] font-semibold text-[#525A63]">Tahakkuk</span>
          <span className="mt-0.5 block text-sm font-bold text-[#1E242B] tabular-nums">
            {formatCurrency(record.accrual)}
          </span>
        </div>
        <div>
          <span className="block text-[11px] font-semibold text-[#525A63]">Tahsilat</span>
          <span className="mt-0.5 block text-sm font-bold text-[#1E242B] tabular-nums">
            {formatCurrency(record.collection)}
          </span>
        </div>
      </div>

      {/* Oransal Kıyaslama Çubukları */}
      <div className="flex flex-col gap-2.5 text-xs">
        {(() => {
          const provTone = getRatioTone(provRatio);
          return (
            <div>
              <div className="flex justify-between items-baseline mb-1">
                <span className="font-semibold text-[#1E242B]">İl Tahsilat Oranı</span>
                <span className={`font-bold text-sm tabular-nums ${provTone.textClass}`}>
                  {formatPercent(provRatio)}
                </span>
              </div>
              <div className="h-2 bg-[#EFECE4] rounded-[2px] overflow-hidden">
                <div
                  className={`comparison-bar-fill h-full motion-safe:transition-all motion-safe:duration-200 ${provTone.bgClass}`}
                  style={{ width: `${Math.max(0, Math.min(100, provRatio))}%` }}
                />
              </div>
            </div>
          );
        })()}

        {regionalAvgRatio !== null && regionName && (
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-[#525A63]">{regionName} Ortalaması</span>
              <span className="tabular-nums">
                <strong className="text-[#1E242B]">{formatPercent(regionalAvgRatio)}</strong>
                {regDelta && <span className={`ml-1.5 font-semibold ${regDelta.toneClass}`}>({regDelta.text})</span>}
              </span>
            </div>
            <div className="h-1.5 bg-[#EFECE4] rounded-[2px] overflow-hidden">
              <div
                className="comparison-bar-fill h-full bg-[#8A6518] motion-safe:transition-all motion-safe:duration-200"
                style={{ width: `${Math.max(0, Math.min(100, regionalAvgRatio))}%` }}
              />
            </div>
          </div>
        )}

        {nationalRatio !== null && (
          <div>
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-[#525A63]">Türkiye Ortalaması</span>
              <span className="tabular-nums">
                <strong className="text-[#1E242B]">{formatPercent(nationalRatio)}</strong>
                {natDelta && <span className={`ml-1.5 font-semibold ${natDelta.toneClass}`}>({natDelta.text})</span>}
              </span>
            </div>
            <div className="h-1.5 bg-[#EFECE4] rounded-[2px] overflow-hidden">
              <div
                className="comparison-bar-fill h-full bg-[#1E242B] motion-safe:transition-all motion-safe:duration-200"
                style={{ width: `${Math.max(0, Math.min(100, nationalRatio))}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
};
