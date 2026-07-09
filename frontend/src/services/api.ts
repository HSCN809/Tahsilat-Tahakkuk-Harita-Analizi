import { z } from 'zod';
import type { YearsResponse, ConfigResponse, DataResponse, TurkeyGeoJSON } from '../types';

// --- Zod runtime şemaları ---
// Backend yanıtı beklenenden farklı gelirse (eksik alan, yanlış tip) doğrulama hatası fırlatır.

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

// --- API fonksiyonları ---

/**
 * Yardımcı: fetch + JSON parse + hata yönetimi.
 * HTTP hatası veya parse hatası fırlatır, çağıran catch'ler.
 */
async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
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
