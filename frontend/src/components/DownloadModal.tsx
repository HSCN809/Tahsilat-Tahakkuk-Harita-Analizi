import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Search, Download, FileSpreadsheet, Loader2, AlertTriangle } from 'lucide-react';
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
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      previouslyFocused?.focus();
    };
  }, [onClose]);

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
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [selectedYear]);

  const filteredFiles = useMemo(() => {
    const q = searchQuery.toLocaleLowerCase('tr-TR');
    return files.filter((f) => prettifyFileId(f.id).toLocaleLowerCase('tr-TR').includes(q));
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

  const allVisibleSelected =
    filteredFiles.length > 0 && filteredFiles.every((f) => selectedIds.has(f.id));

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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="download-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#1E242B]/45"
    >
      <div className="relative w-full max-w-lg bg-white border border-[#1E242B] rounded-[4px] p-6 shadow-xl flex flex-col gap-4 max-h-[90vh]">
        {/* Başlık */}
        <div className="flex items-start justify-between border-b border-[#1E242B] pb-3.5 gap-4">
          <div>
            <h3 id="download-modal-title" className="text-lg font-bold text-[#1E242B]">
              Ham Veri İndir (.xls)
            </h3>
            <p className="text-xs text-[#525A63] mt-0.5">
              Hazine ve Maliye Bakanlığı kaynaklı orijinal Excel çalışma kitapları (aylar sayfa olarak yer alır)
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Pencereyi Kapat"
            className="p-1.5 hover:bg-[#EFECE4] rounded-[2px] text-[#525A63] hover:text-[#1E242B] transition-colors duration-150 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Veri Yılı */}
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor="download-year-select"
            className="text-[11px] font-bold text-[#525A63] uppercase tracking-[0.05em]"
          >
            Veri Yılı
          </label>
          <select
            id="download-year-select"
            aria-label="Veri Yılı Seçin"
            value={selectedYear ?? ''}
            onChange={(e) => setSelectedYear(Number(e.target.value))}
            className="w-full bg-[#FAF9F6] border border-[#C8C1B4] rounded-[4px] px-3 py-2 text-sm text-[#1E242B] focus:border-[#9E2A2B] transition-colors duration-150 cursor-pointer"
          >
            {years.map((y) => (
              <option key={y} value={y}>
                {y} Yılı
              </option>
            ))}
          </select>
        </div>

        {/* Arama ve Tümünü Seç */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#525A63]" />
            <input
              type="text"
              aria-label="Dosyaları il adına göre filtrele"
              placeholder="İl adına göre filtrele…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#FAF9F6] border border-[#C8C1B4] rounded-[4px] pl-9 pr-3 py-2 text-sm text-[#1E242B] placeholder-[#525A63] focus:border-[#9E2A2B] transition-colors duration-150"
            />
          </div>
          <button
            type="button"
            onClick={toggleAll}
            disabled={filteredFiles.length === 0}
            className="px-3 py-2 text-xs font-semibold rounded-[4px] border border-[#C8C1B4] bg-[#FAF9F6] text-[#1E242B] hover:bg-[#EFECE4] transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            {allVisibleSelected ? 'Seçimi Bırak' : 'Tümünü Seç'}
          </button>
        </div>

        {/* Hata */}
        {error && (
          <div className="p-3 bg-[#F9EDED] border border-[#E6C5C5] text-[#9E2A2B] rounded-[4px] text-xs flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Dosya Listesi */}
        <div className="overflow-y-auto border border-[#D9D4C9] rounded-[2px] bg-[#FCFBF8] p-1 flex flex-col gap-0.5 min-h-[200px] max-h-[300px]">
          {loading ? (
            <div className="space-y-2 p-2">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-8 bg-[#EFECE4] rounded-[2px] animate-pulse" />
              ))}
            </div>
          ) : filteredFiles.length === 0 ? (
            <div className="text-center py-8 text-xs text-[#525A63]">
              {files.length === 0 ? 'Bu yıl için ham dosya bulunamadı.' : 'Aramaya uygun dosya bulunamadı.'}
            </div>
          ) : (
            filteredFiles.map((file) => {
              const checked = selectedIds.has(file.id);
              return (
                <label
                  key={file.id}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-[2px] text-xs font-semibold transition-colors duration-150 cursor-pointer ${
                    checked
                      ? 'bg-[#F9EDED] text-[#1E242B]'
                      : 'text-[#525A63] hover:bg-[#EFECE4] hover:text-[#1E242B]'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleFile(file.id)}
                    className="w-3.5 h-3.5 accent-[#9E2A2B] cursor-pointer flex-shrink-0"
                  />
                  <FileSpreadsheet
                    className={`w-4 h-4 flex-shrink-0 ${checked ? 'text-[#9E2A2B]' : 'text-[#525A63]'}`}
                  />
                  <span className="truncate flex-1">{prettifyFileId(file.id)}</span>
                  <span className="text-[11px] text-[#525A63] tabular-nums flex-shrink-0">
                    {formatFileSize(file.size)}
                  </span>
                </label>
              );
            })
          )}
        </div>

        {/* Alt Bilgi & İndir */}
        <div className="flex justify-between items-center border-t border-[#D9D4C9] pt-3 gap-3">
          <span className="text-xs text-[#525A63] tabular-nums">
            {selectedIds.size} dosya seçildi · {formatFileSize(selectedSize)}
          </span>
          <button
            type="button"
            onClick={handleDownload}
            disabled={downloading || selectedIds.size === 0 || loading}
            className="flex items-center gap-2 px-4 py-2 bg-[#9E2A2B] hover:bg-[#822021] text-white text-xs font-semibold rounded-[4px] transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {downloading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            {downloading ? 'İndiriliyor…' : 'Zip Olarak İndir'}
          </button>
        </div>
      </div>
    </div>
  );
};
