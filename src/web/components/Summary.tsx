import { useState } from 'react';
import type { ReviewFilters } from '../App';
import { PERIOD_LABELS } from '../../shared/dates';
import { topicLabel } from '../../shared/topics';
import type { Insight, PropertySummary, SummaryResponse, TopicStat } from '../../shared/types';
import type { Scope } from '../lib/api';
import { fmtScore } from '../lib/format';
import { BookingScores } from './BookingScores';
import { TrendCard } from './TrendCard';
import { Card, Change, Empty, ErrorBox, Icon, RatingPill } from './ui';

interface Props {
  summary: { data: SummaryResponse | null; error: string | null; loading: boolean; reload: () => void };
  scope: Scope;
  scopeKey: string;
  onHotel: (id: string) => void;
  onOpenReviews: (f: Partial<ReviewFilters>) => void;
}

export function Summary({ summary, scope, scopeKey, onHotel, onOpenReviews }: Props) {
  if (summary.error && !summary.data) return <ErrorBox message={summary.error} onRetry={summary.reload} />;
  const s = summary.data;
  if (!s) return <Empty title="Loading…" />;

  const versus = s.period.previousLabel;
  const periodName = PERIOD_LABELS[s.period.preset].toLowerCase();
  const points = s.insights.filter((i) => i.kind !== 'rating_change' && i.kind !== 'low_sample').slice(0, 5);
  const lowSample = s.insights.find((i) => i.kind === 'low_sample');
  const inScope = s.properties.filter((p) => scope.property === 'all' || p.id === scope.property);

  return (
    <div className={`page${summary.loading ? ' is-loading' : ''}`}>
      <div className="summary-top">
        <section className="card hero" aria-label="Average guest rating">
          <p className="eyebrow">Average guest rating · {periodName}</p>
          {s.current.avgScore !== null ? (
            <>
              <p className="hero-value">
                {fmtScore(s.current.avgScore)}
                <span className="hero-outof">/10</span>
              </p>
              <RatingPill score={s.current.avgScore} />
              <p className="hero-change">
                <Change current={s.current.avgScore} previous={s.previous.avgScore} versus={versus} />
              </p>
              <dl className="hero-facts">
                <div>
                  <dt>Reviews</dt>
                  <dd>{s.current.count}</dd>
                </div>
                <div>
                  <dt>Bad reviews</dt>
                  <dd>{s.current.negative}</dd>
                </div>
              </dl>
              {lowSample && (
                <p className="hint">
                  <Icon name="info" size={15} /> Only {s.current.count} review{s.current.count === 1 ? '' : 's'}, so this number can jump around.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="hero-value muted">–</p>
              <p className="hero-change">No reviews {periodName} yet.</p>
              <p className="hint">Try “Last 4 weeks” or “Last 3 months” above.</p>
            </>
          )}
        </section>

        <Card title="Key points" subtitle="The things worth knowing, worked out from the reviews.">
          {points.length ? (
            <ul className="points">
              {points.map((p, i) => (
                <KeyPoint key={i} point={p} onOpenReviews={onOpenReviews} />
              ))}
            </ul>
          ) : (
            <Empty title="Nothing to report for this period." />
          )}
        </Card>
      </div>

      <h2 className="section-title">Our hotels</h2>
      <p className="section-sub">Click a hotel to see only its numbers. Click it again to see all hotels.</p>
      <div className="hotel-grid">
        {s.properties.map((p) => (
          <HotelCard key={p.id} hotel={p} selected={scope.property === p.id} versus={versus} onClick={() => onHotel(scope.property === p.id ? 'all' : p.id)} />
        ))}
      </div>

      <div className="two-col">
        <TopicList
          title="Top complaints"
          subtitle="What guests didn't like"
          kind="complaint"
          topics={s.topics}
          base={s.classifiableCount}
          onOpen={(topic) => onOpenReviews({ topic, polarity: 'complaint' })}
        />
        <TopicList
          title="What guests love"
          subtitle="What guests liked"
          kind="praise"
          topics={s.topics}
          base={s.classifiableCount}
          onOpen={(topic) => onOpenReviews({ topic, polarity: 'praise' })}
        />
      </div>

      <TrendCard scope={scope} scopeKey={scopeKey} period={s.period} />

      <BookingScores hotels={inScope} />
    </div>
  );
}

const POINT_ICON: Record<Insight['tone'], string> = { good: '✓', bad: '!', neutral: 'i' };

function KeyPoint({ point, onOpenReviews }: { point: Insight; onOpenReviews: (f: Partial<ReviewFilters>) => void }) {
  return (
    <li className={`point point-${point.tone}`}>
      <span className="point-icon" aria-hidden="true">
        {POINT_ICON[point.tone]}
      </span>
      <span className="point-text">
        {point.text}
        {point.topic && (
          <button className="link point-link" onClick={() => onOpenReviews({ topic: point.topic, polarity: point.kind === 'praise' ? 'praise' : 'complaint' })}>
            Read them <Icon name="arrow" size={14} />
          </button>
        )}
      </span>
    </li>
  );
}

function HotelCard({ hotel: p, selected, versus, onClick }: { hotel: PropertySummary; selected: boolean; versus: string; onClick: () => void }) {
  return (
    <button className={`hotel-card${selected ? ' is-selected' : ''}`} onClick={onClick} aria-pressed={selected}>
      <HotelPhotoImg photo={p.photo} />
      <span className="hotel-body">
      <span className="hotel-name">{p.name}</span>
      {p.current.count && p.current.avgScore !== null ? (
        <>
          <span className="hotel-score">
            {fmtScore(p.current.avgScore)}
            <small>/10</small>
          </span>
          <RatingPill score={p.current.avgScore} />
          <span className="hotel-change">
            <Change current={p.current.avgScore} previous={p.current.count && p.previous.count ? p.previous.avgScore : null} versus={versus} />
          </span>
        </>
      ) : (
        <span className="hotel-empty">No reviews in this period</span>
      )}
      <span className="hotel-facts">
        <span>
          <span className="fact-label">Reviews</span>
          <span className="fact-value">{p.current.count}</span>
        </span>
        <span>
          <span className="fact-label">Bad reviews</span>
          <span className="fact-value">{p.current.negative}</span>
        </span>
        <span className="fact-wide">
          <span className="fact-label">Main complaint</span>
          <span className="fact-value">{p.topComplaint ? topicLabel(p.topComplaint.topic) : 'None'}</span>
        </span>
        <span className="fact-wide">
          <span className="fact-label">Booking.com overall score</span>
          <span className="fact-value">
            {fmtScore(p.bookingScore)}
            {p.bookingReviewCount !== null && <span className="fact-note"> from {p.bookingReviewCount.toLocaleString()} reviews</span>}
          </span>
        </span>
      </span>
      </span>
    </button>
  );
}

function HotelPhotoImg({ photo }: { photo: PropertySummary['photo'] }) {
  const [failed, setFailed] = useState(false);
  if (!photo || failed) {
    return (
      <span className="hotel-photo hotel-photo-empty" aria-hidden="true">
        <Icon name="hotel" size={28} />
      </span>
    );
  }
  return <img className="hotel-photo" src={photo.thumbUrl} alt={photo.alt ?? ''} loading="lazy" onError={() => setFailed(true)} />;
}

function TopicList({
  title,
  subtitle,
  kind,
  topics,
  base,
  onOpen,
}: {
  title: string;
  subtitle: string;
  kind: 'complaint' | 'praise';
  topics: TopicStat[];
  base: number;
  onOpen: (topic: string) => void;
}) {
  const count = (t: TopicStat) => (kind === 'complaint' ? t.complaints : t.praise);
  const items = topics.filter((t) => count(t) > 0).sort((a, b) => count(b) - count(a)).slice(0, 5);
  const max = Math.max(1, ...items.map(count));
  return (
    <Card title={title} subtitle={base ? `${subtitle}, out of ${base} review${base === 1 ? '' : 's'} with comments.` : subtitle}>
      {items.length ? (
        <ol className="rank-list">
          {items.map((t) => (
            <li key={t.topic}>
              <button className="rank-row" onClick={() => onOpen(t.topic)}>
                <span className="rank-name">{topicLabel(t.topic)}</span>
                <span className="rank-bar" aria-hidden="true">
                  <span className={`rank-fill ${kind}`} style={{ width: `${(count(t) / max) * 100}%` }} />
                </span>
                <span className="rank-count">
                  {count(t)} review{count(t) === 1 ? '' : 's'}
                </span>
                <span className="rank-go" aria-hidden="true">
                  <Icon name="arrow" size={16} />
                </span>
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <Empty title={kind === 'complaint' ? 'No complaints in this period.' : 'No praise found in this period.'} />
      )}
    </Card>
  );
}
