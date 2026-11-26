import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { startOfWeek, type ResolvedPeriod } from '../../shared/dates';
import type { TrendPoint } from '../../shared/types';
import { api, type Scope } from '../lib/api';
import { fmtScore, fmtShortDay } from '../lib/format';
import { useData } from '../lib/hooks';
import { Card, ErrorBox } from './ui';

const AXIS = { stroke: 'var(--axis)', tick: { fill: 'var(--text-2)', fontSize: 13 }, tickLine: false };

interface TipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ payload: TrendPoint }>;
}

function RatingTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length || !label) return null;
  const p = payload[0].payload;
  return (
    <div className="tip">
      <div className="tip-head">Week of {fmtShortDay(label)}</div>
      {p.avgScore === null ? (
        <div>No reviews this week</div>
      ) : (
        <div>
          <strong>{fmtScore(p.avgScore)}</strong> average from {p.count} review{p.count === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

function CountTip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length || !label) return null;
  const p = payload[0].payload;
  return (
    <div className="tip">
      <div className="tip-head">Week of {fmtShortDay(label)}</div>
      <div>
        <i className="key key-good" /> <strong>{p.positive}</strong> good
      </div>
      <div>
        <i className="key key-ok" /> <strong>{p.neutral}</strong> okay
      </div>
      <div>
        <i className="key key-bad" /> <strong>{p.negative}</strong> bad
      </div>
    </div>
  );
}

export function TrendCard({ scope, scopeKey, period }: { scope: Scope; scopeKey: string; period: ResolvedPeriod }) {
  const trends = useData(() => api.trends(scope), [scopeKey]);
  const [view, setView] = useState<'rating' | 'counts' | 'table'>('rating');
  if (trends.error && !trends.data) return <ErrorBox message={trends.error} onRetry={trends.reload} />;
  const weeks = trends.data?.weeks ?? [];
  const hiFrom = startOfWeek(period.current.from);
  const hiTo = startOfWeek(period.current.to);
  const highlight = weeks.length > 1 && (hiFrom !== weeks[0].weekStart || hiTo !== weeks[weeks.length - 1].weekStart);

  const switcher = (
    <div className="switch" role="group" aria-label="Chart view">
      {(
        [
          ['rating', 'Average rating'],
          ['counts', 'Good vs bad reviews'],
          ['table', 'Table'],
        ] as const
      ).map(([id, label]) => (
        <button key={id} aria-pressed={view === id} onClick={() => setView(id)}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <Card
      title="Week by week"
      subtitle={highlight ? 'The shaded weeks are the time period you picked. Earlier weeks are shown for comparison.' : 'Each point is one week (Monday to Sunday).'}
      actions={switcher}
      dim={trends.loading}
    >
      {view === 'table' ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Week of</th>
                <th className="num">Reviews</th>
                <th className="num">Average rating</th>
                <th className="num">Good</th>
                <th className="num">Okay</th>
                <th className="num">Bad</th>
              </tr>
            </thead>
            <tbody>
              {[...weeks].reverse().map((w) => (
                <tr key={w.weekStart}>
                  <td>{fmtShortDay(w.weekStart)}</td>
                  <td className="num">{w.count}</td>
                  <td className="num">{fmtScore(w.avgScore)}</td>
                  <td className="num">{w.positive}</td>
                  <td className="num">{w.neutral}</td>
                  <td className="num">{w.negative}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="chart">
            <ResponsiveContainer>
              {view === 'rating' ? (
                <LineChart data={weeks} margin={{ top: 10, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  {highlight && <ReferenceArea x1={hiFrom} x2={hiTo} fill="var(--highlight)" ifOverflow="extendDomain" />}
                  <XAxis dataKey="weekStart" tickFormatter={fmtShortDay} {...AXIS} minTickGap={28} />
                  <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} {...AXIS} axisLine={false} />
                  <Tooltip content={<RatingTip />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} />
                  <Line
                    type="monotone"
                    dataKey="avgScore"
                    stroke="var(--pos)"
                    strokeWidth={2.5}
                    connectNulls
                    dot={{ r: 4, fill: 'var(--pos)', stroke: 'var(--surface)', strokeWidth: 2 }}
                    activeDot={{ r: 6, fill: 'var(--pos)', stroke: 'var(--surface)', strokeWidth: 2 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              ) : (
                <BarChart data={weeks} margin={{ top: 10, right: 16, bottom: 0, left: -16 }}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  {highlight && <ReferenceArea x1={hiFrom} x2={hiTo} fill="var(--highlight)" ifOverflow="extendDomain" />}
                  <XAxis dataKey="weekStart" tickFormatter={fmtShortDay} {...AXIS} minTickGap={28} />
                  <YAxis allowDecimals={false} {...AXIS} axisLine={false} />
                  <Tooltip content={<CountTip />} cursor={{ fill: 'var(--surface-2)' }} />
                  <Bar dataKey="positive" stackId="s" fill="var(--pos)" stroke="var(--surface)" strokeWidth={1} maxBarSize={26} isAnimationActive={false} />
                  <Bar dataKey="neutral" stackId="s" fill="var(--mid)" stroke="var(--surface)" strokeWidth={1} maxBarSize={26} isAnimationActive={false} />
                  <Bar dataKey="negative" stackId="s" fill="var(--neg)" stroke="var(--surface)" strokeWidth={1} maxBarSize={26} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              )}
            </ResponsiveContainer>
          </div>
          {view === 'counts' ? (
            <div className="legend">
              <span>
                <i className="key key-good" /> Good (8–10)
              </span>
              <span>
                <i className="key key-ok" /> Okay (6–7)
              </span>
              <span>
                <i className="key key-bad" /> Bad (1–5)
              </span>
            </div>
          ) : (
            <p className="chart-note">Hover over a week to see its number. Weeks with no reviews are skipped.</p>
          )}
        </>
      )}
    </Card>
  );
}
