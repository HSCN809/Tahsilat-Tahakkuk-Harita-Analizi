import React, { useMemo, useState } from 'react';
// @ts-ignore
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';

interface ProvinceData {
  province: string;
  accrual: number;
  collection: number;
  ratio: number;
}

interface SimpleMapProps {
  geoJsonData: any;
  records: ProvinceData[];
  mapType: 'tahsilat' | 'tahakkuk' | 'ratio';
}

const normalizeProvinceName = (name: string): string => {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .trim();
};

export const SimpleMap: React.FC<SimpleMapProps> = ({ geoJsonData, records, mapType }) => {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string } | null>(null);

  // Map records by normalized province name for O(1) lookup
  const recordsMap = useMemo(() => {
    const map = new Map<string, ProvinceData>();
    records.forEach((r) => {
      map.set(normalizeProvinceName(r.province), r);
    });
    return map;
  }, [records]);

  // Find max value for color scaling (amounts)
  const maxVal = useMemo(() => {
    if (mapType === 'ratio') return 100;
    let max = 0;
    records.forEach((r) => {
      const val = mapType === 'tahsilat' ? r.collection : r.accrual;
      if (val > max) max = val;
    });
    return max || 1;
  }, [records, mapType]);

  const getColor = (name: string) => {
    const record = recordsMap.get(normalizeProvinceName(name));
    if (!record) return '#1e293b'; // slate-800 for missing data

    if (mapType === 'ratio') {
      const ratio = record.ratio || 0;
      if (ratio < 40) return '#f43f5e'; // rose-500
      if (ratio < 60) return '#f97316'; // orange-500
      if (ratio < 80) return '#eab308'; // yellow-500
      return '#10b981'; // emerald-500
    } else {
      const val = mapType === 'tahsilat' ? record.collection : record.accrual;
      if (!val || val <= 0) return '#1e293b';
      
      const fraction = Math.log1p(val) / Math.log1p(maxVal);
      // Indigo to Cyan/Blue color scale
      if (fraction < 0.2) return '#1e1b4b'; // indigo-950
      if (fraction < 0.4) return '#312e81'; // indigo-900
      if (fraction < 0.6) return '#4338ca'; // indigo-700
      if (fraction < 0.8) return '#3b82f6'; // blue-500
      return '#06b6d4'; // cyan-500
    }
  };

  const formatTooltipValue = (val: number | null | undefined) => {
    if (val === null || val === undefined) return '-';
    if (val >= 1000000) return `${(val / 1000000).toFixed(2)} Milyon ₺`;
    return `${val.toLocaleString('tr-TR')} ₺`;
  };

  return (
    <div className="relative w-full h-[550px] bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 overflow-hidden flex items-center justify-center">
      {tooltip && (
        <div
          className="absolute z-50 bg-slate-950/90 backdrop-blur-md border border-slate-800 text-xs text-slate-100 rounded-xl p-3 shadow-2xl pointer-events-none flex flex-col gap-1 min-w-[150px]"
          style={{ left: tooltip.x + 15, top: tooltip.y - 15 }}
          dangerouslySetInnerHTML={{ __html: tooltip.content }}
        />
      )}

      {!geoJsonData ? (
        <div className="text-slate-500 text-sm font-medium">Harita verisi bekleniyor...</div>
      ) : (
        <div className="w-full h-full">
          <ComposableMap
            projection="geoMercator"
            // Custom center and zoom targeting Turkey coordinates
            projectionConfig={{
              scale: 2800,
              center: [35.2433, 38.9637],
            }}
            style={{ width: '100%', height: '100%' }}
          >
            <Geographies geography={geoJsonData}>
              {({ geographies }: { geographies: any[] }) =>
                geographies.map((geo) => {
                  const name = geo.properties.name;
                  const record = recordsMap.get(normalizeProvinceName(name));
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      onMouseMove={(e: React.MouseEvent) => {
                        const bounds = e.currentTarget.parentElement?.getBoundingClientRect();
                        const x = e.clientX - (bounds?.left || 0);
                        const y = e.clientY - (bounds?.top || 0);
                        
                        let content = `<span class="font-bold text-sm text-slate-200 border-b border-slate-800 pb-1 mb-1 block">${name.toUpperCase()}</span>`;
                        if (record) {
                          content += `
                            <div class="flex justify-between gap-4 mt-1"><span>Tahakkuk:</span><span class="font-mono">${formatTooltipValue(record.accrual)}</span></div>
                            <div class="flex justify-between gap-4"><span>Tahsilat:</span><span class="font-mono">${formatTooltipValue(record.collection)}</span></div>
                            <div class="flex justify-between gap-4 text-purple-400 font-bold border-t border-slate-800/50 mt-1 pt-1"><span>Oran:</span><span>%${record.ratio?.toFixed(2) || '0.00'}</span></div>
                          `;
                        } else {
                          content += `<span class="text-slate-500">Veri bulunamadı</span>`;
                        }
                        
                        setTooltip({ x, y, content });
                      }}
                      onMouseLeave={() => setTooltip(null)}
                      style={{
                        default: {
                          fill: getColor(name),
                          stroke: '#0f172a',
                          strokeWidth: 0.7,
                          outline: 'none',
                          transition: 'all 200ms ease',
                        },
                        hover: {
                          fill: '#6366f1', // Indigo on hover
                          stroke: '#f8fafc',
                          strokeWidth: 1.2,
                          outline: 'none',
                          cursor: 'pointer',
                        },
                        pressed: {
                          fill: '#4338ca',
                          stroke: '#f8fafc',
                          strokeWidth: 1.2,
                          outline: 'none',
                        },
                      }}
                    />
                  );
                })
              }
            </Geographies>
          </ComposableMap>
        </div>
      )}
    </div>
  );
};
