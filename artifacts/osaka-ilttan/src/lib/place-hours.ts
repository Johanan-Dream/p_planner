import type { TravelHours, TravelPlace } from '@workspace/api-client-react';

export const WEEK = '일월화수목금토';

export type WeeklyInfo =
  | { kind: 'alwaysOpen' }
  | { kind: 'closedDays'; days: number[] }
  | { kind: 'unknown' };

/** Regular closed weekdays only when periods form a complete, valid weekly schedule. */
export function weeklyClosed(h?: TravelHours): WeeklyInfo {
  const ps = h?.periods;
  if (!ps || ps.length === 0) return { kind: 'unknown' };
  if (ps.length === 1 && ps[0].open && !ps[0].close && ps[0].open.day === 0 && (ps[0].open.hour ?? 0) === 0 && (ps[0].open.minute ?? 0) === 0) return { kind: 'alwaysOpen' };
  const open = new Set<number>();
  for (const p of ps) {
    const o = p.open, c = p.close;
    if (!o || !c) return { kind: 'unknown' };
    if (typeof o.day !== 'number' || o.day < 0 || o.day > 6 || typeof c.day !== 'number' || c.day < 0 || c.day > 6) return { kind: 'unknown' };
    const begin = o.day * 1440 + (o.hour ?? 0) * 60 + (o.minute ?? 0);
    let end = c.day * 1440 + (c.hour ?? 0) * 60 + (c.minute ?? 0);
    if (end <= begin) end += 7 * 1440;
    for (let day = 0; day < 7; day++) for (const shift of [-10080, 0, 10080])
      if (end + shift > day * 1440 && begin + shift < (day + 1) * 1440) open.add(day);
  }
  return { kind: 'closedDays', days: [0, 1, 2, 3, 4, 5, 6].filter((d) => !open.has(d)) };
}

/** Date-specific Google periods override regular weekdays only within their seven-day coverage. */
export function travelClosedDates(p: TravelPlace, dates: string[]) {
  const checked = p.checkedAt ? Date.parse(p.checkedAt) : NaN;
  const checkedDate = Number.isFinite(checked) ? Date.parse(new Date(checked + 9 * 3600000).toISOString().slice(0, 10) + 'T00:00:00Z') : NaN;
  const regular = new Set(closedTripDates(p.openingHours, dates));
  return dates.filter(date => {
    const stamp = Date.parse(date + 'T00:00:00Z'), ps = p.currentHours?.periods;
    if (!ps || !Number.isFinite(checkedDate) || stamp < checkedDate || stamp >= checkedDate + 7 * 86400000) return regular.has(date);
    if (ps.some(x => x.open?.day === 0 && !x.close && !(x.open.hour ?? 0) && !(x.open.minute ?? 0))) return false;
    const at = (point: typeof ps[number]['open']) => point?.date?.year && point.date.month && point.date.day
      ? Date.UTC(point.date.year, point.date.month - 1, point.date.day, point.hour ?? 0, point.minute ?? 0) : NaN;
    if (ps.some(x => !Number.isFinite(at(x.open)) || !Number.isFinite(at(x.close)))) return false;
    return !ps.some(x => at(x.close) > stamp && at(x.open) < stamp + 86400000);
  });
}

export function weekdayOf(date: string) {
  const t = new Date(date + 'T00:00:00');
  return isNaN(t.getTime()) ? null : t.getDay();
}

/** Trip dates that fall on a Google regular closed weekday. Never infers temporary closures. */
export function closedTripDates(h: TravelHours | undefined, dates: string[]) {
  const w = weeklyClosed(h);
  if (w.kind !== 'closedDays' || w.days.length === 0) return [];
  return dates.filter((d) => { const wd = weekdayOf(d); return wd != null && w.days.includes(wd); });
}

export function dday(date: string) {
  const t = Date.parse(date + 'T00:00:00');
  if (!Number.isFinite(t)) return null;
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((t - now.getTime()) / 86400000);
}
