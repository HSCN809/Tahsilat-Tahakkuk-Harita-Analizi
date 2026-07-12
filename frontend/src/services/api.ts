import { z } from 'zod';
import type { YearsResponse, ConfigResponse, DataResponse, TurkeyGeoJSON } from '../types';

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

// --- Kullaniciya gosterilecek hata mesajlari ---
const USER_FRIENDLY_ERRORS: Record<number, string> = {
  400: 'Gecersiz istek. Lutfen filtre secimlerinizi kontrol edin.',
  404: 'Istediginiz veri sunucuda bulunamadi. Henuz yuklenmemis olabilir, lutfen once veri cekme islemini baslatin.',
  429: 'Cok fazla istek gonderildi. Lutfen biraz bekleyip tekrar deneyin.',
  500: 'Sunucuda gecici bir sorun olustu. Lutfen daha sonra tekrar deneyin.',
  503: 'Sunucu su anda bakimda veya asiri yuklu. Lutfen biraz bekleyin.',
};

function getUserMessage(status: number): string {
  return USER_FRIENDLY_ERRORS[status] ?? 'Beklenmeyen bir sorun olustu. Lutfen daha sonra tekrar deneyin.';
}

// --- API fonksiyonlari ---

/**
 * Yardimci: fetch + JSON parse + hata yonetimi.
 * Teknik detaylari console.error ile log'a yazar (sadece gelistirici gorur).
 * Kullaniciya anlasilir hata mesaji firlatir.
 */
async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (err) {
    // Ag hatasi (internet kesintisi, DNS, CORS vs.)
    console.error(`[api] Ag hatasi: ${url}`, err);
    throw new Error('Sunucuya baglanilamadi. Internet baglantinizi kontrol edin.');
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
