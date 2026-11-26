import type { CategoryScore } from '../src/shared/types.js';

/** File format of data/sample/reviews.json (shared by export-sample and seed). */
export interface SampleFile {
  format: 'azzurro-reviews/v1';
  exportedAt: string;
  note: string;
  snapshots: Array<{
    propertyId: string;
    capturedAt: string;
    overallScore: number | null;
    reviewCount: number | null;
    categories: CategoryScore[];
  }>;
  reviews: Array<Record<string, unknown>>;
}

export const SAMPLE_JSON = 'data/sample/reviews.json';
export const SAMPLE_CSV = 'data/sample/reviews.csv';
