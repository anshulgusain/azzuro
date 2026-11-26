import type { ReviewFilters } from '../App';
import { topicLabel } from '../../shared/topics';
import type { MetaResponse, SummaryResponse, TopicStat } from '../../shared/types';
import { Card, Empty, ErrorBox, Icon } from './ui';

interface Props {
  summary: { data: SummaryResponse | null; error: string | null; loading: boolean; reload: () => void };
  meta: MetaResponse | null;
  onOpenReviews: (f: Partial<ReviewFilters>) => void;
}

export function Problems({ summary, meta, onOpenReviews }: Props) {
  if (summary.error && !summary.data) return <ErrorBox message={summary.error} onRetry={summary.reload} />;
  const s = summary.data;
  if (!s) return <Empty title="Loading…" />;
  const base = s.classifiableCount;
  const versus = s.period.previousLabel;

  return (
    <div className={`page${summary.loading ? ' is-loading' : ''}`}>
      <p className="lead">
        {base
          ? `We read ${base} review${base === 1 ? '' : 's'} with comments and sorted what guests said into topics. Click any topic to read those reviews.`
          : 'No reviews with comments in this time period. Try a longer period at the top of the page.'}
      </p>
      {base > 0 && (
        <div className="two-col">
          <TopicColumn
            title="Complaints"
            subtitle="What guests didn't like"
            kind="complaint"
            topics={s.topics}
            base={base}
            versus={versus}
            onOpen={(topic) => onOpenReviews({ topic, polarity: 'complaint' })}
          />
          <TopicColumn
            title="Praise"
            subtitle="What guests liked"
            kind="praise"
            topics={s.topics}
            base={base}
            versus={versus}
            onOpen={(topic) => onOpenReviews({ topic, polarity: 'praise' })}
          />
        </div>
      )}

      <Card title="How we sort reviews into topics">
        <div className="prose">
          <p>
            Booking.com asks every guest two questions: what they <strong>liked</strong> and what they <strong>didn't like</strong>. We look for words about each topic in
            the answers. For example, “dirty”, “stain” or “smell” in the “didn't like” answer count as a <strong>cleanliness complaint</strong>.
          </p>
          <p>
            This works well most of the time, but it can miss sarcasm or spelling mistakes, and sometimes picks up a word used in a different way. Each topic label on
            a review shows the words it found when you hover over it.
          </p>
        </div>
        <details className="word-lists">
          <summary>See the words we look for</summary>
          <div className="word-grid">
            {meta?.topics.map((t) => (
              <div key={t.id}>
                <h3>{t.label}</h3>
                <p className="muted small">{t.description}</p>
                <p className="small">{t.terms.map((x) => x.replace(/\*$/, '…')).join(', ')}</p>
              </div>
            ))}
          </div>
        </details>
      </Card>
    </div>
  );
}

function TopicColumn({
  title,
  subtitle,
  kind,
  topics,
  base,
  versus,
  onOpen,
}: {
  title: string;
  subtitle: string;
  kind: 'complaint' | 'praise';
  topics: TopicStat[];
  base: number;
  versus: string;
  onOpen: (topic: string) => void;
}) {
  const count = (t: TopicStat) => (kind === 'complaint' ? t.complaints : t.praise);
  const items = [...topics].sort((a, b) => count(b) - count(a));
  const max = Math.max(1, ...items.map(count));
  return (
    <Card title={title} subtitle={subtitle}>
      <ol className="rank-list rank-list-large">
        {items.map((t) => {
          const n = count(t);
          const change = t.complaints - t.previousComplaints;
          return (
            <li key={t.topic}>
              <button className="rank-row" onClick={() => onOpen(t.topic)} disabled={n === 0}>
                <span className="rank-name">
                  {topicLabel(t.topic)}
                  {kind === 'complaint' && n > 0 && change !== 0 && (
                    <span className={`rank-change ${change > 0 ? 'worse' : 'better'}`} title={`Compared with ${versus}`}>
                      {change > 0 ? `▲ ${change} more` : `▼ ${-change} fewer`} than before
                    </span>
                  )}
                </span>
                <span className="rank-bar" aria-hidden="true">
                  <span className={`rank-fill ${kind}`} style={{ width: `${(n / max) * 100}%` }} />
                </span>
                <span className="rank-count">
                  {n} <span className="muted">({Math.round((n / base) * 100)}%)</span>
                </span>
                <span className="rank-go" aria-hidden="true">
                  {n > 0 && <Icon name="arrow" size={16} />}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
