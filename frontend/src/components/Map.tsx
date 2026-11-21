import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { X } from 'lucide-react';
import { formatCurrency, formatPercent, getRatioTone } from '../utils/format';
import { REGIONS, normalizeProvinceName } from '../utils/provinces';
import type { ProvinceRecord, TurkeyGeoJSON, MapType } from '../types';

interface TurkeyMapProps {
  geoJsonData: TurkeyGeoJSON | null;
  records: ProvinceRecord[];
  mapType: MapType;
  selectedRegion: string;
  selectedProvinces: string[];
  loading?: boolean;
  onMapTypeChange: (type: MapType) => void;
  onToggleProvince: (normalizedProvince: string) => void;
  onClearProvinces: () => void;
}

const interpolateColor = (
  color1: [number, number, number],
  color2: [number, number, number],
  factor: number
): string => {
  const f = Math.max(0, Math.min(1, factor));
  const r = Math.round(color1[0] + f * (color2[0] - color1[0]));
  const g = Math.round(color1[1] + f * (color2[1] - color1[1]));
  const b = Math.round(color1[2] + f * (color2[2] - color1[2]));
  return `rgb(${r}, ${g}, ${b})`;
};

// Devlet İstatistik Yıllığı renk rampası: Hazine kırmızısı (#9E2A2B) -> sıcak okr (#C9A25E) -> Ege yeşili (#1B6B63)
const COLOR_LOW: [number, number, number] = [158, 42, 43];
const COLOR_MID: [number, number, number] = [201, 162, 94];
const COLOR_HIGH: [number, number, number] = [27, 107, 99];

const TurkeyMapComponent: React.FC<TurkeyMapProps> = ({
  geoJsonData,
  records,
  mapType,
  selectedRegion,
  selectedProvinces,
  loading = false,
  onMapTypeChange,
  onToggleProvince,
  onClearProvinces,
}) => {
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    name: string;
    record: ProvinceRecord | undefined;
    alignLeft: boolean;
    alignTop: boolean;
  } | null>(null);
  const [focusedKeyboardProvince, setFocusedKeyboardProvince] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cachedBoundsRef = useRef<DOMRect | null>(null);

  const getCachedBounds = useCallback((): DOMRect | null => {
    if (!cachedBoundsRef.current) {
      cachedBoundsRef.current = containerRef.current?.getBoundingClientRect() ?? null;
    }
    return cachedBoundsRef.current;
  }, []);

  const invalidateBounds = useCallback(() => {
    cachedBoundsRef.current = null;
  }, []);

  useEffect(() => {
    window.addEventListener('resize', invalidateBounds);
    window.addEventListener('scroll', invalidateBounds, true);
    return () => {
      window.removeEventListener('resize', invalidateBounds);
      window.removeEventListener('scroll', invalidateBounds, true);
    };
  }, [invalidateBounds]);

  useEffect(() => {
    if (!tooltip) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTooltip(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [tooltip]);

  const filteredFeatures = useMemo(() => {
    if (!geoJsonData) return [];
    const features = geoJsonData.features || [];
    if (selectedRegion === 'Tüm Ülke') return features;
    return features.filter((f) => {
      const name = f.properties?.name;
      const normalized = normalizeProvinceName(name);
      return REGIONS[selectedRegion]?.includes(normalized);
    });
  }, [geoJsonData, selectedRegion]);

  const { pathGenerator, calculatedHeight } = useMemo(() => {
    if (filteredFeatures.length === 0) {
      return { pathGenerator: null, calculatedHeight: 390 };
    }

    const featureCollection = {
      type: 'FeatureCollection',
      features: filteredFeatures,
    };

    const width = 800;
    const baseHeight = 360;
    const padding = 18;

    const proj = geoMercator();
    proj.fitExtent(
      [[padding, padding], [width - padding, baseHeight - padding]],
      featureCollection as any
    );

    const scaleMultipliers: { [key: string]: number } = {
      'Tüm Ülke': 1.04,
      'Marmara': 1.18,
      'Ege': 1.22,
      'Akdeniz': 1.0,
      'İç Anadolu': 1.25,
      'Karadeniz': 1.22,
      'Doğu Anadolu': 1.25,
      'Güneydoğu Anadolu': 1.0,
    };
    const multiplier = scaleMultipliers[selectedRegion] ?? 1.0;

    if (multiplier !== 1.0) {
      const currentScale = proj.scale();
      const [tx, ty] = proj.translate();
      proj.scale(currentScale * multiplier);
      const cx = width / 2;
      const cy = baseHeight / 2;
      proj.translate([cx + (tx - cx) * multiplier, cy + (ty - cy) * multiplier]);
    }

    const generator = geoPath().projection(proj);
    const [[, y0], [, y1]] = generator.bounds(featureCollection as any);

    const rawHeight = y1 - y0 + padding * 2 + 24;
    const height = Math.max(290, Math.min(430, Math.round(rawHeight)));

    return { pathGenerator: generator, calculatedHeight: height };
  }, [filteredFeatures, selectedRegion]);

  const recordsMap = useMemo(() => {
    const map = new Map<string, ProvinceRecord>();
    records.forEach((r) => {
      map.set(normalizeProvinceName(r.province), r);
    });
    return map;
  }, [records]);

  const maxVal = useMemo(() => {
    if (mapType === 'ratio') return 100;
    let max = 0;
    records.forEach((r) => {
      const val = mapType === 'tahsilat' ? r.collection : r.accrual;
      if (val !== null && val > max) max = val;
    });
    return max || 1;
  }, [records, mapType]);

  const getColor = useCallback(
    (name: string) => {
      const record = recordsMap.get(normalizeProvinceName(name));
      if (!record) return '#E5E0D4';

      let factor = 0;
      if (mapType === 'ratio') {
        const ratio = record.ratio ?? 0;
        factor = ratio / 100;
      } else {
        const val = mapType === 'tahsilat' ? record.collection : record.accrual;
        if (!val || val <= 0) return '#E5E0D4';
        factor = Math.log1p(val) / Math.log1p(maxVal);
      }

      if (factor < 0.5) {
        return interpolateColor(COLOR_LOW, COLOR_MID, factor * 2);
      }
      return interpolateColor(COLOR_MID, COLOR_HIGH, (factor - 0.5) * 2);
    },
    [recordsMap, mapType, maxVal]
  );

  const selectedSet = useMemo(() => new Set(selectedProvinces), [selectedProvinces]);

  const selectionBadgeLabel = useMemo(() => {
    if (selectedProvinces.length === 0) return null;
    if (selectedProvinces.length === 1) {
      const first = selectedProvinces[0];
      const match = recordsMap.get(first);
      return `Seçili: ${(match?.province ?? first).toLocaleUpperCase('tr-TR')}`;
    }
    return `${selectedProvinces.length} il kıyaslanıyor`;
  }, [selectedProvinces, recordsMap]);

  const mapTabs: { id: MapType; label: string }[] = [
    { id: 'tahakkuk', label: 'Tahakkuk' },
    { id: 'tahsilat', label: 'Tahsilat' },
    { id: 'ratio', label: 'Oran (%)' },
  ];

  return (
    <section
      aria-label="Coğrafi Dağılım Haritası"
      className="bg-white border border-[#D9D4C9] rounded-[4px] p-5 flex flex-col gap-3.5"
    >
      {/* Harita Başlığı ve Gösterim Tipi Sekmeleri */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1E242B] pb-3">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-base font-bold text-[#1E242B] tracking-tight">
            {selectedRegion === 'Tüm Ülke' ? '81 İl Coğrafi Dağılımı' : `${selectedRegion} Bölgesi Dağılımı`}
          </h2>
          {selectionBadgeLabel && (
            <button
              type="button"
              onClick={onClearProvinces}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-semibold bg-[#F9EDED] text-[#9E2A2B] border border-[#E6C5C5] rounded-[2px] hover:bg-[#F3DCDC] transition-colors duration-150 cursor-pointer"
              title={selectedProvinces.length > 1 ? 'Tüm seçimleri temizle' : 'Seçili ili kaldır'}
            >
              <span>{selectionBadgeLabel}</span>
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <div
          role="group"
          aria-label="Harita metrik seçimi"
          className="inline-flex border border-[#857E72] rounded-[3px] overflow-hidden bg-[#FAF9F6]"
        >
          {mapTabs.map((tab) => {
            const active = mapType === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                aria-pressed={active}
                onClick={() => onMapTypeChange(tab.id)}
                className={`px-3 py-1.5 text-xs font-semibold transition-colors duration-150 cursor-pointer border-r last:border-r-0 border-[#D9D4C9] ${
                  active
                    ? 'bg-[#1E242B] text-white'
                    : 'text-[#525A63] hover:text-[#1E242B] hover:bg-[#EFECE4]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Harita Tuvali */}
      <p id="map-interaction-hint" className="sr-only">
        Bir ilin detaylarını sabitlemek için seçin.
      </p>
      <div
        ref={containerRef}
        style={{ ['--map-h' as string]: `${calculatedHeight}px` }}
        className="relative w-full aspect-[16/9] sm:aspect-auto sm:h-[var(--map-h)] bg-[#FCFBF8] border border-[#E5DFD2] rounded-[2px] overflow-visible flex items-center justify-center"
        onMouseEnter={invalidateBounds}
        onScroll={invalidateBounds}
      >
        {tooltip && (
          <div
            id="map-province-tooltip"
            role="tooltip"
            className="absolute z-40 bg-white border border-[#1E242B] text-xs text-[#1E242B] rounded-[3px] p-3 shadow-md pointer-events-none flex flex-col gap-1 min-w-[175px] whitespace-nowrap"
            style={{
              left: tooltip.alignLeft ? tooltip.x - 14 : tooltip.x + 14,
              top: tooltip.alignTop ? tooltip.y - 12 : Math.max(8, tooltip.y + 12),
              transform: `translate(${tooltip.alignLeft ? '-100%' : '0'}, ${tooltip.alignTop ? '-100%' : '0'})`,
            }}
          >
            <span className="font-bold text-[13px] text-[#1E242B] border-b border-[#D9D4C9] pb-1 mb-0.5 block">
              {tooltip.name.toLocaleUpperCase('tr-TR')}
            </span>
            {tooltip.record ? (
              <>
                <div className="flex justify-between gap-4">
                  <span className="text-[#525A63]">Tahakkuk:</span>
                  <span className="font-semibold tabular-nums">{formatCurrency(tooltip.record.accrual)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span className="text-[#525A63]">Tahsilat:</span>
                  <span className="font-semibold tabular-nums">{formatCurrency(tooltip.record.collection)}</span>
                </div>
                <div className={`flex justify-between gap-4 border-t border-[#EAE5DA] mt-1 pt-1 font-bold ${getRatioTone(tooltip.record.ratio).textClass}`}>
                  <span>Oran:</span>
                  <span className="tabular-nums">
                    {formatPercent(tooltip.record.ratio ?? 0)}
                  </span>
                </div>
              </>
            ) : (
              <span className="text-[#525A63]">Bu dönem için veri yok</span>
            )}
          </div>
        )}

        {!geoJsonData || !pathGenerator || loading ? (
          <div className="w-full h-full p-6 flex flex-col items-center justify-center gap-3">
            <div className="w-full h-full bg-[#EFECE4]/70 rounded-[2px] motion-safe:animate-pulse flex items-center justify-center">
              <span className="text-xs font-semibold text-[#525A63]">Harita ve il verileri hazırlanıyor…</span>
            </div>
          </div>
        ) : (
          <svg
            viewBox="0 0 800 360"
            className="w-full h-full select-none forced-colors-data"
            preserveAspectRatio="xMidYMid meet"
            role="group"
            aria-label="Türkiye il bazında vergi haritası"
          >
            {(() => {
              const selectedPathDs: string[] = [];
              let focusedPathD: string | null = null;
              let hoveredPathD: string | null = null;
              const hoveredNormalized = tooltip ? normalizeProvinceName(tooltip.name) : null;

              const basePaths = filteredFeatures.map((geo) => {
                const d = pathGenerator(geo);
                if (!d) return null;
                const name = geo.properties.name;
                const normalized = normalizeProvinceName(name);
                const record = recordsMap.get(normalized);
                const isSelected = selectedSet.has(normalized);
                const isDimmed = selectedSet.size > 0 && !isSelected;

                if (isSelected) selectedPathDs.push(d);
                if (focusedKeyboardProvince === normalized) focusedPathD = d;
                if (hoveredNormalized === normalized && !isSelected) hoveredPathD = d;

                const metricAria =
                  record && mapType === 'ratio'
                    ? formatPercent(record.ratio ?? 0)
                    : record
                      ? formatCurrency(mapType === 'tahsilat' ? record.collection : record.accrual)
                      : 'veri yok';

                return (
                  <path
                    key={name}
                    d={d}
                    tabIndex={0}
                    role="button"
                    aria-pressed={isSelected}
                    aria-label={`${name}: ${metricAria}`}
                    aria-describedby={
                      tooltip?.name === name ? 'map-province-tooltip map-interaction-hint' : 'map-interaction-hint'
                    }
                    fill={getColor(name)}
                    fillOpacity={isDimmed ? 0.55 : 1}
                    stroke="#FFFFFF"
                    strokeWidth={0.85}
                    className="map-province-path transition-opacity duration-150 hover:opacity-90 cursor-pointer"
                    onClick={() => onToggleProvince(normalized)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        onToggleProvince(normalized);
                      } else if (e.key === ' ') {
                        e.preventDefault();
                      } else if (e.key === 'Escape') {
                        setTooltip(null);
                      }
                    }}
                    onKeyUp={(e) => {
                      if (e.key === ' ') {
                        onToggleProvince(normalized);
                      }
                    }}
                    onFocus={(e: React.FocusEvent<SVGPathElement>) => {
                      if (e.currentTarget.matches(':focus-visible')) {
                        setFocusedKeyboardProvince(normalized);
                      }
                      const bounds = getCachedBounds();
                      if (!bounds) return;
                      const pathRect = e.currentTarget.getBoundingClientRect();
                      const centerX = pathRect.left + pathRect.width / 2 - bounds.left;
                      const centerY = pathRect.top + pathRect.height / 2 - bounds.top;
                      const alignLeft = centerX > bounds.width / 2;
                      const alignTop = centerY > bounds.height / 2;
                      const x = alignLeft ? pathRect.left - bounds.left : pathRect.right - bounds.left;
                      const y = alignTop ? pathRect.top - bounds.top : pathRect.bottom - bounds.top;
                      setTooltip({ x, y, name, record, alignLeft, alignTop });
                    }}
                    onBlur={() => {
                      setFocusedKeyboardProvince(null);
                      setTooltip(null);
                    }}
                    onMouseMove={(e: React.MouseEvent<SVGPathElement>) => {
                      const bounds = getCachedBounds();
                      const x = e.clientX - (bounds?.left || 0);
                      const y = e.clientY - (bounds?.top || 0);
                      const containerWidth = bounds?.width || 0;
                      const containerHeight = bounds?.height || 0;
                      const alignLeft = x > containerWidth / 2;
                      const alignTop = y > containerHeight / 2;
                      setTooltip({ x, y, name, record, alignLeft, alignTop });
                    }}
                    onMouseLeave={() => {
                      invalidateBounds();
                      setTooltip(null);
                    }}
                  />
                );
              });

              return (
                <>
                  <g>{basePaths}</g>
                  {hoveredPathD && (
                    <path
                      d={hoveredPathD}
                      fill="none"
                      stroke="#1E242B"
                      strokeWidth={1.4}
                      strokeLinejoin="round"
                      pointerEvents="none"
                      aria-hidden="true"
                    />
                  )}
                  {selectedPathDs.map((d, idx) => (
                    <path
                      key={idx}
                      d={d}
                      fill="none"
                      stroke="#1E242B"
                      strokeWidth={2}
                      strokeLinejoin="round"
                      pointerEvents="none"
                      aria-hidden="true"
                    />
                  ))}
                  {focusedPathD && (
                    <>
                      <path
                        d={focusedPathD}
                        fill="none"
                        className="map-focus-halo"
                        pointerEvents="none"
                        aria-hidden="true"
                      />
                      <path
                        d={focusedPathD}
                        fill="none"
                        className="map-focus-ring"
                        pointerEvents="none"
                        aria-hidden="true"
                      />
                    </>
                  )}
                </>
              );
            })()}
          </svg>
        )}
      </div>

      {/* Alt Renk Ölçeği Lejantı */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-0.5 text-xs">
        <span className="font-semibold text-[#525A63]">
          {mapType === 'ratio'
            ? 'Tahsilat Oranı Ölçeği'
            : mapType === 'tahsilat'
              ? 'Tahsilat Tutarı Ölçeği (log)'
              : 'Tahakkuk Tutarı Ölçeği (log)'}
        </span>

        <div className="flex items-center gap-2.5 flex-1 max-w-md">
          <span className="text-[11px] font-semibold text-[#525A63] tabular-nums shrink-0">
            {mapType === 'ratio' ? '%0' : '0 ₺'}
          </span>
          <div
            className="forced-colors-data h-2.5 flex-1 rounded-[2px] border border-[#D9D4C9]"
            style={{
              background: 'linear-gradient(90deg, #9E2A2B 0%, #C9A25E 50%, #1B6B63 100%)',
            }}
          />
          {mapType === 'ratio' ? (
            <span className="text-[11px] font-semibold text-[#525A63] tabular-nums shrink-0">%100</span>
          ) : (
            <span
              className="text-[11px] font-semibold text-[#525A63] tabular-nums max-w-[130px] truncate shrink-0"
              title={formatCurrency(maxVal)}
            >
              {formatCurrency(maxVal)}
            </span>
          )}
        </div>
      </div>
    </section>
  );
};

export const TurkeyMap = React.memo(TurkeyMapComponent);
