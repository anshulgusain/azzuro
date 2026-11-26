import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { CategoryScore, HotelPhoto } from '../shared/types.js';
import type { Db } from './database.js';
import { addSnapshot, setPropertyPhotos, upsertReview, type UpsertOutcome } from './repository.js';
import { validateReviewInput } from './reviewInput.js';

/** File format of data/sample/reviews.json (written by export-sample, read by seed and by the server on first start). */
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
  /** Links to each hotel's Booking.com gallery photos (optional for older files). */
  hotelPhotos?: Record<string, HotelPhoto[]>;
}

export const SAMPLE_JSON = resolve('data/sample/reviews.json');
export const SAMPLE_CSV = resolve('data/sample/reviews.csv');

export type SeedCounts = Record<UpsertOutcome | 'rejected', number>;

/**
 * Loads the sample file into the database. Safe to repeat: reviews are
 * upserted by their Booking.com id and snapshots are only added to an empty
 * history.
 */
export function seedFromSample(db: Db, path = SAMPLE_JSON): SeedCounts {
  if (!existsSync(path)) throw new Error(`No sample file at ${path}`);
  const sample = JSON.parse(readFileSync(path, 'utf8')) as SampleFile;
  if (sample.format !== 'azzurro-reviews/v1') throw new Error(`Unsupported sample format: ${String(sample.format)}`);

  const existingSnapshots = (db.prepare('SELECT COUNT(*) AS n FROM property_snapshots').get() as { n: number }).n;
  if (existingSnapshots === 0) {
    for (const s of sample.snapshots) addSnapshot(db, { ...s, runId: null });
  }
  for (const [propertyId, photos] of Object.entries(sample.hotelPhotos ?? {})) {
    if (photos.length) setPropertyPhotos(db, propertyId, photos);
  }

  const counts: SeedCounts = { new: 0, updated: 0, unchanged: 0, rejected: 0 };
  const now = new Date().toISOString();
  for (const raw of sample.reviews) {
    const v = validateReviewInput(raw);
    if (!v.ok) {
      counts.rejected++;
      console.warn(`Rejected ${String(raw.id)}: ${v.error}`);
      continue;
    }
    counts[upsertReview(db, v.value, now)]++;
  }
  return counts;
}
