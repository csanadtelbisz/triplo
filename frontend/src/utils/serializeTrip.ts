import type { SharedTripReference, Trip } from '../../../shared/types';
import { tripForStorage } from '../countries/cache';

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export function serializeTrip(trip: Trip | SharedTripReference, pretty = true): string {
  const serialized = JSON.stringify('segments' in trip ? tripForStorage(trip) : trip);
  if (!pretty) return serialized;
  const value: JsonValue = JSON.parse(serialized);
  function format(value: JsonValue, depth: number, key = ''): string {
    if (value === null || typeof value !== 'object' || key === 'geometry') return JSON.stringify(value);
    const array = Array.isArray(value);
    const entries = array
      ? value.map(item => format(item, depth + 1))
      : Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}: ${format(item, depth + 1, key)}`);
    const [open, close] = array ? ['[', ']'] : ['{', '}'];
    if (!entries.length) return open + close;
    const padding = '  '.repeat(depth + 1);
    return `${open}\n${entries.map(entry => padding + entry).join(',\n')}\n${'  '.repeat(depth)}${close}`;
  }
  return format(value, 0);
}
