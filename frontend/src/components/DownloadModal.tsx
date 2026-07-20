import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import type { RawFileInfo } from '../types';
import { fetchFiles, downloadFiles } from '../services/api';
import { formatFileSize } from '../utils/format';

interface DownloadModalProps {
  years: number[];
  initialYear: number | null;
  onClose: () => void;
}

/** "01-Adana-2023" -> "Adana", "00-Merkez-2023" -> "Merkez" */
const prettifyFileId = (id: string): string =>
  id.replace(/-\d{4}$/, '').replace(/^\d+-/, '');

export const DownloadModal: React.FC<DownloadModalProps> = ({
  years,
  initialYear,
  onClose,
}) => {
  const [selectedYear, setSelectedYear] = useState<number | null>(
    initialYear ?? (years.length > 0 ? years[years.length - 1] : null)
  );
  const [files, setFiles] = useState<RawFileInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Yıl değiştiğinde o yılın ham dosyalarını çek ve tümünü seçili hale getir
  useEffect(() => {
    if (selectedYear === null) return;

    const controller = new AbortController();
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        setFiles([]);
        setSelectedIds(new Set());
        const data = await fetchFiles(selectedYear, controller.signal);
        if (cancelled) return;
        setFiles(data.files);
        setSelectedIds(new Set(data.files.map((f) => f.id)));
      } catch (err) {
        if (cancelled || (err instanceof DOMException && err.name === 'AbortError')) return;
        console.error('[DownloadModal] Dosyalar alınırken hata:', err);
        setError(err instanceof Error ? err.message : 'Dosyalar alınırken bir sorun oluştu.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; controller.abort(); };
  }, [selectedYear]);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return files.filter((f) => prettifyFileId(f.id).toLowerCase().includes(q));
  }, [files, searchQuery]);

  const selectedSize = useMemo(
    () => files.filter((f) => selectedIds.has(f.id)).reduce((sum, f) => sum + f.size, 0),
    [files, selectedIds]
  );

  const toggleFile = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = filteredFiles.length > 0 && filteredFiles.every((f) => selectedIds.has(f.id));

  const toggleAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filteredFiles.forEach((f) => next.delete(f.id));
      } else {
        filteredFiles.forEach((f) => next.add(f.id));
      }
      return next;
    });
  };

  const handleDownload = async () => {
    if (selectedYear === null || selectedIds.size === 0) return;
    try {
      setDownloading(true);
      setError(null);
      await downloadFiles(selectedYear, Array.from(selectedIds));
    } catch (err) {
      console.error('[DownloadModal] İndirme hatası:', err);
      setError(err instanceof Error ? err.message : 'İndirme sırasında bir sorun oluştu.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm">
      <div className="relative w-full max-w-lg bg-slate-900/90 border border-slate-800 rounded-3xl p-6 shadow-2xl flex flex-col gap-5 max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-4">
          <div>
            <h3 className="text-lg font-bold text-slate-100">Ham Veri İndir</h3>
            <p className="text-xs text-slate-400 mt-1">
              Hazine ve Maliye Bakanlığı'ndan alınan orijinal .xls dosyaları (aylar sheet olarak içerir)
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 hover:bg-slate-800 rounded-xl text-slate-400 hover:text-slate-200 transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Year Select */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Veri Yılı</label>
          <select
            value={selectedYear ?? ''}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="w-full bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2.5 text-sm text-slate-100 focus:outline-none focus:border-blue-500 transition-all duration-300 cursor-pointer"
          >
            {years.map((y) => (
              <option key={y} value={y} className="bg-slate-950 text-slate-100">
                {y} Yılı
              </option>
            ))}
          </select>
        </div>

        {/* Search + Select All */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
            <input
              type="text"
              placeholder="İl adına göre filtrele..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-slate-950/60 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500/50 transition-all"
            />
          </div>
          <button
            onClick={toggleAll}
            disabled={filteredFiles.length === 0}
            className="px-3 py-2 text-xs font-semibold rounded-xl border border-slate-800 text-slate-300 hover:bg-slate-800/50 hover:text-slate-100 transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {allVisibleSelected ? 'Seçimi Bırak' : 'Tümünü Seç'}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs">
            ⚠️ {error}
          </div>
        )}

        {/* File List */}
        <div className="overflow-y-auto border border-slate-800/60 rounded-2xl bg-slate-950/40 p-1 flex flex-col gap-0.5 scrollbar-thin min-h-[200px] max-h-[320px]">
          {loading ? (
            <div className="space-y-2 p-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-8 bg-slate-800/40 rounded-lg animate-pulse"></div>
              ))}
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-500">
              {files.length === 0 ? 'Bu yıl için ham dosya bulunamadı.' : 'Aramaya uygun dosya bulunamadı.'}
            </div>
          ) : (
            filteredFiles.map((file) => {
              const checked = selectedIds.has(file.id);
              return (
                <label
                  key={file.id}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 cursor-pointer ${checked
                    ? 'bg-blue-600/10 text-blue-300 border border-blue-500/20'
                    : 'text-slate-400 hover:bg-slate-800/30 hover:text-slate-200 border border-transparent'
                    }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleFile(file.id)}
                    className="w-3.5 h-3.5 rounded accent-blue-600 cursor-pointer flex-shrink-0"
                  />
                  <FileSpreadsheet className={`w-4 h-4 flex-shrink-0 ${checked ? 'text-blue-400' : 'text-slate-500'}`} />
                  <span className="truncate flex-1">{prettifyFileId(file.id)}</span>
                  <span className="text-[10px] text-slate-500 font-mono flex-shrink-0">{formatFileSize(file.size)}</span>
                </label>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-between items-center border-t border-slate-800 pt-3 gap-3">
          <span className="text-xs text-slate-500">
            {selectedIds.size} dosya seçildi · {formatFileSize(selectedSize)}
          </span>
          <button
            onClick={handleDownload}
            disabled={downloading || selectedIds.size === 0 || loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-xl shadow-md transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
          >
            {downloading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {downloading ? 'İndiriliyor...' : 'Zip Olarak İndir'}
          </button>
        </div>

      </div>
    </div>
  );
};
