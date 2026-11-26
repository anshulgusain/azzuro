import { addDays, startOfWeek, type IsoDate } from '../shared/dates.js';
import { TOPICS, topicLabel, type TopicId } from '../shared/topics.js';
import type { CategoryScore, Insight, PeriodStats, Review, TopicStat, TrendPoint } from '../shared/types.js';

/**
 * Pure aggregation functions. They take reviews already filtered by property
 * and date, so they are easy to test and reuse.
 */

const round1 = (n: number) => Math.round(n * 10) / 10;

export function periodStats(reviews: Review[]): PeriodStats {
  const count = reviews.length;
  const sum = reviews.reduce((a, r) => a + r.score, 0);
  return {
    count,
    avgScore: count ? round1(sum / count) : null,
    positive: reviews.filter((r) => r.sentiment === 'positive').length,
    neutral: reviews.filter((r) => r.sentiment === 'neutral').length,
    negative: reviews.filter((r) => r.sentiment === 'negative').length,
  };
}

const mentions = (r: Review, topic: TopicId, polarity: 'praise' | 'complaint') =>
  r.topics.some((t) => t.topic === topic && t.polarity === polarity);

export function topicStats(current: Review[], previous: Review[]): TopicStat[] {
  return TOPICS.map(({ id }) => ({
    topic: id,
    complaints: current.filter((r) => mentions(r, id, 'complaint')).length,
    praise: current.filter((r) => mentions(r, id, 'praise')).length,
    previousComplaints: previous.filter((r) => mentions(r, id, 'complaint')).length,
    negativeReviewsMentioning: current.filter((r) => r.sentiment === 'negative' && mentions(r, id, 'complaint')).length,
  }));
}

export function topComplaint(reviews: Review[]): { topic: TopicId; count: number } | null {
  let best: { topic: TopicId; count: number } | null = null;
  for (const { id } of TOPICS) {
    const count = reviews.filter((r) => mentions(r, id, 'complaint')).length;
    if (count > 0 && (!best || count > best.count)) best = { topic: id, count };
  }
  return best;
}

/** Weekly series (Monday-start), including empty weeks so gaps are visible. */
export function weeklyTrend(reviews: Review[], from: IsoDate, to: IsoDate): TrendPoint[] {
  const byWeek = new Map<IsoDate, Review[]>();
  for (const r of reviews) {
    const wk = startOfWeek(r.reviewedDate);
    const list = byWeek.get(wk);
    if (list) list.push(r);
    else byWeek.set(wk, [r]);
  }
  const points: TrendPoint[] = [];
  for (let wk = startOfWeek(from); wk <= to; wk = addDays(wk, 7)) {
    const list = byWeek.get(wk) ?? [];
    const stats = periodStats(list);
    const complaintsByTopic: TrendPoint['complaintsByTopic'] = {};
    for (const { id } of TOPICS) {
      const n = list.filter((r) => mentions(r, id, 'complaint')).length;
      if (n) complaintsByTopic[id] = n;
    }
    points.push({ weekStart: wk, ...stats, complaintsByTopic });
  }
  return points;
}

const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export interface InsightContext {
  current: Review[];
  previous: Review[];
  currentStats: PeriodStats;
  previousStats: PeriodStats;
  topics: TopicStat[];
  /** e.g. "this week" */
  periodLabel: string;
  /** e.g. "last week" */
  previousLabel: string;
  /** Per-property stats for the current period (only when not filtered to one property). */
  byProperty: Array<{ propertyId: string; name: string; stats: PeriodStats }>;
  lastReviewDate: IsoDate | null;
  scopeLabel: string | null;
}

/**
 * Turns the numbers into short, plain sentences an operations manager can act
 * on. Every sentence carries its count ("2 of 5 reviews"), so a 100% from one
 * review is never presented as a trend.
 */
export function buildInsights(ctx: InsightContext): Insight[] {
  const out: Insight[] = [];
  const { currentStats: cur, previousStats: prev, periodLabel, previousLabel } = ctx;
  const where = ctx.scopeLabel ? ` at ${ctx.scopeLabel}` : '';

  if (cur.count === 0) {
    out.push({
      kind: 'no_data',
      tone: 'neutral',
      text: `No reviews${where} ${periodLabel} yet.${ctx.lastReviewDate ? ` The latest review is from ${formatDay(ctx.lastReviewDate)}.` : ''}`,
    });
    return out;
  }

  // 1. Rating vs the comparison period
  if (cur.avgScore !== null && prev.avgScore !== null) {
    const delta = round1(cur.avgScore - prev.avgScore);
    const tone = Math.abs(delta) < 0.3 ? 'neutral' : delta > 0 ? 'good' : 'bad';
    const movement =
      tone === 'neutral'
        ? `about the same as ${previousLabel} (${prev.avgScore.toFixed(1)})`
        : `${delta > 0 ? 'up' : 'down'} from ${prev.avgScore.toFixed(1)} ${previousLabel}`;
    out.push({
      kind: 'rating_change',
      tone,
      text: `Average rating${where} ${periodLabel}: ${cur.avgScore.toFixed(1)} out of 10 from ${plural(cur.count, 'review')}, ${movement}.`,
    });
  } else if (cur.avgScore !== null) {
    out.push({
      kind: 'rating_change',
      tone: 'neutral',
      text: `Average rating${where} ${periodLabel}: ${cur.avgScore.toFixed(1)} out of 10 from ${plural(cur.count, 'review')}. No reviews ${previousLabel} to compare with.`,
    });
  }

  // 2. What bad reviews are about
  const negatives = ctx.current.filter((r) => r.sentiment === 'negative');
  const negativesWithText = negatives.filter((r) => r.textQuality === 'ok' || r.textQuality === 'misplaced_praise');
  if (negatives.length === 0) {
    out.push({ kind: 'top_issue', tone: 'good', text: `No bad reviews (5 out of 10 or lower)${where} ${periodLabel}.` });
  } else {
    const ranked = [...ctx.topics].filter((t) => t.negativeReviewsMentioning > 0).sort((a, b) => b.negativeReviewsMentioning - a.negativeReviewsMentioning);
    const top = ranked[0];
    if (top && negativesWithText.length) {
      out.push({
        kind: 'top_issue',
        tone: 'bad',
        topic: top.topic,
        text: `${pct(top.negativeReviewsMentioning, negativesWithText.length)}% of bad reviews${where} ${periodLabel} mention ${topicLabel(top.topic).toLowerCase()} (${top.negativeReviewsMentioning} of ${negativesWithText.length}).`,
      });
    } else {
      out.push({
        kind: 'top_issue',
        tone: 'bad',
        text: `${plural(negatives.length, 'bad review')}${where} ${periodLabel}, without comments we could sort into topics.`,
      });
    }
  }

  // 3. Most common complaint across all reviews (guests often complain even when they score 8+)
  const withText = ctx.current.filter((r) => r.textQuality === 'ok' || r.textQuality === 'misplaced_praise');
  const topAll = [...ctx.topics].sort((a, b) => b.complaints - a.complaints)[0];
  if (topAll && topAll.complaints > 0 && withText.length) {
    out.push({
      kind: 'top_issue',
      tone: 'bad',
      topic: topAll.topic,
      text: `Most common complaint${where} ${periodLabel}: ${topicLabel(topAll.topic).toLowerCase()} (${topAll.complaints} of ${plural(withText.length, 'review')}).`,
    });
  }

  // 4. Issues that are growing
  const rising = ctx.topics
    .filter((t) => t.complaints >= 2 && t.complaints - t.previousComplaints >= 2 && t.complaints >= 2 * Math.max(1, t.previousComplaints))
    .sort((a, b) => b.complaints - b.previousComplaints - (a.complaints - a.previousComplaints))
    .slice(0, 2);
  for (const t of rising) {
    out.push({
      kind: 'rising_issue',
      tone: 'bad',
      topic: t.topic,
      text: `More ${topicLabel(t.topic).toLowerCase()} complaints: ${t.complaints} ${periodLabel}, up from ${t.previousComplaints} ${previousLabel}.`,
    });
  }

  // 5. Which property needs attention
  const rated = ctx.byProperty.filter((p) => p.stats.count >= 2 && p.stats.avgScore !== null);
  if (rated.length >= 2) {
    const lowest = [...rated].sort((a, b) => a.stats.avgScore! - b.stats.avgScore!)[0];
    out.push({
      kind: 'property_watch',
      tone: lowest.stats.avgScore! < 7.5 ? 'bad' : 'neutral',
      propertyId: lowest.propertyId,
      text: `Lowest rated hotel ${periodLabel}: ${lowest.name}, ${lowest.stats.avgScore!.toFixed(1)} out of 10 (${plural(lowest.stats.count, 'review')}).`,
    });
  }

  // 6. What guests value most
  const topPraise = [...ctx.topics].sort((a, b) => b.praise - a.praise)[0];
  if (topPraise && topPraise.praise > 0 && withText.length) {
    out.push({
      kind: 'praise',
      tone: 'good',
      topic: topPraise.topic,
      text: `Guests praise ${topicLabel(topPraise.topic).toLowerCase()} the most (${topPraise.praise} of ${plural(withText.length, 'review')}).`,
    });
  }

  // 7. Sample-size caveat
  if (cur.count < 5) {
    out.push({
      kind: 'low_sample',
      tone: 'neutral',
      text: `Only ${plural(cur.count, 'review')} ${periodLabel}, so one review can change the numbers a lot. Pick a longer time period for a steadier picture.`,
    });
  }
  return out;
}

export function formatDay(d: IsoDate): string {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Compares Booking.com's all-time category scores with its range for similar
 * Sydney properties. Built from every review on Booking.com, so it stays
 * reliable even when only a few reviews could be collected.
 */
export function benchmarkInsight(properties: Array<{ name: string; categories: CategoryScore[] }>): Insight | null {
  const withData = properties.filter((p) => p.categories.length);
  if (!withData.length) return null;
  const below = new Map<string, string[]>();
  for (const p of withData) {
    for (const c of p.categories) {
      if (c.cityLow !== null && c.score < c.cityLow) below.set(c.label, [...(below.get(c.label) ?? []), p.name]);
    }
  }
  if (!below.size) {
    return { kind: 'benchmark', tone: 'good', text: 'Booking.com scores us as well as or better than similar Sydney hotels in every area.' };
  }
  const list = (xs: string[]) => (xs.length === 1 ? xs[0] : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  if (withData.length === 1) {
    return {
      kind: 'benchmark',
      tone: 'bad',
      text: `Booking.com scores ${withData[0].name} lower than similar Sydney hotels for ${list([...below.keys()].map((k) => k.toLowerCase()))}.`,
    };
  }
  const everywhere = [...below].filter(([, names]) => names.length === withData.length).map(([k]) => k.toLowerCase());
  const some = [...below].filter(([, names]) => names.length < withData.length).map(([k]) => k.toLowerCase());
  const text = everywhere.length
    ? `Booking.com scores all ${withData.length} hotels lower than similar Sydney hotels for ${list(everywhere)}${some.length ? ` (and some hotels for ${list(some)})` : ''}.`
    : `Booking.com scores some of our hotels lower than similar Sydney hotels for ${list(some)}.`;
  return { kind: 'benchmark', tone: 'bad', text };
}
