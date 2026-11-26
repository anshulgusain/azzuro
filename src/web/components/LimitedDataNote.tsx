import { useState } from 'react';
import type { SummaryResponse } from '../../shared/types';
import { fmtScore } from '../lib/format';
import { Icon } from './ui';

/** One plain sentence about how complete the data is, with the detail one click away. */
export function LimitedDataNote({ coverage, onMore }: { coverage: SummaryResponse['coverage']; onMore: () => void }) {
  const [open, setOpen] = useState(false);
  const { collected, onBooking, featuredOnly, bookingScoreRange } = coverage;
  const share = onBooking ? collected / onBooking : null;
  if (!featuredOnly && (share === null || share >= 0.8)) return null;

  const real = bookingScoreRange
    ? bookingScoreRange[0] === bookingScoreRange[1]
      ? fmtScore(bookingScoreRange[0])
      : `${fmtScore(bookingScoreRange[0])} to ${fmtScore(bookingScoreRange[1])}`
    : null;

  return (
    <aside className="notice" role="note">
      <span className="notice-icon">
        <Icon name="warning" size={18} />
      </span>
      <div className="notice-body">
        <p>
          <strong>Limited data.</strong>{' '}
          {featuredOnly
            ? `Booking.com only shares its best reviews with this tool, so ratings here look higher than they really are.${real ? ` Booking.com's real overall score is ${real}.` : ''}`
            : `Only ${collected.toLocaleString()} of ${onBooking?.toLocaleString()} reviews have been collected so far.`}{' '}
          <button className="link" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Hide' : 'Why?'}
          </button>
        </p>
        {open && (
          <div className="notice-more">
            <p>
              We have {collected} of the {onBooking?.toLocaleString() ?? '?'} reviews on Booking.com. Booking.com blocks automated tools from reading the full list, so
              we can only see the handful of reviews it shows on each hotel's page, and it picks those from high scores.
            </p>
            <p>
              <strong>What you can trust:</strong> the complaints inside these reviews are real, and Booking.com's own scores for cleanliness, staff and so on (bottom of
              the Summary page) are based on every review. <strong>Be careful with:</strong> averages and counts, which will look better than reality.
            </p>
            <button className="link" onClick={onMore}>
              More about the data →
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
