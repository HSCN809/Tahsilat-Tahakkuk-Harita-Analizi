import React, { useEffect, useRef } from 'react';
// @ts-ignore
import Plotly from 'plotly.js-dist-min';

interface MapProps {
  figureData: any;
  loading: boolean;
}

export const Map: React.FC<MapProps> = ({ figureData, loading }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current || !figureData) return;

    // Apply premium dark mode overrides to the Plotly layout
    const layout = {
      ...figureData.layout,
      paper_bgcolor: 'rgba(0,0,0,0)', 
      plot_bgcolor: 'rgba(0,0,0,0)',
      font: {
        family: 'Inter, system-ui, sans-serif',
        color: '#9ca3af',
      },
      geo: {
        ...figureData.layout?.geo,
        bgcolor: 'rgba(0,0,0,0)',
        lakecolor: 'rgba(0,0,0,0)',
        landcolor: 'rgba(30, 41, 59, 0.5)',
        subunitcolor: '#475569',
        countrycolor: '#475569',
        showlakes: false,
        projection: {
          type: 'mercator',
        },
      },
      margin: { r: 10, t: 40, l: 10, b: 10 },
    };

    // Color bar overrides if it exists
    if (layout.coloraxis) {
      layout.coloraxis.colorbar = {
        ...layout.coloraxis.colorbar,
        thickness: 15,
        len: 0.7,
        tickfont: { color: '#9ca3af', size: 10 },
        title: { ...layout.coloraxis.colorbar.title, font: { color: '#e2e8f0', size: 12 } }
      };
    }

    const config = {
      responsive: true,
      displayModeBar: false,
    };

    Plotly.newPlot(containerRef.current, figureData.data, layout, config);

    const handleResize = () => {
      if (containerRef.current) {
        Plotly.Plots.resize(containerRef.current);
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (containerRef.current) {
        Plotly.purge(containerRef.current);
      }
    };
  }, [figureData]);

  return (
    <div className="relative w-full h-[550px] bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-4 overflow-hidden flex items-center justify-center">
      {loading && (
        <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-10">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          <span className="text-sm text-slate-400 font-medium animate-pulse">Harita yükleniyor...</span>
        </div>
      )}
      {!figureData && !loading && (
        <div className="text-slate-500 text-sm font-medium">
          Veri yüklenemedi veya harita seçilmedi.
        </div>
      )}
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};
