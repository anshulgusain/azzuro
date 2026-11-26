import type { IsoDate, ResolvedPeriod } from './dates.js';
import type { Sentiment, TopicId } from './topics.js';

/** How a review reached the database. */
export type ReviewSource = 'featured' | 'review_list' | 'import';

export type TopicPolarity = 'praise' | 'complaint';

export interface TopicMention {
  topic: TopicId;
  polarity: TopicPolarity;
  /** The words in the review that triggered the match, for transparency. */
  terms: string[];
}

/** Why a review's text was (or was not) used for topic insights. */
export type TextQuality =
  | 'ok'
  | 'no_text' // score only, no comments
  | 'non_english' // keyword classifier is English-only
  | 'misplaced_praise'; // praise written in the "disliked" box

export interface Review {
  id: string;
  propertyId: string;
  source: ReviewSource;
  score: number;
  sentiment: Sentiment;
  title: string | null;
  positiveText: string | null;
  negativeText: string | null;
  language: string | null;
  reviewedAt: string; // ISO instant
  reviewedDate: IsoDate; // Sydney calendar date
  stayMonth: string | null; // YYYY-MM
  nights: number | null;
  roomType: string | null;
  travellerType: string | null;
  tripPurpose: string | null;
  guestName: string | null;
  guestCountry: string | null;
  hotelReply: string | null;
  textQuality: TextQuality;
  topics: TopicMention[];
  firstSeenAt: string;
}

/** A hotel photo as published on its Booking.com page (links only; images are not copied). */
export interface HotelPhoto {
  url: string; // up to 1024x768
  thumbUrl: string; // up to 500px
  alt: string | null;
}

export interface PropertySummary {
  id: string;
  name: string;
  bookingUrl: string;
  /** Booking.com's own all-time score and count, from the latest snapshot. */
  bookingScore: number | null;
  bookingReviewCount: number | null;
  reviewsCollected: number;
  current: PeriodStats;
  previous: PeriodStats;
  topComplaint: { topic: TopicId; count: number } | null;
  categories: CategoryScore[];
  lastCollectedAt: string | null;
  photo: HotelPhoto | null;
}

export interface CategoryScore {
  key: string;
  label: string;
  score: number;
  /** Booking.com's range for comparable properties in the same city. */
  cityLow: number | null;
  cityHigh: number | null;
}

export interface PeriodStats {
  count: number;
  avgScore: number | null;
  positive: number;
  neutral: number;
  negative: number;
}

export interface TopicStat {
  topic: TopicId;
  complaints: number;
  praise: number;
  /** Complaints in the comparison period. */
  previousComplaints: number;
  /** Negative reviews (score 1–5) that complain about this topic. */
  negativeReviewsMentioning: number;
}

export interface Insight {
  kind: 'rating_change' | 'top_issue' | 'rising_issue' | 'property_watch' | 'praise' | 'low_sample' | 'no_data' | 'benchmark';
  tone: 'good' | 'bad' | 'neutral';
  text: string;
  topic?: TopicId;
  propertyId?: string;
}

export interface SummaryResponse {
  period: ResolvedPeriod;
  today: IsoDate;
  propertyFilter: string | null;
  current: PeriodStats;
  previous: PeriodStats;
  /** Reviews in the period whose text could be classified. */
  classifiableCount: number;
  negativeWithText: number;
  topics: TopicStat[];
  properties: PropertySummary[];
  insights: Insight[];
  lastReviewDate: IsoDate | null;
  /** How much of Booking.com's review base the figures are built on. */
  coverage: {
    collected: number;
    onBooking: number | null;
    /** True when no review came from the full list, only Booking's (high-rated) featured picks. */
    featuredOnly: boolean;
    /** Booking.com's own all-time scores for the properties in scope. */
    bookingScoreRange: [number, number] | null;
  };
}

export interface TrendPoint {
  weekStart: IsoDate;
  count: number;
  avgScore: number | null;
  positive: number;
  neutral: number;
  negative: number;
  complaintsByTopic: Partial<Record<TopicId, number>>;
}

export interface TrendsResponse {
  weeks: TrendPoint[];
}

export interface ReviewsResponse {
  total: number;
  page: number;
  pageSize: number;
  reviews: Review[];
}

export interface RunItem {
  propertyId: string;
  status: 'ok' | 'partial' | 'failed';
  method: string;
  reviewsSeen: number;
  reviewsNew: number;
  reviewsUpdated: number;
  reviewsRejected: number;
  fullListStatus: string | null;
  error: string | null;
  attempts: number;
  durationMs: number;
}

export interface CollectionRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: 'running' | 'ok' | 'partial' | 'failed';
  trigger: string;
  reviewsNew: number;
  reviewsUpdated: number;
  items: RunItem[];
}

export interface HealthResponse {
  runs: CollectionRun[];
  coverage: Array<{
    propertyId: string;
    name: string;
    collected: number;
    bookingReviewCount: number | null;
    bySource: Partial<Record<ReviewSource, number>>;
    lastSuccessAt: string | null;
    oldestReview: IsoDate | null;
    newestReview: IsoDate | null;
  }>;
  quality: {
    total: number;
    noText: number;
    nonEnglish: number;
    misplacedPraise: number;
    possibleDuplicates: number;
  };
  collecting: boolean;
}

export interface MetaResponse {
  properties: Array<{ id: string; name: string; bookingUrl: string; photo: HotelPhoto | null; photos: HotelPhoto[] }>;
  topics: Array<{ id: TopicId; label: string; description: string; terms: string[] }>;
  today: IsoDate;
  dataRange: { from: IsoDate | null; to: IsoDate | null };
  totalReviews: number;
  classifierVersion: string;
}
