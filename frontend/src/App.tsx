import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, Calendar, MapPin, Download } from 'lucide-react';
import { StatsCards } from './components/StatsCards';
import { TurkeyMap } from './components/Map';
import { Leaderboard } from './components/Leaderboard';
import { ProvinceModal } from './components/ProvinceModal';
import { DownloadModal } from './components/DownloadModal';
import { fetchYears, fetchConfig, fetchData, fetchGeoJson } from './services/api';
import { REGIONS, normalizeProvinceName } from './utils/provinces';
import type { MapType, ModalMetric } from './types';

function App() {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [searchCategory, setSearchCategory] = useState<string>('');
  const [selectedRegion, setSelectedRegion] = useState<string>('Tüm Ülke');
  const [mapType, setMapType] = useState<MapType>('ratio');

  const [activeModalMetric, setActiveModalMetric] = useState<ModalMetric | null>(null);
  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  // 1. Yılları çek (5 dk cache)
  const {
    data: yearsRes,
    isLoading: yearsLoading,
    error: yearsError,
  } = useQuery({
    queryKey: ['years'],
    queryFn: ({ signal }) => fetchYears(signal),
  });

  const years = useMemo(() => yearsRes?.years || [], [yearsRes]);

  // İlk yüklemede en güncel yılı seç
  useEffect(() => {
    if (years.length > 0 && selectedYear === null) {
      setSelectedYear(years[years.length - 1]);
    }
  }, [years, selectedYear]);

  // 2. GeoJSON harita verisini çek (bellekte sonsuz sakla)
  const {
    data: geoJsonData,
    isLoading: geoJsonLoading,
  } = useQuery({
    queryKey: ['geojson'],
    queryFn: ({ signal }) => fetchGeoJson(signal),
    staleTime: Infinity,
  });

  // 3. Seçilen yıla ait config (aylar ve kategoriler)
  const {
    data: configRes,
    isLoading: configLoading,
    error: configError,
  } = useQuery({
    queryKey: ['config', selectedYear],
    queryFn: ({ signal }) => fetchConfig(selectedYear!, signal),
    enabled: selectedYear !== null,
  });

  const months = useMemo(() => configRes?.months || [], [configRes]);
  const categories = useMemo(() => configRes?.categories || [], [configRes]);

  // Aktif ay ve kategori çözümlemesi (seçim yoksa veya yeni yılda mevcut değilse varsayılana düşer)
  const activeMonth = useMemo(() => {
    if (months.length === 0) return '';
    if (selectedMonth && months.includes(selectedMonth)) return selectedMonth;
    return months[months.length - 1];
  }, [months, selectedMonth]);

  const activeCategory = useMemo(() => {
    if (categories.length === 0) return '';
    if (selectedCategory && categories.some((c) => c.id === selectedCategory)) return selectedCategory;
    return categories[0]?.id || '';
  }, [categories, selectedCategory]);

  // 4. Verileri çek (TanStack Query önbellek)
  const {
    data: dataRes,
    isLoading: dataLoading,
    isFetching: dataFetching,
    error: dataError,
  } = useQuery({
    queryKey: ['data', selectedYear, activeCategory, activeMonth],
    queryFn: ({ signal }) => fetchData(selectedYear!, activeCategory, activeMonth, signal),
    enabled: selectedYear !== null && !!activeCategory && !!activeMonth,
  });

  // Verinin gerçekten şu an seçili yıla ait olup olmadığını doğrula (eski yıl verisinin parlamasını önler)
  const isDataFresh = !!dataRes && dataRes.year === selectedYear;
  const summary = isDataFresh ? dataRes.summary : null;
  const records = useMemo(() => (isDataFresh ? dataRes.data : []), [isDataFresh, dataRes]);

  const handleYearChange = (newYear: number) => {
    setSelectedYear(newYear);
    setSelectedMonth(''); // Yıl değiştiğinde ayı sıfırla ki yeni yılın son ayı seçilsin
  };

  const filteredCategories = useMemo(() => {
    return categories.filter((cat) =>
      cat.name.toLowerCase().includes(searchCategory.toLowerCase())
    );
  }, [categories, searchCategory]);

  const filteredRecords = useMemo(() => {
    if (selectedRegion === 'Tüm Ülke') return records;
    const allowed = REGIONS[selectedRegion] || [];
    return records.filter((r) => allowed.includes(normalizeProvinceName(r.province)));
  }, [records, selectedRegion]);

  const calculatedSummary = useMemo(() => {
    if (!summary) return null;
    if (selectedRegion === 'Tüm Ülke') return summary;

    let totalAccrual = 0;
    let totalCollection = 0;

    filteredRecords.forEach((r) => {
      totalAccrual += r.accrual ?? 0;
      totalCollection += r.collection ?? 0;
    });

    const ratio = totalAccrual > 0 ? (totalCollection / totalAccrual) * 100 : 0;

    return {
      total_accrual: totalAccrual,
      total_collection: totalCollection,
      overall_ratio: ratio,
    };
  }, [summary, selectedRegion, filteredRecords]);

  // Hata yönetimi
  const activeError = yearsError || configError || dataError;
  const rawErrorMessage = activeError instanceof Error ? activeError.message : null;
  const error = rawErrorMessage && rawErrorMessage !== dismissedError ? rawErrorMessage : null;

  // Yükleme durumları
  const isInitialLoading = yearsLoading || geoJsonLoading;
  const isConfigWaiting = configLoading && !configRes;
  const isDataLoading = dataLoading || isConfigWaiting || (dataFetching && !isDataFresh);
  const isAnythingLoading = isInitialLoading || isDataLoading;
  const isMapLoading = isInitialLoading || isDataLoading;

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
            <button
              onClick={() => setDismissedError(rawErrorMessage)}
              className="text-xs font-semibold underline hover:text-rose-300 cursor-pointer"
            >
              Kapat
            </button>
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
                  aria-label="Ham verileri indir"
                  className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-blue-400 transition-all cursor-pointer"
                >
                  <Download className="w-5 h-5" />
                </button>
              </div>

              {/* Year Select */}
              <div className="flex flex-col gap-2">
                <label htmlFor="year-select" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Analiz Yılı</label>
                {isInitialLoading ? (
                  <div className="h-10 bg-slate-800/40 rounded-xl animate-pulse"></div>
                ) : (
                  <select
                    id="year-select"
                    aria-label="Analiz Yılı Seçin"
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
                <label htmlFor="month-select" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Analiz Ayı</label>
                {isInitialLoading || isConfigWaiting ? (
                  <div className="h-10 bg-slate-800/40 rounded-xl animate-pulse"></div>
                ) : (
                  <select
                    id="month-select"
                    aria-label="Analiz Ayı Seçin"
                    value={activeMonth}
                    onChange={(e) => setSelectedMonth(e.target.value)}
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
                <label htmlFor="region-select" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Analiz Bölgesi</label>
                <select
                  id="region-select"
                  aria-label="Analiz Bölgesi Seçin"
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
                    aria-label="Haritada Tahakkuk Tutarlarını Göster"
                    className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-300 cursor-pointer ${mapType === 'tahakkuk'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                      }`}
                  >
                    Tahakkuk
                  </button>
                  <button
                    onClick={() => setMapType('tahsilat')}
                    aria-label="Haritada Tahsilat Tutarlarını Göster"
                    className={`py-1.5 px-3 rounded-lg text-xs font-medium transition-all duration-300 cursor-pointer ${mapType === 'tahsilat'
                      ? 'bg-blue-600 text-white shadow-md'
                      : 'text-slate-400 hover:text-slate-200'
                      }`}
                  >
                    Tahsilat
                  </button>
                  <button
                    onClick={() => setMapType('ratio')}
                    aria-label="Haritada Tahsilat Oranını Göster"
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
                  <label htmlFor="category-search" className="text-xs font-semibold text-slate-400 uppercase tracking-wider">GELİR KALEMİ / VERGİ TÜRÜ</label>
                  {categories.length > 0 && (
                    <span className="text-[10px] text-slate-500 font-mono">Toplam: {categories.length}</span>
                  )}
                </div>

                <input
                  type="text"
                  id="category-search"
                  aria-label="Vergi türü veya gelir kalemi ara"
                  placeholder="Vergi türü ara..."
                  value={searchCategory}
                  onChange={(e) => setSearchCategory(e.target.value)}
                  className="w-full bg-slate-950/40 border border-slate-800 rounded-xl px-3 py-1.5 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-blue-500/50 transition-all duration-300"
                />

                {isInitialLoading || isConfigWaiting ? (
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
                          title={cat.name}
                          className={`w-full text-left px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 flex items-center justify-between cursor-pointer ${activeCategory === cat.id
                            ? 'bg-blue-600/10 text-blue-400 border border-blue-500/20'
                            : 'text-slate-400 hover:bg-slate-800/30 hover:text-slate-200 border border-transparent'
                            }`}
                        >
                          <span className="truncate pr-2">{cat.name}</span>
                          <MapPin className={`w-3.5 h-3.5 flex-shrink-0 opacity-50 ${activeCategory === cat.id ? 'opacity-100' : ''}`} />
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
            <StatsCards
              stats={calculatedSummary}
              loading={isAnythingLoading}
              onCardClick={(metric) => {
                setActiveModalMetric(metric);
              }}
            />

            {/* Map Visualizer Container */}
            <div className="relative">
              {isMapLoading && (
                <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm flex flex-col items-center justify-center gap-3 z-30 rounded-2xl">
                  <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-sm text-slate-400 font-medium animate-pulse">Harita ve veriler yükleniyor...</span>
                </div>
              )}

              <TurkeyMap
                geoJsonData={geoJsonData ?? null}
                records={filteredRecords}
                mapType={mapType}
                selectedRegion={selectedRegion}
              />
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
          selectedMonth={activeMonth}
          categories={categories}
          selectedCategory={activeCategory}
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
