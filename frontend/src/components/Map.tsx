import React, { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { geoMercator, geoPath } from 'd3-geo';
import { formatCurrency } from '../utils/format';
import { REGIONS, normalizeProvinceName } from '../utils/provinces';
import type { ProvinceRecord, TurkeyGeoJSON, MapType } from '../types';

interface TurkeyMapProps {
  geoJsonData: TurkeyGeoJSON | null;
  records: ProvinceRecord[];
  mapType: MapType;
  selectedRegion: string;
}

const interpolateColor = (color1: [number, number, number], color2: [number, number, number], factor: number): string => {
  const f = Math.max(0, Math.min(1, factor));
  const r = Math.round(color1[0] + f * (color2[0] - color1[0]));
  const g = Math.round(color1[1] + f * (color2[1] - color1[1]));
  const b = Math.round(color1[2] + f * (color2[2] - color1[2]));
  return `rgb(${r}, ${g}, ${b})`;
};

const TurkeyMapComponent: React.FC<TurkeyMapProps> = ({ geoJsonData, records, mapType, selectedRegion }) => {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; name: string; record: ProvinceRecord | undefined; alignLeft: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Bounds cache — getBoundingClientRect her fare hareketinde değil, sadece gerektiğinde çağrılır
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

  // Pencere resize'ında bounds cache'i invalidate et
  useEffect(() => {
    window.addEventListener('resize', invalidateBounds);
    window.addEventListener('scroll', invalidateBounds, true);
    return () => {
      window.removeEventListener('resize', invalidateBounds);
      window.removeEventListener('scroll', invalidateBounds, true);
    };
  }, [invalidateBounds]);

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

  // Otomatik projeksiyon merkezi, ölçeği ve harita yüksekliğini d3-geo ile hesapla
  const { pathGenerator, calculatedHeight } = useMemo(() => {
    if (filteredFeatures.length === 0) {
      return { pathGenerator: null, calculatedHeight: 450 };
    }

    const featureCollection = {
      type: 'FeatureCollection',
      features: filteredFeatures,
    };

    const width = 800;
    const baseHeight = 380;
    const padding = 20;

    const proj = geoMercator();
    proj.fitExtent(
      [[padding, padding], [width - padding, baseHeight - padding]],
      featureCollection as any
    );

    const scaleMultipliers: { [key: string]: number } = {
      'Tüm Ülke': 1.05,
      'Marmara': 1.2,
      'Ege': 1.25,
      'Akdeniz': 1.0,
      'İç Anadolu': 1.3,
      'Karadeniz': 1.25,
      'Doğu Anadolu': 1.3,
      'Güneydoğu Anadolu': 1.0,
    };
    const multiplier = scaleMultipliers[selectedRegion] ?? 1.0;

    if (multiplier !== 1.0) {
      const currentScale = proj.scale();
      const [tx, ty] = proj.translate();
      proj.scale(currentScale * multiplier);

      // Haritanın merkez noktasını (400, 190) koruyarak kaymayı engellemek için koordinat farkını ölçekle çarpıyoruz
      const cx = width / 2;
      const cy = baseHeight / 2;
      proj.translate([
        cx + (tx - cx) * multiplier,
        cy + (ty - cy) * multiplier,
      ]);
    }

    const generator = geoPath().projection(proj);
    const [[, y0], [, y1]] = generator.bounds(featureCollection as any);

    const paddingTotal = padding * 2 + 40;
    const rawHeight = (y1 - y0) + paddingTotal;
    const height = Math.max(280, Math.min(450, Math.round(rawHeight)));

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

  const getColor = useCallback((name: string) => {
    const record = recordsMap.get(normalizeProvinceName(name));
    if (!record) return '#1e293b';

    let factor = 0;
    if (mapType === 'ratio') {
      const ratio = record.ratio || 0;
      factor = ratio / 100;
    } else {
      const val = mapType === 'tahsilat' ? record.collection : record.accrual;
      if (!val || val <= 0) return '#1e293b';
      factor = Math.log1p(val) / Math.log1p(maxVal);
    }

    // Smooth gradient: Red [244, 63, 94] -> Yellow [234, 179, 8] -> Green [16, 185, 129]
    if (factor < 0.5) {
      return interpolateColor([244, 63, 94], [234, 179, 8], factor * 2);
    } else {
      return interpolateColor([234, 179, 8], [16, 185, 129], (factor - 0.5) * 2);
    }
  }, [recordsMap, mapType, maxVal]);

  const formatTooltipValue = (val: number | null | undefined) => {
    return formatCurrency(val);
  };

  return (
    <div className="w-full flex flex-col gap-4">
      {/* Harita Kartı */}
      <div
        ref={containerRef}
        style={{ height: `${calculatedHeight}px` }}
        className="relative w-full bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-5 overflow-hidden flex items-center justify-center transition-all duration-300"
        onMouseEnter={invalidateBounds}
        onScroll={invalidateBounds}
      >
        {tooltip && (
          <div
            className="absolute z-50 bg-slate-950/90 backdrop-blur-md border border-slate-800 text-xs text-slate-100 rounded-xl p-3 shadow-2xl pointer-events-none flex flex-col gap-1 min-w-[150px] whitespace-nowrap"
            style={{
              left: tooltip.alignLeft ? tooltip.x - 15 : tooltip.x + 15,
              top: tooltip.y - 15,
              transform: tooltip.alignLeft ? 'translateX(-100%)' : 'none',
            }}
          >
            <span className="font-bold text-sm text-slate-200 border-b border-slate-800 pb-1 mb-1 block">
              {tooltip.name.toUpperCase()}
            </span>
            {tooltip.record ? (
              <>
                <div className="flex justify-between gap-4 mt-1">
                  <span>Tahakkuk:</span>
                  <span className="font-mono">{formatTooltipValue(tooltip.record.accrual)}</span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>Tahsilat:</span>
                  <span className="font-mono">{formatTooltipValue(tooltip.record.collection)}</span>
                </div>
                <div className="flex justify-between gap-4 text-purple-400 font-bold border-t border-slate-800/50 mt-1 pt-1">
                  <span>Oran:</span>
                  <span>%{tooltip.record.ratio?.toFixed(2) || '0.00'}</span>
                </div>
              </>
            ) : (
              <span className="text-slate-500">Veri bulunamadı</span>
            )}
          </div>
        )}

        {!geoJsonData || !pathGenerator ? (
          <div className="text-slate-500 text-sm font-medium">Harita verisi bekleniyor...</div>
        ) : (
          <div className="w-full h-full flex items-center justify-center overflow-hidden">
            <svg
              viewBox="0 0 800 380"
              className="w-full h-full select-none"
              style={{ width: '100%', height: '100%' }}
              preserveAspectRatio="xMidYMid meet"
            >
              <g>
                {filteredFeatures.map((geo) => {
                  const d = pathGenerator(geo);
                  if (!d) return null;
                  const name = geo.properties.name;
                  const record = recordsMap.get(normalizeProvinceName(name));
                  return (
                    <path
                      key={name}
                      d={d}
                      fill={getColor(name)}
                      stroke="#0f172a"
                      strokeWidth={0.7}
                      className="transition-all duration-200 outline-none hover:!fill-[#6366f1] hover:!stroke-[#f8fafc] hover:stroke-[1.2px] active:!fill-[#4338ca] cursor-pointer"
                      onMouseMove={(e: React.MouseEvent<SVGPathElement>) => {
                        const bounds = getCachedBounds();
                        const x = e.clientX - (bounds?.left || 0);
                        const y = e.clientY - (bounds?.top || 0);
                        const containerWidth = bounds?.width || 0;
                        const alignLeft = x > containerWidth / 2;

                        setTooltip({ x, y, name, record, alignLeft });
                      }}
                      onMouseLeave={() => {
                        invalidateBounds();
                        setTooltip(null);
                      }}
                    />
                  );
                })}
              </g>
            </svg>
          </div>
        )}
      </div>

      {/* Harita Dışındaki Yatay Renk Lejantı Barı */}
      {geoJsonData && records.length > 0 && (
        <div className="w-full bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 flex flex-col gap-1.5 shadow-lg">
          <div className="flex justify-between items-center text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            <span>
              {mapType === 'ratio'
                ? 'Tahsilat Oranı'
                : mapType === 'tahsilat'
                  ? 'Tahsilat Miktarı'
                  : 'Tahakkuk Miktarı'}
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-gradient-to-r from-[#f43f5e] via-[#eab308] to-[#10b981]"></div>
          <div className="flex justify-between items-center text-[10px] font-mono text-slate-400">
            {mapType === 'ratio' ? (
              <>
                <span>%0</span>
                <span>%50</span>
                <span>%100</span>
              </>
            ) : (
              <>
                <span>Min (0 ₺)</span>
                <span className="max-w-[150px] truncate" title={formatCurrency(maxVal)}>
                  {formatCurrency(maxVal)}
                </span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export const TurkeyMap = React.memo(TurkeyMapComponent);
