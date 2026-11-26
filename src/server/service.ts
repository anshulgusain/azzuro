import type { Db } from '../db/database.js';
import { dataRange, latestSnapshots, queryReviews } from '../db/repository.js';
import { benchmarkInsight, buildInsights, periodStats, topComplaint, topicStats, weeklyTrend } from '../insights/metrics.js';
import { addDays, type IsoDate, type ResolvedPeriod } from '../shared/dates.js';
import { PROPERTIES, bookingUrl, getProperty } from '../shared/properties.js';
import type { PropertySummary, SummaryResponse, TrendsResponse } from '../shared/types.js';

const PERIOD_PHRASE: Record<ResolvedPeriod['preset'], string> = {
  this_week: 'this week',
  last_week: 'last week',
  last_4_weeks: 'in the last 4 weeks',
  last_3_months: 'in the last 3 months',
  last_12_months: 'in the last 12 months',
  custom: 'in the selected dates',
};

export function buildSummary(db: Db, period: ResolvedPeriod, propertyId: string | null, today: IsoDate): SummaryResponse {
  const load = (range: { from: IsoDate; to: IsoDate }, pid: string | null) =>
    queryReviews(db, { propertyId: pid, from: range.from, to: range.to }).reviews;

  const current = load(period.current, propertyId);
  const previous = load(period.previous, propertyId);
  const currentStats = periodStats(current);
  const previousStats = periodStats(previous);
  const topics = topicStats(current, previous);
  const snapshots = latestSnapshots(db);

  const properties: PropertySummary[] = PROPERTIES.map((p) => {
    const cur = propertyId === p.id || !propertyId ? current.filter((r) => r.propertyId === p.id) : load(period.current, p.id);
    const prev = propertyId === p.id || !propertyId ? previous.filter((r) => r.propertyId === p.id) : load(period.previous, p.id);
    const snap = snapshots.get(p.id);
    const collected = (db.prepare('SELECT COUNT(*) AS n FROM reviews WHERE property_id = ?').get(p.id) as { n: number }).n;
    return {
      id: p.id,
      name: p.name,
      bookingUrl: bookingUrl(p).replace('.en-gb.html', '.html'),
      bookingScore: snap?.overallScore ?? null,
      bookingReviewCount: snap?.reviewCount ?? null,
      reviewsCollected: collected,
      current: periodStats(cur),
      previous: periodStats(prev),
      topComplaint: topComplaint(cur),
      categories: snap?.categories ?? [],
      lastCollectedAt: snap?.capturedAt ?? null,
    };
  });

  const lastReview = queryReviews(db, { propertyId, sort: 'newest', limit: 1 }).reviews[0];
  const withText = current.filter((r) => r.textQuality === 'ok' || r.textQuality === 'misplaced_praise');
  const insights = buildInsights({
    current,
    previous,
    currentStats,
    previousStats,
    topics,
    periodLabel: PERIOD_PHRASE[period.preset],
    previousLabel: period.previousLabel,
    byProperty: propertyId ? [] : properties.map((p) => ({ propertyId: p.id, name: p.name, stats: p.current })),
    lastReviewDate: lastReview?.reviewedDate ?? null,
    scopeLabel: propertyId ? (getProperty(propertyId)?.name ?? propertyId) : null,
  });

  const inScope = properties.filter((p) => !propertyId || p.id === propertyId);
  const benchmark = benchmarkInsight(inScope);
  if (benchmark) insights.splice(Math.min(1, insights.length), 0, benchmark);
  const scores = inScope.map((p) => p.bookingScore).filter((s): s is number => s !== null);
  const sources = db
    .prepare(`SELECT source, COUNT(*) AS n FROM reviews ${propertyId ? 'WHERE property_id = ?' : ''} GROUP BY source`)
    .all(...(propertyId ? [propertyId] : [])) as Array<{ source: string; n: number }>;
  const coverage = {
    collected: inScope.reduce((a, p) => a + p.reviewsCollected, 0),
    onBooking: inScope.some((p) => p.bookingReviewCount !== null) ? inScope.reduce((a, p) => a + (p.bookingReviewCount ?? 0), 0) : null,
    featuredOnly: sources.length > 0 && sources.every((s) => s.source === 'featured'),
    bookingScoreRange: scores.length ? ([Math.min(...scores), Math.max(...scores)] as [number, number]) : null,
  };

  return {
    period,
    today,
    coverage,
    propertyFilter: propertyId,
    current: currentStats,
    previous: previousStats,
    classifiableCount: withText.length,
    negativeWithText: withText.filter((r) => r.sentiment === 'negative').length,
    topics,
    properties,
    insights,
    lastReviewDate: lastReview?.reviewedDate ?? null,
  };
}

/** Trend charts always show at least 12 weeks of context ending at the selected period. */
export function buildTrends(db: Db, period: ResolvedPeriod, propertyId: string | null): TrendsResponse {
  const minFrom = addDays(period.current.to, -7 * 11);
  const from = period.current.from < minFrom ? period.current.from : minFrom;
  const reviews = queryReviews(db, { propertyId, from, to: period.current.to }).reviews;
  return { weeks: weeklyTrend(reviews, from, period.current.to) };
}

export function dataBounds(db: Db) {
  return dataRange(db);
}
