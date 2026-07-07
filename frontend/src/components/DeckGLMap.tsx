import React, { useMemo } from 'react';
// @ts-ignore
import DeckGL from '@deck.gl/react';
// @ts-ignore
import { GeoJsonLayer } from '@deck.gl/layers';
import { Map as MapGL } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface ProvinceData {
  province: string;
  accrual: number;
  collection: number;
  ratio: number;
}

interface DeckGLMapProps {
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

const hexToRgb = (hex: string): [number, number, number] => {
  const bigint = parseInt(hex.slice(1), 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return [r, g, b];
};

const INITIAL_VIEW_STATE = {
  longitude: 35.2433,
  latitude: 38.5,
  zoom: 5.3,
  pitch: 45, // Tilt the map for 3D look
  bearing: -10,
};

export const DeckGLMap: React.FC<DeckGLMapProps> = ({ geoJsonData, records, mapType }) => {
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

  // Enrich features with properties, rgb colors, and elevations
  const enrichedGeoJson = useMemo(() => {
    if (!geoJsonData) return null;
    const enriched = JSON.parse(JSON.stringify(geoJsonData));

    const getColorHex = (record: ProvinceData | undefined) => {
      if (!record) return '#1e293b'; 

      if (mapType === 'ratio') {
        const ratio = record.ratio || 0;
        if (ratio < 40) return '#f43f5e'; 
        if (ratio < 60) return '#f97316'; 
        if (ratio < 80) return '#eab308'; 
        return '#10b981'; 
      } else {
        const val = mapType === 'tahsilat' ? record.collection : record.accrual;
        if (!val || val <= 0) return '#1e293b';
        
        const fraction = Math.log1p(val) / Math.log1p(maxVal);
        if (fraction < 0.2) return '#1e1b4b'; 
        if (fraction < 0.4) return '#312e81'; 
        if (fraction < 0.6) return '#4338ca'; 
        if (fraction < 0.8) return '#3b82f6'; 
        return '#06b6d4'; 
      }
    };

    const getElevationValue = (record: ProvinceData | undefined) => {
      if (!record) return 0;
      if (mapType === 'ratio') {
        // scale ratio (0-100) to elevation (0 to 80,000 meters)
        return (record.ratio || 0) * 800;
      } else {
        const val = mapType === 'tahsilat' ? record.collection : record.accrual;
        if (!val || val <= 0) return 0;
        const fraction = Math.log1p(val) / Math.log1p(maxVal);
        return fraction * 120000;
      }
    };

    enriched.features.forEach((feature: any) => {
      const name = feature.properties.name;
      const record = recordsMap.get(normalizeProvinceName(name));
      feature.properties.fillColor = hexToRgb(getColorHex(record));
      feature.properties.elevation = getElevationValue(record);
      feature.properties.accrual = record ? record.accrual : null;
      feature.properties.collection = record ? record.collection : null;
      feature.properties.ratio = record ? record.ratio : null;
    });

    return enriched;
  }, [geoJsonData, recordsMap, mapType, maxVal]);

  const layers = useMemo(() => {
    if (!enrichedGeoJson) return [];
    
    return [
      new GeoJsonLayer({
        id: 'geojson-extruded',
        data: enrichedGeoJson,
        extruded: true, 
        wireframe: false,
        filled: true,
        pickable: true,
        getFillColor: (f: any) => f.properties.fillColor || [30, 41, 59],
        getLineColor: [15, 23, 42],
        getElevation: (f: any) => f.properties.elevation || 0,
        elevationScale: 1,
        updateTriggers: {
          getFillColor: [enrichedGeoJson],
          getElevation: [enrichedGeoJson],
        },
      }),
    ];
  }, [enrichedGeoJson]);

  const getTooltipContent = ({ object }: any) => {
    if (!object) return null;
    const props = object.properties;
    const name = props.name;

    const formatValue = (val: number | null | undefined) => {
      if (val === null || val === undefined || isNaN(val)) return '-';
      if (val >= 1000000) return `${(val / 1000000).toFixed(2)} Milyon ₺`;
      return `${val.toLocaleString('tr-TR')} ₺`;
    };

    const accrualStr = formatValue(props.accrual);
    const collectionStr = formatValue(props.collection);
    const ratioStr = props.ratio !== null && !isNaN(props.ratio) ? `%${parseFloat(props.ratio).toFixed(2)}` : '-';

    return {
      html: `
        <div style="background-color: #020617; color: #f8fafc; border: 1px solid #334155; border-radius: 12px; padding: 10px; font-family: Inter, sans-serif; font-size: 11px; min-width: 150px; box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.5);">
          <b style="font-size: 13px; border-bottom: 1px solid #1e293b; padding-bottom: 4px; margin-bottom: 6px; display: block; text-transform: uppercase;">${name}</b>
          <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 2px;"><span>Tahakkuk:</span><b>${accrualStr}</b></div>
          <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 2px;"><span>Tahsilat:</span><b>${collectionStr}</b></div>
          <div style="display: flex; justify-content: space-between; gap: 20px; border-top: 1px solid #1e293b; margin-top: 4px; padding-top: 4px; color: #a855f7;"><span>Oran:</span><b>${ratioStr}</b></div>
        </div>
      `,
      style: {
        background: 'transparent',
        padding: '0px',
      },
    };
  };

  return (
    <div className="relative w-full h-[550px] bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl overflow-hidden">
      <DeckGL
        initialViewState={INITIAL_VIEW_STATE as any}
        controller={true}
        layers={layers}
        getTooltip={getTooltipContent}
        style={{ position: 'relative', width: '100%', height: '100%' }}
      >
        <MapGL
          reuseMaps
          mapLib={maplibregl}
          mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
        />
      </DeckGL>
      <div className="absolute bottom-4 left-4 bg-slate-950/80 backdrop-blur-md border border-slate-800 text-[10px] text-slate-400 rounded-lg px-2.5 py-1.5 pointer-events-none select-none">
        Fare sağ tuşu / CTRL + Sol tuş ile haritayı döndürebilirsiniz.
      </div>
    </div>
  );
};
