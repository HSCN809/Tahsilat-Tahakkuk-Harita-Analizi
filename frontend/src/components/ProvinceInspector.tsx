import React, { useMemo } from 'react';
import { MapPin, X } from 'lucide-react';
import { formatCurrency, formatPercent, getRatioTone } from '../utils/format';
import { REGIONS, findRegionForProvince, normalizeProvinceName } from '../utils/provinces';
import type { ProvinceRecord } from '../types';

interface ProvinceInspectorProps {
  selectedProvinces: string[];
  allRecords: ProvinceRecord[];
  nationalRatio: number | null;
  totalSelectableCount: number;
  loading: boolean;
  onRemoveProvince: (normalized: string) => void;
  onSelectAllProvinces: () => void;
  onClearProvinces: () => void;
}

interface InspectionItem {
  normalized: string;
  record: ProvinceRecord;
  regionName: string | null;
  nationalRank: number | null;
  nationalTotal: number;
  regionalRank: number | null;
  regionalTotal: number;
  regionalAvgRatio: number | null;
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
  selectedProvinces,
  allRecords,
  nationalRatio,
  totalSelectableCount,
  loading,
  onRemoveProvince,
  onSelectAllProvinces,
  onClearProvinces,
}) => {
  const { recordMap, nationalRankMap, nationalTotal, regionStatsMap } = useMemo(() => {
    const recMap = new Map<string, ProvinceRecord>();
    allRecords.forEach((r) => {
      recMap.set(normalizeProvinceName(r.province), r);
    });

    const rankedAll = allRecords
      .filter((r) => r.ratio !== null)
      .toSorted((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));

    const natRanks = new Map<string, number>();
    rankedAll.forEach((r, idx) => {
      natRanks.set(normalizeProvinceName(r.province), idx + 1);
    });

    const regMap = new Map<
      string,
      { avgRatio: number | null; rankMap: Map<string, number>; total: number }
    >();

    Object.entries(REGIONS).forEach(([regionName, allowed]) => {
      const regionRecords = allRecords.filter((r) =>
        allowed.includes(normalizeProvinceName(r.province))
      );
      const rankedRegion = regionRecords
        .filter((r) => r.ratio !== null)
        .toSorted((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0));

      const rankMap = new Map<string, number>();
      rankedRegion.forEach((r, idx) => {
        rankMap.set(normalizeProvinceName(r.province), idx + 1);
      });

      let regAccrual = 0;
      let regCollection = 0;
      regionRecords.forEach((r) => {
        regAccrual += r.accrual ?? 0;
        regCollection += r.collection ?? 0;
      });
      const avgRatio = regAccrual > 0 ? (regCollection / regAccrual) * 100 : null;

      regMap.set(regionName, { avgRatio, rankMap, total: rankedRegion.length });
    });

    return {
      recordMap: recMap,
      nationalRankMap: natRanks,
      nationalTotal: rankedAll.length,
      regionStatsMap: regMap,
    };
  }, [allRecords]);

  const inspections = useMemo<InspectionItem[]>(() => {
    if (selectedProvinces.length === 0 || allRecords.length === 0) return [];
    const items: InspectionItem[] = [];
    selectedProvinces.forEach((normalized) => {
      const record = recordMap.get(normalized);
      if (!record) return;
      const regionName = findRegionForProvince(record.province);
      const regionStats = regionName ? regionStatsMap.get(regionName) : undefined;
      items.push({
        normalized,
        record,
        regionName,
        nationalRank: nationalRankMap.get(normalized) ?? null,
        nationalTotal,
        regionalRank: regionStats?.rankMap.get(normalized) ?? null,
        regionalTotal: regionStats?.total ?? 0,
        regionalAvgRatio: regionStats?.avgRatio ?? null,
      });
    });
    return items;
  }, [selectedProvinces, allRecords.length, recordMap, nationalRankMap, nationalTotal, regionStatsMap]);

  const allSelected = totalSelectableCount > 0 && inspections.length >= totalSelectableCount;

  if (loading) {
    return (
      <section className="bg-white border border-[#D9D4C9] rounded-[4px] p-5 flex flex-col gap-3">
        <div className="h-5 w-40 bg-[#EFECE4] rounded-[2px] motion-safe:animate-pulse" />
        <div className="h-16 bg-[#EFECE4] rounded-[2px] motion-safe:animate-pulse" />
        <div className="h-12 bg-[#EFECE4] rounded-[2px] motion-safe:animate-pulse" />
      </section>
    );
  }

  if (inspections.length === 0) {
    return (
      <section
        aria-label="İl İnceleme ve Kıyaslama"
        className="bg-white border border-[#D9D4C9] rounded-[4px] p-5 flex flex-col gap-3"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[#1E242B] pb-2.5">
          <div className="flex items-center gap-2">
            <MapPin className="w-4 h-4 text-[#9E2A2B] shrink-0" />
            <h2 className="text-base font-bold text-[#1E242B]">İl İnceleme &amp; Kıyaslama</h2>
          </div>
          <button
            type="button"
            onClick={onSelectAllProvinces}
            disabled={totalSelectableCount === 0}
            className="px-2.5 py-1 text-xs font-semibold text-[#1E242B] bg-[#FAF9F6] hover:bg-[#EFECE4] border border-[#857E72] rounded-[3px] transition-colors duration-150 cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Hepsini Seç
          </button>
        </div>
        <p className="text-xs text-[#525A63] leading-relaxed">
          Haritadan veya aşağıdaki il kütüğünden bir ya da daha fazla il seçin; seçilen iller hem birbirleriyle hem de bölge ve Türkiye ortalamalarıyla yan yana kıyaslanır.
        </p>
      </section>
    );
  }

  if (inspections.length === 1) {
    const {
      normalized,
      record,
      regionName,
      nationalRank,
      nationalTotal: natTotal,
      regionalRank,
      regionalTotal,
      regionalAvgRatio,
    } = inspections[0];
    const provRatio = record.ratio ?? 0;
    const natDelta = nationalRatio !== null ? formatDelta(provRatio - nationalRatio) : null;
    const regDelta = regionalAvgRatio !== null ? formatDelta(provRatio - regionalAvgRatio) : null;
    const provTone = getRatioTone(provRatio);

    return (
      <section
        aria-label="Seçili İl Kıyaslama Paneli"
        className="bg-white border border-[#D9D4C9] border-t-2 border-t-[#9E2A2B] rounded-[4px] p-5 flex flex-col gap-3.5 min-h-0 max-h-full overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-2 border-b border-[#D9D4C9] pb-3">
          <div>
            <h2 className="text-lg font-bold text-[#1E242B] leading-tight">
              {record.province.toLocaleUpperCase('tr-TR')}
            </h2>
            <p className="text-xs text-[#525A63] mt-0.5 tabular-nums">
              {regionName ? `${regionName} Bölgesi` : 'Türkiye'}
              {nationalRank ? ` · Türkiye #${nationalRank}/${natTotal}` : ''}
              {regionalRank && regionalTotal > 0 ? ` · Bölge #${regionalRank}/${regionalTotal}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onSelectAllProvinces}
              disabled={allSelected}
              className="px-2.5 py-1 text-xs font-semibold text-[#1E242B] bg-[#FAF9F6] hover:bg-[#EFECE4] border border-[#857E72] rounded-[3px] transition-colors duration-150 cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Hepsini Seç
            </button>
            <button
              type="button"
              onClick={() => onRemoveProvince(normalized)}
              aria-label="Sabitlenen ili temizle"
              className="p-1 text-[#525A63] hover:text-[#1E242B] hover:bg-[#EFECE4] rounded-[2px] transition-colors duration-150 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
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

        <p className="text-[11px] text-[#525A63] border-t border-[#EAE5DA] pt-2.5">
          Kıyaslamak için haritadan veya kütükten başka bir il daha seçin.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-label="Çoklu İl Kıyaslama Paneli"
      className="bg-white border border-[#D9D4C9] border-t-2 border-t-[#9E2A2B] rounded-[4px] p-5 flex flex-col gap-3.5 min-h-0 max-h-full"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[#1E242B] pb-2.5">
        <h2 className="text-base font-bold text-[#1E242B] tabular-nums">
          İl Kıyaslama ({inspections.length} İl)
        </h2>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onSelectAllProvinces}
            disabled={allSelected}
            className="px-2.5 py-1 text-xs font-semibold text-[#1E242B] bg-[#FAF9F6] hover:bg-[#EFECE4] border border-[#857E72] rounded-[3px] transition-colors duration-150 cursor-pointer whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Hepsini Seç
          </button>
          <button
            type="button"
            onClick={onClearProvinces}
            className="px-2.5 py-1 text-xs font-semibold text-[#1E242B] bg-[#FAF9F6] hover:bg-[#EFECE4] border border-[#857E72] rounded-[3px] transition-colors duration-150 cursor-pointer whitespace-nowrap"
          >
            Temizle
          </button>
        </div>
      </div>

      {/* Seçilen İller Kıyaslama Listesi */}
      <ul className="divide-y divide-[#EAE5DA] min-h-0 flex-1 max-h-[360px] lg:max-h-none overflow-y-auto overscroll-contain pr-0.5">
        {inspections.map((item) => {
          const provRatio = item.record.ratio ?? 0;
          const provTone = getRatioTone(provRatio);
          const natDelta = nationalRatio !== null ? formatDelta(provRatio - nationalRatio) : null;
          const regDelta = item.regionalAvgRatio !== null ? formatDelta(provRatio - item.regionalAvgRatio) : null;

          return (
            <li key={item.normalized} className="py-3 first:pt-1 last:pb-1 flex flex-col gap-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <span className="block text-sm font-bold text-[#1E242B] leading-tight truncate">
                    {item.record.province.toLocaleUpperCase('tr-TR')}
                  </span>
                  <span className="block text-[11px] text-[#525A63] mt-0.5 tabular-nums">
                    {item.regionName ?? 'Türkiye'}
                    {item.nationalRank ? ` · TR #${item.nationalRank}` : ''}
                    {item.regionalRank && item.regionalTotal > 0 ? ` · Bölge #${item.regionalRank}` : ''}
                  </span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-sm font-bold tabular-nums ${provTone.textClass}`}>
                    {formatPercent(provRatio)}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRemoveProvince(item.normalized)}
                    aria-label={`${item.record.province} ilini kıyaslamadan çıkar`}
                    className="p-1 text-[#525A63] hover:text-[#1E242B] hover:bg-[#EFECE4] rounded-[2px] transition-colors duration-150 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="relative h-2 bg-[#EFECE4] rounded-[2px] overflow-hidden">
                <div
                  className={`comparison-bar-fill h-full motion-safe:transition-all motion-safe:duration-200 ${provTone.bgClass}`}
                  style={{ width: `${Math.max(0, Math.min(100, provRatio))}%` }}
                />
                {nationalRatio !== null && (
                  <span
                    aria-hidden="true"
                    className="absolute top-0 bottom-0 w-0.5 bg-[#1E242B]/80"
                    style={{ left: `${Math.max(0, Math.min(100, nationalRatio))}%` }}
                  />
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-3 text-[11px] tabular-nums">
                <div className="flex justify-between gap-1 text-[#525A63]">
                  <span>Tahakkuk:</span>
                  <span className="font-semibold text-[#1E242B]">{formatCurrency(item.record.accrual)}</span>
                </div>
                <div className="flex justify-between gap-1 text-[#525A63]">
                  <span>Tahsilat:</span>
                  <span className="font-semibold text-[#1E242B]">{formatCurrency(item.record.collection)}</span>
                </div>
              </div>

              {(regDelta || natDelta) && (
                <div className="flex flex-col gap-0.5 text-[11px] tabular-nums pt-0.5 text-[#525A63]">
                  {regDelta && item.regionName && item.regionalAvgRatio !== null && (
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        {item.regionName} Ort. (
                        <strong className="font-semibold text-[#1E242B]">
                          {formatPercent(item.regionalAvgRatio)}
                        </strong>
                        )
                      </span>
                      <span className={`font-semibold shrink-0 ${regDelta.toneClass}`}>{regDelta.text}</span>
                    </div>
                  )}
                  {natDelta && nationalRatio !== null && (
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        Türkiye Ort. (
                        <strong className="font-semibold text-[#1E242B]">
                          {formatPercent(nationalRatio)}
                        </strong>
                        )
                      </span>
                      <span className={`font-semibold shrink-0 ${natDelta.toneClass}`}>{natDelta.text}</span>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
