import { createHash } from 'node:crypto';
import { classifyReview, normalizeText } from '../insights/classify.js';
import { toLocalDate, type IsoDate } from '../shared/dates.js';
import { PROPERTIES } from '../shared/properties.js';
import { CLASSIFIER_VERSION, SENTIMENT_BANDS, sentimentForScore, type Sentiment, type TopicId } from '../shared/topics.js';
import type {
  CategoryScore,
  CollectionRun,
  HealthResponse,
  Review,
  ReviewSource,
  RunItem,
  TextQuality,
  TopicMention,
  TopicPolarity,
} from '../shared/types.js';
import { transaction, type Db } from './database.js';
import type { ReviewInput } from './reviewInput.js';

/* ------------------------------------------------------------------ */
/* Writing reviews                                                      */
/* ------------------------------------------------------------------ */

export type UpsertOutcome = 'new' | 'updated' | 'unchanged';

const SOURCE_RANK: Record<ReviewSource, number> = { featured: 1, import: 2, review_list: 3 };

/** Fingerprint of a review's content, used to flag possible duplicates across ids. */
export function contentHash(r: Pick<ReviewInput, 'propertyId' | 'score' | 'positiveText' | 'negativeText'> & { reviewedDate: string }): string {
  const parts = [r.propertyId, r.reviewedDate, r.score, normalizeText(r.positiveText ?? ''), normalizeText(r.negativeText ?? '')];
  return createHash('sha1').update(parts.join('␟')).digest('hex');
}

interface ReviewRow {
  id: string;
  property_id: string;
  source: ReviewSource;
  booking_review_id: string | null;
  score: number;
  title: string | null;
  positive_text: string | null;
  negative_text: string | null;
  language: string | null;
  reviewed_at: string;
  reviewed_date: string;
  stay_month: string | null;
  nights: number | null;
  room_type: string | null;
  traveller_type: string | null;
  trip_purpose: string | null;
  guest_name: string | null;
  guest_country: string | null;
  hotel_reply: string | null;
  content_hash: string;
  text_quality: TextQuality;
  classifier_version: string | null;
  first_seen_at: string;
  last_seen_at: string;
  topics_json?: string;
}

/**
 * Inserts a new review or merges it into the existing record with the same
 * Booking.com id. Fields missing from the incoming copy (e.g. hotel replies,
 * which featured reviews do not include) never overwrite stored values.
 */
export function upsertReview(db: Db, input: ReviewInput, now: string): UpsertOutcome {
  const existing = db.prepare('SELECT * FROM reviews WHERE id = ?').get(input.id) as ReviewRow | undefined;

  const merged = {
    property_id: input.propertyId,
    source: existing && SOURCE_RANK[existing.source] > SOURCE_RANK[input.source] ? existing.source : input.source,
    booking_review_id: input.bookingReviewId ?? existing?.booking_review_id ?? null,
    score: input.score,
    title: input.title ?? existing?.title ?? null,
    positive_text: input.positiveText ?? existing?.positive_text ?? null,
    negative_text: input.negativeText ?? existing?.negative_text ?? null,
    language: input.language ?? existing?.language ?? null,
    reviewed_at: input.reviewedAt,
    reviewed_date: toLocalDate(new Date(input.reviewedAt)),
    stay_month: input.stayMonth ?? existing?.stay_month ?? null,
    nights: input.nights ?? existing?.nights ?? null,
    room_type: input.roomType ?? existing?.room_type ?? null,
    traveller_type: input.travellerType ?? existing?.traveller_type ?? null,
    trip_purpose: input.tripPurpose ?? existing?.trip_purpose ?? null,
    guest_name: input.guestName ?? existing?.guest_name ?? null,
    guest_country: input.guestCountry ?? existing?.guest_country ?? null,
    hotel_reply: input.hotelReply ?? existing?.hotel_reply ?? null,
  };
  const hash = contentHash({
    propertyId: merged.property_id,
    reviewedDate: merged.reviewed_date,
    score: merged.score,
    positiveText: merged.positive_text,
    negativeText: merged.negative_text,
  });

  if (existing) {
    const changed =
      existing.content_hash !== hash ||
      existing.hotel_reply !== merged.hotel_reply ||
      existing.title !== merged.title ||
      existing.source !== merged.source ||
      existing.room_type !== merged.room_type;
    if (!changed) {
      db.prepare('UPDATE reviews SET last_seen_at = ? WHERE id = ?').run(now, input.id);
      return 'unchanged';
    }
  }

  const classification = classifyReview({
    positiveText: merged.positive_text,
    negativeText: merged.negative_text,
    language: merged.language,
  });

  transaction(db, () => {
    db.prepare(
      `INSERT INTO reviews (
         id, property_id, source, booking_review_id, score, title, positive_text, negative_text, language,
         reviewed_at, reviewed_date, stay_month, nights, room_type, traveller_type, trip_purpose,
         guest_name, guest_country, hotel_reply, content_hash, text_quality, classifier_version,
         first_seen_at, last_seen_at, updated_at)
       VALUES (
         :id, :property_id, :source, :booking_review_id, :score, :title, :positive_text, :negative_text, :language,
         :reviewed_at, :reviewed_date, :stay_month, :nights, :room_type, :traveller_type, :trip_purpose,
         :guest_name, :guest_country, :hotel_reply, :content_hash, :text_quality, :classifier_version,
         :now, :now, NULL)
       ON CONFLICT (id) DO UPDATE SET
         source = excluded.source, booking_review_id = excluded.booking_review_id, score = excluded.score,
         title = excluded.title, positive_text = excluded.positive_text, negative_text = excluded.negative_text,
         language = excluded.language, reviewed_at = excluded.reviewed_at, reviewed_date = excluded.reviewed_date,
         stay_month = excluded.stay_month, nights = excluded.nights, room_type = excluded.room_type,
         traveller_type = excluded.traveller_type, trip_purpose = excluded.trip_purpose,
         guest_name = excluded.guest_name, guest_country = excluded.guest_country, hotel_reply = excluded.hotel_reply,
         content_hash = excluded.content_hash, text_quality = excluded.text_quality,
         classifier_version = excluded.classifier_version, last_seen_at = :now, updated_at = :now`,
    ).run({
      id: input.id,
      ...merged,
      content_hash: hash,
      text_quality: classification.textQuality,
      classifier_version: CLASSIFIER_VERSION,
      now,
    });
    replaceTopics(db, input.id, classification.topics);
  });

  return existing ? 'updated' : 'new';
}

function replaceTopics(db: Db, reviewId: string, topics: TopicMention[]): void {
  db.prepare('DELETE FROM review_topics WHERE review_id = ?').run(reviewId);
  const ins = db.prepare('INSERT INTO review_topics (review_id, topic, polarity, terms) VALUES (?, ?, ?, ?)');
  for (const t of topics) ins.run(reviewId, t.topic, t.polarity, JSON.stringify(t.terms));
}

/** Re-runs the topic classifier over every stored review (after editing the taxonomy). */
export function reclassifyAll(db: Db): { reviews: number; changed: number } {
  const rows = db.prepare('SELECT id, positive_text, negative_text, language, text_quality FROM reviews').all() as unknown as Array<
    Pick<ReviewRow, 'id' | 'positive_text' | 'negative_text' | 'language' | 'text_quality'>
  >;
  let changed = 0;
  transaction(db, () => {
    for (const r of rows) {
      const c = classifyReview({ positiveText: r.positive_text, negativeText: r.negative_text, language: r.language });
      db.prepare('UPDATE reviews SET text_quality = ?, classifier_version = ? WHERE id = ?').run(c.textQuality, CLASSIFIER_VERSION, r.id);
      const before = db.prepare('SELECT topic, polarity FROM review_topics WHERE review_id = ? ORDER BY topic, polarity').all(r.id);
      replaceTopics(db, r.id, c.topics);
      const after = db.prepare('SELECT topic, polarity FROM review_topics WHERE review_id = ? ORDER BY topic, polarity').all(r.id);
      if (JSON.stringify(before) !== JSON.stringify(after) || c.textQuality !== r.text_quality) changed++;
    }
  });
  return { reviews: rows.length, changed };
}

/* ------------------------------------------------------------------ */
/* Reading reviews                                                      */
/* ------------------------------------------------------------------ */

export interface ReviewQuery {
  propertyId?: string | null;
  from?: IsoDate | null;
  to?: IsoDate | null;
  sentiment?: Sentiment | null;
  topic?: TopicId | null;
  polarity?: TopicPolarity | null;
  q?: string | null;
  sort?: 'newest' | 'oldest' | 'lowest' | 'highest';
  limit?: number;
  offset?: number;
}

function buildWhere(q: ReviewQuery): { sql: string; params: Record<string, string | number | null> } {
  const clauses: string[] = [];
  const params: Record<string, string | number | null> = {};
  if (q.propertyId) {
    clauses.push('r.property_id = :propertyId');
    params.propertyId = q.propertyId;
  }
  if (q.from) {
    clauses.push('r.reviewed_date >= :from');
    params.from = q.from;
  }
  if (q.to) {
    clauses.push('r.reviewed_date <= :to');
    params.to = q.to;
  }
  if (q.sentiment === 'positive') clauses.push(`r.score >= ${SENTIMENT_BANDS.positiveMin}`);
  if (q.sentiment === 'negative') clauses.push(`r.score < ${SENTIMENT_BANDS.negativeBelow}`);
  if (q.sentiment === 'neutral')
    clauses.push(`r.score >= ${SENTIMENT_BANDS.negativeBelow} AND r.score < ${SENTIMENT_BANDS.positiveMin}`);
  if (q.topic) {
    clauses.push(
      'EXISTS (SELECT 1 FROM review_topics t WHERE t.review_id = r.id AND t.topic = :topic AND (:polarity IS NULL OR t.polarity = :polarity))',
    );
    params.topic = q.topic;
    params.polarity = q.polarity ?? null;
  }
  if (q.q?.trim()) {
    clauses.push(
      "(r.positive_text LIKE :q ESCAPE '\\' OR r.negative_text LIKE :q ESCAPE '\\' OR r.title LIKE :q ESCAPE '\\' OR r.hotel_reply LIKE :q ESCAPE '\\')",
    );
    params.q = `%${q.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

const ORDER_BY: Record<NonNullable<ReviewQuery['sort']>, string> = {
  newest: 'r.reviewed_at DESC, r.id',
  oldest: 'r.reviewed_at ASC, r.id',
  lowest: 'r.score ASC, r.reviewed_at DESC, r.id',
  highest: 'r.score DESC, r.reviewed_at DESC, r.id',
};

function rowToReview(row: ReviewRow): Review {
  const topics = (JSON.parse(row.topics_json ?? '[]') as Array<{ topic: TopicId; polarity: TopicPolarity; terms: string[] }>).filter(
    (t) => t.topic,
  );
  return {
    id: row.id,
    propertyId: row.property_id,
    source: row.source,
    score: row.score,
    sentiment: sentimentForScore(row.score),
    title: row.title,
    positiveText: row.positive_text,
    negativeText: row.negative_text,
    language: row.language,
    reviewedAt: row.reviewed_at,
    reviewedDate: row.reviewed_date,
    stayMonth: row.stay_month,
    nights: row.nights,
    roomType: row.room_type,
    travellerType: row.traveller_type,
    tripPurpose: row.trip_purpose,
    guestName: row.guest_name,
    guestCountry: row.guest_country,
    hotelReply: row.hotel_reply,
    textQuality: row.text_quality,
    topics,
    firstSeenAt: row.first_seen_at,
  };
}

export function queryReviews(db: Db, q: ReviewQuery): { total: number; reviews: Review[] } {
  const { sql: where, params } = buildWhere(q);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM reviews r ${where}`).get(params) as { n: number }).n;
  const limit = Math.max(1, Math.min(q.limit ?? 10_000, 10_000));
  const offset = Math.max(0, q.offset ?? 0);
  const rows = db
    .prepare(
      `SELECT r.*,
         (SELECT json_group_array(json_object('topic', t.topic, 'polarity', t.polarity, 'terms', json(t.terms)))
            FROM review_topics t WHERE t.review_id = r.id) AS topics_json
       FROM reviews r ${where}
       ORDER BY ${ORDER_BY[q.sort ?? 'newest']}
       LIMIT ${limit} OFFSET ${offset}`,
    )
    .all(params) as unknown as ReviewRow[];
  return { total, reviews: rows.map(rowToReview) };
}

export function dataRange(db: Db): { from: IsoDate | null; to: IsoDate | null; total: number } {
  const r = db.prepare('SELECT MIN(reviewed_date) AS f, MAX(reviewed_date) AS t, COUNT(*) AS n FROM reviews').get() as {
    f: string | null;
    t: string | null;
    n: number;
  };
  return { from: r.f, to: r.t, total: r.n };
}

/* ------------------------------------------------------------------ */
/* Property snapshots                                                   */
/* ------------------------------------------------------------------ */

export interface SnapshotInput {
  propertyId: string;
  runId: number | null;
  capturedAt: string;
  overallScore: number | null;
  reviewCount: number | null;
  categories: CategoryScore[];
  bookingHotelId?: number | null;
  bookingName?: string | null;
  address?: string | null;
}

export function addSnapshot(db: Db, s: SnapshotInput): void {
  db.prepare(
    'INSERT INTO property_snapshots (property_id, run_id, captured_at, overall_score, review_count, categories_json) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(s.propertyId, s.runId, s.capturedAt, s.overallScore, s.reviewCount, JSON.stringify(s.categories));
  db.prepare(
    `UPDATE properties SET
       booking_hotel_id = COALESCE(?, booking_hotel_id),
       booking_name = COALESCE(?, booking_name),
       address = COALESCE(?, address)
     WHERE id = ?`,
  ).run(s.bookingHotelId ?? null, s.bookingName ?? null, s.address ?? null, s.propertyId);
}

export interface LatestSnapshot {
  propertyId: string;
  capturedAt: string;
  overallScore: number | null;
  reviewCount: number | null;
  categories: CategoryScore[];
}

export function latestSnapshots(db: Db): Map<string, LatestSnapshot> {
  const rows = db
    .prepare(
      `SELECT s.* FROM property_snapshots s
       JOIN (SELECT property_id, MAX(id) AS id FROM property_snapshots GROUP BY property_id) last ON last.id = s.id`,
    )
    .all() as Array<{ property_id: string; captured_at: string; overall_score: number | null; review_count: number | null; categories_json: string }>;
  return new Map(
    rows.map((r) => [
      r.property_id,
      {
        propertyId: r.property_id,
        capturedAt: r.captured_at,
        overallScore: r.overall_score,
        reviewCount: r.review_count,
        categories: JSON.parse(r.categories_json) as CategoryScore[],
      },
    ]),
  );
}

/* ------------------------------------------------------------------ */
/* Collection runs                                                      */
/* ------------------------------------------------------------------ */

export function startRun(db: Db, trigger: string, now: string): number {
  const res = db.prepare("INSERT INTO collection_runs (started_at, status, trigger) VALUES (?, 'running', ?)").run(now, trigger);
  return Number(res.lastInsertRowid);
}

export function addRunItem(db: Db, runId: number, item: RunItem): void {
  db.prepare(
    `INSERT OR REPLACE INTO collection_run_items
       (run_id, property_id, status, method, reviews_seen, reviews_new, reviews_updated, reviews_rejected,
        full_list_status, error, attempts, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    item.propertyId,
    item.status,
    item.method,
    item.reviewsSeen,
    item.reviewsNew,
    item.reviewsUpdated,
    item.reviewsRejected,
    item.fullListStatus,
    item.error,
    item.attempts,
    item.durationMs,
  );
}

export function finishRun(db: Db, runId: number, status: CollectionRun['status'], now: string, notes?: string): void {
  const totals = db
    .prepare('SELECT COALESCE(SUM(reviews_new), 0) AS n, COALESCE(SUM(reviews_updated), 0) AS u FROM collection_run_items WHERE run_id = ?')
    .get(runId) as { n: number; u: number };
  db.prepare('UPDATE collection_runs SET finished_at = ?, status = ?, reviews_new = ?, reviews_updated = ?, notes = ? WHERE id = ?').run(
    now,
    status,
    totals.n,
    totals.u,
    notes ?? null,
    runId,
  );
}

/** Marks runs left in 'running' by a crashed process as failed. */
export function closeAbandonedRuns(db: Db, now: string): void {
  db.prepare(
    "UPDATE collection_runs SET status = 'failed', finished_at = ?, notes = 'Process stopped before the run finished' WHERE status = 'running' AND started_at < ?",
  ).run(now, new Date(Date.parse(now) - 60 * 60_000).toISOString());
}

export function listRuns(db: Db, limit = 10): CollectionRun[] {
  const runs = db.prepare('SELECT * FROM collection_runs ORDER BY id DESC LIMIT ?').all(limit) as Array<{
    id: number;
    started_at: string;
    finished_at: string | null;
    status: CollectionRun['status'];
    trigger: string;
    reviews_new: number;
    reviews_updated: number;
  }>;
  const itemStmt = db.prepare('SELECT * FROM collection_run_items WHERE run_id = ? ORDER BY property_id');
  return runs.map((r) => ({
    id: r.id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    trigger: r.trigger,
    reviewsNew: r.reviews_new,
    reviewsUpdated: r.reviews_updated,
    items: (itemStmt.all(r.id) as Array<Record<string, unknown>>).map((i) => ({
      propertyId: i.property_id as string,
      status: i.status as RunItem['status'],
      method: i.method as string,
      reviewsSeen: i.reviews_seen as number,
      reviewsNew: i.reviews_new as number,
      reviewsUpdated: i.reviews_updated as number,
      reviewsRejected: i.reviews_rejected as number,
      fullListStatus: (i.full_list_status as string | null) ?? null,
      error: (i.error as string | null) ?? null,
      attempts: i.attempts as number,
      durationMs: i.duration_ms as number,
    })),
  }));
}

/** Known review keys for a property, used to stop paging early in incremental mode. */
export function knownReviewIds(db: Db, propertyId: string): Set<string> {
  const rows = db.prepare('SELECT id FROM reviews WHERE property_id = ?').all(propertyId) as Array<{ id: string }>;
  return new Set(rows.map((r) => r.id));
}

/* ------------------------------------------------------------------ */
/* Data health                                                          */
/* ------------------------------------------------------------------ */

export function healthReport(db: Db, collecting: boolean): HealthResponse {
  const snapshots = latestSnapshots(db);
  const coverage = PROPERTIES.map((p) => {
    const bySourceRows = db
      .prepare('SELECT source, COUNT(*) AS n FROM reviews WHERE property_id = ? GROUP BY source')
      .all(p.id) as Array<{ source: ReviewSource; n: number }>;
    const range = db
      .prepare('SELECT COUNT(*) AS n, MIN(reviewed_date) AS f, MAX(reviewed_date) AS t FROM reviews WHERE property_id = ?')
      .get(p.id) as { n: number; f: string | null; t: string | null };
    const lastOk = db
      .prepare(
        `SELECT MAX(r.finished_at) AS at FROM collection_run_items i JOIN collection_runs r ON r.id = i.run_id
         WHERE i.property_id = ? AND i.status IN ('ok', 'partial')`,
      )
      .get(p.id) as { at: string | null };
    return {
      propertyId: p.id,
      name: p.name,
      collected: range.n,
      bookingReviewCount: snapshots.get(p.id)?.reviewCount ?? null,
      bySource: Object.fromEntries(bySourceRows.map((r) => [r.source, r.n])),
      lastSuccessAt: lastOk.at,
      oldestReview: range.f,
      newestReview: range.t,
    };
  });
  const q = db
    .prepare(
      `SELECT COUNT(*) AS total,
         SUM(text_quality = 'no_text') AS noText,
         SUM(text_quality = 'non_english') AS nonEnglish,
         SUM(text_quality = 'misplaced_praise') AS misplaced
       FROM reviews`,
    )
    .get() as { total: number; noText: number | null; nonEnglish: number | null; misplaced: number | null };
  const dup = db
    .prepare(
      `SELECT COALESCE(SUM(n - 1), 0) AS d FROM (
         SELECT COUNT(*) AS n FROM reviews
         WHERE COALESCE(positive_text, '') || COALESCE(negative_text, '') <> ''
         GROUP BY content_hash HAVING COUNT(*) > 1)`,
    )
    .get() as { d: number };
  return {
    runs: listRuns(db, 10),
    coverage,
    quality: {
      total: q.total,
      noText: q.noText ?? 0,
      nonEnglish: q.nonEnglish ?? 0,
      misplacedPraise: q.misplaced ?? 0,
      possibleDuplicates: dup.d,
    },
    collecting,
  };
}
