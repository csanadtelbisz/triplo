import type { Trip } from '../../../shared/types';

const parseLocalDay = (value?: string): Date | null => {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : new Date(date.getFullYear(), date.getMonth(), date.getDate());
};

/** The trip's whole first to last day in device-local time, or null without both dates. */
export function tripPeriod(trip: Pick<Trip, 'startDate' | 'endDate'>): { from: number; to: number } | null {
  const start = parseLocalDay(trip.startDate);
  const end = parseLocalDay(trip.endDate);
  if (!start || !end || end < start) return null;
  return { from: start.getTime(), to: new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1).getTime() - 1 };
}
