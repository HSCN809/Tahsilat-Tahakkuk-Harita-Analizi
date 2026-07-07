import React, { useState } from 'react';
import { RefreshCw, Play, CheckCircle, AlertTriangle } from 'lucide-react';

export const ScraperControl: React.FC = () => {
  const [yearInput, setYearInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error' | null; message: string }>({
    type: null,
    message: '',
  });

  const handleScrape = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!yearInput.trim()) return;

    setLoading(true);
    setStatus({ type: null, message: '' });

    try {
      const response = await fetch(`/api/scrape?year_input=${encodeURIComponent(yearInput)}`, {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('API isteği başarısız oldu.');
      }

      const data = await response.json();
      setStatus({
        type: 'success',
        message: data.message || 'Veri çekme işlemi arka planda başlatıldı.',
      });
      setYearInput('');
    } catch (err: any) {
      setStatus({
        type: 'error',
        message: err.message || 'Bir hata oluştu.',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900/40 backdrop-blur-md border border-slate-800/80 rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-slate-100 flex items-center gap-2 mb-2">
        <RefreshCw className="w-5 h-5 text-blue-400" />
        Hazine ve Maliye Bakanlığı Veri Güncelleyici
      </h3>
      <p className="text-sm text-slate-400 mb-4">
        Yeni yılları veya eksik il Excel dosyalarını indirmek için arka plan veri çekme (Scraper) tetikleyebilirsiniz. (Örnek girdi: <code className="bg-slate-950 px-1.5 py-0.5 rounded text-blue-400">2025</code> veya <code className="bg-slate-950 px-1.5 py-0.5 rounded text-blue-400">2024-2025</code>)
      </p>

      <form onSubmit={handleScrape} className="flex gap-3">
        <input
          type="text"
          value={yearInput}
          onChange={(e) => setYearInput(e.target.value)}
          placeholder="Yıl veya Yıl Aralığı Girin..."
          disabled={loading}
          className="flex-1 bg-slate-950/60 border border-slate-800 rounded-xl px-4 py-2 text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-all duration-300 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={loading || !yearInput.trim()}
          className="bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-white font-medium text-sm px-5 py-2 rounded-xl flex items-center gap-2 transition-all duration-300 shadow-[0_4px_12px_rgba(59,130,246,0.2)] disabled:shadow-none cursor-pointer disabled:cursor-not-allowed"
        >
          {loading ? (
            <RefreshCw className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          Tetikle
        </button>
      </form>

      {status.type && (
        <div
          className={`mt-4 p-3 rounded-xl border flex items-start gap-2.5 text-sm ${
            status.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-rose-500/10 border-rose-500/20 text-rose-400'
          }`}
        >
          {status.type === 'success' ? (
            <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="w-5 h-5 flex-shrink-0 mt-0.5" />
          )}
          <span>{status.message}</span>
        </div>
      )}
    </div>
  );
};
