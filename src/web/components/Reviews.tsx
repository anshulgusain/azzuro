import { useEffect, useState, type ReactNode } from 'react';
import type { ReviewFilters } from '../App';
import { SENTIMENT_LABELS, topicLabel } from '../../shared/topics';
import type { MetaResponse, Review, TopicMention } from '../../shared/types';
import { api, type Scope } from '../lib/api';
import { fmtDay, fmtStayMonth } from '../lib/format';
import { useData } from '../lib/hooks';
import { Empty, ErrorBox, ScoreBadge } from './ui';

const PAGE_SIZE = 20;

interface Props {
  scope: Scope;
  scopeKey: string;
  meta: MetaResponse | null;
  filters: ReviewFilters;
  onFilters: (f: Partial<ReviewFilters>) => void;
}

export function Reviews({ scope, scopeKey, meta, filters, onFilters }: Props) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState(filters.q);
  const filterKey = JSON.stringify(filters);
  useEffect(() => setPage(1), [scopeKey, filterKey]);
  useEffect(() => setSearch(filters.q), [filters.q]);

  // Debounce typing so every keystroke doesn't hit the server.
  useEffect(() => {
    if (search === filters.q) return;
    const t = setTimeout(() => onFilters({ q: search }), 300);
    return () => clearTimeout(t);
  }, [search, filters.q, onFilters]);

  const res = useData(
    () =>
      api.reviews(scope, {
        sentiment: filters.sentiment || undefined,
        topic: filters.topic || undefined,
        polarity: filters.topic ? filters.polarity || undefined : undefined,
        q: filters.q || undefined,
        sort: filters.sort,
        page,
        pageSize: PAGE_SIZE,
      }),
    [scopeKey, filterKey, page],
  );

  const propertyName = (id: string) => meta?.properties.find((p) => p.id === id)?.name ?? id;
  const anyFilter = filters.sentiment || filters.topic || filters.q;
  const totalPages = res.data ? Math.max(1, Math.ceil(res.data.total / PAGE_SIZE)) : 1;

  return (
    <div>
      <div className="feed-controls" aria-label="Review filters">
        <div className="segmented" role="group" aria-label="Guest score">
          {[
            ['', 'All scores'],
            ['positive', SENTIMENT_LABELS.positive],
            ['neutral', SENTIMENT_LABELS.neutral],
            ['negative', SENTIMENT_LABELS.negative],
          ].map(([v, label]) => (
            <button key={v} aria-pressed={filters.sentiment === v} onClick={() => onFilters({ sentiment: v })}>
              {label}
            </button>
          ))}
        </div>
        <label className="field">
          <span>Topic</span>
          <select value={filters.topic} onChange={(e) => onFilters({ topic: e.target.value, polarity: e.target.value ? filters.polarity || 'complaint' : '' })}>
            <option value="">Any topic</option>
            {meta?.topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {filters.topic && (
          <select aria-label="Complaints or praise" value={filters.polarity} onChange={(e) => onFilters({ polarity: e.target.value })}>
            <option value="complaint">Complaints</option>
            <option value="praise">Praise</option>
            <option value="">Complaints or praise</option>
          </select>
        )}
        <input type="search" placeholder="Search review text, e.g. towels" aria-label="Search reviews" value={search} onChange={(e) => setSearch(e.target.value)} />
        <label className="field">
          <span>Sort</span>
          <select value={filters.sort} onChange={(e) => onFilters({ sort: e.target.value })}>
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="lowest">Lowest score first</option>
            <option value="highest">Highest score first</option>
          </select>
        </label>
      </div>

      <div className="spread" style={{ marginBottom: 12 }}>
        <span className="muted small">
          {res.data ? `${res.data.total} review${res.data.total === 1 ? '' : 's'} in the selected period` : 'Loading…'}
          {filters.topic ? ` · ${topicLabel(filters.topic)}${filters.polarity ? ` ${filters.polarity === 'complaint' ? 'complaints' : 'praise'}` : ''}` : ''}
        </span>
        {anyFilter && (
          <button className="btn-link small" onClick={() => onFilters({ sentiment: '', topic: '', polarity: '', q: '' })}>
            Clear review filters
          </button>
        )}
      </div>

      {res.error && <ErrorBox message={res.error} onRetry={res.reload} />}
      {res.data && res.data.total === 0 && (
        <div className="card">
          <Empty title="No reviews match">
            <p>Try a longer period in the bar above{anyFilter ? ', or clear the review filters' : ''}.</p>
          </Empty>
        </div>
      )}
      <div className={`stack${res.loading ? ' loading-dim' : ''}`}>
        {res.data?.reviews.map((r) => (
          <ReviewCard key={r.id} review={r} propertyName={propertyName(r.propertyId)} onTopic={(topic, polarity) => onFilters({ topic, polarity })} />
        ))}
      </div>
      {res.data && totalPages > 1 && (
        <nav className="pager" aria-label="Pages">
          <button className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            ← Newer
          </button>
          <span className="small muted">
            Page {page} of {totalPages}
          </span>
          <button className="btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Older →
          </button>
        </nav>
      )}
    </div>
  );
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Wraps the words that triggered a topic in <mark> so staff can see why a review was tagged. */
function highlight(text: string, terms: string[]): ReactNode {
  const clean = [...new Set(terms)].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!clean.length) return text;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${clean.map((t) => escapeRe(t).replace(/'/g, "['’]").replace(/[\s-]+/g, '[\\s-]+')).join('|')})(?![\\p{L}\\p{N}])`, 'giu');
  const parts = text.split(re);
  return parts.map((part, i) => (i % 2 === 1 ? <mark key={i}>{part}</mark> : part));
}

function termsFor(topics: TopicMention[], polarity: TopicMention['polarity']) {
  return topics.filter((t) => t.polarity === polarity).flatMap((t) => t.terms);
}

function ReviewCard({ review: r, propertyName, onTopic }: { review: Review; propertyName: string; onTopic: (topic: string, polarity: string) => void }) {
  const praiseTerms = termsFor(r.topics, 'praise');
  const complaintTerms = termsFor(r.topics, 'complaint');
  const meta = [
    propertyName,
    `Reviewed ${fmtDay(r.reviewedDate)}`,
    r.stayMonth ? `Stayed ${fmtStayMonth(r.stayMonth)}${r.nights ? `, ${r.nights} night${r.nights === 1 ? '' : 's'}` : ''}` : null,
    r.travellerType,
    r.roomType,
    [r.guestName, r.guestCountry].filter(Boolean).join(', ') || null,
  ].filter(Boolean);

  return (
    <article className="review" aria-label={`Review of ${propertyName}, score ${r.score}`}>
      <ScoreBadge score={r.score} sentiment={r.sentiment} />
      <div className="review-meta">
        {meta.map((m, i) => (
          <span key={i}>{m}</span>
        ))}
      </div>
      {r.title ? <div className="review-title">“{r.title}”</div> : <div />}
      <div className="review-body">
        {r.positiveText && (
          <div className="review-text">
            <span className="polarity-icon liked" role="img" aria-label="Liked">
              +
            </span>
            <p>{highlight(r.positiveText, praiseTerms)}</p>
          </div>
        )}
        {r.negativeText && (
          <div className="review-text">
            <span className="polarity-icon disliked" role="img" aria-label="Disliked">
              –
            </span>
            <p>{highlight(r.negativeText, r.textQuality === 'misplaced_praise' ? praiseTerms : complaintTerms)}</p>
          </div>
        )}
        {!r.positiveText && !r.negativeText && <p className="muted small">The guest left a score without comments.</p>}
      </div>
      {r.topics.length > 0 && (
        <div className="chips">
          {r.topics
            .slice()
            .sort((a, b) => (a.polarity === b.polarity ? 0 : a.polarity === 'complaint' ? -1 : 1))
            .map((t) => (
              <button
                key={`${t.topic}-${t.polarity}`}
                className="chip"
                onClick={() => onTopic(t.topic, t.polarity)}
                title={`Matched: ${t.terms.join(', ')}. Click to see all reviews with this tag.`}
              >
                <span className={`dot ${t.polarity}`} aria-hidden="true" />
                {topicLabel(t.topic)} · {t.polarity === 'complaint' ? 'complaint' : 'praise'}
              </button>
            ))}
        </div>
      )}
      {r.textQuality === 'misplaced_praise' && (
        <div className="note">The guest wrote praise in the “disliked” box, so it is counted as praise, not a complaint.</div>
      )}
      {r.textQuality === 'non_english' && <div className="note">Not in English, so it has no topic tags. The score still counts.</div>}
      {r.hotelReply && (
        <div className="reply">
          <strong>Property reply:</strong> {r.hotelReply}
        </div>
      )}
    </article>
  );
}
