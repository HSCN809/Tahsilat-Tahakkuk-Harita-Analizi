import React, { useMemo, useState, useRef } from 'react';
// @ts-ignore
import { ComposableMap, Geographies, Geography } from 'react-simple-maps';
import { formatCurrency } from '../utils/format';

interface ProvinceData {
  province: string;
  accrual: number;
  collection: number;
  ratio: number;
}

const REGIONS: { [key: string]: string[] } = {
  "Marmara": [
    "balikesir", "bilecik", "bursa", "canakkale", "edirne", "istanbul", 
    "kirklareli", "kocaeli", "sakarya", "tekirdag", "yalova"
  ],
  "Ege": [
    "afyonkarahisar", "aydin", "denizli", "izmir", "kutahya", "manisa", 
    "mugla", "usak"
  ],
  "Akdeniz": [
    "adana", "antalya", "burdur", "hatay", "isparta", "mersin", 
    "kahramanmaras", "osmaniye"
  ],
  "İç Anadolu": [
    "ankara", "cankiri", "eskisehir", "kayseri", "kirsehir", "konya", 
    "nevsehir", "nigde", "sivas", "yozgat", "aksaray", "karaman", "kirikkale"
  ],
  "Karadeniz": [
    "amasya", "artvin", "bolu", "corum", "giresun", "gumushane", "ordu", 
    "rize", "samsun", "sinop", "tokat", "trabzon", "bayburt", "bartin", 
    "karabuk", "zonguldak", "duzce", "kastamonu"
  ],
  "Doğu Anadolu": [
    "agri", "bingol", "bitlis", "elazig", "erzincan", "erzurum", "hakkari", 
    "kars", "malatya", "mus", "tunceli", "van", "ardahan", "igdir"
  ],
  "Güneydoğu Anadolu": [
    "adiyaman", "diyarbakir", "gaziantep", "mardin", "siirt", "sanliurfa", 
    "batman", "sirnak", "kilis"
  ]
};

const REGION_VIEWPORTS: { [key: string]: { scale: number; center: [number, number] } } = {
  "Tüm Ülke": { scale: 3000, center: [35.2433, 38.9637] },
  "Marmara": { scale: 6500, center: [28.3, 40.8] },
  "Ege": { scale: 6000, center: [28.2, 38.3] },
  "Akdeniz": { scale: 5000, center: [33.5, 36.8] },
  "İç Anadolu": { scale: 5500, center: [33.2, 39.0] },
  "Karadeniz": { scale: 4500, center: [36.5, 41.1] },
  "Doğu Anadolu": { scale: 5000, center: [41.8, 39.3] },
  "Güneydoğu Anadolu": { scale: 6000, center: [40.0, 37.6] }
};

interface TurkeyMapProps {
  geoJsonData: any;
  records: ProvinceData[];
  mapType: 'tahsilat' | 'tahakkuk' | 'ratio';
  selectedRegion: string;
}

const normalizeProvinceName = (name: string): string => {
  if (!name) return '';
  const normalized = name
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '') // remove spaces, underscores, and special characters
    .trim();

  // Handle known variation mappings to match GeoJSON normalized names
  if (normalized === 'urfa' || normalized === 'urdfa') return 'sanliurfa';
  if (normalized === 'kmaras' || normalized === 'maras') return 'kahramanmaras';
  if (normalized === 'elazi') return 'elazig';
  if (normalized === 'aksarat') return 'aksaray';
  if (normalized === 'izmit') return 'izmir'; // plate 35 is mapped as 'izmit' in 2008
  if (normalized === 'kirikkalae') return 'kirikkale';
  if (normalized === 'mardim') return 'mardin';
  if (normalized === 'afyon') return 'afyonkarahisar'; // 2026 directory is '03_Afyon'

  return normalized;
};

const interpolateColor = (color1: [number, number, number], color2: [number, number, number], factor: number): string => {
  const f = Math.max(0, Math.min(1, factor));
  const r = Math.round(color1[0] + f * (color2[0] - color1[0]));
  const g = Math.round(color1[1] + f * (color2[1] - color1[1]));
  const b = Math.round(color1[2] + f * (color2[2] - color1[2]));
  return `rgb(${r}, ${g}, ${b})`;
};

export const TurkeyMap: React.FC<TurkeyMapProps> = ({ geoJsonData, records, mapType, selectedRegion }) => {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string; alignLeft: boolean } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const recordsMap = useMemo(() => {
    const map = new Map<string, ProvinceData>();
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
      if (val > max) max = val;
    });
    return max || 1;
  }, [records, mapType]);

  const getColor = (name: string) => {
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
  };

  const formatTooltipValue = (val: number | null | undefined) => {
    return formatCurrency(val);
  };

  return (
    <div ref={containerRef} className="relative w-full h-[450px] bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 overflow-hidden flex items-center justify-center">
      {tooltip && (
        <div
          className="absolute z-50 bg-slate-950/90 backdrop-blur-md border border-slate-800 text-xs text-slate-100 rounded-xl p-3 shadow-2xl pointer-events-none flex flex-col gap-1 min-w-[150px] whitespace-nowrap"
          style={{
            left: tooltip.alignLeft ? tooltip.x - 15 : tooltip.x + 15,
            top: tooltip.y - 15,
            transform: tooltip.alignLeft ? 'translateX(-100%)' : 'none'
          }}
          dangerouslySetInnerHTML={{ __html: tooltip.content }}
        />
      )}

      {/* Harita Renk Lejantı */}
      {geoJsonData && records.length > 0 && (
        <div className="absolute bottom-4 right-4 z-20 bg-slate-950/85 backdrop-blur-md border border-slate-800/80 rounded-xl p-3 shadow-xl flex flex-col gap-2 min-w-[200px]">
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
            {mapType === 'ratio'
              ? 'Tahsilat Oranı'
              : mapType === 'tahsilat'
                ? 'Tahsilat Miktarı'
                : 'Tahakkuk Miktarı'}
          </span>
          <div className="h-2.5 w-full rounded-full bg-gradient-to-r from-[#f43f5e] via-[#eab308] to-[#10b981]"></div>
          <div className="flex justify-between items-center text-[10px] font-mono text-slate-300">
            {mapType === 'ratio' ? (
              <>
                <span>%0</span>
                <span>%50</span>
                <span>%100</span>
              </>
            ) : (
              <>
                <span>Min (0 ₺)</span>
                <span className="max-w-[120px] truncate" title={formatCurrency(maxVal)}>
                  {formatCurrency(maxVal)}
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {!geoJsonData ? (
        <div className="text-slate-500 text-sm font-medium">Harita verisi bekleniyor...</div>
      ) : (
        <div className="w-full h-full">
          <ComposableMap
            projection="geoMercator"
            projectionConfig={{
              scale: REGION_VIEWPORTS[selectedRegion]?.scale || 3000,
              center: REGION_VIEWPORTS[selectedRegion]?.center || [35.2433, 38.9637],
            }}
            style={{ width: '100%', height: '100%' }}
          >
            <Geographies geography={geoJsonData}>
              {({ geographies }: { geographies: any[] }) => {
                const filteredGeos = selectedRegion === 'Tüm Ülke' 
                  ? geographies 
                  : geographies.filter(geo => {
                      const name = geo.properties.name;
                      const normalized = normalizeProvinceName(name);
                      return REGIONS[selectedRegion]?.includes(normalized);
                    });

                return filteredGeos.map((geo) => {
                  const name = geo.properties.name;
                  const record = recordsMap.get(normalizeProvinceName(name));
                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      onMouseMove={(e: React.MouseEvent) => {
                        const bounds = containerRef.current?.getBoundingClientRect();
                        const x = e.clientX - (bounds?.left || 0);
                        const y = e.clientY - (bounds?.top || 0);
                        const containerWidth = bounds?.width || 0;
                        const alignLeft = x > containerWidth / 2;

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

                        setTooltip({ x, y, content, alignLeft });
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
                          fill: '#6366f1',
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
                });
              }}
            </Geographies>
          </ComposableMap>
        </div>
      )}
    </div>
  );
};
