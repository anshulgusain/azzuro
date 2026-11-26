/**
 * Loads data/sample/reviews.json into the local database so the dashboard
 * works straight after `npm install`, without running the collector.
 * Safe to run repeatedly: reviews are upserted by their Booking.com id.
 */
import { openDb } from '../src/db/database.js';
import { SAMPLE_JSON, seedFromSample } from '../src/db/sample.js';

const db = openDb();
try {
  const c = seedFromSample(db);
  console.log(`Seeded from ${SAMPLE_JSON}: ${c.new} new, ${c.updated} updated, ${c.unchanged} unchanged, ${c.rejected} rejected.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  db.close();
}
