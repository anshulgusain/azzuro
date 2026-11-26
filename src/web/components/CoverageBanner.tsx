import type { SummaryResponse } from '../../shared/types';
import { fmtScore, pct } from '../lib/format';

/**
 * Tells staff, in plain words, how complete the data is. Shown whenever the
 * figures are built on a small or biased slice of Booking.com's reviews.
 */
export function CoverageBanner({ coverage, onDetails }: { coverage: SummaryResponse['coverage']; onDetails: () => void }) {
  const { collected, onBooking, featuredOnly, bookingScoreRange } = coverage;
  const share = onBooking ? pct(collected, onBooking) : null;
  if (!featuredOnly && (share === null || share >= 80)) return null;

  const range = bookingScoreRange
    ? bookingScoreRange[0] === bookingScoreRange[1]
      ? fmtScore(bookingScoreRange[0])
      : `${fmtScore(bookingScoreRange[0])}–${fmtScore(bookingScoreRange[1])}`
    : null;

  return (
    <div className="banner" role="note">
      <span className="banner-icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>
          Partial data: {collected.toLocaleString()} of {onBooking?.toLocaleString() ?? '?'} Booking.com reviews{share !== null ? ` (${share < 1 ? '<1' : share}%)` : ''}
        </strong>
        {featuredOnly ? (
          <p>
            Booking.com currently only lets automated tools see the handful of reviews it features on each property page, and it picks those from high scores. Averages
            here will look better than reality{range ? `: Booking.com's own overall score is ${range}` : ''}. Complaints and topics are still real, but treat them as
            examples, not totals.{' '}
            <button className="btn-link" onClick={onDetails}>
              How data is collected
            </button>
          </p>
        ) : (
          <p>
            Older reviews have not been collected yet, so long periods may be incomplete.{' '}
            <button className="btn-link" onClick={onDetails}>
              See coverage
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
