import type { ReviewFilters } from '../App';
import { topicLabel } from '../../shared/topics';
import type { PropertySummary, SummaryResponse } from '../../shared/types';
import type { Scope } from '../lib/api';
import { fmtDay, fmtScore, pct } from '../lib/format';
import { CategoryScores } from './CategoryScores';
import { TrendCharts } from './TrendCharts';
import { Card, Delta, Empty, ErrorBox, Meter, ToneIcon } from './ui';

interface Props {
  summary: { data: SummaryResponse | null; error: string | null; loading: boolean; reload: () => void };
  scope: Scope;
  scopeKey: string;
  onProperty: (id: string) => void;
  onOpenReviews: (f: Partial<ReviewFilters>) => void;
}

export function Overview({ summary, scope, scopeKey, onProperty, onOpenReviews }: Props) {
  if (summary.error && !summary.data) return <ErrorBox message={summary.error} onRetry={summary.reload} />;
  const s = summary.data;
  if (!s) return <Empty title="Loading…" />;
  const dim = summary.loading;
  const prevLabel = s.period.previousLabel;

  return (
    <div className="stack">
      <Card title="What stands out" subtitle="Generated from the reviews in the selected period." dim={dim}>
        <ul className="insights">
          {s.insights.map((i, n) => (
            <li key={n}>
              <ToneIcon tone={i.tone} />
              <span>
                {i.text}{' '}
                {i.topic && (
                  <button
                    className="btn-link small"
                    onClick={() => onOpenReviews({ topic: i.topic, polarity: i.kind === 'praise' ? 'praise' : 'complaint' })}
                  >
                    Read these reviews
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <div className={`kpis${dim ? ' loading-dim' : ''}`}>
        <div className="tile">
          <div className="tile-label">Average rating</div>
          <div className="tile-value hero">
            {fmtScore(s.current.avgScore)}
            <small> / 10</small>
          </div>
          <div className="tile-foot">
            <Delta value={s.current.avgScore !== null && s.previous.avgScore !== null ? s.current.avgScore - s.previous.avgScore : null} /> vs {prevLabel} (
            {fmtScore(s.previous.avgScore)})
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Reviews</div>
          <div className="tile-value">{s.current.count}</div>
          <div className="tile-foot">
            {s.previous.count} {prevLabel}
            {s.period.inProgress ? ' · period still in progress' : ''}
          </div>
        </div>
        <div className="tile">
          <div className="tile-label">Negative reviews (score 1–5)</div>
          <div className="tile-value">
            {s.current.negative}
            <small> {s.current.count ? `${pct(s.current.negative, s.current.count)}%` : ''}</small>
          </div>
          <div className="tile-foot">
            {s.previous.negative} {prevLabel}{' '}
            {s.current.negative > 0 && (
              <button className="btn-link" onClick={() => onOpenReviews({ sentiment: 'negative' })}>
                Read them
              </button>
            )}
          </div>
        </div>
        <TopComplaintTile summary={s} onOpenReviews={onOpenReviews} />
      </div>

      <Card
        title="By property"
        subtitle={`Ratings from reviews in the selected period. Booking.com's all-time score is shown for context. Click a row to focus on one property.`}
        dim={dim}
      >
        <PropertyTable properties={s.properties} selected={scope.property} prevLabel={prevLabel} onSelect={onProperty} />
      </Card>

      <TrendCharts scope={scope} scopeKey={scopeKey} period={s.period} />

      <CategoryScores properties={s.properties.filter((p) => scope.property === 'all' || p.id === scope.property)} />
    </div>
  );
}

function TopComplaintTile({ summary: s, onOpenReviews }: { summary: SummaryResponse; onOpenReviews: (f: Partial<ReviewFilters>) => void }) {
  const top = [...s.topics].sort((a, b) => b.complaints - a.complaints)[0];
  return (
    <div className="tile">
      <div className="tile-label">Most common complaint</div>
      {top && top.complaints > 0 ? (
        <>
          <div className="tile-value" style={{ fontSize: '1.5rem', margin: '10px 0 8px' }}>
            {topicLabel(top.topic)}
          </div>
          <div className="tile-foot">
            In {top.complaints} of {s.classifiableCount} reviews with comments ·{' '}
            <button className="btn-link" onClick={() => onOpenReviews({ topic: top.topic, polarity: 'complaint' })}>
              Read them
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="tile-value" style={{ fontSize: '1.5rem', margin: '10px 0 8px' }}>
            None
          </div>
          <div className="tile-foot">No complaints found in this period.</div>
        </>
      )}
    </div>
  );
}

function PropertyTable({
  properties,
  selected,
  prevLabel,
  onSelect,
}: {
  properties: PropertySummary[];
  selected: string;
  prevLabel: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Property</th>
            <th>Average rating</th>
            <th>Change vs {prevLabel}</th>
            <th className="num">Reviews</th>
            <th className="num">Negative</th>
            <th>Top complaint</th>
            <th className="num">Booking.com score (all-time)</th>
          </tr>
        </thead>
        <tbody>
          {properties.map((p) => (
            <tr
              key={p.id}
              className="clickable"
              onClick={() => onSelect(selected === p.id ? 'all' : p.id)}
              aria-selected={selected === p.id}
              style={selected === p.id ? { outline: '2px solid var(--pos)', outlineOffset: -2 } : undefined}
            >
              <td>
                <strong>{p.name}</strong>
                {p.lastCollectedAt && <div className="small muted">Checked {fmtDay(p.lastCollectedAt.slice(0, 10))}</div>}
              </td>
              <td>
                {p.current.count ? <Meter value={p.current.avgScore} label={`${p.name} average rating`} /> : <span className="muted small">No reviews</span>}
              </td>
              <td>
                {p.current.count && p.previous.count ? (
                  <>
                    <Delta value={(p.current.avgScore ?? 0) - (p.previous.avgScore ?? 0)} />{' '}
                    <span className="small muted">from {fmtScore(p.previous.avgScore)}</span>
                  </>
                ) : (
                  <span className="small muted">–</span>
                )}
              </td>
              <td className="num">{p.current.count}</td>
              <td className="num">{p.current.negative}</td>
              <td>{p.topComplaint ? `${topicLabel(p.topComplaint.topic)} (${p.topComplaint.count})` : <span className="muted">–</span>}</td>
              <td className="num">
                <strong>{fmtScore(p.bookingScore)}</strong>{' '}
                <span className="small muted">{p.bookingReviewCount !== null ? `from ${p.bookingReviewCount.toLocaleString()}` : ''}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
