import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { isCollectionRunning } from '../collector/run.js';
import { openDb } from '../db/database.js';
import { healthReport, queryReviews } from '../db/repository.js';
import { isValidIsoDate, resolvePeriod, todayLocal, type PeriodPreset } from '../shared/dates.js';
import { PROPERTIES, bookingUrl, getProperty } from '../shared/properties.js';
import { CLASSIFIER_VERSION, TOPICS, TOPIC_IDS, type Sentiment, type TopicId } from '../shared/topics.js';
import type { MetaResponse, ReviewsResponse, TopicPolarity } from '../shared/types.js';
import { buildSummary, buildTrends, dataBounds } from './service.js';

const db = openDb();
const app = new Hono();

const PRESETS: PeriodPreset[] = ['this_week', 'last_week', 'last_4_weeks', 'last_3_months', 'last_12_months', 'custom'];

function badRequest(message: string): never {
  throw new HTTPException(400, { message });
}

/** Reads ?period=&from=&to= into a resolved period, validating every value. */
function periodFromQuery(q: (k: string) => string | undefined) {
  const today = todayLocal();
  const preset = (q('period') ?? 'this_week') as PeriodPreset;
  if (!PRESETS.includes(preset)) badRequest(`Unknown period "${preset}"`);
  if (preset !== 'custom') return { today, period: resolvePeriod(preset, today) };
  const from = q('from');
  const to = q('to');
  if (!from || !to || !isValidIsoDate(from) || !isValidIsoDate(to)) badRequest('Custom period needs from and to as YYYY-MM-DD');
  if (from > to) badRequest('"from" must be on or before "to"');
  return { today, period: resolvePeriod('custom', today, { from, to }) };
}

function propertyFromQuery(q: (k: string) => string | undefined): string | null {
  const id = q('property');
  if (!id || id === 'all') return null;
  if (!getProperty(id)) badRequest(`Unknown property "${id}"`);
  return id;
}

app.get('/api/meta', (c) => {
  const range = dataBounds(db);
  const body: MetaResponse = {
    properties: PROPERTIES.map((p) => ({ id: p.id, name: p.name, bookingUrl: bookingUrl(p).replace('.en-gb.html', '.html') })),
    topics: TOPICS.map((t) => ({ id: t.id, label: t.label, description: t.description, terms: [...t.terms] })),
    today: todayLocal(),
    dataRange: { from: range.from, to: range.to },
    totalReviews: range.total,
    classifierVersion: CLASSIFIER_VERSION,
  };
  return c.json(body);
});

app.get('/api/summary', (c) => {
  const q = (k: string) => c.req.query(k);
  const { today, period } = periodFromQuery(q);
  return c.json(buildSummary(db, period, propertyFromQuery(q), today));
});

app.get('/api/trends', (c) => {
  const q = (k: string) => c.req.query(k);
  const { period } = periodFromQuery(q);
  return c.json(buildTrends(db, period, propertyFromQuery(q)));
});

app.get('/api/reviews', (c) => {
  const q = (k: string) => c.req.query(k);
  const { period } = periodFromQuery(q);
  const sentiment = q('sentiment') as Sentiment | undefined;
  if (sentiment && !['positive', 'neutral', 'negative'].includes(sentiment)) badRequest('Unknown sentiment');
  const topic = q('topic') as TopicId | undefined;
  if (topic && !TOPIC_IDS.includes(topic)) badRequest('Unknown topic');
  const polarity = q('polarity') as TopicPolarity | undefined;
  if (polarity && !['praise', 'complaint'].includes(polarity)) badRequest('Unknown polarity');
  const sort = (q('sort') ?? 'newest') as 'newest' | 'oldest' | 'lowest' | 'highest';
  if (!['newest', 'oldest', 'lowest', 'highest'].includes(sort)) badRequest('Unknown sort');
  const page = Math.max(1, Number(q('page')) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(q('pageSize')) || 20));
  const allDates = q('allDates') === '1';

  const { total, reviews } = queryReviews(db, {
    propertyId: propertyFromQuery(q),
    from: allDates ? null : period.current.from,
    to: allDates ? null : period.current.to,
    sentiment: sentiment ?? null,
    topic: topic ?? null,
    polarity: polarity ?? null,
    q: q('q')?.slice(0, 200) ?? null,
    sort,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  const body: ReviewsResponse = { total, page, pageSize, reviews };
  return c.json(body);
});

app.get('/api/health', (c) => c.json(healthReport(db, isCollectionRunning())));

/** Starts a collection in the background so staff can refresh data from the dashboard. */
app.post('/api/collect', (c) => {
  if (isCollectionRunning()) return c.json({ started: false, message: 'A collection is already running.' }, 409);
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/collector/cli.ts'), '--trigger', 'dashboard'], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  return c.json({ started: true, message: 'Collection started. It usually takes 1–2 minutes.' }, 202);
});

app.onError((err, c) => {
  if (err instanceof HTTPException) return c.json({ error: err.message }, err.status);
  console.error(err);
  return c.json({ error: 'Something went wrong on the server.' }, 500);
});

// Production: serve the built dashboard and fall back to index.html for client routes.
const webDist = resolve('dist/web');
if (existsSync(join(webDist, 'index.html'))) {
  app.use('/*', serveStatic({ root: './dist/web' }));
  const indexHtml = readFileSync(join(webDist, 'index.html'), 'utf8');
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(indexHtml)));
}

const port = Number(process.env.PORT ?? 8787);
const server = serve({ fetch: app.fetch, port }, () => {
  const ui = existsSync(join(webDist, 'index.html'));
  console.log(ui ? `Dashboard: http://localhost:${port}` : `API on http://localhost:${port} (run the Vite dev server for the dashboard)`);
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Start on another port, e.g. PORT=8788 npm start`);
    process.exit(1);
  }
  throw err;
});
