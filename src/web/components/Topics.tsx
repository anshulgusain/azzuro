import type { ReviewFilters } from '../App';
import { topicLabel } from '../../shared/topics';
import type { MetaResponse, SummaryResponse } from '../../shared/types';
import { pct } from '../lib/format';
import { Card, Empty, ErrorBox } from './ui';

interface Props {
  summary: { data: SummaryResponse | null; error: string | null; loading: boolean; reload: () => void };
  meta: MetaResponse | null;
  onOpenReviews: (f: Partial<ReviewFilters>) => void;
}

export function Topics({ summary, meta, onOpenReviews }: Props) {
  if (summary.error && !summary.data) return <ErrorBox message={summary.error} onRetry={summary.reload} />;
  const s = summary.data;
  if (!s) return <Empty title="Loading…" />;
  const base = s.classifiableCount;
  const rows = [...s.topics].sort((a, b) => b.complaints - a.complaints || b.praise - a.praise);
  const max = Math.max(1, ...rows.map((r) => Math.max(r.complaints, r.praise)));
  const negatives = s.negativeWithText;

  return (
    <div className="stack">
      <Card
        title="What guests talk about"
        subtitle={
          base
            ? `${base} review${base === 1 ? '' : 's'} with comments in this period. A review can mention several topics. Click a topic to read the reviews.`
            : 'No reviews with comments in this period.'
        }
        dim={summary.loading}
        actions={
          <div className="legend">
            <span>
              <i className="swatch neg" /> Complaints
            </span>
            <span>
              <i className="swatch pos" /> Praise
            </span>
          </div>
        }
      >
        {base === 0 ? (
          <Empty title="Nothing to show for this period">Try a longer period using the bar above.</Empty>
        ) : (
          <div className="topic-rows" role="list">
            <div className="topic-row header" aria-hidden="true">
              <span>Topic</span>
              <span style={{ textAlign: 'right' }}>Complaints (% of reviews)</span>
              <span>Praise (% of reviews)</span>
              <span>Complaints vs {s.period.previousLabel}</span>
            </div>
            {rows.map((t) => {
              const change = t.complaints - t.previousComplaints;
              return (
                <button
                  key={t.topic}
                  className="topic-row"
                  role="listitem"
                  onClick={() => onOpenReviews({ topic: t.topic, polarity: t.complaints ? 'complaint' : 'praise' })}
                  aria-label={`${topicLabel(t.topic)}: ${t.complaints} complaints, ${t.praise} praise`}
                >
                  <span className="topic-name">
                    <strong>{topicLabel(t.topic)}</strong>
                    {negatives > 0 && t.negativeReviewsMentioning > 0 && (
                      <span className="small muted" style={{ display: 'block' }}>
                        in {pct(t.negativeReviewsMentioning, negatives)}% of negative reviews
                      </span>
                    )}
                  </span>
                  <span className="half left">
                    <span className="val">
                      {t.complaints} · {pct(t.complaints, base)}%
                    </span>
                    {t.complaints > 0 && <span className="bar neg" style={{ width: `${(t.complaints / max) * 72}%` }} />}
                  </span>
                  <span className="half">
                    {t.praise > 0 && <span className="bar pos" style={{ width: `${(t.praise / max) * 72}%` }} />}
                    <span className="val">
                      {t.praise} · {pct(t.praise, base)}%
                    </span>
                  </span>
                  <span className="change">
                    {change === 0 ? '→ same' : change > 0 ? `▲ ${change} more` : `▼ ${-change} fewer`}{' '}
                    <span className="muted">({t.previousComplaints} before)</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      <Card title="How topics are assigned" subtitle="Plain rules, so every tag can be explained.">
        <div className="method">
          <p>
            Booking.com asks guests two questions: what they <strong>liked</strong> and what they <strong>disliked</strong>. We look for topic words in each answer. A topic
            found in the disliked answer counts as a <strong>complaint</strong>; in the liked answer it counts as <strong>praise</strong>. The guest's score (1–10)
            decides whether the whole review is positive (8–10), mixed (6–7) or negative (1–5).
          </p>
          <p>
            Answers like “Nothing” or “All good” in the disliked box are ignored. Short compliments written in the disliked box (e.g. “Friendly staff”) are counted as
            praise and marked on the review.
          </p>
          <p>
            <strong>Limits:</strong> keywords miss sarcasm, unusual wording and spelling mistakes, and can occasionally tag a word used in another sense. Reviews not in
            English get no tags (their scores still count). Every tag in the review feed shows the words that triggered it, so mistakes are easy to spot and the word
            lists can be improved.
          </p>
        </div>
        <div className="stack" style={{ gap: 8, marginTop: 8 }}>
          {meta?.topics.map((t) => (
            <details key={t.id}>
              <summary>
                {t.label}: {t.description}
              </summary>
              <div className="term-list">
                {t.terms.map((term) => (
                  <code key={term}>{term}</code>
                ))}
              </div>
            </details>
          ))}
        </div>
      </Card>
    </div>
  );
}
