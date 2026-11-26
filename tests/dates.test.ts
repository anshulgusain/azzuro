import { describe, expect, it } from 'vitest';
import { addDays, isValidIsoDate, resolvePeriod, startOfWeek, toLocalDate } from '../src/shared/dates.js';

describe('dates', () => {
  it('uses Sydney time for calendar dates', () => {
    // 14:00 UTC on 25 Nov is 01:00 on 26 Nov in Sydney (AEDT, UTC+11)
    expect(toLocalDate(new Date('2026-11-25T14:00:00Z'))).toBe('2026-11-26');
    expect(toLocalDate(new Date('2026-11-25T12:00:00Z'))).toBe('2026-11-25');
  });

  it('starts weeks on Monday', () => {
    expect(startOfWeek('2026-11-26')).toBe('2026-11-23'); // Thursday
    expect(startOfWeek('2026-11-23')).toBe('2026-11-23'); // Monday
    expect(startOfWeek('2026-11-29')).toBe('2026-11-23'); // Sunday
  });

  it('crosses month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(startOfWeek('2027-01-01')).toBe('2026-12-28');
  });

  it('compares this week to the whole of last week', () => {
    const p = resolvePeriod('this_week', '2026-11-26');
    expect(p.current).toEqual({ from: '2026-11-23', to: '2026-11-26' });
    expect(p.previous).toEqual({ from: '2026-11-16', to: '2026-11-22' });
    expect(p.inProgress).toBe(true);
  });

  it('compares rolling periods with the same number of preceding days', () => {
    const p = resolvePeriod('last_4_weeks', '2026-11-26');
    expect(p.current).toEqual({ from: '2026-10-30', to: '2026-11-26' });
    expect(p.previous).toEqual({ from: '2026-10-02', to: '2026-10-29' });
  });

  it('validates ISO dates', () => {
    expect(isValidIsoDate('2026-02-29')).toBe(false);
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('26-11-2026')).toBe(false);
  });
});
