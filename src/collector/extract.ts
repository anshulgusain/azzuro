import type { CategoryScore } from '../shared/types.js';

/**
 * Pure functions that turn what Booking.com serves into our raw review shape.
 *
 * The property page embeds an Apollo GraphQL cache as JSON
 * (<script data-capla-store-data="apollo">). It is far more stable than the
 * rendered HTML (whose CSS classes are hashed and change between deploys), so
 * we read entities by their `__typename` rather than by fixed paths. If
 * Booking moves an entity around, the lookup still finds it.
 */

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Entity = { [k: string]: Json };
type Cache = Record<string, Entity>;

/** Raw, unvalidated review in our field names. Validated by ReviewInputSchema before storage. */
export interface RawReview {
  id: string;
  propertyId: string;
  source: 'featured' | 'review_list';
  bookingReviewId: string | null;
  score: number | null;
  title: string | null;
  positiveText: string | null;
  negativeText: string | null;
  language: string | null;
  reviewedAt: string | null;
  stayMonth: string | null;
  nights: number | null;
  roomType: string | null;
  travellerType: string | null;
  tripPurpose: string | null;
  guestName: string | null;
  guestCountry: string | null;
  hotelReply: string | null;
}

export interface ParsedPropertyPage {
  hotelId: number | null;
  name: string | null;
  address: string | null;
  overallScore: number | null;
  reviewCount: number | null;
  categories: CategoryScore[];
  featured: RawReview[];
  /** Booking.com's own bot flag for this page view, when present. */
  flaggedAsRobot: boolean;
  warnings: string[];
}

export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExtractionError';
  }
}

const isObj = (v: unknown): v is Entity => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function deref(cache: Cache, v: unknown): Entity | null {
  if (isObj(v) && typeof v.__ref === 'string') return cache[v.__ref] ?? null;
  return isObj(v) ? v : null;
}

function entitiesOfType(cache: Cache, typename: string): Entity[] {
  return Object.values(cache).filter((e) => isObj(e) && e.__typename === typename);
}

/** SOLO_TRAVELLER -> "Solo traveller" */
export function humanizeEnum(v: unknown): string | null {
  const s = str(v);
  if (!s || s === 'NOT_SET' || s === 'UNKNOWN') return null;
  const words = s.toLowerCase().split('_').filter(Boolean);
  if (!words.length) return null;
  return words.join(' ').replace(/^./, (c) => c.toUpperCase());
}

/** Unix seconds, milliseconds or an ISO string -> ISO instant. */
export function toIsoInstant(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    const ms = v < 1e12 ? v * 1000 : v;
    return new Date(ms).toISOString();
  }
  if (typeof v === 'string' && v.trim()) {
    if (/^\d+$/.test(v)) return toIsoInstant(Number(v));
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }
  return null;
}

function reviewKey(reviewUrl: unknown, numericId: unknown): string | null {
  const url = str(reviewUrl);
  if (url) return `bkg:${url}`;
  if (num(numericId) !== null || str(numericId)) return `bkg-id:${String(numericId)}`;
  return null;
}

export function mergeApolloCaches(caches: unknown[]): Cache {
  const merged: Cache = {};
  for (const c of caches) {
    if (!isObj(c)) continue;
    for (const [k, v] of Object.entries(c)) {
      if (!isObj(v)) continue;
      merged[k] = isObj(merged[k]) ? { ...merged[k], ...v } : v;
    }
  }
  return merged;
}

export function parsePropertyPage(cacheInput: unknown, propertyId: string): ParsedPropertyPage {
  if (!isObj(cacheInput)) throw new ExtractionError('Embedded page data is not an object');
  const cache = cacheInput as Cache;
  const warnings: string[] = [];
  const root = cache.ROOT_QUERY;
  if (!isObj(root)) throw new ExtractionError('Embedded page data has no ROOT_QUERY (page structure changed?)');

  // Property identity
  const basic = entitiesOfType(cache, 'BasicPropertyData')[0];
  const location = basic ? deref(cache, basic.location) : null;
  const hotelId = num(basic?.id);
  if (!basic) warnings.push('BasicPropertyData not found; property metadata unavailable');

  // Headline score and review count
  const propertyReview = entitiesOfType(cache, 'PropertyReview')[0];
  const totalScore = propertyReview ? deref(cache, propertyReview.totalScore) : null;
  let overallScore = num(totalScore?.score) ?? num(totalScore?.scoreOutOf10);
  let reviewCount = num(totalScore?.reviewsCount);

  // Category scores (Staff, Cleanliness, ...) with Booking's city benchmark range.
  // Several reviewsFrontend(...) results can exist; take the one covering the most reviews.
  const frontends = Object.entries(root)
    .filter(([k]) => k.startsWith('reviewsFrontend('))
    .map(([, v]) => deref(cache, v))
    .filter((v): v is Entity => v !== null);
  let categories: CategoryScore[] = [];
  let bestCoverage = -1;
  for (const fe of frontends) {
    const scores = Array.isArray(fe.ratingScores) ? fe.ratingScores.map((s) => deref(cache, s)).filter(isObj) : [];
    const coverage = Math.max(0, ...scores.map((s) => num(s.count) ?? 0));
    if (scores.length && coverage > bestCoverage) {
      bestCoverage = coverage;
      categories = scores
        .map((s) => {
          const range = deref(cache, s.ufiScoresAverage);
          const score = num(s.value);
          const key = str(s.name);
          if (score === null || !key) return null;
          return {
            key,
            label: str(s.translation) ?? humanizeEnum(key.replace(/^hotel_/, '')) ?? key,
            score: Math.round(score * 10) / 10,
            cityLow: num(range?.ufiScoreLowerBound) !== null ? Math.round(num(range?.ufiScoreLowerBound)! * 10) / 10 : null,
            cityHigh: num(range?.ufiScoreHigherBound) !== null ? Math.round(num(range?.ufiScoreHigherBound)! * 10) / 10 : null,
          };
        })
        .filter((c): c is CategoryScore => c !== null);
    }
    reviewCount ??= num(fe.reviewsCount);
  }
  if (!categories.length) warnings.push('Category scores not found');
  if (overallScore === null) warnings.push('Overall review score not found');

  // Featured reviews. Prefer the order Booking lists them in, fall back to every entity of the type.
  const featuredEntities: Entity[] =
    propertyReview && Array.isArray(propertyReview.featuredReviews)
      ? propertyReview.featuredReviews.map((r) => deref(cache, r)).filter(isObj)
      : entitiesOfType(cache, 'FeaturedReview');
  const featured = featuredEntities
    .map((r) => featuredToRaw(cache, r, propertyId))
    .filter((r): r is RawReview => r !== null);
  if (!featured.length && (reviewCount ?? 0) > 0) warnings.push('Property has reviews but no featured reviews were found');

  const flaggedAsRobot = Object.keys(root).some((k) => k.includes('"isRobot":true'));

  return {
    hotelId,
    name: str(basic?.name),
    address: str(location?.formattedAddress),
    overallScore,
    reviewCount,
    categories,
    featured,
    flaggedAsRobot,
    warnings,
  };
}

function featuredToRaw(cache: Cache, r: Entity, propertyId: string): RawReview | null {
  const id = reviewKey(r.reviewUrl, r.id);
  if (!id) return null;
  const room = deref(cache, r.roomType);
  const anonymous = r.isAnonymous === true;
  return {
    id,
    propertyId,
    source: 'featured',
    bookingReviewId: r.id !== undefined && r.id !== null ? String(r.id) : null,
    score: num(r.averageScore),
    title: str(r.title),
    positiveText: str(r.positiveText),
    negativeText: str(r.negativeText),
    language: str(r.language),
    reviewedAt: toIsoInstant(r.completed),
    stayMonth: null,
    nights: null,
    roomType: str(room?.name),
    travellerType: humanizeEnum(r.customerType),
    tripPurpose: humanizeEnum(r.purposeType),
    guestName: anonymous ? null : str(r.guestName),
    guestCountry: str(r.guestCountryCode)?.toUpperCase() ?? null,
    hotelReply: null,
  };
}

/* ------------------------------------------------------------------ */
/* Full review list (ReviewList GraphQL operation)                      */
/* ------------------------------------------------------------------ */

export type ReviewListPage =
  | { ok: true; total: number | null; reviews: RawReview[]; skipped: number }
  | { ok: false; statusCode: number | null; message: string };

/**
 * Parses a response of the site's own `ReviewList` GraphQL operation.
 *
 * NOTE: during development Booking.com answered this operation with
 * `ReviewsFrontendError` for automated browsers, so the success branch is
 * written against the field names the site's review cards use publicly and
 * is deliberately tolerant: unknown shapes are reported, not guessed.
 */
export function parseReviewListResponse(body: unknown, propertyId: string): ReviewListPage {
  const data = isObj(body) && isObj(body.data) ? body.data : null;
  const result = data && isObj(data.reviewListFrontend) ? data.reviewListFrontend : null;
  if (!result) {
    const errs = isObj(body) && Array.isArray(body.errors) ? body.errors : [];
    const msg = errs.map((e) => (isObj(e) ? str(e.message) : null)).filter(Boolean).join('; ');
    return { ok: false, statusCode: null, message: msg || 'Response has no reviewListFrontend field' };
  }
  if (result.__typename === 'ReviewsFrontendError' || (num(result.statusCode) ?? 200) >= 400) {
    return { ok: false, statusCode: num(result.statusCode), message: str(result.message) ?? 'Unknown review list error' };
  }
  const cards = Array.isArray(result.reviewCard) ? result.reviewCard : Array.isArray(result.reviewCards) ? result.reviewCards : null;
  if (!cards) return { ok: false, statusCode: null, message: 'Review list response has no review cards field (format changed?)' };

  const reviews: RawReview[] = [];
  let skipped = 0;
  for (const c of cards) {
    const raw = isObj(c) ? reviewCardToRaw(c, propertyId) : null;
    if (raw) reviews.push(raw);
    else skipped++;
  }
  return { ok: true, total: num(result.reviewsCount), reviews, skipped };
}

function reviewCardToRaw(c: Entity, propertyId: string): RawReview | null {
  const id = reviewKey(c.reviewUrl, c.id);
  if (!id) return null;
  const guest = isObj(c.guestDetails) ? c.guestDetails : {};
  const booking = isObj(c.bookingDetails) ? c.bookingDetails : {};
  const text = isObj(c.textDetails) ? c.textDetails : {};
  const room = isObj(booking.roomType) ? booking.roomType : {};
  const reply = isObj(c.partnerReply) ? c.partnerReply : {};
  const checkin = str(booking.checkinDate) ?? str(booking.checkoutDate);
  return {
    id,
    propertyId,
    source: 'review_list',
    bookingReviewId: str(c.reviewUrl) ?? (c.id != null ? String(c.id) : null),
    score: num(c.reviewScore),
    title: str(text.title),
    positiveText: str(text.positiveText),
    negativeText: str(text.negativeText),
    language: str(text.lang),
    reviewedAt: toIsoInstant(c.reviewedDate),
    stayMonth: checkin && /^\d{4}-\d{2}/.test(checkin) ? checkin.slice(0, 7) : null,
    nights: num(booking.numNights),
    roomType: str(room.name),
    travellerType: str(guest.guestTypeTranslation) ?? humanizeEnum(booking.customerType),
    tripPurpose: null,
    guestName: guest.anonymous === true ? null : str(guest.username),
    guestCountry: str(guest.countryName) ?? str(guest.countryCode)?.toUpperCase() ?? null,
    hotelReply: str(reply.reply),
  };
}
