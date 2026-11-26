import { getProperty } from '../../shared/properties';
import type { HealthResponse } from '../../shared/types';
import { fmtDateTime, fmtDay, fmtRelative } from '../lib/format';
import { Card, Empty, ErrorBox } from './ui';

const STATUS_TEXT = { ok: 'Worked', partial: 'Partly worked', failed: 'Failed', running: 'Running' } as const;

/** For managers and IT: how complete the data is and whether collection is working. */
export function DataStatus({
  health,
  onBack,
}: {
  health: { data: HealthResponse | null; error: string | null; loading: boolean; reload: () => void };
  onBack: () => void;
}) {
  if (health.error && !health.data) return <ErrorBox message={health.error} onRetry={health.reload} />;
  const h = health.data;
  if (!h) return <Empty title="Loading…" />;
  const q = h.quality;

  return (
    <div className={`page${health.loading ? ' is-loading' : ''}`}>
      <div className="page-head">
        <div>
          <h1>Data status</h1>
          <p className="muted">Where the numbers come from, and whether collecting them is working. Mainly useful for managers and IT.</p>
        </div>
        <button className="btn" onClick={onBack}>
          ← Back to summary
        </button>
      </div>

      <Card title="How many reviews we have">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Hotel</th>
                <th className="num">We have</th>
                <th className="num">On Booking.com</th>
                <th>Oldest – newest review</th>
                <th>Last checked</th>
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
                  <td>{c.oldestReview && c.newestReview ? `${fmtDay(c.oldestReview)} – ${fmtDay(c.newestReview)}` : '–'}</td>
                  <td>{fmtRelative(c.lastSuccessAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Data checks" subtitle="Every review is checked before it's counted.">
        <div className="checks">
          {[
            [q.total, 'reviews stored', 'Each review is saved once, however many times we see it.'],
            [q.noText, 'with a score only', 'Counted in ratings, not in topics.'],
            [q.nonEnglish, 'not in English', 'Counted in ratings, not in topics.'],
            [q.misplacedPraise, 'praise in the “didn’t like” box', 'Counted as praise, not a complaint.'],
            [q.possibleDuplicates, 'possible duplicates', 'Same words, score and date twice.'],
          ].map(([n, label, note]) => (
            <div className="check" key={label as string}>
              <span className="check-num">{n}</span>
              <span className="check-label">{label}</span>
              <span className="check-note">{note}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card title="Recent updates" subtitle={h.collecting ? 'Getting the latest reviews right now…' : 'Each update visits every hotel’s Booking.com page.'}>
        {h.runs.length === 0 ? (
          <Empty title="No updates on this computer yet">Press “Get latest reviews” at the top of the page.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Hotel</th>
                  <th>Result</th>
                  <th className="num">New reviews</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {h.runs.flatMap((run) =>
                  run.items.map((item, i) => (
                    <tr key={`${run.id}-${item.propertyId}`}>
                      <td className="nowrap">{i === 0 ? fmtDateTime(run.startedAt) : ''}</td>
                      <td>{getProperty(item.propertyId)?.name ?? item.propertyId}</td>
                      <td>
                        <span className={`status status-${item.status}`}>{STATUS_TEXT[item.status]}</span>
                      </td>
                      <td className="num">{item.reviewsNew}</td>
                      <td className="small muted">
                        {item.status === 'failed'
                          ? item.error
                          : item.fullListStatus?.startsWith('blocked')
                            ? 'Page read. Full review list blocked by Booking.com.'
                            : item.fullListStatus}
                        {item.attempts > 1 ? ` (took ${item.attempts} tries)` : ''}
                        {item.reviewsRejected > 0 ? ` · ${item.reviewsRejected} failed checks` : ''}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="How it works">
        <div className="prose">
          <p>
            Booking.com doesn't offer a way to download reviews, so this tool opens each hotel's public Booking.com page in an automated web browser (just like a guest
            would) and reads the reviews and scores shown there.
          </p>
          <p>
            <strong>The catch:</strong> Booking.com recognises automated browsers and blocks the full list of reviews. We can only see the few reviews Booking.com
            features on each hotel's page, and it chooses those from high scores. Every update tries the full list again, so this page will show when that changes.
          </p>
          <p>
            <strong>For complete data</strong>, the best option is an export of reviews from the hotel's own Booking.com account (the Extranet), which this tool can be
            extended to read.
          </p>
        </div>
      </Card>
    </div>
  );
}
