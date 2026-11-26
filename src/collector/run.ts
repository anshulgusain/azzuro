import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import type { Db } from '../db/database.js';
import {
  addRunItem,
  addSnapshot,
  closeAbandonedRuns,
  finishRun,
  knownReviewIds,
  startRun,
  upsertReview,
} from '../db/repository.js';
import { validateReviewInput } from '../db/reviewInput.js';
import type { PropertyConfig } from '../shared/properties.js';
import type { CollectionRun, RunItem } from '../shared/types.js';
import { fetchProperty } from './browser.js';
import type { RawReview } from './extract.js';
import { CollectError, errorMessage, log, politePause, withRetry } from './util.js';

export interface RunOptions {
  properties: readonly PropertyConfig[];
  fullList: boolean;
  incremental: boolean;
  maxPages: number;
  attempts: number;
  trigger: string;
  debugDir: string;
}

export interface RunSummary {
  runId: number;
  status: CollectionRun['status'];
  items: RunItem[];
}

const LOCK_PATH = resolve('data/.collect.lock');

/** Prevents two collections writing at once (e.g. cron plus the dashboard's refresh button). */
function acquireLock(): () => void {
  if (existsSync(LOCK_PATH)) {
    const pid = Number(readFileSync(LOCK_PATH, 'utf8'));
    let alive = false;
    try {
      if (pid) process.kill(pid, 0);
      alive = pid > 0;
    } catch {
      alive = false;
    }
    if (alive) throw new Error(`Another collection is already running (pid ${pid})`);
  }
  writeFileSync(LOCK_PATH, String(process.pid));
  return () => rmSync(LOCK_PATH, { force: true });
}

export function isCollectionRunning(): boolean {
  if (!existsSync(LOCK_PATH)) return false;
  const pid = Number(readFileSync(LOCK_PATH, 'utf8'));
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function runCollection(db: Db, opts: RunOptions): Promise<RunSummary> {
  const release = acquireLock();
  try {
    return await collectAll(db, opts);
  } finally {
    release();
  }
}

async function collectAll(db: Db, opts: RunOptions): Promise<RunSummary> {
  const now = () => new Date().toISOString();
  closeAbandonedRuns(db, now());
  const runId = startRun(db, opts.trigger, now());
  log('info', `Collection run #${runId} started`, { properties: opts.properties.length, fullList: opts.fullList });

  const items: RunItem[] = [];
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [i, property] of opts.properties.entries()) {
      if (i > 0) await politePause(3_000, 6_000);
      const item = await collectOne(db, runId, property, opts, browser);
      addRunItem(db, runId, item);
      items.push(item);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const status: CollectionRun['status'] = items.every((i) => i.status === 'ok')
    ? 'ok'
    : items.every((i) => i.status === 'failed')
      ? 'failed'
      : 'partial';
  finishRun(db, runId, status, now());
  log(status === 'failed' ? 'error' : 'info', `Run #${runId} finished: ${status}`, {
    new: items.reduce((a, i) => a + i.reviewsNew, 0),
    updated: items.reduce((a, i) => a + i.reviewsUpdated, 0),
  });
  return { runId, status, items };
}

async function collectOne(
  db: Db,
  runId: number,
  property: PropertyConfig,
  opts: RunOptions,
  browser: Awaited<ReturnType<typeof chromium.launch>>,
): Promise<RunItem> {
  const started = Date.now();
  log('info', `→ ${property.name}`, { page: property.pageName });
  const base: RunItem = {
    propertyId: property.id,
    status: 'failed',
    method: 'browser',
    reviewsSeen: 0,
    reviewsNew: 0,
    reviewsUpdated: 0,
    reviewsRejected: 0,
    fullListStatus: null,
    error: null,
    attempts: 0,
    durationMs: 0,
  };

  let fetched;
  try {
    const { value, attempts } = await withRetry(
      () =>
        fetchProperty(browser, property, {
          fullList: opts.fullList,
          incremental: opts.incremental,
          maxPages: opts.maxPages,
          knownIds: knownReviewIds(db, property.id),
          debugDir: opts.debugDir,
        }),
      {
        attempts: opts.attempts,
        baseDelayMs: 5_000,
        // A changed page structure won't fix itself on retry; network blips and challenges might.
        shouldRetry: (err) => !(err instanceof CollectError && err.kind === 'structure'),
        onRetry: (attempt, err, delay) =>
          log('warn', `  attempt ${attempt} failed, retrying in ${Math.round(delay / 1000)}s`, { error: errorMessage(err) }),
      },
    );
    fetched = value;
    base.attempts = attempts;
  } catch (err) {
    const kind = err instanceof CollectError ? err.kind : 'unknown';
    log('error', `  ${property.name} failed`, { kind, error: errorMessage(err) });
    return {
      ...base,
      attempts: (err as { attemptsUsed?: number }).attemptsUsed ?? opts.attempts,
      error: `[${kind}] ${errorMessage(err)}`,
      durationMs: Date.now() - started,
    };
  }

  const { page, fullList } = fetched;
  const capturedAt = new Date().toISOString();
  addSnapshot(db, {
    propertyId: property.id,
    runId,
    capturedAt,
    overallScore: page.overallScore,
    reviewCount: page.reviewCount,
    categories: page.categories,
    bookingHotelId: page.hotelId,
    bookingName: page.name,
    address: page.address,
    photos: page.photos,
  });

  // Full-list copies win over featured copies of the same review (they carry more detail).
  const byId = new Map<string, RawReview>();
  for (const r of page.featured) byId.set(r.id, r);
  for (const r of fullList.reviews) byId.set(r.id, r);

  const counts = { new: 0, updated: 0, rejected: 0 };
  for (const raw of byId.values()) {
    const v = validateReviewInput(raw);
    if (!v.ok) {
      counts.rejected++;
      log('warn', '  rejected review', { id: raw.id, reason: v.error });
      continue;
    }
    const outcome = upsertReview(db, v.value, capturedAt);
    if (outcome === 'new') counts.new++;
    if (outcome === 'updated') counts.updated++;
  }

  for (const w of page.warnings) log('warn', `  ${w}`);
  const method = fullList.status === 'ok' ? 'browser:review-list' : 'browser:featured';
  const status: RunItem['status'] = !opts.fullList || fullList.status === 'ok' ? 'ok' : 'partial';
  log('info', `  ${page.overallScore ?? '?'} / 10 from ${page.reviewCount ?? '?'} reviews on Booking.com`, {
    seen: byId.size,
    new: counts.new,
    updated: counts.updated,
    rejected: counts.rejected,
    fullList: `${fullList.status}: ${fullList.detail}`,
  });

  return {
    ...base,
    status,
    method,
    reviewsSeen: byId.size,
    reviewsNew: counts.new,
    reviewsUpdated: counts.updated,
    reviewsRejected: counts.rejected,
    fullListStatus: `${fullList.status}: ${fullList.detail}`,
    error: page.warnings.length ? page.warnings.join('; ') : null,
    durationMs: Date.now() - started,
  };
}
