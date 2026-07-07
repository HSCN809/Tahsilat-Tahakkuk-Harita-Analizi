import { useState, useEffect } from 'react';
import { Layers, Calendar, MapPin } from 'lucide-react';
import { StatsCards } from './components/StatsCards';
import { Map } from './components/Map';
import { Leaderboard } from './components/Leaderboard';
import { ScraperControl } from './components/ScraperControl';

interface Category {
  id: string;
  name: string;
}

interface Summary {
  total_accrual: number;
  total_collection: number;
  overall_ratio: number;
}

function App() {
  const [years, setYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchCategory, setSearchCategory] = useState<string>('');
  
  const [mapType, setMapType] = useState<'tahsilat' | 'tahakkuk' | 'ratio'>('ratio');
  
  const [summary, setSummary] = useState<Summary | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [mapFigure, setMapFigure] = useState<any>(null);

  const [loadingYears, setLoadingYears] = useState(true);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [loadingMap, setLoadingMap] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch years on mount
  useEffect(() => {
    const fetchYears = async () => {
      try {
        setLoadingYears(true);
        const response = await fetch('/api/years');
        if (!response.ok) throw new Error('Yıllar yüklenemedi.');
        const data = await response.json();
        setYears(data.years);
        if (data.years && data.years.length > 0) {
          // Select latest year by default
          setSelectedYear(data.years[data.years.length - 1]);
        }
      } catch (err: any) {
        setError(err.message || 'Yıllar alınırken bir sorun oluştu.');
      } finally {
        setLoadingYears(false);
      }
    };

    fetchYears();
  }, []);

  // Fetch categories when year changes
  useEffect(() => {
    if (selectedYear === null) return;

    const fetchCategories = async () => {
      try {
        setLoadingCategories(true);
        const response = await fetch(`/api/categories?year=${selectedYear}`);
        if (!response.ok) throw new Error('Kategoriler yüklenemedi.');
        const data = await response.json();
        setCategories(data.categories);
        if (data.categories && data.categories.length > 0) {
          setSelectedCategory(data.categories[0].id);
        } else {
          setSelectedCategory('');
        }
      } catch (err: any) {
        setError(err.message || 'Kategoriler alınırken bir sorun oluştu.');
      } finally {
        setLoadingCategories(false);
      }
    };

    fetchCategories();
  }, [selectedYear]);

  // Fetch data (summary/records) and map figure when year, category or mapType changes
  useEffect(() => {
    if (selectedYear === null || !selectedCategory) return;

    const fetchDataAndMap = async () => {
      setError(null);
      
      // Fetch stats and leaderboard data
      const fetchStats = async () => {
        try {
          setLoadingData(true);
          const response = await fetch(`/api/data?year=${selectedYear}&category=${encodeURIComponent(selectedCategory)}`);
          if (!response.ok) throw new Error('İl verileri yüklenemedi.');
          const data = await response.json();
          setSummary(data.summary);
          setRecords(data.data);
        } catch (err: any) {
          console.error(err);
        } finally {
          setLoadingData(false);
        }
      };

      // Fetch Plotly map JSON
      const fetchMap = async () => {
        try {
          setLoadingMap(true);
          let url = '';
          if (mapType === 'ratio') {
            url = `/api/map/ratio?year=${selectedYear}&category=${encodeURIComponent(selectedCategory)}`;
          } else {
            url = `/api/map/amount?year=${selectedYear}&category=${encodeURIComponent(selectedCategory)}&type=${mapType}`;
          }

          const response = await fetch(url);
          if (!response.ok) throw new Error('Harita çizimi başarısız oldu.');
          const mapJson = await response.json();
          setMapFigure(mapJson);
        } catch (err: any) {
          console.error(err);
          setMapFigure(null);
        } finally {
          setLoadingMap(false);
        }
      };

      fetchStats();
      fetchMap();
    };

    fetchDataAndMap();
  }, [selectedYear, selectedCategory, mapType]);

  const filteredCategories = categories.filter((cat) =>
    cat.name.toLowerCase().includes(searchCategory.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col relative overflow-x-hidden">
      {/* Background decoration elements */}
      <div className="absolute top-0 left-1/4 w-[500px] h-[500px] bg-blue-500/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-emerald-500/5 rounded-full blur-[150px] pointer-events-none"></div>

      {/* Header */}
      <header className="border-b border-slate-900 bg-slate-950/80 backdrop-blur-md sticky top-0 z-40 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-blue-600/10 border border-blue-500/20 text-blue-500 rounded-xl">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100 m-0 tracking-tight flex items-center gap-2">
              Tahsilat & Tahakkuk Harita Analizi
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">Hazine ve Maliye Bakanlığı Vergi İstatistikleri Portalı</p>
          </div>
        </div>
        <div className="text-xs text-slate-500 font-mono hidden md:block">
          Backend: FastAPI | Frontend: React & Plotly
        </div>
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6">
        {error && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl flex items-center justify-between text-sm">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} className="text-xs font-semibold underline hover:text-rose-300">Kapat</button>
          </div>
        )}

        {/* Outer Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* Left Panel: Sidebar (Filters) */}
          <div className="lg:col-span-4 flex flex-col gap-6">
            
            {/* Filter Section */}
            <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 flex flex-col gap-5">
              <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2 border-b border-slate-800 pb-3">
                <Calendar className="w-5 h-5 text-blue-400" />
                Filtre Seçenekleri
              </h2>

              {/* Year Select */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Analiz Yılı</label>
                {loadingYears ? (
                  <div className="h-10 bg-slate-800/40 rounded-xl animate-pulse"></div>
                ) : (
                  <select
                    value={selectedYear || ''}
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500 transition-all duration-300 cursor-pointer"
                  >
                    {years.map((y) => (
                      <option key={y} value={y} className="bg-slate-950 text-slate-100">
                        {y} Yılı
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Map Type toggle */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Harita Gösterim Tipi</label>
                <div className="grid grid-cols-3 gap-2 bg-slate-950/60 p-1 border border-slate-800 rounded-xl">
                  <button
                    onClick={() => setMapType('tahsilat')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-300 cursor-pointer ${
                      mapType === 'tahsilat'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Tahsilat
                  </button>
                  <button
                    onClick={() => setMapType('tahakkuk')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-300 cursor-pointer ${
                      mapType === 'tahakkuk'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Tahakkuk
                  </button>
                  <button
                    onClick={() => setMapType('ratio')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-300 cursor-pointer ${
                      mapType === 'ratio'
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    Oran (%)
                  </button>
                </div>
              </div>

              {/* Category Search & Select */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Gelir Kalemi / Vergi Türü</label>
                  {categories.length > 0 && (
                    <span className="text-[10px] text-slate-500 font-mono">Toplam: {categories.length}</span>
                  )}
                </div>

                <input
                  type="text"
                  placeholder="Vergi türü ara..."
                  value={searchCategory}
                  onChange={(e) => setSearchCategory(e.target.value)}
                  className="w-full bg-slate-950/40 border border-slate-850 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50 transition-all duration-300"
                />

                {loadingCategories ? (
                  <div className="space-y-2 mt-2">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className="h-8 bg-slate-800/40 rounded-lg animate-pulse"></div>
                    ))}
                  </div>
                ) : (
                  <div className="max-h-[250px] overflow-y-auto border border-slate-800/60 rounded-xl bg-slate-950/40 p-1 flex flex-col gap-0.5 scrollbar-thin">
                    {filteredCategories.length === 0 ? (
                      <div className="text-center py-4 text-xs text-slate-500">Aramaya uygun kategori bulunamadı.</div>
                    ) : (
                      filteredCategories.map((cat) => (
                        <button
                          key={cat.id}
                          onClick={() => setSelectedCategory(cat.id)}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 flex items-center justify-between cursor-pointer ${
                            selectedCategory === cat.id
                              ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20'
                              : 'text-slate-400 hover:bg-slate-800/30 hover:text-slate-200 border border-transparent'
                          }`}
                        >
                          <span className="truncate pr-2">{cat.name}</span>
                          <MapPin className={`w-3.5 h-3.5 flex-shrink-0 opacity-50 ${selectedCategory === cat.id ? 'opacity-100' : ''}`} />
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Scraper Panel */}
            <ScraperControl />
          </div>

          {/* Right Panel: Map & Stats Dashboard */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            
            {/* Header info about the current query */}
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold text-blue-500 uppercase tracking-widest font-mono">
                {selectedYear} Analiz Raporu
              </span>
              <h2 className="text-2xl font-extrabold text-slate-100 tracking-tight">
                {categories.find((c) => c.id === selectedCategory)?.name || 'Kategori Seçilmedi'}
              </h2>
            </div>

            {/* KPI Cards */}
            <StatsCards stats={summary} loading={loadingData} />

            {/* Map Visualizer */}
            <Map figureData={mapFigure} loading={loadingMap} />

            {/* Leaderboards */}
            <Leaderboard data={records} loading={loadingData} />
            
          </div>
        </div>
      </main>

      <footer className="border-t border-slate-900 bg-slate-950/40 py-6 text-center text-xs text-slate-500 font-mono mt-12">
        Tahsilat Tahakkuk Harita Analizi © 2026. Tüm hakları saklıdır.
      </footer>
    </div>
  );
}

export default App;
//
