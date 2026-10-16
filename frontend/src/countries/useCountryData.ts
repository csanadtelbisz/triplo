import { useEffect, useState } from 'react';
import type { Trip } from '../../../shared/types';
import type { CountryData } from './types';

export function useCountryData(trips: Trip[], enabled: boolean) {
  const [state, setState] = useState<{ trips: Trip[]; data?: CountryData; error?: string }>();
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const worker = new Worker(new URL('./country.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = event => setState({ trips, ...event.data });
    worker.onerror = event => setState({ trips, error: event.message || 'Country calculations failed' });
    worker.postMessage({ trips, base: new URL(`${import.meta.env.BASE_URL}countries/`, location.origin).href });
    return () => worker.terminate();
  }, [trips, enabled, retry]);
  return {
    data: state?.trips === trips ? state.data : undefined,
    error: state?.trips === trips ? state.error : undefined,
    loading: enabled && (state?.trips !== trips || (!state?.data && !state?.error)),
    retry: () => { setState(undefined); setRetry(value => value + 1); }
  };
}
