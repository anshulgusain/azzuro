import type { ReactNode } from 'react';

/* ---------- Ratings in plain words ---------- */

export type Tone = 'good' | 'ok' | 'bad';

/** Words staff already know from Booking.com's own score badges. */
export function ratingWord(score: number): string {
  if (score >= 9) return 'Excellent';
  if (score >= 8) return 'Very good';
  if (score >= 7) return 'Good';
  if (score >= 6) return 'Okay';
  return 'Poor';
}

export function ratingTone(score: number): Tone {
  if (score >= 8) return 'good';
  if (score >= 6) return 'ok';
  return 'bad';
}

const TONE_ICON: Record<Tone, string> = { good: '✓', ok: '–', bad: '!' };

/** A score's meaning as a word plus icon, never colour alone. */
export function RatingPill({ score }: { score: number }) {
  const tone = ratingTone(score);
  return (
    <span className={`pill pill-${tone}`}>
      <span aria-hidden="true">{TONE_ICON[tone]}</span> {ratingWord(score)}
    </span>
  );
}

/** "▲ 0.5 higher than last week" — the arrow, the number and the words all say the same thing. */
export function Change({ current, previous, versus }: { current: number | null; previous: number | null; versus: string }) {
  if (current === null) return null;
  if (previous === null) return <span className="change change-flat">No reviews {versus} to compare with</span>;
  const delta = Math.round((current - previous) * 10) / 10;
  if (Math.abs(delta) < 0.1) return <span className="change change-flat">Same as {versus}</span>;
  const up = delta > 0;
  return (
    <span className={`change ${up ? 'change-up' : 'change-down'}`}>
      <span aria-hidden="true">{up ? '▲' : '▼'}</span> {Math.abs(delta).toFixed(1)} {up ? 'higher' : 'lower'} than {versus}
    </span>
  );
}

/* ---------- Layout ---------- */

export function Card({
  title,
  subtitle,
  actions,
  children,
  dim,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  dim?: boolean;
  className?: string;
}) {
  return (
    <section className={`card ${className}${dim ? ' is-loading' : ''}`}>
      {(title || actions) && (
        <header className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-box" role="alert">
      <strong>Something went wrong loading this page.</strong> {message}{' '}
      {onRetry && (
        <button className="link" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

/* ---------- Icons (simple line icons, inherit text colour) ---------- */

const PATHS: Record<string, string> = {
  summary: 'M4 20V11M10 20V5M16 20v-6M22 20H2',
  reviews: 'M21 11.5a8.4 8.4 0 0 1-12.2 7.5L3 20.5l1.6-5A8.4 8.4 0 1 1 21 11.5z',
  problems: 'M12 3 2 20h20L12 3zM12 10v4M12 17h.01',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-5M12 8h.01',
  warning: 'M12 3 2 20h20L12 3zM12 10v4M12 17h.01',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  hotel: 'M3 21h18M5 21V5l7-2 7 2v16M9 9h1M14 9h1M9 13h1M14 13h1M10 21v-4h4v4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4',
};

export function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
