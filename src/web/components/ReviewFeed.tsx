import { useEffect, useState } from 'react';
import type { ReviewFilters } from '../App';
import { topicLabel } from '../../shared/topics';
import type { MetaResponse, Review } from '../../shared/types';
import { api, type Scope } from '../lib/api';
import { fmtDay, fmtStayMonth } from '../lib/format';
import { Empty, ErrorBox, ratingTone, ratingWord } from './ui';

const PAGE_SIZE = 15;

const SCORE_FILTERS: Array<[string, string]> = [
  ['', 'All reviews'],
  ['positive', 'Good (8–10)'],
  ['neutral', 'Okay (6–7)'],
  ['negative', 'Bad (1–5)'],
];

interface Props {
  scope: Scope;
  scopeKey: string;
  meta: MetaResponse | null;
  filters: ReviewFilters;
  onFilters: (f: Partial<ReviewFilters>) => void;
}

export function ReviewFeed({ scope, scopeKey, meta, filters, onFilters }: Props) {
  const key = scopeKey + JSON.stringify(filters);
  const [paging, setPaging] = useState({ key, page: 1 });
  const page = paging.key === key ? paging.page : 1;
  const [items, setItems] = useState<Review[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(filters.q);

  useEffect(() => setSearch(filters.q), [filters.q]);
  useEffect(() => {
    if (search === filters.q) return;
    const t = setTimeout(() => onFilters({ q: search }), 350);
    return () => clearTimeout(t);
  }, [search, filters.q, onFilters]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .reviews(scope, {
        sentiment: filters.sentiment || undefined,
        topic: filters.topic || undefined,
        polarity: filters.topic ? filters.polarity || undefined : undefined,
        q: filters.q || undefined,
        sort: filters.sort,
        page,
        pageSize: PAGE_SIZE,
      })
      .then((res) => {
        if (cancelled) return;
        setTotal(res.total);
        setItems((prev) => (page === 1 ? res.reviews : [...prev, ...res.reviews]));
        setError(null);
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, page]);

  const hotelName = (id: string) => meta?.properties.find((p) => p.id === id)?.name ?? id;
  const anyFilter = filters.sentiment || filters.topic || filters.q;

  return (
    <div className="page">
      <section className="card feed-filters" aria-label="Filter reviews">
        <div className="choice-group" role="group" aria-label="Score">
          {SCORE_FILTERS.map(([v, label]) => (
            <button key={v} className="choice" aria-pressed={filters.sentiment === v} onClick={() => onFilters({ sentiment: v })}>
              {label}
            </button>
          ))}
        </div>
        <div className="feed-row">
          <label className="field">
            <span>What about?</span>
            <select
              value={filters.topic}
              onChange={(e) => onFilters({ topic: e.target.value, polarity: e.target.value ? filters.polarity || 'complaint' : '' })}
            >
              <option value="">Anything</option>
              {meta?.topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          {filters.topic && (
            <label className="field">
              <span>Show</span>
              <select value={filters.polarity} onChange={(e) => onFilters({ polarity: e.target.value })}>
                <option value="complaint">Complaints</option>
                <option value="praise">Praise</option>
                <option value="">Both</option>
              </select>
            </label>
          )}
          <label className="field field-grow">
            <span>Search</span>
            <input type="search" placeholder="Type a word, e.g. towel, wifi, noisy" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <label className="field">
            <span>Order</span>
            <select value={filters.sort} onChange={(e) => onFilters({ sort: e.target.value })}>
              <option value="newest">Newest first</option>
              <option value="lowest">Worst first</option>
              <option value="highest">Best first</option>
              <option value="oldest">Oldest first</option>
            </select>
          </label>
        </div>
      </section>

      <div className="feed-status">
        <span>
          {total === null ? 'Loading…' : `${total} review${total === 1 ? '' : 's'}`}
          {filters.topic ? ` about ${topicLabel(filters.topic).toLowerCase()}` : ''}
        </span>
        {anyFilter && (
          <button className="link" onClick={() => onFilters({ sentiment: '', topic: '', polarity: '', q: '' })}>
            Show all reviews
          </button>
        )}
      </div>

      {error && <ErrorBox message={error} />}
      {total === 0 && !loading && (
        <div className="card">
          <Empty title="No reviews found">
            Try a longer time period at the top of the page{anyFilter ? ', or press “Show all reviews”' : ''}.
          </Empty>
        </div>
      )}

      <div className={`review-list${loading && page === 1 ? ' is-loading' : ''}`}>
        {items.map((r) => (
          <ReviewCard key={r.id} review={r} hotel={hotelName(r.propertyId)} onTopic={(topic, polarity) => onFilters({ topic, polarity })} />
        ))}
      </div>

      {total !== null && items.length < total && (
        <div className="more">
          <button className="btn btn-primary" disabled={loading} onClick={() => setPaging({ key, page: page + 1 })}>
            {loading ? 'Loading…' : `Show more reviews (${total - items.length} left)`}
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review: r, hotel, onTopic }: { review: Review; hotel: string; onTopic: (topic: string, polarity: string) => void }) {
  const tone = ratingTone(r.score);
  // Guests sometimes type just "-" or "." to skip a question; that isn't worth a box.
  const disliked = r.negativeText && /[\p{L}\p{N}]/u.test(r.negativeText) ? r.negativeText : null;
  const liked = r.positiveText && /[\p{L}\p{N}]/u.test(r.positiveText) ? r.positiveText : null;
  const complaints = r.topics.filter((t) => t.polarity === 'complaint');
  const praise = r.topics.filter((t) => t.polarity === 'praise');
  const details = [
    r.travellerType,
    r.roomType,
    r.stayMonth ? `Stayed ${fmtStayMonth(r.stayMonth)}${r.nights ? ` (${r.nights} night${r.nights === 1 ? '' : 's'})` : ''}` : null,
    [r.guestName, r.guestCountry].filter(Boolean).join(' from ') || null,
  ].filter(Boolean);

  return (
    <article className="review-card" aria-label={`${hotel}, ${r.score} out of 10`}>
      <div className="review-score">
        <span className={`score-circle score-${tone}`}>{Number.isInteger(r.score) ? r.score : r.score.toFixed(1)}</span>
        <span className="score-word">{ratingWord(r.score)}</span>
      </div>
      <div className="review-main">
        <p className="review-head">
          <strong>{hotel}</strong>
          <span className="dot-sep" aria-hidden="true">
            ·
          </span>
          {fmtDay(r.reviewedDate)}
        </p>
        {details.length > 0 && <p className="review-details">{details.join(' · ')}</p>}
        {r.title && <h3 className="review-title">“{r.title}”</h3>}

        {liked && (
          <div className="said said-liked">
            <span className="said-label">Liked</span>
            <p>{liked}</p>
          </div>
        )}
        {disliked && (
          <div className="said said-disliked">
            <span className="said-label">Didn't like</span>
            <p>{disliked}</p>
          </div>
        )}
        {!liked && !disliked && <p className="muted">The guest gave a score but didn't write anything.</p>}

        {(complaints.length > 0 || praise.length > 0) && (
          <div className="tags-row">
            {complaints.map((t) => (
              <button key={`c-${t.topic}`} className="tag tag-below" onClick={() => onTopic(t.topic, 'complaint')} title={`Words found: ${t.terms.join(', ')}`}>
                <span aria-hidden="true">!</span> {topicLabel(t.topic)}
              </button>
            ))}
            {praise.map((t) => (
              <button key={`p-${t.topic}`} className="tag tag-above" onClick={() => onTopic(t.topic, 'praise')} title={`Words found: ${t.terms.join(', ')}`}>
                <span aria-hidden="true">✓</span> {topicLabel(t.topic)}
              </button>
            ))}
          </div>
        )}
        {r.textQuality === 'misplaced_praise' && <p className="review-note">The guest wrote something nice in the “didn't like” box, so we count it as praise.</p>}
        {r.textQuality === 'non_english' && <p className="review-note">Not in English, so it isn't sorted into topics. The score still counts.</p>}
        {r.hotelReply && (
          <div className="reply">
            <span className="said-label">Our reply</span>
            <p>{r.hotelReply}</p>
          </div>
        )}
      </div>
    </article>
  );
}
