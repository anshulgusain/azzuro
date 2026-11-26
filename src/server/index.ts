import { spawn } from 'node:child_process';
import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { askAssistant, sanitizeHistory, type ViewContext } from '../assistant/agent.js';
import { assistantConfig, friendlyOpenAiError, openAiCreate } from '../assistant/openai.js';
import { isCollectionRunning } from '../collector/run.js';
import { openDb } from '../db/database.js';
import { dataRange, healthReport, listRuns, propertyPhotos, queryReviews } from '../db/repository.js';
import { SAMPLE_JSON, seedFromSample } from '../db/sample.js';
import { isValidIsoDate, resolvePeriod, todayLocal, type PeriodPreset } from '../shared/dates.js';
import { PROPERTIES, bookingUrl, getProperty } from '../shared/properties.js';
import { CLASSIFIER_VERSION, TOPICS, TOPIC_IDS, type Sentiment, type TopicId } from '../shared/topics.js';
import type { MetaResponse, ReviewsResponse, TopicPolarity } from '../shared/types.js';
import { buildSummary, buildTrends, dataBounds } from './service.js';

// Settings such as OPENAI_API_KEY can live in a .env file next to package.json.
try {
  process.loadEnvFile();
} catch {
  /* no .env file: that's fine */
}

const db = openDb();

// A brand-new database (e.g. a fresh server) starts with the sample reviews so the dashboard isn't empty.
if (dataRange(db).total === 0 && existsSync(SAMPLE_JSON)) {
  const c = seedFromSample(db);
  console.log(`Empty database: loaded ${c.new} sample reviews from ${SAMPLE_JSON}.`);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Render's (or any) proxy, so req.ip is the visitor's address

/** For uptime checks (Render's health check). Deliberately outside the password. */
app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

/* ---------- Password protection ----------
   When DASHBOARD_PASSWORD is set, the browser asks for a user name and
   password before showing anything. Essential on a public address: the chat
   assistant spends OpenAI credit and "Get latest reviews" starts a browser. */
const AUTH_USER = process.env.DASHBOARD_USER?.trim() || 'staff';
const AUTH_PASSWORD = process.env.DASHBOARD_PASSWORD ?? '';

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

if (AUTH_PASSWORD) {
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      if (sep > 0 && sameText(decoded.slice(0, sep), AUTH_USER) && sameText(decoded.slice(sep + 1), AUTH_PASSWORD)) {
        next();
        return;
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="Azzurro guest reviews", charset="UTF-8"');
    res.status(401).send('Please sign in with the staff user name and password.');
  });
} else {
  console.warn('DASHBOARD_PASSWORD is not set: anyone who can reach this address can use the dashboard and the chat assistant.');
}

const PRESETS: PeriodPreset[] = ['this_week', 'last_week', 'last_4_weeks', 'last_3_months', 'last_12_months', 'custom'];

/** A request error with a message that is safe to show to the user. */
class BadRequest extends Error {}

function badRequest(message: string): never {
  throw new BadRequest(message);
}

type Query = (key: string) => string | undefined;

/** Reads one query-string value, ignoring repeated or nested parameters. */
function queryOf(req: Request): Query {
  return (key) => {
    const v = req.query[key];
    return typeof v === 'string' ? v : undefined;
  };
}

/** Reads ?period=&from=&to= into a resolved period, validating every value. */
function periodFromQuery(q: Query) {
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

function propertyFromQuery(q: Query): string | null {
  const id = q('property');
  if (!id || id === 'all') return null;
  if (!getProperty(id)) badRequest(`Unknown property "${id}"`);
  return id;
}

app.get('/api/meta', (_req, res) => {
  const range = dataBounds(db);
  const photos = propertyPhotos(db);
  const body: MetaResponse = {
    properties: PROPERTIES.map((p) => ({
      id: p.id,
      name: p.name,
      bookingUrl: bookingUrl(p).replace('.en-gb.html', '.html'),
      photo: photos.get(p.id)?.[0] ?? null,
      photos: (photos.get(p.id) ?? []).slice(0, 4),
    })),
    topics: TOPICS.map((t) => ({ id: t.id, label: t.label, description: t.description, terms: [...t.terms] })),
    today: todayLocal(),
    dataRange: { from: range.from, to: range.to },
    totalReviews: range.total,
    classifierVersion: CLASSIFIER_VERSION,
  };
  res.json(body);
});

app.get('/api/summary', (req, res) => {
  const q = queryOf(req);
  const { today, period } = periodFromQuery(q);
  res.json(buildSummary(db, period, propertyFromQuery(q), today));
});

app.get('/api/trends', (req, res) => {
  const q = queryOf(req);
  const { period } = periodFromQuery(q);
  res.json(buildTrends(db, period, propertyFromQuery(q)));
});

app.get('/api/reviews', (req, res) => {
  const q = queryOf(req);
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
  res.json(body);
});

app.get('/api/health', (_req, res) => {
  res.json(healthReport(db, isCollectionRunning()));
});

/** Runs the collector as a separate process (its log lines go to this server's log). */
function startCollection(trigger: string): boolean {
  if (isCollectionRunning()) return false;
  const child = spawn(process.execPath, ['--import', 'tsx', resolve('src/collector/cli.ts'), '--trigger', trigger], {
    cwd: process.cwd(),
    detached: true,
    stdio: 'inherit',
  });
  child.on('error', (err) => console.error('Could not start the collector:', err.message));
  child.unref();
  return true;
}

/** Starts a collection in the background so staff can refresh data from the dashboard. */
app.post('/api/collect', (_req, res) => {
  if (!startCollection('dashboard')) {
    res.status(409).json({ started: false, message: 'A collection is already running.' });
    return;
  }
  res.status(202).json({ started: true, message: 'Collection started. It usually takes 1–2 minutes.' });
});

/* Optional automatic updates: set AUTO_COLLECT_HOURS (e.g. 24) to collect whenever the
   last run is older than that. Checked a minute after start and then every 15 minutes. */
const autoHours = Number(process.env.AUTO_COLLECT_HOURS ?? 0);
if (autoHours > 0) {
  const check = () => {
    const last = listRuns(db, 1)[0];
    const lastAt = last ? Date.parse(last.finishedAt ?? last.startedAt) : 0;
    if (Date.now() - lastAt >= autoHours * 3_600_000 && startCollection('schedule')) {
      console.log(`Automatic collection started (last run ${last ? `at ${last.startedAt}` : 'never'}).`);
    }
  };
  setTimeout(check, 60_000).unref();
  setInterval(check, 15 * 60_000).unref();
  console.log(`Automatic collection every ${autoHours} hour(s) is on.`);
}

/* ---------- Chat assistant ---------- */

app.get('/api/assistant', (_req, res) => {
  const cfg = assistantConfig();
  res.json({ enabled: cfg.enabled, model: cfg.enabled ? cfg.model : null });
});

/** A gentle per-person limit so a stuck key or a runaway script can't run up the OpenAI bill. */
const CHAT_LIMIT = { max: 30, windowMs: 10 * 60_000 };
const chatHits = new Map<string, number[]>();
function allowChat(who: string): boolean {
  const now = Date.now();
  const recent = (chatHits.get(who) ?? []).filter((t) => now - t < CHAT_LIMIT.windowMs);
  if (recent.length >= CHAT_LIMIT.max) {
    chatHits.set(who, recent);
    return false;
  }
  recent.push(now);
  chatHits.set(who, recent);
  return true;
}

function viewFromBody(body: unknown): ViewContext {
  const v = (body && typeof body === 'object' ? (body as { view?: Record<string, unknown> }).view : null) ?? {};
  const str = (x: unknown) => (typeof x === 'string' && x ? x : null);
  const hotel = str(v.hotel);
  const period = str(v.period);
  const from = str(v.from);
  const to = str(v.to);
  return {
    hotel: hotel && getProperty(hotel) ? hotel : null,
    period: period && PRESETS.includes(period as PeriodPreset) ? period : null,
    from: from && isValidIsoDate(from) ? from : null,
    to: to && isValidIsoDate(to) ? to : null,
  };
}

app.post('/api/assistant/chat', express.json({ limit: '64kb' }), async (req, res) => {
  const cfg = assistantConfig();
  if (!cfg.enabled) {
    res.status(503).json({ error: 'The assistant is not set up yet. Ask IT to add an OpenAI key (see the README).' });
    return;
  }
  if (!allowChat(req.ip ?? 'unknown')) {
    res.status(429).json({ error: "You've asked a lot of questions in a short time. Please wait a few minutes and try again." });
    return;
  }
  let history;
  try {
    history = sanitizeHistory((req.body as { messages?: unknown } | undefined)?.messages);
  } catch (err) {
    badRequest(err instanceof Error ? err.message : 'Invalid messages');
  }
  try {
    const result = await askAssistant({ create: openAiCreate(), model: cfg.model, db, today: todayLocal() }, history, viewFromBody(req.body));
    res.json(result);
  } catch (err) {
    const friendly = friendlyOpenAiError(err);
    console.error('assistant error:', err instanceof Error ? err.message : err);
    res.status(friendly.status).json({ error: friendly.message });
  }
});

// Unknown API paths get a JSON 404 rather than the dashboard page.
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Production: serve the built dashboard and fall back to index.html for client routes.
const webDist = resolve('dist/web');
const hasDashboard = existsSync(join(webDist, 'index.html'));
if (hasDashboard) {
  app.use(express.static(webDist));
  app.get('/{*path}', (_req, res) => {
    res.sendFile(join(webDist, 'index.html'));
  });
}

// Express 5 passes errors thrown in route handlers here.
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof BadRequest) {
    res.status(400).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? '0.0.0.0';
const server = app.listen(port, host, () => {
  console.log(hasDashboard ? `Dashboard: http://localhost:${port}` : `API on http://localhost:${port} (run the Vite dev server for the dashboard)`);
});
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Start on another port, e.g. PORT=8788 npm start`);
    process.exit(1);
  }
  throw err;
});
