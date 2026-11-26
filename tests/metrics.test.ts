import { describe, expect, it } from 'vitest';
import { benchmarkInsight, buildInsights, periodStats, topicStats, weeklyTrend } from '../src/insights/metrics.js';
import { sentimentForScore, type TopicId } from '../src/shared/topics.js';
import type { Review, TopicMention } from '../src/shared/types.js';

let n = 0;
function review(score: number, date: string, complaints: TopicId[] = [], praise: TopicId[] = []): Review {
  const topics: TopicMention[] = [
    ...complaints.map((topic) => ({ topic, polarity: 'complaint' as const, terms: [topic] })),
    ...praise.map((topic) => ({ topic, polarity: 'praise' as const, terms: [topic] })),
  ];
  return {
    id: `r${n++}`,
    propertyId: 'potts-point',
    source: 'review_list',
    score,
    sentiment: sentimentForScore(score),
    title: null,
    positiveText: 'x',
    negativeText: 'y',
    language: 'en',
    reviewedAt: `${date}T01:00:00Z`,
    reviewedDate: date,
    stayMonth: null,
    nights: null,
    roomType: null,
    travellerType: null,
    tripPurpose: null,
    guestName: null,
    guestCountry: null,
    hotelReply: null,
    textQuality: 'ok',
    topics,
    firstSeenAt: date,
  };
}

describe('periodStats', () => {
  it('averages and buckets by score band', () => {
    expect(periodStats([review(10, '2026-11-23'), review(7, '2026-11-24'), review(3, '2026-11-25')])).toEqual({
      count: 3,
      avgScore: 6.7,
      positive: 1,
      neutral: 1,
      negative: 1,
    });
    expect(periodStats([]).avgScore).toBeNull();
  });
});

describe('weeklyTrend', () => {
  it('fills empty weeks so gaps stay visible', () => {
    const weeks = weeklyTrend([review(8, '2026-11-02'), review(4, '2026-11-25', ['noise'])], '2026-11-02', '2026-11-26');
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-23']);
    expect(weeks[1].count).toBe(0);
    expect(weeks[3].complaintsByTopic).toEqual({ noise: 1 });
  });
});

describe('buildInsights', () => {
  const current = [
    review(3, '2026-11-24', ['cleanliness', 'noise']),
    review(4, '2026-11-24', ['cleanliness']),
    review(5, '2026-11-25', ['staff']),
    review(2, '2026-11-25', ['noise']),
    review(9, '2026-11-25', ['noise'], ['location']),
  ];
  const previous = [review(9, '2026-11-17', [], ['staff']), review(8, '2026-11-18')];
  const insights = buildInsights({
    current,
    previous,
    currentStats: periodStats(current),
    previousStats: periodStats(previous),
    topics: topicStats(current, previous),
    periodLabel: 'this week',
    previousLabel: 'last week',
    byProperty: [],
    lastReviewDate: '2026-11-25',
    scopeLabel: null,
  });
  const texts = insights.map((i) => i.text);

  it('reports the rating change with the comparison value', () => {
    expect(texts[0]).toBe('Average rating this week: 4.6 out of 10 from 5 reviews, down from 8.5 last week.');
  });

  it('states what share of negative reviews mention the top issue, with counts', () => {
    // 4 negative reviews: cleanliness in 2, noise in 2; ties resolve to taxonomy order
    expect(texts).toContain('50% of bad reviews this week mention cleanliness (2 of 4).');
  });

  it('flags issues that are growing', () => {
    expect(insights.find((i) => i.kind === 'rising_issue' && i.topic === 'noise')?.text).toBe('More noise complaints: 3 this week, up from 0 last week.');
  });

  it('warns when the sample is small', () => {
    expect(insights.some((i) => i.kind === 'low_sample')).toBe(false);
    const tiny = buildInsights({
      current: [review(9, '2026-11-25')],
      previous: [],
      currentStats: periodStats([review(9, '2026-11-25')]),
      previousStats: periodStats([]),
      topics: topicStats([review(9, '2026-11-25')], []),
      periodLabel: 'this week',
      previousLabel: 'last week',
      byProperty: [],
      lastReviewDate: null,
      scopeLabel: null,
    });
    expect(tiny.some((i) => i.kind === 'low_sample')).toBe(true);
  });

  it('says so when there are no reviews', () => {
    const none = buildInsights({
      current: [],
      previous: [],
      currentStats: periodStats([]),
      previousStats: periodStats([]),
      topics: topicStats([], []),
      periodLabel: 'this week',
      previousLabel: 'last week',
      byProperty: [],
      lastReviewDate: '2026-11-20',
      scopeLabel: 'Potts Point',
    });
    expect(none).toEqual([{ kind: 'no_data', tone: 'neutral', text: 'No reviews at Potts Point this week yet. The latest review is from 20 Nov 2026.' }]);
  });
});

describe('benchmarkInsight', () => {
  const cat = (label: string, score: number) => ({ key: label, label, score, cityLow: 7, cityHigh: 9 });
  it('separates categories below range everywhere from those below at some properties', () => {
    const i = benchmarkInsight([
      { name: 'A', categories: [cat('Cleanliness', 6.5), cat('Staff', 6.9)] },
      { name: 'B', categories: [cat('Cleanliness', 6.8), cat('Staff', 8)] },
    ]);
    expect(i?.text).toBe('Booking.com scores all 2 hotels lower than similar Sydney hotels for cleanliness (and some hotels for staff).');
  });
  it('names the categories for a single property', () => {
    expect(benchmarkInsight([{ name: 'A', categories: [cat('Facilities', 6), cat('Location', 8)] }])?.text).toBe('Booking.com scores A lower than similar Sydney hotels for facilities.');
  });
});
