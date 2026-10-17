import { useEffect, useMemo, useRef, useState } from 'react';
import type { Trip } from '../../../shared/types';
import type { CountryWorkerUpdate } from './types';
import { segmentKey } from './types';
import { retainCountryData, sameCountryTripInputs } from './cache';

export function useCountryData(trips: Trip[], enabled: boolean, onUpdateTrips: (source: Trip[], distances: Record<string, Record<string, number>>) => Trip[] | undefined, country: string | null = null) {
  const [state, setState] = useState<CountryWorkerUpdate & { trips: Trip[] }>();
  const [retry, setRetry] = useState(0);
  const active = useRef<{ worker: Worker; trips: Trip[]; retry: number; country: string | null } | null>(null);
  useEffect(() => {
    if (!enabled) { active.current?.worker.terminate(); active.current = null; return; }
    const previous = active.current;
    const needsGeometry = country && country !== previous?.country && trips.some(trip => trip.segments.some(segment =>
      !!segment.countryDistances?.[country] && state?.data?.results[segmentKey(trip.id, segment.id)]?.geometryReady === false));
    if (previous && previous.retry === retry && !needsGeometry && sameCountryTripInputs(previous.trips, trips)) {
      previous.trips = trips;
      setState(value => value && value.trips !== trips ? { ...value, trips } : value);
      return;
    }
    previous?.worker.terminate();
    const worker = new Worker(new URL('./country.worker.ts', import.meta.url), { type: 'module' });
    const job = { worker, trips, retry, country };
    active.current = job;
    setState(previous => ({ trips, complete: false, data: retainCountryData(previous?.data, previous?.trips || [], trips) }));
    worker.onmessage = (event: MessageEvent<CountryWorkerUpdate>) => {
      if (active.current !== job) return;
      const message = event.data;
      const updated = onUpdateTrips(job.trips, message.distances || {});
      if (!updated) return;
      job.trips = updated;
      setState(previous => {
        const data = message.data && (!previous?.data || previous.data.index.version !== message.data.index.version || Object.keys(message.data.results).length)
          ? { index: message.data.index, results: { ...(previous?.data?.index.version === message.data.index.version ? previous.data.results : {}), ...message.data.results } } : previous?.data;
        if (previous?.trips === updated && previous.data === data && previous.complete === message.complete && previous.error === message.error &&
          previous.currentTrip?.id === message.currentTrip?.id && previous.currentTrip?.name === message.currentTrip?.name) return previous;
        return { trips: updated, data, complete: message.complete, error: message.error, currentTrip: message.currentTrip };
      });
    };
    worker.onerror = event => {
      if (active.current === job) setState(value => ({ ...value, trips: job.trips, complete: true, error: event.message || 'Country calculations failed' }));
    };
    worker.postMessage({ trips, country, base: new URL(`${import.meta.env.BASE_URL}countries/`, location.origin).href });
  }, [trips, enabled, retry, onUpdateTrips, country, state?.data?.results]);
  useEffect(() => () => { active.current?.worker.terminate(); active.current = null; }, []);
  const data = useMemo(() => retainCountryData(state?.data, state?.trips || [], trips), [state?.data, state?.trips, trips]);
  const currentInputs = useMemo(() => !!state && sameCountryTripInputs(state.trips, trips), [state?.trips, trips]);
  return {
    data,
    error: currentInputs ? state?.error : undefined,
    loading: enabled && (!currentInputs || !state?.complete),
    currentTrip: currentInputs && state?.currentTrip ? trips.find(trip => trip.id === state.currentTrip!.id)?.name || state.currentTrip.name : undefined,
    retry: () => setRetry(value => value + 1)
  };
}
