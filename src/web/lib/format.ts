import type { IsoDate } from '../../shared/dates';

const parse = (d: IsoDate) => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
};

export const fmtDay = (d: IsoDate) =>
  parse(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const fmtShortDay = (d: IsoDate) => parse(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function fmtRange(from: IsoDate, to: IsoDate): string {
  if (from === to) return fmtDay(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  return `${sameYear ? fmtShortDay(from) : fmtDay(from)} – ${fmtDay(to)}`;
}

export function fmtRelative(iso: string | null): string {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Australia/Sydney' });

export const fmtScore = (n: number | null | undefined) => (n === null || n === undefined ? '–' : n.toFixed(1));

export const pct = (part: number, whole: number) => (whole ? Math.round((part / whole) * 100) : 0);

export const fmtStayMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
};
