import { useState } from 'react';
import { PERIOD_LABELS, type PeriodPreset } from '../shared/dates';
import { CoverageBanner } from './components/CoverageBanner';
import { Health } from './components/Health';
import { Overview } from './components/Overview';
import { Reviews } from './components/Reviews';
import { Topics } from './components/Topics';
import { ErrorBox } from './components/ui';
import { api, type Scope } from './lib/api';
import { fmtRange, fmtRelative } from './lib/format';
import { useData, useUrlState } from './lib/hooks';

const PRESETS: PeriodPreset[] = ['this_week', 'last_week', 'last_4_weeks', 'last_3_months', 'last_12_months', 'custom'];
type Tab = 'overview' | 'reviews' | 'topics' | 'health';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'reviews', label: 'Reviews' },
  { id: 'topics', label: 'Topics' },
  { id: 'health', label: 'Data & sources' },
];

export interface ReviewFilters {
  sentiment: string;
  topic: string;
  polarity: string;
  q: string;
  sort: string;
}

export function App() {
  const [state, setState] = useUrlState({
    tab: 'overview',
    property: 'all',
    period: 'this_week',
    from: '',
    to: '',
    sentiment: '',
    topic: '',
    polarity: '',
    q: '',
    sort: 'newest',
  });
  const scope: Scope = { property: state.property, period: state.period, from: state.from, to: state.to };
  const scopeKey = JSON.stringify(scope);

  const meta = useData(() => api.meta(), []);
  const summary = useData(() => api.summary(scope), [scopeKey]);
  const health = useData(() => api.health(), []);
  const [collectMsg, setCollectMsg] = useState<string | null>(null);

  const customInvalid = state.period === 'custom' && (!state.from || !state.to || state.from > state.to);
  const lastRun = health.data?.runs[0];

  const openReviews = (patch: Partial<ReviewFilters>) =>
    setState({ tab: 'reviews', sentiment: '', topic: '', polarity: '', q: '', ...patch });

  async function refresh() {
    const res = await api.collect();
    setCollectMsg(res.message);
    // Poll the run log until the collection finishes, then reload everything.
    const started = Date.now();
    const timer = setInterval(async () => {
      const h = await api.health().catch(() => null);
      if ((h && !h.collecting && Date.now() - started > 5_000) || Date.now() - started > 10 * 60_000) {
        clearInterval(timer);
        setCollectMsg(null);
        health.reload();
        summary.reload();
        meta.reload();
      }
    }, 4_000);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            A
          </div>
          <div>
            <h1>Guest Review Insights</h1>
            <p>Azzurro Hotels · Booking.com reviews</p>
          </div>
        </div>
        <div className="freshness">
          <span>
            {collectMsg ??
              (health.data?.collecting
                ? 'Collecting new reviews…'
                : lastRun
                  ? `Last updated ${fmtRelative(lastRun.finishedAt ?? lastRun.startedAt)}`
                  : 'Not collected yet')}
          </span>
          <button className="btn" onClick={refresh} disabled={!!collectMsg || health.data?.collecting} title="Fetch the latest reviews from Booking.com">
            Refresh data
          </button>
        </div>
      </header>

      <div className="filters" role="search" aria-label="Filters for every view">
        <label className="field">
          <span>Property</span>
          <select value={state.property} onChange={(e) => setState({ property: e.target.value })}>
            <option value="all">All properties</option>
            {meta.data?.properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span id="period-label">Period</span>
          <div className="segmented" role="group" aria-labelledby="period-label">
            {PRESETS.map((p) => (
              <button
                key={p}
                aria-pressed={state.period === p}
                onClick={() =>
                  setState(
                    p === 'custom' && !state.from && summary.data
                      ? { period: p, from: summary.data.period.current.from, to: summary.data.period.current.to }
                      : { period: p },
                  )
                }
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>
        {state.period === 'custom' && (
          <div className="field">
            <input type="date" aria-label="From" value={state.from} max={state.to || undefined} onChange={(e) => setState({ from: e.target.value })} />
            <span>to</span>
            <input type="date" aria-label="To" value={state.to} min={state.from || undefined} onChange={(e) => setState({ to: e.target.value })} />
          </div>
        )}
        {summary.data && !customInvalid && (
          <span className="small muted">
            {fmtRange(summary.data.period.current.from, summary.data.period.current.to)}
            {summary.data.period.inProgress ? ' (so far)' : ''} · compared with {summary.data.period.previousLabel}
          </span>
        )}
      </div>

      {summary.data && <CoverageBanner coverage={summary.data.coverage} onDetails={() => setState({ tab: 'health' })} />}

      <nav className="tabs" role="tablist" aria-label="Views">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={state.tab === t.id} onClick={() => setState({ tab: t.id })}>
            {t.label}
            {t.id === 'reviews' && summary.data ? <span className="count">{summary.data.current.count}</span> : null}
          </button>
        ))}
      </nav>

      <main>
        {customInvalid ? (
          <ErrorBox message="Choose a start and end date (the start must be on or before the end)." />
        ) : state.tab === 'overview' ? (
          <Overview summary={summary} scope={scope} scopeKey={scopeKey} onProperty={(id) => setState({ property: id })} onOpenReviews={openReviews} />
        ) : state.tab === 'reviews' ? (
          <Reviews
            scope={scope}
            scopeKey={scopeKey}
            meta={meta.data}
            filters={{ sentiment: state.sentiment, topic: state.topic, polarity: state.polarity, q: state.q, sort: state.sort }}
            onFilters={(f) => setState(f)}
          />
        ) : state.tab === 'topics' ? (
          <Topics summary={summary} meta={meta.data} onOpenReviews={openReviews} />
        ) : (
          <Health health={health} />
        )}
      </main>

      <footer>
        Reviews are public Booking.com guest reviews. Weeks run Monday to Sunday, Sydney time. Topic tags come from keyword rules ({meta.data?.classifierVersion ?? '…'}) – see
        the Topics tab for how they work.
      </footer>
    </div>
  );
}
