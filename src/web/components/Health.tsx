import { getProperty } from '../../shared/properties';
import type { HealthResponse } from '../../shared/types';
import { fmtDateTime, fmtDay, fmtRelative, pct } from '../lib/format';
import { Card, Empty, ErrorBox } from './ui';

const STATUS_LABEL = { ok: 'Complete', partial: 'Partial', failed: 'Failed', running: 'Running' } as const;

export function Health({ health }: { health: { data: HealthResponse | null; error: string | null; loading: boolean; reload: () => void } }) {
  if (health.error && !health.data) return <ErrorBox message={health.error} onRetry={health.reload} />;
  const h = health.data;
  if (!h) return <Empty title="Loading…" />;
  const q = h.quality;

  return (
    <div className="stack">
      <Card title="Coverage by property" subtitle="How many of each property's Booking.com reviews are in the dashboard." dim={health.loading}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th className="num">Collected</th>
                <th className="num">On Booking.com</th>
                <th className="num">Coverage</th>
                <th>Source</th>
                <th>Review dates</th>
                <th>Last successful check</th>
              </tr>
            </thead>
            <tbody>
              {h.coverage.map((c) => (
                <tr key={c.propertyId}>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td className="num">{c.collected}</td>
                  <td className="num">{c.bookingReviewCount?.toLocaleString() ?? '–'}</td>
                  <td className="num">{c.bookingReviewCount ? `${pct(c.collected, c.bookingReviewCount) || '<1'}%` : '–'}</td>
                  <td className="small">
                    {Object.entries(c.bySource)
                      .map(([src, n]) => `${n} ${src === 'featured' ? 'featured' : src === 'review_list' ? 'full list' : 'imported'}`)
                      .join(', ') || '–'}
                  </td>
                  <td className="small">{c.oldestReview && c.newestReview ? `${fmtDay(c.oldestReview)} – ${fmtDay(c.newestReview)}` : '–'}</td>
                  <td className="small">{fmtRelative(c.lastSuccessAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="kpis">
        {[
          ['Reviews stored', q.total, 'Each Booking.com review is stored once, however often it is seen.'],
          ['Score only, no comments', q.noText, 'Counted in ratings, not in topics.'],
          ['Not in English', q.nonEnglish, 'Counted in ratings, no topic tags.'],
          ['Praise in “disliked” box', q.misplacedPraise, 'Counted as praise, not complaints.'],
          ['Possible duplicates', q.possibleDuplicates, 'Same text, score and date under different ids.'],
        ].map(([label, value, foot]) => (
          <div className="tile" key={label as string}>
            <div className="tile-label">{label}</div>
            <div className="tile-value">{value}</div>
            <div className="tile-foot">{foot}</div>
          </div>
        ))}
      </div>

      <Card title="Recent collection runs" subtitle={h.collecting ? 'A collection is running now…' : 'Each run checks every property page on Booking.com.'} dim={health.loading}>
        {h.runs.length === 0 ? (
          <Empty title="No collections yet">Use “Refresh data” at the top, or run npm run collect.</Empty>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Started</th>
                  <th>Result</th>
                  <th>Property</th>
                  <th className="num">New</th>
                  <th className="num">Updated</th>
                  <th>Full review list</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {h.runs.flatMap((run) =>
                  (run.items.length ? run.items : [null]).map((item, i) => (
                    <tr key={`${run.id}-${i}`}>
                      <td className="small">
                        {i === 0 && (
                          <>
                            {fmtDateTime(run.startedAt)}
                            <div className="muted">
                              #{run.id} · {run.trigger}
                            </div>
                          </>
                        )}
                      </td>
                      <td>
                        {item ? (
                          <span className={`status ${item.status}`}>{STATUS_LABEL[item.status]}</span>
                        ) : (
                          <span className={`status ${run.status}`}>{STATUS_LABEL[run.status]}</span>
                        )}
                      </td>
                      <td>{item ? (getProperty(item.propertyId)?.name ?? item.propertyId) : '–'}</td>
                      <td className="num">{item?.reviewsNew ?? '–'}</td>
                      <td className="num">{item?.reviewsUpdated ?? '–'}</td>
                      <td className="small">{item?.fullListStatus ?? '–'}</td>
                      <td className="small">
                        {item?.error ?? ''}
                        {item && item.attempts > 1 ? ` (${item.attempts} attempts)` : ''}
                        {item && item.reviewsRejected > 0 ? ` · ${item.reviewsRejected} rejected by validation` : ''}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="How reviews are collected">
        <div className="method">
          <p>
            Booking.com has no public review API, so the collector opens each property's public page in an automated Chrome browser, the same page a guest sees, and
            reads the review data embedded in it: Booking.com's overall score, category scores and the reviews it features. It then opens “Read all reviews” to try
            to page through the full list, newest first.
          </p>
          <p>
            <strong>Current limitation:</strong> Booking.com recognises the automated browser and refuses the full review list (shown as “blocked” above), so only the
            featured reviews are available. These are chosen by Booking.com from high-scoring reviews, which is why averages here run higher than Booking.com's own
            score. Every run tries the full list again and records the result, so this page shows immediately if that changes.
          </p>
          <p>
            Reviews are matched on Booking.com's own review id, so a review seen in many runs is stored once and updated if the guest edits it. Each run is
            retried up to three times on errors, and failures are logged here with a screenshot saved for the developer.
          </p>
        </div>
      </Card>
    </div>
  );
}
