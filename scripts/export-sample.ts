/**
 * Writes the collected data to data/sample/ as JSON (re-loadable with `npm run seed`)
 * and CSV (for opening in a spreadsheet). Guest names are left out: the sample is
 * committed to the repository and names add nothing to the analysis.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb } from '../src/db/database.js';
import { propertyPhotos, queryReviews } from '../src/db/repository.js';
import { getProperty } from '../src/shared/properties.js';
import { SAMPLE_CSV, SAMPLE_JSON, type SampleFile } from '../src/db/sample.js';

const db = openDb();
const { reviews } = queryReviews(db, { sort: 'oldest' });
const snapshots = (
  db.prepare('SELECT property_id, captured_at, overall_score, review_count, categories_json FROM property_snapshots ORDER BY id').all() as Array<{
    property_id: string;
    captured_at: string;
    overall_score: number | null;
    review_count: number | null;
    categories_json: string;
  }>
).map((s) => ({
  propertyId: s.property_id,
  capturedAt: s.captured_at,
  overallScore: s.overall_score,
  reviewCount: s.review_count,
  categories: JSON.parse(s.categories_json),
}));

const out: SampleFile = {
  format: 'azzurro-reviews/v1',
  exportedAt: new Date().toISOString(),
  note: 'Public Booking.com guest reviews collected by `npm run collect`. Guest names removed.',
  snapshots,
  hotelPhotos: Object.fromEntries(propertyPhotos(db)),
  reviews: reviews.map((r) => ({
    id: r.id,
    propertyId: r.propertyId,
    source: r.source,
    score: r.score,
    title: r.title,
    positiveText: r.positiveText,
    negativeText: r.negativeText,
    language: r.language,
    reviewedAt: r.reviewedAt,
    stayMonth: r.stayMonth,
    nights: r.nights,
    roomType: r.roomType,
    travellerType: r.travellerType,
    tripPurpose: r.tripPurpose,
    guestName: null,
    guestCountry: r.guestCountry,
    hotelReply: r.hotelReply,
    // Derived fields, included so the sample can be read without running the app:
    reviewedDate: r.reviewedDate,
    sentiment: r.sentiment,
    topics: r.topics,
  })),
};

mkdirSync(dirname(SAMPLE_JSON), { recursive: true });
writeFileSync(SAMPLE_JSON, `${JSON.stringify(out, null, 2)}\n`);

const cols = ['property', 'reviewed_date', 'score', 'sentiment', 'title', 'liked', 'disliked', 'traveller_type', 'room_type', 'guest_country', 'language', 'complaint_topics', 'praise_topics', 'source', 'review_id'];
const esc = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const rows = reviews.map((r) =>
  [
    getProperty(r.propertyId)?.name ?? r.propertyId,
    r.reviewedDate,
    r.score,
    r.sentiment,
    r.title,
    r.positiveText,
    r.negativeText,
    r.travellerType,
    r.roomType,
    r.guestCountry,
    r.language,
    r.topics.filter((t) => t.polarity === 'complaint').map((t) => t.topic).join('; '),
    r.topics.filter((t) => t.polarity === 'praise').map((t) => t.topic).join('; '),
    r.source,
    r.id,
  ]
    .map(esc)
    .join(','),
);
writeFileSync(SAMPLE_CSV, `${cols.join(',')}\n${rows.join('\n')}\n`);
console.log(`Exported ${reviews.length} reviews and ${snapshots.length} snapshots to ${SAMPLE_JSON} and ${SAMPLE_CSV}`);
db.close();
