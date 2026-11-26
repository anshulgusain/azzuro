import type { ReactNode } from 'react';
import { SENTIMENT_LABELS, type Sentiment } from '../../shared/topics';
import { fmtScore } from '../lib/format';

export function Card({ title, subtitle, actions, children, dim }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; dim?: boolean }) {
  return (
    <section className={`card${dim ? ' loading-dim' : ''}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** Signed change with direction shown by arrow and words, not colour alone. */
export function Delta({ value, suffix = '', higherIsBetter = true, digits = 1 }: { value: number | null; suffix?: string; higherIsBetter?: boolean; digits?: number }) {
  if (value === null || Number.isNaN(value)) return <span className="delta flat">no comparison</span>;
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return <span className="delta flat">→ no change</span>;
  const good = rounded > 0 === higherIsBetter;
  return (
    <span className={`delta ${good ? 'up' : 'down'}`}>
      {rounded > 0 ? '▲' : '▼'} {Math.abs(rounded).toFixed(digits)}
      {suffix}
    </span>
  );
}

export function ScoreBadge({ score, sentiment }: { score: number; sentiment: Sentiment }) {
  return (
    <div className={`score-badge ${sentiment}`} title={SENTIMENT_LABELS[sentiment]} aria-label={`Score ${score} out of 10, ${SENTIMENT_LABELS[sentiment]}`}>
      {Number.isInteger(score) ? score : score.toFixed(1)}
    </div>
  );
}

export function Meter({ value, max = 10, label }: { value: number | null; max?: number; label: string }) {
  return (
    <div className="meter" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value ?? undefined}>
      <div className="meter-track">{value !== null && <div className="meter-fill" style={{ width: `${(value / max) * 100}%` }} />}</div>
      <span className="meter-value">{fmtScore(value)}</span>
    </div>
  );
}

export function ToneIcon({ tone }: { tone: 'good' | 'bad' | 'neutral' }) {
  const glyph = tone === 'good' ? '✓' : tone === 'bad' ? '!' : 'i';
  const label = tone === 'good' ? 'Good news' : tone === 'bad' ? 'Needs attention' : 'For information';
  return (
    <span className={`tone-icon tone-${tone}`} role="img" aria-label={label}>
      {glyph}
    </span>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <strong>Could not load this data.</strong> {message}{' '}
      {onRetry && (
        <button className="btn-link" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
