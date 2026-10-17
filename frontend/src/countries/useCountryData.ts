import { useEffect, useRef, useState } from 'react';
import type { Trip } from '../../../shared/types';
import type { CountryData } from './types';
import { attachCountryCaches } from './cache';

export function useCountryData(trips: Trip[], enabled: boolean, onUpdateTrips: (source: Trip[], updated: Trip[]) => boolean) {
  const [state, setState] = useState<{ trips: Trip[]; data?: CountryData; error?: string }>();
  const [retry, setRetry] = useState(0);
  const appliedTrips = useRef<Trip[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (appliedTrips.current === trips) { appliedTrips.current = null; return; }
    const worker = new Worker(new URL('./country.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = event => {
      if (event.data.error) { setState({ trips, error: event.data.error }); return; }
      const updated = attachCountryCaches(trips, event.data.caches);
      if (updated !== trips) {
        appliedTrips.current = updated;
        if (!onUpdateTrips(trips, updated)) return;
      }
      setState({ trips: updated, data: event.data.data });
    };
    worker.onerror = event => setState({ trips, error: event.message || 'Country calculations failed' });
    worker.postMessage({ trips, base: new URL(`${import.meta.env.BASE_URL}countries/`, location.origin).href });
    return () => worker.terminate();
  }, [trips, enabled, retry, onUpdateTrips]);
  return {
    data: state?.trips === trips ? state.data : undefined,
    error: state?.trips === trips ? state.error : undefined,
    loading: enabled && (state?.trips !== trips || (!state?.data && !state?.error)),
    retry: () => { appliedTrips.current = null; setState(undefined); setRetry(value => value + 1); }
  };
}
