import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Layers, Calendar, MapPin, Download } from 'lucide-react';
import { StatsCards } from './components/StatsCards';
import { TurkeyMap } from './components/Map';
import { Leaderboard } from './components/Leaderboard';
import { ProvinceModal } from './components/ProvinceModal';
import { DownloadModal } from './components/DownloadModal';
import { fetchYears, fetchConfig, fetchData, fetchGeoJson } from './services/api';
import { REGIONS, normalizeProvinceName } from './utils/provinces';
import type { Category, Summary, ProvinceRecord, TurkeyGeoJSON, MapType, ModalMetric } from './types';

function App() {
  const [years, setYears] = useState<number[]>([]);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [searchCategory, setSearchCategory] = useState<string>('');

  const [mapType, setMapType] = useState<MapType>('ratio');

  const [geoJsonData, setGeoJsonData] = useState<TurkeyGeoJSON | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [records, setRecords] = useState<ProvinceRecord[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedRegion, setSelectedRegion] = useState<string>('Tüm Ülke');

  const [activeModalMetric, setActiveModalMetric] = useState<ModalMetric | null>(null);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);

  // Birleşik yükleme durumları (flicker / çift animasyonu önler)
  const [initialLoading, setInitialLoading] = useState(true);
  const [updatingData, setUpdatingData] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // İstek iptali (race condition önleme)
  const abortControllerRef = useRef<AbortController | null>(null);

  // 1. Sayfa Açılışında Tekil ve Senkronize Başlatma (Single Pipeline Bootstrapping)
  useEffect(() => {
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const bootstrap = async () => {
      try {
        setInitialLoading(true);
        setError(null);

        // Yılları ve Haritayı paralel çek
        const [yearsRes, geoJsonRes] = await Promise.all([
          fetchYears(controller.signal),
          fetchGeoJson(controller.signal),
        ]);

        if (controller.signal.aborted) return;

        const availableYears = yearsRes.years || [];
        if (availableYears.length === 0) {
          setYears([]);
          setGeoJsonData(geoJsonRes);
          setInitialLoading(false);
          return;
        }

        const latestYear = availableYears[availableYears.length - 1];

        // En son yıla ait konfigürasyonu çek
        const configRes = await fetchConfig(latestYear, controller.signal);
        if (controller.signal.aborted) return;

        const availableMonths = configRes.months || [];
        const availableCats = configRes.categories || [];
        const defaultMonth = availableMonths.length > 0 ? availableMonths[availableMonths.length - 1] : '';
        const defaultCat = availableCats.length > 0 ? availableCats[0].id : '';

        // İlk veriyi çek
        let dataRes: { summary: Summary; data: ProvinceRecord[] } | null = null;
        if (defaultCat && defaultMonth) {
          dataRes = await fetchData(latestYear, defaultCat, defaultMonth, controller.signal);
        }

        if (controller.signal.aborted) return;

        // Tüm state'leri tek seferde senkronize commit et
        setYears(availableYears);
        setSelectedYear(latestYear);
        setGeoJsonData(geoJsonRes);
        setMonths(availableMonths);
        setSelectedMonth(defaultMonth);
        setCategories(availableCats);
        setSelectedCategory(defaultCat);
        if (dataRes) {
          setSummary(dataRes.summary);
          setRecords(dataRes.data);
        }
      } catch (err) {
        if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
        console.error('[App] Başlatma hatası:', err);
        setError(err instanceof Error ? err.message : 'Sistem verileri yüklenirken bir sorun oluştu.');
      } finally {
        if (!controller.signal.aborted) {
          setInitialLoading(false);
        }
      }
    };

    bootstrap();

    return () => {
      controller.abort();
    };
  }, []);

  // 2. Yıl Değişikliği Yöneticisi (Config + Data tek akışta yüklenir)
  const handleYearChange = useCallback(async (newYear: number) => {
    if (newYear === selectedYear) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setUpdatingData(true);
      setError(null);
      setSelectedYear(newYear);

      const configRes = await fetchConfig(newYear, controller.signal);
      if (controller.signal.aborted) return;

      const availableMonths = configRes.months || [];
      const availableCats = configRes.categories || [];

      // Mevcut ay/kategori yeni yılda var mı kontrol et, yoksa varsayılana dön
      const targetMonth = availableMonths.includes(selectedMonth)
        ? selectedMonth
        : (availableMonths[availableMonths.length - 1] || '');

      const targetCat = availableCats.some(c => c.id === selectedCategory)
        ? selectedCategory
        : (availableCats[0]?.id || '');

      setMonths(availableMonths);
      setSelectedMonth(targetMonth);
      setCategories(availableCats);
      setSelectedCategory(targetCat);

      if (targetCat && targetMonth) {
        const dataRes = await fetchData(newYear, targetCat, targetMonth, controller.signal);
        if (controller.signal.aborted) return;
        setSummary(dataRes.summary);
        setRecords(dataRes.data);
      } else {
        setSummary(null);
        setRecords([]);
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      console.error('[App] Yıl değiştirme hatası:', err);
      setError(err instanceof Error ? err.message : 'Yıl verileri yüklenirken hata oluştu.');
    } finally {
      if (!controller.signal.aborted) {
        setUpdatingData(false);
      }
    }
  }, [selectedYear, selectedMonth, selectedCategory]);

  // 3. Kategori veya Ay Değişikliği Yöneticisi
  const handleFilterChange = useCallback(async (newCat: string, newMonth: string) => {
    if (!selectedYear || !newCat || !newMonth) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      setUpdatingData(true);
      setError(null);
      setSelectedCategory(newCat);
      setSelectedMonth(newMonth);

      const dataRes = await fetchData(selectedYear, newCat, newMonth, controller.signal);
      if (controller.signal.aborted) return;

      setSummary(dataRes.summary);
      setRecords(dataRes.data);
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      console.error('[App] Filtre verisi hatası:', err);
      setError(err instanceof Error ? err.message : 'Veriler filtrelenirken bir hata oluştu.');
    } finally {
      if (!controller.signal.aborted) {
        setUpdatingData(false);
      }
    }
  }, [selectedYear]);

  const filteredCategories = categories.filter((cat) =>
    cat.name.toLowerCase().includes(searchCategory.toLowerCase())
  );

  const filteredRecords = useMemo(() => {
    if (selectedRegion === 'Tüm Ülke') return records;
    const allowed = REGIONS[selectedRegion] || [];
    return records.filter(r => allowed.includes(normalizeProvinceName(r.province)));
  }, [records, selectedRegion]);

  const calculatedSummary = useMemo(() => {
    if (!summary) return null;
    if (selectedRegion === 'Tüm Ülke') return summary;

    let totalAccrual = 0;
    let totalCollection = 0;

    filteredRecords.forEach(r => {
      totalAccrual += r.accrual ?? 0;
      totalCollection += r.collection ?? 0;
    });

    const ratio = totalAccrual > 0 ? (totalCollection / totalAccrual) * 100 : 0;

    return {
      total_accrual: totalAccrual,
      total_collection: totalCollection,
      overall_ratio: ratio
    };
  }, [summary, selectedRegion, filteredRecords]);

  const isAnythingLoading = initialLoading || updatingData;
  const isMapLoading = initialLoading || updatingData;

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col relative overflow-x-hidden">
      {/* Background gradients */}
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
      </header>

      {/* Main Workspace */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-6 flex flex-col gap-6">
        {error && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-2xl flex items-center justify-between text-sm">
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} className="text-xs font-semibold underline hover:text-rose-300">Kapat</button>
          </div>
        )}

        {/* Outer Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">

          {/* Left Panel: Sidebar (Filters) */}
          <div className="lg:col-span-3 flex flex-col gap-6">

            {/* Filter Section */}
            <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6 flex flex-col gap-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h2 className="text-lg font-semibold text-slate-100 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-blue-400" />
                  Filtre Seçenekleri
                </h2>
                <button
                  onClick={() => setDownloadModalOpen(true)}
                  title="Ham veri indir"
                  className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-blue-400 transition-all cursor-pointer"
                >
                  <Download className="w-5 h-5" />
                </button>
              </div>

              {/* Year Select */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Analiz Yılı</label>
                {initialLoading ? (
                  <div className="h-10 bg-slate-800/40 rounded-xl animate-pulse"></div>
                ) : (
                  <select
                    value={selectedYear || ''}
                    onChange={(e) => handleYearChange(Number(e.target.value))}
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

              {/* Month Select */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Analiz Ayı</label>
                {initialLoading ? (
                  <div className="h-10 bg-slate-800/40 rounded-xl animate-pulse"></div>
                ) : (
                  <select
                    value={selectedMonth}
                    onChange={(e) => handleFilterChange(selectedCategory, e.target.value)}
                    className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500 transition-all duration-300 cursor-pointer"
                  >
                    {months.map((m) => (
                      <option key={m} value={m} className="bg-slate-950 text-slate-100">
                        {m}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Region Select */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Analiz Bölgesi</label>
                <select
                  value={selectedRegion}
                  onChange={(e) => setSelectedRegion(e.target.value)}
                  className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500 transition-all duration-300 cursor-pointer"
                >
                  <option value="Tüm Ülke" className="bg-slate-950 text-slate-100">Tüm Ülke</option>
                  {Object.keys(REGIONS).map((reg) => (
                    <option key={reg} value={reg} className="bg-slate-950 text-slate-100">
                      {reg} Bölgesi
                    </option>
                  ))}
                </select>
              </div>

              {/* Map Type toggle */}
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Harita Gösterim Tipi</label>
                <div className="grid grid-cols-3 gap-2 bg-slate-950/60 p-1 border border-slate-800 rounded-xl">
                  <button
                    onClick={() => setMapType('tahakkuk')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-300 cursor-pointer ${mapType === 'tahakkuk'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                      }`}
                  >
                    Tahakkuk
                  </button>
                  <button
                    onClick={() => setMapType('tahsilat')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-300 cursor-pointer ${mapType === 'tahsilat'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                      }`}
                  >
                    Tahsilat
                  </button>
                  <button
                    onClick={() => setMapType('ratio')}
                    className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-300 cursor-pointer ${mapType === 'ratio'
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
                  <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">GELİR KALEMİ / VERGİ TÜRÜ</label>
                  {categories.length > 0 && (
                    <span className="text-[10px] text-slate-500 font-mono">Toplam: {categories.length}</span>
                  )}
                </div>

                <input
                  type="text"
                  placeholder="Vergi türü ara..."
                  value={searchCategory}
                  onChange={(e) => setSearchCategory(e.target.value)}
                  className="w-full bg-slate-950/40 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50 transition-all duration-300"
                />

                {initialLoading ? (
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
                          onClick={() => handleFilterChange(cat.id, selectedMonth)}
                          title={cat.name}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 flex items-center justify-between cursor-pointer ${selectedCategory === cat.id
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
          </div>

          {/* Middle Panel: Map & Stats Dashboard */}
          <div className="lg:col-span-6 flex flex-col gap-6">

            <StatsCards stats={calculatedSummary} loading={isAnythingLoading} onCardClick={(metric) => {
              setActiveModalMetric(metric);
            }} />

            {/* Map Visualizer Container */}
            <div className="relative">
              {isMapLoading && (
                <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-30 rounded-2xl">
                  <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-sm text-slate-400 font-medium animate-pulse">Harita ve veriler yükleniyor...</span>
                </div>
              )}

              <TurkeyMap geoJsonData={geoJsonData} records={filteredRecords} mapType={mapType} selectedRegion={selectedRegion} />
            </div>
          </div>

          {/* Right Panel: Leaderboards */}
          <div className="lg:col-span-3 flex flex-col gap-6">
            <Leaderboard data={filteredRecords} loading={isAnythingLoading} />
          </div>

        </div>
      </main>

      <footer className="border-t border-slate-900 bg-slate-950/40 py-6 text-center text-xs text-slate-500 font-mono mt-12">
        Tahsilat Tahakkuk Harita Analizi © 2026. Tüm hakları saklıdır.
      </footer>

      {/* 81 İl Detay Modalı */}
      {activeModalMetric && (
        <ProvinceModal
          metric={activeModalMetric}
          records={filteredRecords}
          selectedYear={selectedYear}
          selectedMonth={selectedMonth}
          categories={categories}
          selectedCategory={selectedCategory}
          onClose={() => setActiveModalMetric(null)}
        />
      )}

      {/* Ham Veri İndirme Modalı */}
      {downloadModalOpen && (
        <DownloadModal
          years={years}
          initialYear={selectedYear}
          onClose={() => setDownloadModalOpen(false)}
        />
      )}
    </div>
  );
}

export default App;
