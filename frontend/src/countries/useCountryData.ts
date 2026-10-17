import { useEffect, useRef, useState } from 'react';
import type { Trip } from '../../../shared/types';
import type { CountryWorkerUpdate } from './types';
import { attachCountryCaches, sameCountryTripInputs } from './cache';

export function useCountryData(trips: Trip[], enabled: boolean, onUpdateTrips: (source: Trip[], updated: Trip[]) => boolean) {
  const [state, setState] = useState<CountryWorkerUpdate & { trips: Trip[] }>();
  const [retry, setRetry] = useState(0);
  const active = useRef<{ worker: Worker; trips: Trip[]; retry: number } | null>(null);
  useEffect(() => {
    if (!enabled) { active.current?.worker.terminate(); active.current = null; return; }
    const previous = active.current;
    if (previous && previous.retry === retry && sameCountryTripInputs(previous.trips, trips)) {
      previous.trips = trips;
      setState(value => value && { ...value, trips });
      return;
    }
    previous?.worker.terminate();
    const worker = new Worker(new URL('./country.worker.ts', import.meta.url), { type: 'module' });
    const job = { worker, trips, retry };
    active.current = job;
    setState({ trips, complete: false });
    worker.onmessage = (event: MessageEvent<CountryWorkerUpdate>) => {
      if (active.current !== job) return;
      const message = event.data;
      const updated = attachCountryCaches(job.trips, message.caches || {});
      if (updated !== job.trips) {
        if (!onUpdateTrips(job.trips, updated)) return;
        job.trips = updated;
      }
      setState(previous => ({
        ...message, trips: updated,
        data: message.data && (!previous?.data || previous.data.index.version !== message.data.index.version || Object.keys(message.data.results).length)
          ? { index: message.data.index, results: { ...previous?.data?.results, ...message.data.results } } : previous?.data,
      }));
    };
    worker.onerror = event => {
      if (active.current === job) setState(value => ({ ...value, trips: job.trips, complete: true, error: event.message || 'Country calculations failed' }));
    };
    worker.postMessage({ trips, base: new URL(`${import.meta.env.BASE_URL}countries/`, location.origin).href });
  }, [trips, enabled, retry, onUpdateTrips]);
  useEffect(() => () => { active.current?.worker.terminate(); active.current = null; }, []);
  return {
    data: state?.trips === trips ? state.data : undefined,
    error: state?.trips === trips ? state.error : undefined,
    loading: enabled && (state?.trips !== trips || !state?.complete),
    currentTrip: state?.currentTrip && (trips.find(trip => trip.id === state.currentTrip!.id)?.name || state.currentTrip.name),
    retry: () => { setState(undefined); setRetry(value => value + 1); }
  };
}
