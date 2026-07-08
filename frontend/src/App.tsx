import { useState, useEffect, useMemo } from 'react';
import { Layers, Calendar, MapPin, X, Search, ChevronUp, ChevronDown } from 'lucide-react';
import { StatsCards } from './components/StatsCards';
import { TurkeyMap } from './components/Map';
import { Leaderboard } from './components/Leaderboard';
import { formatCurrency } from './utils/format';

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
    .replace(/[^a-z0-9]/g, '')
    .trim();

  if (normalized === 'urfa' || normalized === 'urdfa') return 'sanliurfa';
  if (normalized === 'kmaras' || normalized === 'maras') return 'kahramanmaras';
  if (normalized === 'elazi') return 'elazig';
  if (normalized === 'aksarat') return 'aksaray';
  if (normalized === 'izmit') return 'izmir';
  if (normalized === 'kirikkalae') return 'kirikkale';
  if (normalized === 'mardin' || normalized === 'mardim') return 'mardin';
  if (normalized === 'afyon') return 'afyonkarahisar';

  return normalized;
};

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

  const [geoJsonData, setGeoJsonData] = useState<any>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [records, setRecords] = useState<any[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedRegion, setSelectedRegion] = useState<string>('Tüm Ülke');

  const [activeModalMetric, setActiveModalMetric] = useState<'accrual' | 'collection' | 'ratio' | null>(null);
  const [modalSearchQuery, setModalSearchQuery] = useState('');
  const [modalSortColumn, setModalSortColumn] = useState<'province' | 'accrual' | 'collection' | 'ratio'>('accrual');
  const [modalSortDirection, setModalSortDirection] = useState<'asc' | 'desc'>('desc');

  const handleSort = (column: 'province' | 'accrual' | 'collection' | 'ratio') => {
    if (modalSortColumn === column) {
      setModalSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setModalSortColumn(column);
      setModalSortDirection(column === 'province' ? 'asc' : 'desc');
    }
  };

  const renderSortIcon = (column: 'province' | 'accrual' | 'collection' | 'ratio') => {
    if (modalSortColumn !== column) return null;
    return modalSortDirection === 'asc' 
      ? <ChevronUp className="w-3.5 h-3.5 ml-1 inline-block" /> 
      : <ChevronDown className="w-3.5 h-3.5 ml-1 inline-block" />;
  };

  const [loadingYears, setLoadingYears] = useState(true);
  const [loadingMonths, setLoadingMonths] = useState(false);
  const [loadingCategories, setLoadingCategories] = useState(false);
  const [loadingData, setLoadingData] = useState(false);
  const [loadingGeoJson, setLoadingGeoJson] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch years and GeoJSON on mount
  useEffect(() => {
    const fetchYears = async () => {
      try {
        setLoadingYears(true);
        const response = await fetch('/api/years');
        if (!response.ok) throw new Error('Yıllar yüklenemedi.');
        const data = await response.json();
        setYears(data.years);
        if (data.years && data.years.length > 0) {
          setSelectedYear(data.years[data.years.length - 1]);
        }
      } catch (err: any) {
        setError(err.message || 'Yıllar alınırken bir sorun oluştu.');
      } finally {
        setLoadingYears(false);
      }
    };

    const fetchGeoJson = async () => {
      try {
        setLoadingGeoJson(true);
        const response = await fetch('/api/geojson');
        if (!response.ok) throw new Error('Harita sınır verisi yüklenemedi.');
        const data = await response.json();
        setGeoJsonData(data);
      } catch (err: any) {
        setError(err.message || 'Harita verisi alınırken bir sorun oluştu.');
      } finally {
        setLoadingGeoJson(false);
      }
    };

    fetchYears();
    fetchGeoJson();
  }, []);

  // Yıl değiştiğinde aylar + kategorileri TEK istekle çek
  useEffect(() => {
    if (selectedYear === null) return;

    // Yıl geçişinde bağımlı state'leri anında temizle
    setMonths([]);
    setSelectedMonth('');
    setCategories([]);
    setSelectedCategory('');
    setRecords([]);
    setSummary(null);

    const controller = new AbortController();
    let cancelled = false;

    const fetchConfig = async () => {
      try {
        setLoadingMonths(true);
        setLoadingCategories(true);
        const response = await fetch(`/api/config?year=${selectedYear}`, { signal: controller.signal });
        if (!response.ok) throw new Error('Yıl yapılandırması yüklenemedi.');
        const data = await response.json();
        if (cancelled) return;

        // Aylar
        setMonths(data.months);
        const mevcutAy = data.months && data.months.length > 0 ? data.months[data.months.length - 1] : '';
        setSelectedMonth(mevcutAy);

        // Kategoriler
        setCategories(data.categories);
        if (data.categories && data.categories.length > 0) {
          setSelectedCategory(data.categories[0].id);
        } else {
          setSelectedCategory('');
        }
      } catch (err: any) {
        if (cancelled || err.name === 'AbortError') return;
        setError(err.message || 'Yıl yapılandırması alınırken bir sorun oluştu.');
      } finally {
        if (!cancelled) {
          setLoadingMonths(false);
          setLoadingCategories(false);
        }
      }
    };

    fetchConfig();

    return () => { cancelled = true; controller.abort(); };
  }, [selectedYear]);

  // Fetch summary and records when year/category/month changes
  useEffect(() => {
    // Bağımlı seçimler hazır değilse fetch başlatma; takılı kalan loading'i de temizle
    if (selectedYear === null || !selectedCategory || !selectedMonth) {
      setLoadingData(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    const fetchStats = async () => {
      try {
        setLoadingData(true);
        setError(null);
        const response = await fetch(`/api/data?year=${selectedYear}&category=${encodeURIComponent(selectedCategory)}&month=${encodeURIComponent(selectedMonth)}`, { signal: controller.signal });
        if (!response.ok) throw new Error('İl verileri yüklenemedi.');
        const data = await response.json();
        if (cancelled) return;
        setSummary(data.summary);
        setRecords(data.data);
      } catch (err: any) {
        if (cancelled || err.name === 'AbortError') return;
        setError(err.message || 'Veriler alınırken bir sorun oluştu.');
      } finally {
        if (!cancelled) setLoadingData(false);
      }
    };

    fetchStats();

    return () => { cancelled = true; controller.abort(); };
  }, [selectedYear, selectedCategory, selectedMonth]);

  const filteredCategories = categories.filter((cat) =>
    cat.name.toLowerCase().includes(searchCategory.toLowerCase())
  );

  // Filter records based on selected coğrafi bölge
  const filteredRecords = useMemo(() => {
    if (selectedRegion === 'Tüm Ülke') return records;
    const allowed = REGIONS[selectedRegion] || [];
    return records.filter(r => allowed.includes(normalizeProvinceName(r.province)));
  }, [records, selectedRegion]);

  // Recalculate summary KPIs based on the filtered regional records
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

  // Sort records for the modal dynamically based on search query, active column, and sort direction
  const sortedModalRecords = useMemo(() => {
    if (!activeModalMetric) return [];
    
    const filtered = filteredRecords.filter(r => 
      r.province.toLowerCase().includes(modalSearchQuery.toLowerCase())
    );

    return [...filtered].sort((a, b) => {
      if (modalSortColumn === 'province') {
        const valA = a.province.toLowerCase();
        const valB = b.province.toLowerCase();
        return modalSortDirection === 'asc' 
          ? valA.localeCompare(valB, 'tr') 
          : valB.localeCompare(valA, 'tr');
      } else {
        const valA = a[modalSortColumn] ?? 0;
        const valB = b[modalSortColumn] ?? 0;
        return modalSortDirection === 'desc' ? valB - valA : valA - valB;
      }
    });
  }, [filteredRecords, activeModalMetric, modalSearchQuery, modalSortColumn, modalSortDirection]);

  // Veri gösterimi için gerekli seçimler hazır mı?
  const selectionsReady = selectedYear !== null && !!selectedCategory && !!selectedMonth;

  // Gerçek "veri yükleniyor" durumu: ya fetch sürüyor ya da bağımlı seçimler henüz hazır değil.
  // loadingMonths/loadingCategories sırasında data fetch'in guard'ı erken döneceği için bunları da kapsa.
  const isDataLoading = loadingData || loadingMonths || loadingCategories || !selectionsReady;

  const isMapLoading = loadingGeoJson || isDataLoading;

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
                    onChange={(e) => {
                      setSelectedMonth('');
                      setSelectedCategory('');
                      setSelectedYear(Number(e.target.value));
                    }}
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
                {loadingMonths ? (
                  <div className="h-10 bg-slate-800/40 rounded-xl animate-pulse"></div>
                ) : (
                  <select
                    value={selectedMonth}
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

            <StatsCards stats={calculatedSummary} loading={isDataLoading} onCardClick={(metric) => {
              setActiveModalMetric(metric);
              setModalSortColumn(metric === 'accrual' ? 'accrual' : metric === 'collection' ? 'collection' : 'ratio');
              setModalSortDirection('desc');
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
            <Leaderboard data={filteredRecords} loading={isDataLoading} />
          </div>

        </div>
      </main>

      <footer className="border-t border-slate-900 bg-slate-950/40 py-6 text-center text-xs text-slate-500 font-mono mt-12">
        Tahsilat Tahakkuk Harita Analizi © 2026. Tüm hakları saklıdır.
      </footer>

      {/* 81 İl Detay Modalı */}
      {activeModalMetric && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
          {/* Modal Card */}
          <div className="relative w-full max-w-4xl bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col gap-5 max-h-[90vh]">
            
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-slate-100">
                  {activeModalMetric === 'accrual'
                    ? 'Tüm İller - Toplam Tahakkuk Detayları'
                    : activeModalMetric === 'collection'
                    ? 'Tüm İller - Toplam Tahsilat Detayları'
                    : 'Tüm İller - Tahsilat Oranı Detayları'}
                </h3>
                <p className="text-xs text-slate-400 mt-1">
                  {selectedYear} Yılı - {selectedMonth} Dönemi | Kategori: {categories.find(c => c.id === selectedCategory)?.name || selectedCategory}
                </p>
              </div>
              <button
                onClick={() => {
                  setActiveModalMetric(null);
                  setModalSearchQuery('');
                }}
                className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Input inside Modal */}
            <div className="relative w-full">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <input
                type="text"
                placeholder="İl adına göre filtrele..."
                value={modalSearchQuery}
                onChange={(e) => setModalSearchQuery(e.target.value)}
                className="w-full bg-slate-950/60 border border-slate-805 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 transition-all"
              />
            </div>

            {/* Table Container */}
            <div className="overflow-auto border border-slate-850 rounded-2xl bg-slate-950/40 scrollbar-thin">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="sticky top-0 bg-slate-950 text-slate-400 z-10">
                  <tr className="border-b border-slate-850">
                    <th className="py-3 px-4 font-semibold text-center w-16 select-none bg-slate-950">Sıra</th>
                    <th 
                      onClick={() => handleSort('province')}
                      className="py-3 px-4 font-semibold cursor-pointer select-none hover:text-slate-200 transition-colors bg-slate-950"
                    >
                      İl {renderSortIcon('province')}
                    </th>
                    <th 
                      onClick={() => handleSort('accrual')}
                      className={`py-3 px-4 font-semibold text-right cursor-pointer select-none hover:text-slate-200 transition-colors ${modalSortColumn === 'accrual' ? 'text-blue-400 bg-[#0f1626]' : 'bg-slate-950'}`}
                    >
                      Tahakkuk {renderSortIcon('accrual')}
                    </th>
                    <th 
                      onClick={() => handleSort('collection')}
                      className={`py-3 px-4 font-semibold text-right cursor-pointer select-none hover:text-slate-200 transition-colors ${modalSortColumn === 'collection' ? 'text-emerald-400 bg-[#0b1b15]' : 'bg-slate-950'}`}
                    >
                      Tahsilat {renderSortIcon('collection')}
                    </th>
                    <th 
                      onClick={() => handleSort('ratio')}
                      className={`py-3 px-4 font-semibold text-right cursor-pointer select-none hover:text-slate-200 transition-colors ${modalSortColumn === 'ratio' ? 'text-purple-400 bg-[#161224]' : 'bg-slate-950'}`}
                    >
                      Oran {renderSortIcon('ratio')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-850">
                  {sortedModalRecords.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500 text-xs">Aradığınız kriterde il bulunamadı.</td>
                    </tr>
                  ) : (
                    sortedModalRecords.map((record, index) => {
                      return (
                        <tr key={record.province} className="hover:bg-slate-800/20 transition-all">
                          <td className="py-2.5 px-4 text-center font-mono text-xs text-slate-500 bg-slate-900/10">{index + 1}</td>
                          <td className="py-2.5 px-4 font-semibold text-slate-200">{record.province.toUpperCase()}</td>
                          <td className={`py-2.5 px-4 text-right font-mono text-slate-300 ${modalSortColumn === 'accrual' ? 'text-blue-400 font-bold bg-[#0f1626]' : ''}`}>
                            {formatCurrency(record.accrual)}
                          </td>
                          <td className={`py-2.5 px-4 text-right font-mono text-slate-300 ${modalSortColumn === 'collection' ? 'text-emerald-400 font-bold bg-[#0b1b15]' : ''}`}>
                            {formatCurrency(record.collection)}
                          </td>
                          <td className={`py-2.5 px-4 text-right font-mono font-bold ${modalSortColumn === 'ratio' ? 'text-purple-400 bg-[#161224]' : record.ratio >= 75 ? 'text-emerald-400' : record.ratio >= 50 ? 'text-yellow-400' : 'text-rose-400'}`}>
                            %{record.ratio?.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Footer Summary / Info */}
            <div className="flex justify-between items-center text-xs text-slate-500 border-t border-slate-800 pt-3">
              <span>Toplam: {sortedModalRecords.length} il gösteriliyor</span>
              <span>Kapatmak için sağ üstteki butona tıklayabilirsiniz.</span>
            </div>
            
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
