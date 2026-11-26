import type { CategoryScore, PropertySummary } from '../../shared/types';
import { fmtScore } from '../lib/format';
import { Card, Empty } from './ui';

const SCALE_MIN = 5; // scores below 5 are rare; starting at 5 makes differences readable

function RangeCell({ c }: { c: CategoryScore }) {
  const pos = (v: number) => `${Math.max(0, Math.min(100, ((v - SCALE_MIN) / (10 - SCALE_MIN)) * 100))}%`;
  const below = c.cityLow !== null && c.score < c.cityLow;
  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', gap: 6 }}>
        <strong className="num">{fmtScore(c.score)}</strong>
        {below && <span className="flag">▼ below Sydney range</span>}
      </div>
      {c.cityLow !== null && c.cityHigh !== null && (
        <div
          className="range"
          title={`Sydney range for similar properties: ${fmtScore(c.cityLow)}–${fmtScore(c.cityHigh)}`}
          aria-label={`${c.label} ${fmtScore(c.score)}; Sydney range ${fmtScore(c.cityLow)} to ${fmtScore(c.cityHigh)}`}
        >
          <div className="range-line" />
          <div className="range-band" style={{ left: pos(c.cityLow), width: `calc(${pos(c.cityHigh)} - ${pos(c.cityLow)})` }} />
          <div className={`range-dot${below ? ' below' : ''}`} style={{ left: pos(c.score) }} />
        </div>
      )}
    </div>
  );
}

/** Booking.com's category scores for each property against its Sydney benchmark range. */
export function CategoryScores({ properties }: { properties: PropertySummary[] }) {
  const withData = properties.filter((p) => p.categories.length);
  if (!withData.length) {
    return (
      <Card title="Booking.com category scores">
        <Empty title="No category scores yet">Run a collection to fetch them.</Empty>
      </Card>
    );
  }
  const keys = [...new Map(withData.flatMap((p) => p.categories.map((c) => [c.key, c.label] as const))).entries()];
  return (
    <Card
      title="Booking.com category scores (all-time)"
      subtitle="Booking.com's scores per category, built from all reviews. The grey band is Booking.com's range for comparable Sydney properties; red dots fall below it."
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Category</th>
              {withData.map((p) => (
                <th key={p.id}>{p.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {keys.map(([key, label]) => (
              <tr key={key}>
                <td>{label}</td>
                {withData.map((p) => {
                  const c = p.categories.find((x) => x.key === key);
                  return <td key={p.id}>{c ? <RangeCell c={c} /> : <span className="muted">–</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ margin: '10px 0 0' }}>
        Scale shown from 5 to 10. Snapshot taken at each collection, so changes over time are kept.
      </p>
    </Card>
  );
}
