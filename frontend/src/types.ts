import type { FeatureCollection, Geometry } from 'geojson';

// --- Domain tipleri ---

export interface Category {
  id: string;
  name: string;
}

export interface Summary {
  total_accrual: number;
  total_collection: number;
  overall_ratio: number;
}

export interface ProvinceRecord {
  province: string;
  accrual: number | null;
  collection: number | null;
  ratio: number | null;
}

export type MapType = 'tahsilat' | 'tahakkuk' | 'ratio';

export type ModalMetric = 'accrual' | 'collection' | 'ratio';

export type SortColumn = 'province' | 'accrual' | 'collection' | 'ratio';
export type SortDirection = 'asc' | 'desc';

// --- API yanıt tipleri ---

export interface YearsResponse {
  years: number[];
}

export interface ConfigResponse {
  year: number;
  months: string[];
  categories: Category[];
}

export interface DataResponse {
  year: number;
  category: string;
  summary: Summary;
  data: ProvinceRecord[];
}

export interface RawFileInfo {
  id: string;
  name: string;
  size: number;
}

export interface FilesResponse {
  year: number;
  files: RawFileInfo[];
}

// GeoJSON Türkiye haritası — geojson tipleri ile
export type TurkeyGeoJSON = FeatureCollection<Geometry, { name: string }>;
