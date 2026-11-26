import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/database.js';
import { healthReport, queryReviews, upsertReview } from '../src/db/repository.js';
import { validateReviewInput, type ReviewInput } from '../src/db/reviewInput.js';

const base = {
  id: 'bkg:aaa111',
  propertyId: 'potts-point',
  source: 'featured',
  bookingReviewId: '1',
  score: 9,
  title: 'Great',
  positiveText: 'Friendly staff and great location',
  negativeText: 'Room was a bit noisy',
  language: 'en',
  reviewedAt: '2026-11-20T03:00:00Z',
};

function input(overrides: Record<string, unknown> = {}): ReviewInput {
  const v = validateReviewInput({ ...base, ...overrides });
  if (!v.ok) throw new Error(v.error);
  return v.value;
}

describe('repository', () => {
  let db: Db;
  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('does not duplicate a review seen twice', () => {
    expect(upsertReview(db, input(), '2026-11-21T00:00:00Z')).toBe('new');
    expect(upsertReview(db, input(), '2026-11-22T00:00:00Z')).toBe('unchanged');
    expect(queryReviews(db, {}).total).toBe(1);
  });

  it('records edits and reclassifies them', () => {
    upsertReview(db, input(), '2026-11-21T00:00:00Z');
    expect(upsertReview(db, input({ negativeText: 'Bathroom was dirty' }), '2026-11-22T00:00:00Z')).toBe('updated');
    const [r] = queryReviews(db, {}).reviews;
    expect(r.topics.map((t) => `${t.topic}:${t.polarity}`).sort()).toContain('cleanliness:complaint');
    expect(r.topics.map((t) => t.topic)).not.toContain('noise');
  });

  it('merges a richer copy without losing data the poorer copy lacks', () => {
    upsertReview(db, input({ source: 'review_list', roomType: 'Double Room', hotelReply: 'Thanks!' }), '2026-11-21T00:00:00Z');
    upsertReview(db, input({ source: 'featured' }), '2026-11-22T00:00:00Z');
    const [r] = queryReviews(db, {}).reviews;
    expect(r.source).toBe('review_list');
    expect(r.roomType).toBe('Double Room');
    expect(r.hotelReply).toBe('Thanks!');
  });

  it('stores the Sydney calendar date', () => {
    upsertReview(db, input({ reviewedAt: '2026-11-22T14:30:00Z' }), '2026-11-23T00:00:00Z');
    expect(queryReviews(db, {}).reviews[0].reviewedDate).toBe('2026-11-23');
  });

  it('filters by sentiment, topic and free text', () => {
    upsertReview(db, input(), 'now');
    upsertReview(db, input({ id: 'bkg:bbb222', score: 3, negativeText: 'Dirty sheets' }), 'now');
    expect(queryReviews(db, { sentiment: 'negative' }).total).toBe(1);
    expect(queryReviews(db, { topic: 'cleanliness', polarity: 'complaint' }).total).toBe(1);
    expect(queryReviews(db, { q: 'sheets' }).total).toBe(1);
    expect(queryReviews(db, { q: '100%_' }).total).toBe(0);
  });

  it('flags possible duplicates with different ids', () => {
    upsertReview(db, input(), 'now');
    upsertReview(db, input({ id: 'bkg-id:999' }), 'now');
    expect(healthReport(db, false).quality.possibleDuplicates).toBe(1);
  });
});

describe('validateReviewInput', () => {
  it('rejects impossible scores, dates and unknown properties', () => {
    expect(validateReviewInput({ ...base, score: 11 }).ok).toBe(false);
    expect(validateReviewInput({ ...base, reviewedAt: '2099-01-01T00:00:00Z' }).ok).toBe(false);
    expect(validateReviewInput({ ...base, propertyId: 'somewhere-else' }).ok).toBe(false);
  });
  it('normalises blank text to null', () => {
    const v = validateReviewInput({ ...base, negativeText: '   ' });
    expect(v.ok && v.value.negativeText).toBe(null);
  });
});
