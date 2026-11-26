import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { startOfWeek, type ResolvedPeriod } from '../../shared/dates';
import type { TrendPoint } from '../../shared/types';
import { api, type Scope } from '../lib/api';
import { fmtScore, fmtShortDay } from '../lib/format';
import { useData } from '../lib/hooks';
import { Card, ErrorBox } from './ui';

const AXIS = { stroke: 'var(--axis)', tick: { fill: 'var(--text-2)', fontSize: 12 }, tickLine: false };

interface TooltipProps {
  active?: boolean;
  label?: string;
  payload?: Array<{ payload: TrendPoint }>;
}

function RatingTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length || !label) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <div className="t-head">Week of {fmtShortDay(label)}</div>
      <div className="t-row">
        <span className="t-key" style={{ background: 'var(--pos)' }} />
        <strong>{p.avgScore === null ? 'No reviews' : fmtScore(p.avgScore)}</strong>
        {p.avgScore !== null && <span className="muted">average from {p.count}</span>}
      </div>
    </div>
  );
}

function CountTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length || !label) return null;
  const p = payload[0].payload;
  const rows: Array<[string, number, string]> = [
    ['Positive', p.positive, 'var(--pos)'],
    ['Mixed', p.neutral, 'var(--mid)'],
    ['Negative', p.negative, 'var(--neg)'],
  ];
  return (
    <div className="chart-tooltip">
      <div className="t-head">
        Week of {fmtShortDay(label)} · {p.count} review{p.count === 1 ? '' : 's'}
      </div>
      {rows.map(([name, v, color]) => (
        <div className="t-row" key={name}>
          <span className="t-key" style={{ background: color, height: 8, width: 8, borderRadius: 2 }} />
          <strong>{v}</strong>
          <span className="muted">{name}</span>
        </div>
      ))}
    </div>
  );
}

export function TrendCharts({ scope, scopeKey, period }: { scope: Scope; scopeKey: string; period: ResolvedPeriod }) {
  const trends = useData(() => api.trends(scope), [scopeKey]);
  const [asTable, setAsTable] = useState(false);
  if (trends.error && !trends.data) return <ErrorBox message={trends.error} onRetry={trends.reload} />;
  const weeks = trends.data?.weeks ?? [];
  const hiFrom = startOfWeek(period.current.from);
  const hiTo = startOfWeek(period.current.to);
  const highlight = weeks.length > 1 && (hiFrom !== weeks[0].weekStart || hiTo !== weeks[weeks.length - 1].weekStart);
  const toggle = (
    <button className="btn" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
      {asTable ? 'Show charts' : 'Show as table'}
    </button>
  );

  if (asTable) {
    return (
      <Card title="Weekly trend" subtitle="Weeks start on Monday (Sydney time)." actions={toggle} dim={trends.loading}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Week of</th>
                <th className="num">Reviews</th>
                <th className="num">Average</th>
                <th className="num">Positive</th>
                <th className="num">Mixed</th>
                <th className="num">Negative</th>
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
      </Card>
    );
  }

  return (
    <div className="grid grid-2">
      <Card
        title="Average rating by week"
        subtitle={highlight ? 'Shaded weeks are the selected period; earlier weeks give context.' : 'Weeks start on Monday (Sydney time).'}
        actions={toggle}
        dim={trends.loading}
      >
        <div className="chart">
          <ResponsiveContainer>
            <LineChart data={weeks} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              {highlight && <ReferenceArea x1={hiFrom} x2={hiTo} fill="var(--pos-wash)" ifOverflow="extendDomain" />}
              <XAxis dataKey="weekStart" tickFormatter={fmtShortDay} {...AXIS} minTickGap={24} />
              <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} {...AXIS} axisLine={false} />
              <Tooltip content={<RatingTooltip />} cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }} />
              <Line
                type="linear"
                dataKey="avgScore"
                stroke="var(--pos)"
                strokeWidth={2}
                connectNulls
                dot={{ r: 4, fill: 'var(--pos)', stroke: 'var(--surface)', strokeWidth: 2 }}
                activeDot={{ r: 6, fill: 'var(--pos)', stroke: 'var(--surface)', strokeWidth: 2 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <p className="small muted" style={{ margin: '8px 0 0' }}>
          Weeks with no reviews are skipped by the line. Hover a week for the exact figure.
        </p>
      </Card>

      <Card title="Positive and negative reviews by week" subtitle="Each bar is one week's reviews, split by the guest's score." dim={trends.loading}>
        <div className="chart">
          <ResponsiveContainer>
            <BarChart data={weeks} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} stroke="var(--grid)" />
              {highlight && <ReferenceArea x1={hiFrom} x2={hiTo} fill="var(--pos-wash)" ifOverflow="extendDomain" />}
              <XAxis dataKey="weekStart" tickFormatter={fmtShortDay} {...AXIS} minTickGap={24} />
              <YAxis allowDecimals={false} {...AXIS} axisLine={false} />
              <Tooltip content={<CountTooltip />} cursor={{ fill: 'var(--surface-2)' }} />
              <Bar dataKey="positive" stackId="s" fill="var(--pos)" stroke="var(--surface)" strokeWidth={1} maxBarSize={24} isAnimationActive={false} />
              <Bar dataKey="neutral" stackId="s" fill="var(--mid)" stroke="var(--surface)" strokeWidth={1} maxBarSize={24} isAnimationActive={false} />
              <Bar dataKey="negative" stackId="s" fill="var(--neg)" stroke="var(--surface)" strokeWidth={1} maxBarSize={24} radius={[4, 4, 0, 0]} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="legend" style={{ marginTop: 8 }}>
          <span>
            <i className="swatch pos" /> Positive (8–10)
          </span>
          <span>
            <i className="swatch mid" /> Mixed (6–7)
          </span>
          <span>
            <i className="swatch neg" /> Negative (1–5)
          </span>
        </div>
      </Card>
    </div>
  );
}
