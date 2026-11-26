/**
 * Date helpers. All reporting is done in the hotels' local time zone
 * (Australia/Sydney) and works on plain `YYYY-MM-DD` strings so that week
 * boundaries never drift with the server's or the browser's time zone.
 */
export const REPORTING_TZ = 'Australia/Sydney';

/** A calendar date as YYYY-MM-DD. */
export type IsoDate = string;

const localDateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: REPORTING_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Converts an instant to the calendar date it falls on in Sydney. */
export function toLocalDate(instant: Date): IsoDate {
  return localDateFmt.format(instant); // en-CA formats as YYYY-MM-DD
}

export function todayLocal(now: Date = new Date()): IsoDate {
  return toLocalDate(now);
}

function parse(d: IsoDate): Date {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

function format(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const x = parse(d);
  x.setUTCDate(x.getUTCDate() + n);
  return format(x);
}

/** Inclusive number of days between two dates. */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((parse(to).getTime() - parse(from).getTime()) / 86_400_000) + 1;
}

/** Monday of the week containing `d` (ISO weeks start on Monday). */
export function startOfWeek(d: IsoDate): IsoDate {
  const x = parse(d);
  const dow = (x.getUTCDay() + 6) % 7; // 0 = Monday
  return addDays(d, -dow);
}

export function isValidIsoDate(d: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return format(parse(d)) === d;
}

export interface DateRange {
  from: IsoDate;
  to: IsoDate;
}

export type PeriodPreset = 'this_week' | 'last_week' | 'last_4_weeks' | 'last_3_months' | 'last_12_months' | 'custom';

export const PERIOD_LABELS: Record<PeriodPreset, string> = {
  this_week: 'This week',
  last_week: 'Last week',
  last_4_weeks: 'Last 4 weeks',
  last_3_months: 'Last 3 months',
  last_12_months: 'Last 12 months',
  custom: 'Custom dates',
};

export interface ResolvedPeriod {
  preset: PeriodPreset;
  current: DateRange;
  previous: DateRange;
  /** Human label for the comparison period, e.g. "last week". */
  previousLabel: string;
  /** True when the current period has not finished yet (e.g. this week). */
  inProgress: boolean;
}

/**
 * Turns a preset (or custom range) into the current period and the period
 * it is compared against. Week presets compare whole calendar weeks
 * (Mon–Sun); rolling presets compare against the same number of days
 * immediately before.
 */
export function resolvePeriod(preset: PeriodPreset, today: IsoDate, custom?: DateRange): ResolvedPeriod {
  const thisMonday = startOfWeek(today);
  switch (preset) {
    case 'this_week':
      return {
        preset,
        current: { from: thisMonday, to: today },
        previous: { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) },
        previousLabel: 'last week',
        inProgress: true,
      };
    case 'last_week':
      return {
        preset,
        current: { from: addDays(thisMonday, -7), to: addDays(thisMonday, -1) },
        previous: { from: addDays(thisMonday, -14), to: addDays(thisMonday, -8) },
        previousLabel: 'the week before',
        inProgress: false,
      };
    case 'last_4_weeks':
      return rolling(preset, today, 28, 'previous 4 weeks');
    case 'last_3_months':
      return rolling(preset, today, 91, 'previous 3 months');
    case 'last_12_months':
      return rolling(preset, today, 364, 'previous 12 months');
    case 'custom': {
      if (!custom) throw new Error('custom period needs a date range');
      const len = daysBetween(custom.from, custom.to);
      return {
        preset,
        current: custom,
        previous: { from: addDays(custom.from, -len), to: addDays(custom.from, -1) },
        previousLabel: `previous ${len} days`,
        inProgress: custom.to >= today,
      };
    }
  }
}

function rolling(preset: PeriodPreset, today: IsoDate, days: number, previousLabel: string): ResolvedPeriod {
  const from = addDays(today, -(days - 1));
  return {
    preset,
    current: { from, to: today },
    previous: { from: addDays(from, -days), to: addDays(from, -1) },
    previousLabel,
    inProgress: true,
  };
}
