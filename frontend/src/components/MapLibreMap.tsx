import React, { useEffect, useRef, useMemo } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface ProvinceData {
  province: string;
  accrual: number;
  collection: number;
  ratio: number;
}

interface MapLibreMapProps {
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

export const MapLibreMap: React.FC<MapLibreMapProps> = ({ geoJsonData, records, mapType }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Map records by normalized province name
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

  // Enrich GeoJSON features with properties and colors
  const enrichedGeoJson = useMemo(() => {
    if (!geoJsonData) return null;
    const enriched = JSON.parse(JSON.stringify(geoJsonData));

    const getColor = (record: ProvinceData | undefined) => {
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

    enriched.features.forEach((feature: any) => {
      const name = feature.properties.name;
      const record = recordsMap.get(normalizeProvinceName(name));
      feature.properties.color = getColor(record);
      feature.properties.accrual = record ? record.accrual : null;
      feature.properties.collection = record ? record.collection : null;
      feature.properties.ratio = record ? record.ratio : null;
    });

    return enriched;
  }, [geoJsonData, recordsMap, mapType, maxVal]);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Initialize MapLibre GL Map with Dark Matter base style
    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
      center: [35.2433, 38.9637], 
      zoom: 5.2,
      maxZoom: 10,
      minZoom: 4,
    });

    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl(), 'top-right');

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      className: 'custom-maplibre-popup',
    });

    map.on('load', () => {
      if (!enrichedGeoJson) return;

      map.addSource('provinces', {
        type: 'geojson',
        data: enrichedGeoJson,
      });

      // Fill Layer
      map.addLayer({
        id: 'provinces-layer',
        type: 'fill',
        source: 'provinces',
        paint: {
          'fill-color': ['get', 'color'],
          'fill-opacity': 0.75,
          'fill-outline-color': '#0f172a',
        },
      });

      // Highlight line Layer
      map.addLayer({
        id: 'provinces-line-hover',
        type: 'line',
        source: 'provinces',
        paint: {
          'line-color': '#ffffff',
          'line-width': 1.5,
        },
        filter: ['==', ['get', 'name'], ''],
      });

      // Mouse interact
      map.on('mousemove', 'provinces-layer', (e) => {
        if (!e.features || e.features.length === 0) return;
        map.getCanvas().style.cursor = 'pointer';

        const feature = e.features[0];
        const properties = feature.properties as any;
        const name = properties.name;

        map.setFilter('provinces-line-hover', ['==', ['get', 'name'], name]);

        const formatValue = (val: number | null | undefined) => {
          if (val === null || val === undefined || isNaN(val)) return '-';
          if (val >= 1000000) return `${(val / 1000000).toFixed(2)} Milyon ₺`;
          return `${val.toLocaleString('tr-TR')} ₺`;
        };

        const accrualStr = formatValue(properties.accrual);
        const collectionStr = formatValue(properties.collection);
        const ratioStr = properties.ratio !== null && !isNaN(properties.ratio) ? `%${parseFloat(properties.ratio).toFixed(2)}` : '-';

        let html = `
          <div style="background-color: #020617; color: #f8fafc; border: 1px solid #334155; border-radius: 12px; padding: 10px; font-family: Inter, sans-serif; font-size: 11px;">
            <b style="font-size: 13px; border-bottom: 1px solid #1e293b; padding-bottom: 4px; margin-bottom: 6px; display: block; text-transform: uppercase;">${name}</b>
            <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 2px;"><span>Tahakkuk:</span><b>${accrualStr}</b></div>
            <div style="display: flex; justify-content: space-between; gap: 20px; margin-bottom: 2px;"><span>Tahsilat:</span><b>${collectionStr}</b></div>
            <div style="display: flex; justify-content: space-between; gap: 20px; border-top: 1px solid #1e293b; margin-top: 4px; padding-top: 4px; color: #a855f7;"><span>Oran:</span><b>${ratioStr}</b></div>
          </div>
        `;

        popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
      });

      map.on('mouseleave', 'provinces-layer', () => {
        map.getCanvas().style.cursor = '';
        map.setFilter('provinces-line-hover', ['==', ['get', 'name'], '']);
        popup.remove();
      });
    });

    return () => {
      map.remove();
    };
  }, [enrichedGeoJson]);

  // Dynamically update data
  useEffect(() => {
    if (!mapRef.current || !enrichedGeoJson) return;
    const map = mapRef.current;
    
    if (map.isStyleLoaded()) {
      const source = map.getSource('provinces') as maplibregl.GeoJSONSource;
      if (source) {
        source.setData(enrichedGeoJson);
      }
    }
  }, [enrichedGeoJson]);

  return (
    <div className="relative w-full h-[550px] bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl overflow-hidden">
      <div ref={mapContainerRef} className="w-full h-full" />
    </div>
  );
};
