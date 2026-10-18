import { countryDistances } from './parts';
import type { Segment, Trip } from '../../../shared/types';
import { segmentKey } from './types';
import type { CountryData } from './types';

export interface AnalyticsSelection {
  climate?: boolean;
  climateView?: 'trips' | 'modes';
  distanceSelection?: Pick<AnalyticsSelection, 'countries' | 'country' | 'mode'>;
  countries: boolean;
  country: string | null;
  mode: string | null;
  range: [number, number] | null;
  year: number | null;
}
export const emptyAnalyticsSelection: AnalyticsSelection = { countries: false, country: null, mode: null, range: null, year: null };
export const modeKey = (segment: Segment) => segment.transportMode === 'other' && segment.customIcon ? `other:${segment.customIcon}` : segment.transportMode;
const day = 86400000;
function tripDays(trip: Trip): [number, number] | null {
  const start = trip.startDate ? Date.parse(trip.startDate) : NaN;
  const end = trip.endDate ? Date.parse(trip.endDate) : start;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const utcDay = (time: number) => { const d = new Date(time); return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()); };
  return [utcDay(start), Math.max(utcDay(start), utcDay(end))];
}
export function tripIntersects(trip: Trip, range: [number, number] | null): boolean {
  if (!range) return true;
  const dates = tripDays(trip);
  if (!dates) return true;
  const d = (t: number) => { const date = new Date(t); return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()); };
  return dates[0] <= d(range[1]) && dates[1] >= d(range[0]);
}
export function tripFraction(trip: Trip, range: [number, number] | null): number {
  const dates = tripDays(trip);
  if (!range || !dates) return 1;
  const d = (t: number) => { const date = new Date(t); return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()); };
  return Math.max(0, Math.min(dates[1], d(range[1])) - Math.max(dates[0], d(range[0])) + day) / (dates[1] - dates[0] + day);
}
export function selectedDistance(trip: Trip, segment: Segment, country: string | null, data?: CountryData): number {
  if (segment.routingProfile === 'teleport') return 0;
  return country ? (data?.results[segmentKey(trip.id, segment.id)]?.distanceKmByCountry || countryDistances(segment))?.[country] || 0 : segment.distanceStats?.totalDistance || 0;
}
export function countryYearDistances(trips: Trip[], selection: AnalyticsSelection, data?: CountryData, metric: typeof selectedDistance = selectedDistance) {
  const years = new Map<number, number>();
  for (const trip of trips) {
    if (!trip.startDate) continue;
    const start = new Date(trip.startDate).getFullYear(), end = new Date(trip.endDate || trip.startDate).getFullYear();
    const total = trip.segments.reduce((sum, segment) => sum + (!selection.mode || modeKey(segment) === selection.mode ? metric(trip, segment, selection.country, data) : 0), 0);
    for (let year = start; year <= end; year++) {
      const range: [number, number] = [new Date(year, 0, 1).getTime(), new Date(year, 11, 31).getTime()];
      years.set(year, (years.get(year) || 0) + total * tripFraction(trip, range));
    }
  }
  return [...years].sort(([a], [b]) => a - b).map(([year, distance]) => ({ year, distance }));
}
