/**
 * Loads data/sample/reviews.json into the local database so the dashboard
 * works straight after `npm install`, without running the collector.
 * Safe to run repeatedly: reviews are upserted by their Booking.com id.
 */
import { existsSync, readFileSync } from 'node:fs';
import { openDb } from '../src/db/database.js';
import { addSnapshot, upsertReview } from '../src/db/repository.js';
import { validateReviewInput } from '../src/db/reviewInput.js';
import { SAMPLE_JSON, type SampleFile } from './sample-format.js';

if (!existsSync(SAMPLE_JSON)) {
  console.error(`No sample file at ${SAMPLE_JSON}. Run \`npm run collect\` instead.`);
  process.exit(1);
}
const sample = JSON.parse(readFileSync(SAMPLE_JSON, 'utf8')) as SampleFile;
if (sample.format !== 'azzurro-reviews/v1') {
  console.error(`Unsupported sample format: ${String(sample.format)}`);
  process.exit(1);
}

const db = openDb();
const existingSnapshots = (db.prepare('SELECT COUNT(*) AS n FROM property_snapshots').get() as { n: number }).n;
if (existingSnapshots === 0) {
  for (const s of sample.snapshots) addSnapshot(db, { ...s, runId: null });
}

const counts = { new: 0, updated: 0, unchanged: 0, rejected: 0 };
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
console.log(
  `Seeded from ${SAMPLE_JSON}: ${counts.new} new, ${counts.updated} updated, ${counts.unchanged} unchanged, ${counts.rejected} rejected.`,
);
db.close();
