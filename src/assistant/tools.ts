import type { FunctionTool } from 'openai/resources/responses/responses';
import type { Db } from '../db/database.js';
import { healthReport, latestSnapshots, queryReviews } from '../db/repository.js';
import { buildSummary, buildTrends } from '../server/service.js';
import { addDays, isValidIsoDate, resolvePeriod, type IsoDate, type PeriodPreset, type ResolvedPeriod } from '../shared/dates.js';
import { PROPERTIES, getProperty } from '../shared/properties.js';
import { TOPICS, TOPIC_IDS, topicLabel, type Sentiment, type TopicId } from '../shared/topics.js';

/**
 * The only things the assistant can do: read-only questions answered by the
 * same functions that power the dashboard. The model never writes SQL and
 * cannot change data or start collections.
 */

export interface ToolContext {
  db: Db;
  today: IsoDate;
}

export class ToolInputError extends Error {}

const HOTEL_IDS = PROPERTIES.map((p) => p.id);
const PRESETS: PeriodPreset[] = ['this_week', 'last_week', 'last_4_weeks', 'last_3_months', 'last_12_months', 'custom'];
const MAX_TEXT = 500;

/* ---------- JSON-schema building blocks (strict mode: every field required, null = not given) ---------- */

const hotelParam = {
  type: ['string', 'null'],
  enum: [...HOTEL_IDS, 'all', null],
  description: `Hotel id, or "all"/null for every hotel. Ids: ${PROPERTIES.map((p) => `${p.id} = ${p.name}`).join('; ')}.`,
};
const periodParams = {
  period: {
    type: ['string', 'null'],
    enum: [...PRESETS, null],
    description:
      'Time period. this_week = Monday to today; last_week = previous Mon–Sun; last_4_weeks / last_3_months / last_12_months = rolling. Use "custom" with from/to for specific dates.',
  },
  from: { type: ['string', 'null'], description: 'Start date YYYY-MM-DD, only when period is "custom".' },
  to: { type: ['string', 'null'], description: 'End date YYYY-MM-DD, only when period is "custom".' },
};

function strictObject(properties: Record<string, unknown>) {
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

/* ---------- Argument parsing (the model's JSON is untrusted input) ---------- */

type Args = Record<string, unknown>;

function hotelArg(a: Args): string | null {
  const v = a.hotel;
  if (v === null || v === undefined || v === 'all') return null;
  if (typeof v !== 'string' || !getProperty(v)) throw new ToolInputError(`Unknown hotel "${String(v)}". Use one of: ${HOTEL_IDS.join(', ')}.`);
  return v;
}

function periodArg(a: Args, today: IsoDate, fallback: PeriodPreset): ResolvedPeriod {
  const preset = (a.period ?? fallback) as PeriodPreset;
  if (!PRESETS.includes(preset)) throw new ToolInputError(`Unknown period "${String(a.period)}".`);
  if (preset !== 'custom') return resolvePeriod(preset, today);
  const from = a.from;
  const to = a.to;
  if (typeof from !== 'string' || typeof to !== 'string' || !isValidIsoDate(from) || !isValidIsoDate(to) || from > to) {
    throw new ToolInputError('A custom period needs valid "from" and "to" dates (YYYY-MM-DD, from before to).');
  }
  return resolvePeriod('custom', today, { from, to });
}

function enumArg<T extends string>(a: Args, key: string, allowed: readonly T[]): T | null {
  const v = a[key];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string' || !allowed.includes(v as T)) throw new ToolInputError(`Unknown ${key} "${String(v)}".`);
  return v as T;
}

const hotelName = (id: string) => getProperty(id)?.name ?? id;
const clip = (s: string | null, n = MAX_TEXT) => (s && s.length > n ? `${s.slice(0, n)}…` : s);
const periodInfo = (p: ResolvedPeriod) => ({
  from: p.current.from,
  to: p.current.to,
  in_progress: p.inProgress,
  compared_with: { from: p.previous.from, to: p.previous.to, label: p.previousLabel },
});

/* ---------- Tools ---------- */

export interface ToolDef {
  definition: FunctionTool;
  run: (args: Args, ctx: ToolContext) => unknown;
}

const getOverview: ToolDef = {
  definition: {
    type: 'function',
    name: 'get_overview',
    description:
      'Headline numbers for a hotel (or all hotels) and period: average guest rating vs the previous period, counts of good/okay/bad reviews, per-hotel breakdown, complaints and praise by topic, and ready-made key points. Use this first for "how are we doing" questions.',
    strict: true,
    parameters: strictObject({ hotel: hotelParam, ...periodParams }),
  },
  run(a, { db, today }) {
    const hotel = hotelArg(a);
    const period = periodArg(a, today, 'last_4_weeks');
    const s = buildSummary(db, period, hotel, today);
    const topics = [...s.topics];
    return {
      hotel: hotel ? hotelName(hotel) : 'All hotels',
      period: periodInfo(period),
      average_rating: s.current.avgScore,
      previous_average_rating: s.previous.avgScore,
      reviews: s.current.count,
      previous_reviews: s.previous.count,
      good_reviews_8_to_10: s.current.positive,
      okay_reviews_6_to_7: s.current.neutral,
      bad_reviews_1_to_5: s.current.negative,
      reviews_with_comments: s.classifiableCount,
      hotels: s.properties
        .filter((p) => !hotel || p.id === hotel)
        .map((p) => ({
          hotel: p.name,
          average_rating: p.current.avgScore,
          previous_average_rating: p.previous.avgScore,
          reviews: p.current.count,
          bad_reviews: p.current.negative,
          main_complaint: p.topComplaint ? topicLabel(p.topComplaint.topic) : null,
          booking_com_overall_score_all_time: p.bookingScore,
          booking_com_total_reviews: p.bookingReviewCount,
        })),
      complaints_by_topic: topics
        .filter((t) => t.complaints > 0)
        .sort((x, y) => y.complaints - x.complaints)
        .map((t) => ({ topic: topicLabel(t.topic), reviews: t.complaints, previous_period: t.previousComplaints, in_bad_reviews: t.negativeReviewsMentioning })),
      praise_by_topic: topics
        .filter((t) => t.praise > 0)
        .sort((x, y) => y.praise - x.praise)
        .map((t) => ({ topic: topicLabel(t.topic), reviews: t.praise })),
      key_points: s.insights.map((i) => i.text),
      data_note: s.coverage.featuredOnly
        ? `Only ${s.coverage.collected} of ${s.coverage.onBooking ?? '?'} Booking.com reviews are available (Booking.com's featured, mostly high-scoring reviews), so averages look higher than Booking.com's real overall score.`
        : null,
    };
  },
};

const searchReviews: ToolDef = {
  definition: {
    type: 'function',
    name: 'search_reviews',
    description:
      'Find and read individual guest reviews. Filter by hotel, period (null = all dates), rating band, topic (as a complaint or praise) and words in the text. Returns the total number of matches and up to `limit` reviews with what guests liked and did not like.',
    strict: true,
    parameters: strictObject({
      hotel: hotelParam,
      ...periodParams,
      rating: { type: ['string', 'null'], enum: ['good', 'okay', 'bad', null], description: 'good = 8–10, okay = 6–7, bad = 1–5.' },
      topic: {
        type: ['string', 'null'],
        enum: [...TOPIC_IDS, null],
        description: `Topic: ${TOPICS.map((t) => `${t.id} (${t.label})`).join(', ')}.`,
      },
      mentions: { type: ['string', 'null'], enum: ['complaint', 'praise', null], description: 'With a topic: complaints only or praise only.' },
      text: { type: ['string', 'null'], description: 'Word or phrase to look for in the review text, e.g. "towel".' },
      sort: { type: ['string', 'null'], enum: ['newest', 'worst', 'best', null], description: 'Default newest.' },
      limit: { type: ['integer', 'null'], description: 'How many reviews to return, 1–15. Default 8.' },
    }),
  },
  run(a, { db, today }) {
    const hotel = hotelArg(a);
    const allDates = a.period === null || a.period === undefined;
    const period = allDates ? null : periodArg(a, today, 'last_12_months');
    const rating = enumArg(a, 'rating', ['good', 'okay', 'bad'] as const);
    const topic = enumArg(a, 'topic', TOPIC_IDS as readonly TopicId[]);
    const mentions = enumArg(a, 'mentions', ['complaint', 'praise'] as const);
    const sort = enumArg(a, 'sort', ['newest', 'worst', 'best'] as const) ?? 'newest';
    const limit = Math.min(15, Math.max(1, typeof a.limit === 'number' && Number.isFinite(a.limit) ? Math.round(a.limit) : 8));
    const sentiment: Sentiment | null = rating === 'good' ? 'positive' : rating === 'okay' ? 'neutral' : rating === 'bad' ? 'negative' : null;
    const text = typeof a.text === 'string' && a.text.trim() ? a.text.trim().slice(0, 100) : null;

    const { total, reviews } = queryReviews(db, {
      propertyId: hotel,
      from: period?.current.from ?? null,
      to: period?.current.to ?? null,
      sentiment,
      topic,
      polarity: topic ? mentions : null,
      q: text,
      sort: sort === 'worst' ? 'lowest' : sort === 'best' ? 'highest' : 'newest',
      limit,
    });
    return {
      period: period ? periodInfo(period) : 'all dates',
      total_matching: total,
      showing: reviews.length,
      reviews: reviews.map((r) => ({
        review_id: r.id,
        hotel: hotelName(r.propertyId),
        date: r.reviewedDate,
        score_out_of_10: r.score,
        title: r.title,
        liked: clip(r.positiveText),
        did_not_like: clip(r.negativeText),
        complaints: r.topics.filter((t) => t.polarity === 'complaint').map((t) => topicLabel(t.topic)),
        praise: r.topics.filter((t) => t.polarity === 'praise').map((t) => topicLabel(t.topic)),
        traveller_type: r.travellerType,
        room: r.roomType,
        hotel_reply: clip(r.hotelReply, 300),
      })),
    };
  },
};

const getWeeklyTrend: ToolDef = {
  definition: {
    type: 'function',
    name: 'get_weekly_trend',
    description: 'Week-by-week (Monday to Sunday, Sydney time) review counts and average rating, newest week last, for spotting changes over time.',
    strict: true,
    parameters: strictObject({
      hotel: hotelParam,
      weeks: { type: ['integer', 'null'], description: 'How many recent weeks, 1–52. Default 12.' },
    }),
  },
  run(a, { db, today }) {
    const hotel = hotelArg(a);
    const weeks = Math.min(52, Math.max(1, typeof a.weeks === 'number' && Number.isFinite(a.weeks) ? Math.round(a.weeks) : 12));
    const period = resolvePeriod('custom', today, { from: addDays(today, -(weeks * 7 - 1)), to: today });
    const t = buildTrends(db, period, hotel);
    return {
      hotel: hotel ? hotelName(hotel) : 'All hotels',
      weeks: t.weeks.slice(-weeks).map((w) => {
        const top = Object.entries(w.complaintsByTopic).sort((x, y) => (y[1] ?? 0) - (x[1] ?? 0))[0];
        return {
          week_starting: w.weekStart,
          reviews: w.count,
          average_rating: w.avgScore,
          good: w.positive,
          okay: w.neutral,
          bad: w.negative,
          top_complaint: top ? topicLabel(top[0]) : null,
        };
      }),
    };
  },
};

const getBookingScores: ToolDef = {
  definition: {
    type: 'function',
    name: 'get_booking_scores',
    description:
      "Booking.com's own all-time scores per area (staff, cleanliness, comfort, facilities, value, location, wifi) for each hotel, compared with the range for similar Sydney hotels. Built from every review on Booking.com, so it is the most reliable data available.",
    strict: true,
    parameters: strictObject({ hotel: hotelParam }),
  },
  run(a, { db }) {
    const hotel = hotelArg(a);
    const snaps = latestSnapshots(db);
    return PROPERTIES.filter((p) => !hotel || p.id === hotel).map((p) => {
      const snap = snaps.get(p.id);
      return {
        hotel: p.name,
        overall_score: snap?.overallScore ?? null,
        total_reviews_on_booking_com: snap?.reviewCount ?? null,
        checked_at: snap?.capturedAt ?? null,
        areas: (snap?.categories ?? []).map((c) => ({
          area: c.label,
          score: c.score,
          similar_sydney_hotels: c.cityLow !== null && c.cityHigh !== null ? `${c.cityLow}–${c.cityHigh}` : null,
          standing:
            c.cityLow !== null && c.score < c.cityLow
              ? 'lower than similar hotels'
              : c.cityHigh !== null && c.score > c.cityHigh
                ? 'better than similar hotels'
                : 'similar to other hotels',
        })),
      };
    });
  },
};

const getDataStatus: ToolDef = {
  definition: {
    type: 'function',
    name: 'get_data_status',
    description: 'How complete the review data is, when it was last updated, and its known limits. Use when asked about data, freshness or reliability.',
    strict: true,
    parameters: strictObject({}),
  },
  run(_a, { db }) {
    const h = healthReport(db, false);
    const lastRun = h.runs[0];
    return {
      last_update: lastRun ? { at: lastRun.finishedAt ?? lastRun.startedAt, result: lastRun.status } : null,
      hotels: h.coverage.map((c) => ({
        hotel: c.name,
        reviews_collected: c.collected,
        reviews_on_booking_com: c.bookingReviewCount,
        oldest_review: c.oldestReview,
        newest_review: c.newestReview,
      })),
      limits: [
        "Booking.com blocks automated tools from its full review list, so only the reviews it features on each hotel's page are collected. It picks those from high scores, so averages here look better than Booking.com's real overall scores.",
        'Topics come from keyword rules on what guests liked and did not like; they can miss sarcasm or unusual wording.',
        'Non-English reviews keep their score but are not sorted into topics.',
      ],
    };
  },
};

export const TOOLS: ToolDef[] = [getOverview, searchReviews, getWeeklyTrend, getBookingScores, getDataStatus];

/** Runs a tool call from the model. Bad arguments come back as an error message the model can correct. */
export function runTool(name: string, rawArgs: string, ctx: ToolContext): unknown {
  const tool = TOOLS.find((t) => t.definition.name === name);
  if (!tool) return { error: `Unknown tool "${name}".` };
  let args: Args;
  try {
    const parsed: unknown = JSON.parse(rawArgs || '{}');
    args = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Args) : {};
  } catch {
    return { error: 'Arguments were not valid JSON.' };
  }
  try {
    return tool.run(args, ctx);
  } catch (err) {
    if (err instanceof ToolInputError) return { error: err.message };
    throw err;
  }
}
