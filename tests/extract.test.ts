import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ExtractionError, humanizeEnum, parsePropertyPage, parseReviewListResponse, toIsoInstant } from '../src/collector/extract.js';

// Real page data captured from Booking.com, trimmed and with guest names replaced.
const apollo = JSON.parse(readFileSync('tests/fixtures/property-page.apollo.json', 'utf8'));
// Real response Booking.com returned to the automated browser for the full review list.
const blocked = JSON.parse(readFileSync('tests/fixtures/review-list.blocked.json', 'utf8'));

describe('parsePropertyPage', () => {
  const page = parsePropertyPage(apollo, 'olympic-paddington');

  it('reads property identity and headline score', () => {
    expect(page.hotelId).toBe(16211291);
    expect(page.address).toContain('Moore Park Road');
    expect(page.overallScore).toBe(6.4);
    expect(page.reviewCount).toBe(129);
  });

  it('reads category scores with the city benchmark range', () => {
    const clean = page.categories.find((c) => c.key === 'hotel_clean');
    expect(clean).toMatchObject({ label: 'Cleanliness', score: 6.8 });
    expect(clean!.cityLow).toBeLessThan(clean!.cityHigh!);
  });

  it('maps featured reviews to our shape with stable ids', () => {
    expect(page.featured).toHaveLength(3);
    const first = page.featured[0];
    expect(first.id).toMatch(/^bkg:[0-9a-f]+$/);
    expect(first).toMatchObject({ source: 'featured', score: 10, guestName: 'Guest A', guestCountry: 'AU', travellerType: 'Solo traveller', tripPurpose: 'Business' });
    expect(first.reviewedAt).toBe('2026-11-04T10:44:11.000Z'); // completed: 1793789051
    expect(first.roomType).toContain('Double Room');
  });

  it('reads the hotel photos, main photo first, as https links', () => {
    expect(page.photos.length).toBe(3);
    expect(page.photos[0].alt).toContain('Olympic Paddington');
    for (const p of page.photos) {
      expect(p.url).toMatch(/^https:\/\/cf\.bstatic\.com\/.*max1024x768/);
      expect(p.thumbUrl).toMatch(/max500/);
    }
  });

  it("notices Booking.com's bot flag", () => {
    expect(page.flaggedAsRobot).toBe(true);
  });

  it('fails loudly when the page data is unrecognisable', () => {
    expect(() => parsePropertyPage({ foo: {} }, 'x')).toThrow(ExtractionError);
  });

  it('degrades with warnings when optional parts are missing', () => {
    const partial = parsePropertyPage({ ROOT_QUERY: { __typename: 'Query' } }, 'x');
    expect(partial.featured).toEqual([]);
    expect(partial.warnings.length).toBeGreaterThan(0);
  });
});

describe('parseReviewListResponse', () => {
  it('reports a refused request', () => {
    expect(parseReviewListResponse(blocked, 'x')).toEqual({ ok: false, statusCode: 400, message: 'Request not supported' });
  });

  it('maps review cards (illustrative response, see note in extract.ts)', () => {
    const res = parseReviewListResponse(
      {
        data: {
          reviewListFrontend: {
            __typename: 'ReviewListFrontendResult',
            reviewsCount: 2,
            reviewCard: [
              {
                reviewUrl: 'abc123',
                reviewScore: 4,
                reviewedDate: 1795000000,
                guestDetails: { username: 'Sam', countryName: 'Australia', guestTypeTranslation: 'Couple', anonymous: false },
                bookingDetails: { checkinDate: '2026-11-10', numNights: 2, roomType: { name: 'Double Room' } },
                textDetails: { title: 'Disappointing', positiveText: 'Location', negativeText: 'Dirty bathroom', lang: 'en' },
                partnerReply: { reply: 'Sorry to hear this.' },
              },
              { reviewScore: 9 },
            ],
          },
        },
      },
      'potts-point',
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.skipped).toBe(1); // the card without an id is skipped, not guessed
    expect(res.reviews[0]).toMatchObject({ id: 'bkg:abc123', score: 4, stayMonth: '2026-11', nights: 2, hotelReply: 'Sorry to hear this.' });
  });
});

describe('helpers', () => {
  it('humanises Booking enums', () => {
    expect(humanizeEnum('FAMILY_WITH_YOUNG_CHILDREN')).toBe('Family with young children');
    expect(humanizeEnum('NOT_SET')).toBeNull();
  });
  it('accepts seconds, milliseconds and ISO strings', () => {
    expect(toIsoInstant(1795000000)).toBe(toIsoInstant(1795000000000));
    expect(toIsoInstant('2026-11-01T00:00:00Z')).toBe('2026-11-01T00:00:00.000Z');
    expect(toIsoInstant('garbage')).toBeNull();
  });
});
