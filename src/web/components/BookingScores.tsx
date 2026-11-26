import type { CategoryScore, PropertySummary } from '../../shared/types';
import { fmtScore } from '../lib/format';
import { Card, Empty } from './ui';

type Standing = 'below' | 'similar' | 'above';

function standing(c: CategoryScore): Standing {
  if (c.cityLow !== null && c.score < c.cityLow) return 'below';
  if (c.cityHigh !== null && c.score > c.cityHigh) return 'above';
  return 'similar';
}

const STANDING_TEXT: Record<Standing, string> = {
  below: 'Lower than others',
  similar: 'Similar to others',
  above: 'Better than others',
};
const STANDING_ICON: Record<Standing, string> = { below: '!', similar: '–', above: '✓' };
const ORDER: Record<Standing, number> = { below: 0, similar: 1, above: 2 };

/**
 * Booking.com's own scores per area (cleanliness, staff...), compared with
 * similar Sydney hotels. Built from every review, so this is the most
 * reliable part of the dashboard while only featured reviews are available.
 */
export function BookingScores({ hotels }: { hotels: PropertySummary[] }) {
  const withData = hotels.filter((h) => h.categories.length);
  return (
    <Card
      title="How Booking.com scores us"
      subtitle="Booking.com's scores for each area, from all reviews ever written, compared with similar hotels in Sydney. Areas that need work are listed first."
    >
      {withData.length === 0 ? (
        <Empty title="No scores yet">Press “Get latest reviews” at the top to fetch them.</Empty>
      ) : (
        <div className="score-grid">
          {withData.map((h) => {
            const cats = [...h.categories].sort((a, b) => ORDER[standing(a)] - ORDER[standing(b)] || a.score - b.score);
            return (
              <section key={h.id} className="score-hotel" aria-label={`${h.name} Booking.com scores`}>
                <h3>
                  {h.name}
                  <span className="score-overall">{fmtScore(h.bookingScore)} overall</span>
                </h3>
                <ul>
                  {cats.map((c) => {
                    const st = standing(c);
                    return (
                      <li key={c.key} className="score-row">
                        <span className="score-label">{c.label}</span>
                        <span className="score-value">{fmtScore(c.score)}</span>
                        <span
                          className={`tag tag-${st}`}
                          title={c.cityLow !== null && c.cityHigh !== null ? `Similar Sydney hotels score ${fmtScore(c.cityLow)} to ${fmtScore(c.cityHigh)}` : undefined}
                        >
                          <span aria-hidden="true">{STANDING_ICON[st]}</span> {STANDING_TEXT[st]}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </Card>
  );
}
