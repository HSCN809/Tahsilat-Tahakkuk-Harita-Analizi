import { z } from 'zod';
import type { YearsResponse, ConfigResponse, DataResponse, TurkeyGeoJSON, FilesResponse } from '../types';

// --- Zod runtime şemaları ---

const YearsResponseSchema = z.object({
  years: z.array(z.number()),
});

const ConfigResponseSchema = z.object({
  year: z.number(),
  months: z.array(z.string()),
  categories: z.array(z.object({
    id: z.string(),
    name: z.string(),
  })),
});

const DataResponseSchema = z.object({
  year: z.number(),
  category: z.string(),
  summary: z.object({
    total_accrual: z.number(),
    total_collection: z.number(),
    overall_ratio: z.number(),
  }),
  data: z.array(z.object({
    province: z.string(),
    accrual: z.number().nullable(),
    collection: z.number().nullable(),
    ratio: z.number().nullable(),
  })),
});

const FilesResponseSchema = z.object({
  year: z.number(),
  files: z.array(z.object({
    id: z.string(),
    name: z.string(),
    size: z.number(),
  })),
});

// --- Kullaniciya gosterilecek hata mesajlari ---
const USER_FRIENDLY_ERRORS: Record<number, string> = {
  400: 'Geçersiz istek. Lütfen filtre seçimlerinizi kontrol edin.',
  404: 'İstediğiniz veri sunucuda bulunamadı. Henüz yüklenmemiş olabilir, lütfen önce veri çekme işlemini başlatın.',
  429: 'Çok fazla istek gönderildi. Lütfen biraz bekleyip tekrar deneyin.',
  500: 'Sunucuda geçici bir sorun oluştu. Lütfen daha sonra tekrar deneyin.',
  503: 'Sunucu şu anda bakımda veya aşırı yüklü. Lütfen biraz bekleyin.',
};

function getUserMessage(status: number): string {
  return USER_FRIENDLY_ERRORS[status] ?? 'Beklenmeyen bir sorun oluştu. Lütfen daha sonra tekrar deneyin.';
}

// --- API fonksiyonlari ---

/**
 * Yardimci: fetch + JSON parse + hata yonetimi.
 * Teknik detayları console.error ile log'a yazar (sadece geliştirici görür).
 * Kullaniciya anlasilir hata mesaji firlatir.
 */
async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (err) {
    // Ag hatasi (internet kesintisi, DNS, CORS vs.)
    console.error(`[api] Ağ hatası: ${url}`, err);
    throw new Error('Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.');
  }

  if (!response.ok) {
    // Backend'den detayli hata mesaji geliyorsa onu log'a yaz
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.detail ?? '';
    } catch {
      // JSON parse edilemezse bos gec
    }
    console.error(`[api] HTTP ${response.status} - ${url}${detail ? ` | detay: ${detail}` : ''}`);
    throw new Error(getUserMessage(response.status));
  }

  return response.json();
}

export async function fetchYears(signal?: AbortSignal): Promise<YearsResponse> {
  const json = await fetchJson('/api/years', signal);
  return YearsResponseSchema.parse(json) as YearsResponse;
}

export async function fetchConfig(year: number, signal?: AbortSignal): Promise<ConfigResponse> {
  const json = await fetchJson(`/api/config?year=${year}`, signal);
  return ConfigResponseSchema.parse(json) as ConfigResponse;
}

export async function fetchData(
  year: number,
  category: string,
  month: string,
  signal?: AbortSignal
): Promise<DataResponse> {
  const url = `/api/data?year=${year}&category=${encodeURIComponent(category)}&month=${encodeURIComponent(month)}`;
  const json = await fetchJson(url, signal);
  return DataResponseSchema.parse(json) as DataResponse;
}

export async function fetchGeoJson(signal?: AbortSignal): Promise<TurkeyGeoJSON> {
  const json = await fetchJson('/api/geojson', signal);
  return json as TurkeyGeoJSON;
}

export async function fetchFiles(year: number, signal?: AbortSignal): Promise<FilesResponse> {
  const json = await fetchJson(`/api/files?year=${year}`, signal);
  return FilesResponseSchema.parse(json) as FilesResponse;
}

/**
 * Seçilen ham .xls dosyalarını zip olarak indirir.
 * Yanıt fetch ile Blob (bellekte ikili veri) olarak alınır; geçici bir nesne
 * URL'si üzerinden tarayıcıya dosya olarak kaydettirilir. fetch kullandığımız
 * için hata durumunda kullanıcıya anlamlı mesaj gösterebiliriz.
 */
export async function downloadFiles(year: number, ids: string[]): Promise<void> {
  const query = ids.map(encodeURIComponent).join(',');
  const url = `/api/files/download?year=${year}&files=${query}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (err) {
    console.error(`[api] Ağ hatası: ${url}`, err);
    throw new Error('Sunucuya bağlanılamadı. İnternet bağlantınızı kontrol edin.');
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.detail ?? '';
    } catch {
      // JSON parse edilemezse boş geç
    }
    console.error(`[api] HTTP ${response.status} - ${url}${detail ? ` | detay: ${detail}` : ''}`);
    throw new Error(getUserMessage(response.status));
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = `tahsilat-tahakkuk-${year}-ham-veri.zip`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
}
