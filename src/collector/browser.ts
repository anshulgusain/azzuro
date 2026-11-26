import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, Page, Request } from 'playwright';
import { bookingUrl, type PropertyConfig } from '../shared/properties.js';
import {
  ExtractionError,
  mergeApolloCaches,
  parsePropertyPage,
  parseReviewListResponse,
  type ParsedPropertyPage,
  type RawReview,
} from './extract.js';
import { CollectError, errorMessage, log, politePause } from './util.js';

const APOLLO_SELECTOR = 'script[data-capla-store-data="apollo"]';
const READ_ALL_SELECTORS = [
  '[data-testid="fr-read-all-reviews"]',
  '[data-testid="review-score-read-all"]',
  '[data-testid="Property-Header-Nav-Tab-Trigger-reviews"]',
];

export interface FetchOptions {
  /** Also try the full review list behind "Read all reviews". */
  fullList: boolean;
  /** Stop paging once a page contains only reviews we already have. */
  incremental: boolean;
  maxPages: number;
  knownIds: Set<string>;
  debugDir: string;
}

export interface FullListOutcome {
  /** 'ok' | 'not_attempted' | 'blocked' | 'unavailable' | 'error' */
  status: 'ok' | 'not_attempted' | 'blocked' | 'unavailable' | 'error';
  detail: string;
  reviews: RawReview[];
  pages: number;
}

export interface PropertyFetchResult {
  page: ParsedPropertyPage;
  fullList: FullListOutcome;
}

/**
 * Loads one property page in a fresh browser context and extracts its data.
 *
 * The browser is a standard Playwright Chromium with its default identity:
 * we do not disguise automation. Booking.com's bot protection serves a
 * JavaScript challenge first; a real browser engine runs it and is then
 * redirected to the page, which is why plain HTTP clients don't work here.
 */
export async function fetchProperty(browser: Browser, property: PropertyConfig, opts: FetchOptions): Promise<PropertyFetchResult> {
  const context = await browser.newContext({ locale: 'en-GB', viewport: { width: 1366, height: 900 } });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  try {
    const parsed = await loadPropertyPage(page, property);
    const fullList = opts.fullList
      ? await fetchFullReviewList(page, property, parsed, opts)
      : { status: 'not_attempted' as const, detail: 'Skipped (--featured-only)', reviews: [], pages: 0 };
    return { page: parsed, fullList };
  } catch (err) {
    await saveDebugArtifacts(page, property, opts.debugDir, err);
    throw err;
  } finally {
    await context.close().catch(() => {});
  }
}

async function loadPropertyPage(page: Page, property: PropertyConfig): Promise<ParsedPropertyPage> {
  const url = bookingUrl(property);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  } catch (err) {
    throw new CollectError('network', `Could not load ${url}: ${errorMessage(err)}`);
  }

  // The first response is usually a bot-protection challenge (HTTP 202) that
  // reloads into the real page once solved. Wait for the real page's data.
  try {
    await page.waitForSelector(APOLLO_SELECTOR, { state: 'attached', timeout: 45_000 });
  } catch {
    const html = await page.content().catch(() => '');
    if (/challenge\.js|awsWafCookieDomainList|captcha/i.test(html) && !/data-capla-store-data/.test(html)) {
      throw new CollectError('challenge', 'Bot-protection challenge did not clear within 45s');
    }
    throw new CollectError('structure', 'Page loaded but the embedded review data block was not found (page structure changed?)');
  }

  // The page streams several data blocks; the first to appear is not always the
  // one holding the property. Wait until the property's own data has arrived.
  await page
    .waitForFunction(
      (sel) =>
        Array.from(document.querySelectorAll(sel)).some(
          (s) => s.textContent?.includes('"ROOT_QUERY"') && s.textContent.includes('"PropertyReview"'),
        ),
      APOLLO_SELECTOR,
      { timeout: 20_000, polling: 250 },
    )
    .catch(() => log('warn', '  property data block not complete after 20s; parsing what is there'));

  const blocks = await page.locator(APOLLO_SELECTOR).allTextContents();
  const caches = blocks.map((b) => {
    try {
      return JSON.parse(b) as unknown;
    } catch {
      return null;
    }
  });
  try {
    const parsed = parsePropertyPage(mergeApolloCaches(caches), property.id);
    if (parsed.overallScore === null) {
      // Second line of defence: read the visible score badge.
      parsed.overallScore = await readScoreFromDom(page);
      if (parsed.overallScore !== null) parsed.warnings.push('Overall score read from page text (embedded data changed)');
    }
    return parsed;
  } catch (err) {
    if (err instanceof ExtractionError) throw new CollectError('structure', err.message);
    throw err;
  }
}

async function readScoreFromDom(page: Page): Promise<number | null> {
  const text = await page
    .locator('[data-testid="review-score-component"]')
    .first()
    .innerText({ timeout: 3_000 })
    .catch(() => '');
  const m = text.match(/(\d{1,2}(?:[.,]\d)?)/);
  const v = m ? Number(m[1].replace(',', '.')) : NaN;
  return v >= 1 && v <= 10 ? v : null;
}

/**
 * Opens the "Read all reviews" panel and observes the site's own ReviewList
 * request. If Booking.com serves the list, further pages are requested the
 * same way the panel does (same endpoint, headers and variables, only the
 * offset changes), newest first, with a pause between pages.
 */
async function fetchFullReviewList(
  page: Page,
  property: PropertyConfig,
  parsed: ParsedPropertyPage,
  opts: FetchOptions,
): Promise<FullListOutcome> {
  await page.locator('#onetrust-accept-btn-handler').click({ timeout: 2_000 }).catch(() => {});

  const isReviewList = (req: Request) => {
    if (!req.url().includes('/dml/graphql')) return false;
    try {
      return (JSON.parse(req.postData() ?? '{}') as { operationName?: string }).operationName === 'ReviewList';
    } catch {
      return false;
    }
  };
  const responsePromise = page.waitForResponse((r) => isReviewList(r.request()), { timeout: 20_000 });

  let clicked = false;
  for (const sel of READ_ALL_SELECTORS) {
    const el = page.locator(sel).first();
    if (await el.isVisible().catch(() => false)) {
      await el.click().catch(() => {});
      clicked = true;
      break;
    }
  }
  if (!clicked) {
    responsePromise.catch(() => {});
    return { status: 'unavailable', detail: '"Read all reviews" button not found', reviews: [], pages: 0 };
  }

  let response;
  try {
    response = await responsePromise;
  } catch {
    return { status: 'unavailable', detail: 'The review panel did not request a review list', reviews: [], pages: 0 };
  }
  const request = response.request();
  const first = parseReviewListResponse(await response.json().catch(() => null), property.id);
  if (!first.ok) {
    const robot = parsed.flaggedAsRobot ? ' (Booking.com flagged this browser session as automated)' : '';
    return {
      status: 'blocked',
      detail: `Booking.com refused the review list: ${first.statusCode ?? ''} ${first.message}${robot}`.replace(/\s+/g, ' ').trim(),
      reviews: [],
      pages: 1,
    };
  }

  const reviews = new Map<string, RawReview>(first.reviews.map((r) => [r.id, r]));
  const body = JSON.parse(request.postData() ?? '{}') as { variables?: { input?: Record<string, unknown> } };
  const input = body.variables?.input;
  const limit = typeof input?.limit === 'number' ? input.limit : 10;
  const total = first.total;
  if (!input) {
    return { status: 'ok', detail: `First page only (${reviews.size}); request variables not readable`, reviews: [...reviews.values()], pages: 1 };
  }

  const headers = Object.fromEntries(
    Object.entries(request.headers()).filter(([k]) => !k.startsWith(':') && !['content-length', 'cookie', 'host'].includes(k)),
  );
  let pages = 1;
  let detail = '';
  for (let skip = 0; pages < opts.maxPages; skip += limit) {
    await politePause(1_500, 3_500);
    const vars = { ...body.variables, input: { ...input, sorter: 'NEWEST_FIRST', skip, limit } };
    const json = await page
      .evaluate(
        async ({ url, headers, payload }) => {
          const res = await fetch(url, { method: 'POST', headers, body: payload, credentials: 'include' });
          return res.ok ? res.json() : { errors: [{ message: `HTTP ${res.status}` }] };
        },
        { url: request.url(), headers, payload: JSON.stringify({ ...body, variables: vars }) },
      )
      .catch((err: unknown) => ({ errors: [{ message: errorMessage(err) }] }));
    pages++;
    const result = parseReviewListResponse(json, property.id);
    if (!result.ok) {
      detail = `stopped at offset ${skip}: ${result.message}`;
      break;
    }
    if (!result.reviews.length) break;
    const fresh = result.reviews.filter((r) => !opts.knownIds.has(r.id) && !reviews.has(r.id));
    for (const r of result.reviews) reviews.set(r.id, r);
    if (opts.incremental && fresh.length === 0) {
      detail = 'caught up with stored reviews';
      break;
    }
    if (total !== null && skip + limit >= total) break;
  }
  log('info', `  review list: ${reviews.size} reviews over ${pages} page(s)`, { property: property.id, detail: detail || undefined });
  return { status: 'ok', detail: detail || `${reviews.size} reviews`, reviews: [...reviews.values()], pages };
}

async function saveDebugArtifacts(page: Page, property: PropertyConfig, dir: string, err: unknown): Promise<void> {
  try {
    mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const base = join(dir, `${property.id}-${stamp}`);
    await page.screenshot({ path: `${base}.png`, fullPage: false }).catch(() => {});
    writeFileSync(`${base}.txt`, `${errorMessage(err)}\n\nURL: ${page.url()}\n`);
    log('warn', `  saved debug screenshot to ${base}.png`);
  } catch {
    /* debugging aids must never break a run */
  }
}

