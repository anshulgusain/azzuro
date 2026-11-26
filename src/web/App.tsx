import { useState } from 'react';
import { PERIOD_LABELS, type PeriodPreset } from '../shared/dates';
import { DataStatus } from './components/DataStatus';
import { HeroBanner } from './components/HeroBanner';
import { LimitedDataNote } from './components/LimitedDataNote';
import { Problems } from './components/Problems';
import { ReviewFeed } from './components/ReviewFeed';
import { Summary } from './components/Summary';
import { ErrorBox, Icon } from './components/ui';
import { api, type Scope } from './lib/api';
import { fmtRange, fmtRelative } from './lib/format';
import { useData, useUrlState } from './lib/hooks';
import { useTheme } from './lib/theme';

const PRESETS: PeriodPreset[] = ['this_week', 'last_week', 'last_4_weeks', 'last_3_months', 'last_12_months', 'custom'];

type Tab = 'summary' | 'reviews' | 'problems' | 'data';
const MAIN_TABS: Array<{ id: Tab; label: string; icon: string; hint: string }> = [
  { id: 'summary', label: 'Summary', icon: 'summary', hint: 'How are we doing?' },
  { id: 'reviews', label: 'Read reviews', icon: 'reviews', hint: 'What guests wrote' },
  { id: 'problems', label: 'Complaints & praise', icon: 'problems', hint: 'What to fix, what to keep' },
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
    tab: 'summary',
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
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [theme, toggleTheme] = useTheme();

  const customInvalid = state.period === 'custom' && (!state.from || !state.to || state.from > state.to);
  const lastRun = health.data?.runs[0];
  const hotels = meta.data?.properties ?? [];

  const openReviews = (patch: Partial<ReviewFilters>) => {
    setState({ tab: 'reviews', sentiment: '', topic: '', polarity: '', q: '', ...patch });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  async function refresh() {
    const res = await api.collect();
    setRefreshMsg(res.started ? 'Getting the latest reviews… this takes about a minute.' : res.message);
    const started = Date.now();
    const timer = setInterval(async () => {
      const h = await api.health().catch(() => null);
      if ((h && !h.collecting && Date.now() - started > 5_000) || Date.now() - started > 10 * 60_000) {
        clearInterval(timer);
        setRefreshMsg(null);
        health.reload();
        summary.reload();
        meta.reload();
      }
    }, 4_000);
  }

  const freshness =
    refreshMsg ??
    (health.data?.collecting
      ? 'Getting the latest reviews…'
      : lastRun
        ? `Updated ${fmtRelative(lastRun.finishedAt ?? lastRun.startedAt)}`
        : meta.data?.totalReviews
          ? 'Showing sample data'
          : 'No reviews yet');

  return (
    <>
      <header className="masthead">
        <div className="wrap masthead-inner">
          <div className="brand">
            <div className="logo" aria-hidden="true">
              <Icon name="hotel" size={22} />
            </div>
            <div>
              <div className="brand-name">
                Azzurro <span>Hotels</span>
              </div>
              <div className="brand-sub">Guest reviews dashboard</div>
            </div>
          </div>
          <div className="masthead-actions">
            <span className="updated" aria-live="polite">
              {freshness}
            </span>
            <button className="btn btn-ghost" onClick={toggleTheme} aria-pressed={theme === 'dark'} title="Switch between white and dark screens">
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} /> {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </button>
            <button className="btn btn-cta" onClick={refresh} disabled={!!refreshMsg || health.data?.collecting}>
              <Icon name="refresh" size={16} /> Get latest reviews
            </button>
          </div>
        </div>
      </header>

      <HeroBanner meta={meta.data} summary={summary.data} property={state.property} />

      <div className="wrap">
        <section className="filters" aria-label="Choose hotel and time period">
          <div className="filter-row">
            <span className="filter-label" id="hotel-label">
              Hotel
            </span>
            <div className="choice-group" role="group" aria-labelledby="hotel-label">
              <button className="choice" aria-pressed={state.property === 'all'} onClick={() => setState({ property: 'all' })}>
                All hotels
              </button>
              {hotels.map((p) => (
                <button key={p.id} className="choice" aria-pressed={state.property === p.id} onClick={() => setState({ property: p.id })}>
                  {p.name}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-row">
            <span className="filter-label" id="time-label">
              Time
            </span>
            <div className="choice-group" role="group" aria-labelledby="time-label">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  className="choice"
                  aria-pressed={state.period === p}
                  onClick={() =>
                    setState(
                      p === 'custom' && !state.from && summary.data
                        ? { period: p, from: summary.data.period.current.from, to: summary.data.period.current.to }
                        : { period: p },
                    )
                  }
                >
                  {p === 'custom' ? 'Pick dates' : PERIOD_LABELS[p]}
                </button>
              ))}
            </div>
          </div>
          {state.period === 'custom' && (
            <div className="filter-row">
              <span className="filter-label">Dates</span>
              <div className="date-pickers">
                <label>
                  From <input type="date" value={state.from} max={state.to || undefined} onChange={(e) => setState({ from: e.target.value })} />
                </label>
                <label>
                  to <input type="date" value={state.to} min={state.from || undefined} onChange={(e) => setState({ to: e.target.value })} />
                </label>
              </div>
            </div>
          )}
          {summary.data && !customInvalid && (
            <p className="filter-summary">
              Showing <strong>{fmtRange(summary.data.period.current.from, summary.data.period.current.to)}</strong>
              {summary.data.period.inProgress ? ' (so far)' : ''}, compared with {summary.data.period.previousLabel}.
            </p>
          )}
        </section>

        {summary.data && <LimitedDataNote coverage={summary.data.coverage} onMore={() => setState({ tab: 'data' })} />}

        <nav className="tabs" role="tablist" aria-label="Pages">
          {MAIN_TABS.map((t) => (
            <button key={t.id} role="tab" className="tab" aria-selected={state.tab === t.id} onClick={() => setState({ tab: t.id })}>
              <Icon name={t.icon} size={20} />
              <span>
                <span className="tab-label">
                  {t.label}
                  {t.id === 'reviews' && summary.data ? <span className="tab-count">{summary.data.current.count}</span> : null}
                </span>
                <span className="tab-hint">{t.hint}</span>
              </span>
            </button>
          ))}
        </nav>

        <main>
          {customInvalid ? (
            <ErrorBox message="Choose a start date and an end date (the start must be before the end)." />
          ) : state.tab === 'reviews' ? (
            <ReviewFeed
              scope={scope}
              scopeKey={scopeKey}
              meta={meta.data}
              filters={{ sentiment: state.sentiment, topic: state.topic, polarity: state.polarity, q: state.q, sort: state.sort }}
              onFilters={(f) => setState(f)}
            />
          ) : state.tab === 'problems' ? (
            <Problems summary={summary} meta={meta.data} onOpenReviews={openReviews} />
          ) : state.tab === 'data' ? (
            <DataStatus health={health} onBack={() => setState({ tab: 'summary' })} />
          ) : (
            <Summary summary={summary} scope={scope} scopeKey={scopeKey} onHotel={(id) => setState({ property: id })} onOpenReviews={openReviews} />
          )}
        </main>

        <footer className="footer">
          <span>Weeks run Monday to Sunday, Sydney time.</span>
          <button className="link" onClick={() => setState({ tab: 'data' })}>
            <Icon name="data" size={14} /> Data status and how this works
          </button>
        </footer>
      </div>
    </>
  );
}
