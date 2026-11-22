import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Download, ChevronDown, Search, AlertTriangle, Check } from 'lucide-react';
import { StatsCards } from './components/StatsCards';
import { TurkeyMap } from './components/Map';
import { ProvinceInspector } from './components/ProvinceInspector';
import { ProvinceLedger } from './components/ProvinceLedger';
import { fetchYears, fetchConfig, fetchData, fetchGeoJson, fetchBootstrap } from './services/api';

const DownloadModal = lazy(() =>
  import('./components/DownloadModal').then((m) => ({ default: m.DownloadModal }))
);
import { REGIONS, normalizeProvinceName } from './utils/provinces';
import type { MapType, SortColumn, SortDirection } from './types';

const supportsAnchoredPopover =
  typeof HTMLElement !== 'undefined' &&
  Object.hasOwn(HTMLElement.prototype, 'popover') &&
  typeof CSS !== 'undefined' &&
  CSS.supports('position-area: block-end');

function App() {
  const queryClient = useQueryClient();
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [searchCategory, setSearchCategory] = useState<string>('');
  const [categoryMenuOpen, setCategoryMenuOpen] = useState<boolean>(false);
  const [selectedRegion, setSelectedRegion] = useState<string>('Tüm Ülke');
  const [selectedProvinces, setSelectedProvinces] = useState<string[]>([]);
  const [mapType, setMapType] = useState<MapType>('ratio');

  const [ledgerSortColumn, setLedgerSortColumn] = useState<SortColumn>('ratio');
  const [ledgerSortDirection, setLedgerSortDirection] = useState<SortDirection>('desc');

  const [downloadModalOpen, setDownloadModalOpen] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const categoryPopoverRef = useRef<HTMLDivElement>(null);
  const categoryTriggerRef = useRef<HTMLButtonElement>(null);
  const categorySearchRef = useRef<HTMLInputElement>(null);
  const categoryOptionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // İlk açılış hızlandırması: Bootstrap tek ağ turunda (yıllar + son yıl config + ilk veri) indirir
  const {
    data: bootstrapData,
    isLoading: bootstrapLoading,
    error: bootstrapError,
  } = useQuery({
    queryKey: ['bootstrap'],
    queryFn: ({ signal }) => fetchBootstrap(signal),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (bootstrapData && selectedYear === null) {
      const { years: bYears, config: bConfig, data: bData } = bootstrapData;
      if (bYears && bYears.length > 0) {
        queryClient.setQueryData(['years'], { years: bYears });
        const latest = bYears[bYears.length - 1];
        if (bConfig) {
          queryClient.setQueryData(['config', latest], bConfig);
          const defaultCat = bConfig.categories[0]?.id || '';
          const defaultMonth = bConfig.months[bConfig.months.length - 1] || '';
          if (bData && defaultCat && defaultMonth) {
            queryClient.setQueryData(['data', latest, defaultCat, defaultMonth], bData);
          }
        }
        setSelectedYear(latest);
      }
    }
  }, [bootstrapData, selectedYear, queryClient]);

  const {
    data: yearsRes,
    isLoading: yearsLoading,
    error: yearsError,
  } = useQuery({
    queryKey: ['years'],
    queryFn: ({ signal }) => fetchYears(signal),
  });

  const years = useMemo(() => yearsRes?.years || bootstrapData?.years || [], [yearsRes, bootstrapData]);

  useEffect(() => {
    if (years.length > 0 && selectedYear === null) {
      setSelectedYear(years[years.length - 1]);
    }
  }, [years, selectedYear]);

  const {
    data: geoJsonData,
    isLoading: geoJsonLoading,
  } = useQuery({
    queryKey: ['geojson'],
    queryFn: ({ signal }) => fetchGeoJson(signal),
    staleTime: Infinity,
  });

  const {
    data: configRes,
    isLoading: configLoading,
    error: configError,
  } = useQuery({
    queryKey: ['config', selectedYear],
    queryFn: ({ signal }) => fetchConfig(selectedYear!, signal),
    enabled: selectedYear !== null,
    placeholderData: keepPreviousData,
  });

  const isConfigFresh = !!configRes && configRes.year === selectedYear;
  const months = useMemo(() => configRes?.months || [], [configRes]);
  const categories = useMemo(() => configRes?.categories || [], [configRes]);

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

  const activeCategoryName = useMemo(() => {
    return categories.find((c) => c.id === activeCategory)?.name || 'Kalem seçin';
  }, [categories, activeCategory]);

  const {
    data: dataRes,
    isLoading: dataLoading,
    isFetching: dataFetching,
    error: dataError,
  } = useQuery({
    queryKey: ['data', selectedYear, activeCategory, activeMonth],
    queryFn: ({ signal }) => fetchData(selectedYear!, activeCategory, activeMonth, signal),
    enabled: selectedYear !== null && isConfigFresh && !!activeCategory && !!activeMonth,
  });

  const isDataMatching = !dataLoading && !dataFetching && isConfigFresh && !!dataRes && dataRes.year === selectedYear;
  const isDataLoading = !isDataMatching;

  const summary = isDataLoading ? null : dataRes?.summary || null;
  const records = useMemo(() => (isDataLoading ? [] : dataRes?.data || []), [isDataLoading, dataRes]);

  const closeCategoryMenu = useCallback((returnFocus: boolean) => {
    if (supportsAnchoredPopover && categoryPopoverRef.current?.matches(':popover-open')) {
      categoryPopoverRef.current.hidePopover();
    } else {
      setCategoryMenuOpen(false);
    }
    if (returnFocus) {
      requestAnimationFrame(() => categoryTriggerRef.current?.focus());
    }
  }, []);

  // Yedek menü (Popover/Anchor desteklemeyen tarayıcılar): dış tıklama veya Escape'te kapat
  useEffect(() => {
    if (!categoryMenuOpen || supportsAnchoredPopover) return;
    requestAnimationFrame(() => categorySearchRef.current?.focus());
    const handlePointerDown = (e: MouseEvent) => {
      if (categoryMenuRef.current && !categoryMenuRef.current.contains(e.target as Node)) {
        closeCategoryMenu(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeCategoryMenu(true);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [categoryMenuOpen, closeCategoryMenu]);

  const handleYearChange = (newYear: number) => {
    setSelectedYear(newYear);
    setSelectedMonth('');
  };

  const handleRegionChange = (newRegion: string) => {
    setSelectedRegion(newRegion);
    if (newRegion !== 'Tüm Ülke') {
      const allowed = REGIONS[newRegion] || [];
      setSelectedProvinces((prev) => prev.filter((p) => allowed.includes(p)));
    }
  };

  const handleSelectProvince = useCallback((normalized: string, multi: boolean) => {
    setSelectedProvinces((prev) => {
      if (multi) {
        return prev.includes(normalized)
          ? prev.filter((p) => p !== normalized)
          : [...prev, normalized];
      }
      if (prev.length === 1 && prev[0] === normalized) {
        return [];
      }
      return [normalized];
    });
  }, []);

  const handleRemoveProvince = useCallback((normalized: string) => {
    setSelectedProvinces((prev) => prev.filter((p) => p !== normalized));
  }, []);

  const handleClearProvinces = useCallback(() => {
    setSelectedProvinces([]);
  }, []);

  const filteredCategories = useMemo(() => {
    const q = searchCategory.trim().toLocaleLowerCase('tr-TR');
    if (!q) return categories;
    return categories.filter((cat) =>
      cat.name.toLocaleLowerCase('tr-TR').includes(q)
    );
  }, [categories, searchCategory]);

  const filteredRecords = useMemo(() => {
    if (selectedRegion === 'Tüm Ülke') return records;
    const allowed = REGIONS[selectedRegion] || [];
    return records.filter((r) => allowed.includes(normalizeProvinceName(r.province)));
  }, [records, selectedRegion]);

  const visibleProvinceIds = useMemo(
    () => filteredRecords.map((r) => normalizeProvinceName(r.province)),
    [filteredRecords]
  );

  const handleSelectAllProvinces = useCallback(() => {
    setSelectedProvinces(visibleProvinceIds);
  }, [visibleProvinceIds]);

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

  const handleMetricClick = (metric: SortColumn) => {
    setLedgerSortColumn(metric);
    setLedgerSortDirection('desc');
    const el = document.getElementById('il-kutugu');
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el?.scrollIntoView({ behavior: prefersReducedMotion ? 'auto' : 'smooth', block: 'start' });
  };

  const activeError = bootstrapError || yearsError || configError || dataError;
  const rawErrorMessage = activeError instanceof Error ? activeError.message : null;
  const error = rawErrorMessage && rawErrorMessage !== dismissedError ? rawErrorMessage : null;

  const isAppInitializing =
    (bootstrapLoading && !bootstrapData) || yearsLoading || geoJsonLoading || (configLoading && !configRes);

  return (
    <div className="min-h-dvh bg-[#F7F5F0] text-[#1E242B] flex flex-col">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[60] focus:px-3.5 focus:py-2 focus:bg-white focus:text-[#1E242B] focus:border-2 focus:border-[#9E2A2B] focus:rounded-[4px] focus:text-xs focus:font-bold focus:shadow-lg"
      >
        Ana içeriğe geç
      </a>
      {/* Üst Kurumsal Başlık */}
      <header className="bg-white border-b-2 border-[#1E242B]">
        <div className="max-w-[1440px] w-full mx-auto px-4 sm:px-7 py-3.5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3.5 min-w-0">
            <svg
              aria-hidden="true"
              viewBox="0 0 36 36"
              className="w-9 h-9 shrink-0"
              fill="none"
            >
              <rect x="0.5" y="0.5" width="35" height="35" rx="3" fill="#FAF7F0" stroke="#1E242B" />
              <rect x="7" y="19" width="5" height="10" fill="#9E2A2B" />
              <rect x="15.5" y="13" width="5" height="16" fill="#C9A25E" />
              <rect x="24" y="8" width="5" height="21" fill="#1B6B63" />
            </svg>
            <div className="min-w-0">
              <h1 className="text-lg sm:text-xl font-bold text-[#1E242B] tracking-tight leading-snug">
                Tahsilat &amp; Tahakkuk Harita Analizi
              </h1>
              <p className="text-xs text-[#525A63] mt-0.5 leading-snug">
                T.C. Hazine ve Maliye Bakanlığı Muhasebat Genel Müdürlüğü Verileri
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 ml-auto">
            <button
              type="button"
              onClick={() => setDownloadModalOpen(true)}
              className="inline-flex items-center gap-2 px-3.5 py-2 bg-[#9E2A2B] hover:bg-[#822021] text-white text-xs font-semibold rounded-[4px] transition-colors duration-150 cursor-pointer shrink-0"
            >
              <Download className="w-4 h-4" />
              <span>Resmi Verileri İndir (Excel)</span>
            </button>
          </div>
        </div>
      </header>

      {/* Yatay Filtre Çubuğu */}
      <search
        aria-label="Veri Filtreleri"
        className="bg-white border-b border-[#D9D4C9] sticky top-0 z-30"
      >
        <div className="max-w-[1440px] w-full mx-auto px-4 sm:px-7 py-2.5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-2.5 items-center">
          {/* Yıl */}
          <div className="lg:col-span-2 flex items-center gap-2">
            <label htmlFor="year-select" className="w-11 sm:w-auto text-xs font-semibold text-[#525A63] shrink-0">
              Yıl
            </label>
            {isAppInitializing ? (
              <div className="h-9 flex-1 bg-[#EFECE4] rounded-[4px] motion-safe:animate-pulse" />
            ) : (
              <select
                id="year-select"
                name="year"
                value={selectedYear || ''}
                onChange={(e) => handleYearChange(Number(e.target.value))}
                className="archival-select w-full bg-[#FAF9F6] border border-[#857E72] hover:border-[#1E242B] rounded-[4px] px-3 py-1.5 text-base sm:text-sm font-semibold text-[#1E242B] focus:border-[#9E2A2B] transition-colors duration-150 cursor-pointer tabular-nums"
              >
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Ay */}
          <div className="lg:col-span-2 flex items-center gap-2">
            <label htmlFor="month-select" className="w-11 sm:w-auto text-xs font-semibold text-[#525A63] shrink-0">
              Ay
            </label>
            {isAppInitializing ? (
              <div className="h-9 flex-1 bg-[#EFECE4] rounded-[4px] motion-safe:animate-pulse" />
            ) : (
              <select
                id="month-select"
                name="month"
                value={activeMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="archival-select w-full bg-[#FAF9F6] border border-[#857E72] hover:border-[#1E242B] rounded-[4px] px-3 py-1.5 text-base sm:text-sm font-semibold text-[#1E242B] focus:border-[#9E2A2B] transition-colors duration-150 cursor-pointer"
              >
                {months.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Bölge */}
          <div className="lg:col-span-3 flex items-center gap-2">
            <label htmlFor="region-select" className="w-11 sm:w-auto text-xs font-semibold text-[#525A63] shrink-0">
              Bölge
            </label>
            <select
              id="region-select"
              name="region"
              value={selectedRegion}
              onChange={(e) => handleRegionChange(e.target.value)}
              className="archival-select w-full bg-[#FAF9F6] border border-[#857E72] hover:border-[#1E242B] rounded-[4px] px-3 py-1.5 text-base sm:text-sm font-semibold text-[#1E242B] focus:border-[#9E2A2B] transition-colors duration-150 cursor-pointer"
            >
              <option value="Tüm Ülke">Tüm Ülke (81 İl)</option>
              {Object.keys(REGIONS).map((reg) => (
                <option key={reg} value={reg}>
                  {reg} Bölgesi
                </option>
              ))}
            </select>
          </div>

          {/* Aranabilir Gelir Kalemi Seçici */}
          <div className="lg:col-span-5 flex items-center gap-2">
            <label id="category-label" htmlFor="category-trigger" className="w-11 sm:w-auto text-xs font-semibold text-[#525A63] shrink-0">
              Kalem
            </label>
            <div className="relative flex-1 min-w-0" ref={categoryMenuRef}>
              {isAppInitializing ? (
                <div className="h-9 w-full bg-[#EFECE4] rounded-[4px] motion-safe:animate-pulse" />
              ) : (
                <button
                  ref={categoryTriggerRef}
                  id="category-trigger"
                  type="button"
                  popoverTarget={supportsAnchoredPopover ? 'category-popover' : undefined}
                  aria-haspopup="listbox"
                  aria-expanded={categoryMenuOpen}
                  aria-controls="category-listbox"
                  aria-labelledby="category-label category-value"
                  onClick={supportsAnchoredPopover ? undefined : () => setCategoryMenuOpen((prev) => !prev)}
                  className={`w-full min-w-0 bg-[#FAF9F6] border border-[#857E72] hover:border-[#1E242B] rounded-[4px] px-3 py-1.5 text-base sm:text-sm font-semibold text-[#1E242B] flex items-center justify-between gap-2 transition-colors duration-150 cursor-pointer ${
                    supportsAnchoredPopover ? 'category-trigger-anchor' : ''
                  }`}
                >
                  <span id="category-value" className="truncate">{activeCategoryName}</span>
                  <span className="inline-flex items-center gap-1.5 shrink-0">
                    {categories.length > 0 && (
                      <span className="text-[0.6875rem] font-semibold text-[#525A63] tabular-nums">
                        ({categories.length})
                      </span>
                    )}
                    <ChevronDown
                      className={`w-4 h-4 text-[#525A63] motion-safe:transition-transform motion-safe:duration-150 ${categoryMenuOpen ? 'rotate-180' : ''
                        }`}
                    />
                  </span>
                </button>
              )}

              {(() => {
                const showAnchored = !isAppInitializing && supportsAnchoredPopover;
                const showFallback = !isAppInitializing && !supportsAnchoredPopover && categoryMenuOpen;
                if (!showAnchored && !showFallback) return null;

                const handleCategoryKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
                  const optionCount = filteredCategories.length;
                  if (optionCount === 0) return;
                  const activeEl = document.activeElement;
                  const currentIdx = categoryOptionRefs.current.findIndex((el) => el === activeEl);

                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    if (activeEl === categorySearchRef.current || currentIdx === -1) {
                      categoryOptionRefs.current[0]?.focus();
                    } else {
                      const nextIdx = Math.min(optionCount - 1, currentIdx + 1);
                      categoryOptionRefs.current[nextIdx]?.focus();
                    }
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    if (currentIdx === 0) {
                      categorySearchRef.current?.focus();
                    } else if (currentIdx > 0) {
                      categoryOptionRefs.current[currentIdx - 1]?.focus();
                    }
                  } else if (e.key === 'Home' && currentIdx >= 0) {
                    e.preventDefault();
                    categoryOptionRefs.current[0]?.focus();
                  } else if (e.key === 'End' && currentIdx >= 0) {
                    e.preventDefault();
                    categoryOptionRefs.current[optionCount - 1]?.focus();
                  }
                };

                const panelContent = (
                  <>
                    <div className="relative">
                      <label htmlFor="category-search" className="sr-only">
                        Vergi türü veya gelir kalemi ara
                      </label>
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[#525A63]" />
                      <input
                        ref={categorySearchRef}
                        id="category-search"
                        name="categorySearch"
                        type="search"
                        autoCorrect="off"
                        autoCapitalize="none"
                        spellCheck={false}
                        placeholder="Vergi türü veya gelir kalemi ara…"
                        value={searchCategory}
                        onChange={(e) => setSearchCategory(e.target.value)}
                        className="w-full bg-[#FAF9F6] border border-[#857E72] rounded-[3px] pl-8 pr-2.5 py-1.5 text-base sm:text-xs text-[#1E242B] placeholder-[#525A63] focus:border-[#9E2A2B]"
                      />
                    </div>
                    <div id="category-listbox" role="listbox" aria-label="Gelir kalemleri" className="max-h-64 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] divide-y divide-[#F0ECE2]">
                      {filteredCategories.length === 0 ? (
                        <div className="py-4 text-center text-xs text-[#525A63]">
                          Aramaya uygun kalem bulunamadı.
                        </div>
                      ) : (
                        filteredCategories.map((cat, idx) => {
                          const active = activeCategory === cat.id;
                          return (
                            <button
                              key={cat.id}
                              ref={(el) => {
                                categoryOptionRefs.current[idx] = el;
                              }}
                              type="button"
                              role="option"
                              aria-selected={active}
                              onClick={() => {
                                setSelectedCategory(cat.id);
                                closeCategoryMenu(true);
                              }}
                              className={`w-full text-left px-2.5 py-2 text-xs flex items-center justify-between gap-2 transition-colors duration-150 cursor-pointer ${active
                                ? 'bg-[#F9EDED] text-[#9E2A2B] font-bold'
                                : 'text-[#1E242B] hover:bg-[#FCFBF8]'
                                }`}
                            >
                              <span className="truncate">{cat.name}</span>
                              {active && <Check className="w-3.5 h-3.5 shrink-0 text-[#9E2A2B]" />}
                            </button>
                          );
                        })
                      )}
                    </div>
                  </>
                );

                if (showAnchored) {
                  return (
                    <div
                      id="category-popover"
                      ref={categoryPopoverRef}
                      popover="auto"
                      onToggle={(e) => {
                        const isOpen = (e.nativeEvent as ToggleEvent).newState === 'open';
                        setCategoryMenuOpen(isOpen);
                        if (isOpen) {
                          requestAnimationFrame(() => categorySearchRef.current?.focus());
                        }
                      }}
                      onKeyDown={handleCategoryKeyDown}
                      className="category-popover bg-white border border-[#1E242B] rounded-[4px] shadow-lg p-2 flex flex-col gap-2"
                    >
                      {panelContent}
                    </div>
                  );
                }

                return (
                  <div
                    onKeyDown={handleCategoryKeyDown}
                    className="absolute left-0 right-0 top-full mt-0.5 bg-white border border-[#1E242B] rounded-[4px] shadow-lg z-50 p-2 flex flex-col gap-2"
                  >
                    {panelContent}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </search>

      {/* Ana Çalışma Alanı */}
      <main id="main-content" className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-7 py-5 flex flex-col gap-5">
        {error && (
          <div
            role="alert"
            className="p-3.5 bg-[#F9EDED] border border-[#E6C5C5] text-[#9E2A2B] rounded-[4px] flex items-center justify-between gap-4 text-sm"
          >
            <div className="flex items-center gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
            <button
              type="button"
              onClick={() => setDismissedError(rawErrorMessage)}
              className="text-xs font-bold underline hover:text-[#822021] cursor-pointer shrink-0"
            >
              Kapat
            </button>
          </div>
        )}

        {/* 1. Birleşik Cetvelli Özet Şeridi */}
        <StatsCards
          stats={calculatedSummary}
          loading={isDataLoading}
          activeSortColumn={ledgerSortColumn}
          onMetricClick={handleMetricClick}
        />

        {/* 2. Asimetrik 8:4 Harita ve İl İnceleme/Kıyaslama Izgarası */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start lg:items-stretch">
          <div className="lg:col-span-8">
            <TurkeyMap
              geoJsonData={geoJsonData ?? null}
              records={filteredRecords}
              mapType={mapType}
              selectedRegion={selectedRegion}
              selectedProvinces={selectedProvinces}
              loading={isDataLoading}
              onMapTypeChange={setMapType}
              onSelectProvince={handleSelectProvince}
              onClearProvinces={handleClearProvinces}
            />
          </div>

          <div className="lg:col-span-4 lg:relative">
            <div className="lg:absolute lg:inset-x-0 lg:top-0 lg:max-h-full flex flex-col">
              <ProvinceInspector
                selectedProvinces={selectedProvinces}
                allRecords={records}
                nationalRatio={summary?.overall_ratio ?? null}
                totalSelectableCount={visibleProvinceIds.length}
                loading={isDataLoading}
                onRemoveProvince={handleRemoveProvince}
                onSelectAllProvinces={handleSelectAllProvinces}
                onClearProvinces={handleClearProvinces}
              />
            </div>
          </div>
        </div>

        {/* 3. İl Bazlı Tam Dağılım Kütüğü */}
        <ProvinceLedger
          records={filteredRecords}
          loading={isDataLoading}
          selectedYear={selectedYear}
          selectedMonth={activeMonth}
          categories={categories}
          selectedCategory={activeCategory}
          selectedRegion={selectedRegion}
          selectedProvinces={selectedProvinces}
          sortColumn={ledgerSortColumn}
          sortDirection={ledgerSortDirection}
          onSortChange={(col, dir) => {
            setLedgerSortColumn(col);
            setLedgerSortDirection(dir);
          }}
          onSelectProvince={handleSelectProvince}
        />
      </main>

      {/* Kaynak ve Telif Alt Bilgisi */}
      <footer className="border-t border-[#D9D4C9] bg-[#EFECE4]/60 py-5 px-4 sm:px-7 mt-4">
        <div className="max-w-[1440px] mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-[#525A63]">
          <span>
            Kaynak:{' '}
            <a
              href="https://muhasebat.hmb.gov.tr/genel-butce-gelirlerinin-iller-itibariyle-tahakkuk-ve-tahsilati-2004-2026"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-[#C8C1B4] underline-offset-2 hover:text-[#1E242B]"
            >
              T.C. Hazine ve Maliye Bakanlığı Muhasebat Genel Müdürlüğü
            </a>
          </span>
          <span>Tahsilat &amp; Tahakkuk Harita Analizi © 2026</span>
        </div>
      </footer>

      {downloadModalOpen && (
        <Suspense fallback={null}>
          <DownloadModal
            years={years}
            initialYear={selectedYear}
            onClose={() => setDownloadModalOpen(false)}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
