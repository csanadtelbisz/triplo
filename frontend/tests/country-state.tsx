import { useCallback, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Trip } from '../../shared/types';
import { AnalyticsPanel } from '../src/components/AnalyticsPanel';
import { emptyAnalyticsSelection } from '../src/countries/analytics';
import { attachCountryDistances, sameCountryTripInputs } from '../src/countries/cache';
import { useCountryData } from '../src/countries/useCountryData';
import '../src/styles/TripEditor.css';

function fixture(id: string, west: number): Trip {
  const coordinates: [number, number][] = [[west, 0], [west + 0.5, 0]];
  return { id, name: id, createdAt: '', updatedAt: '', segments: [{
    id: `${id}-segment`, transportMode: 'car', routingProfile: 'straight', routingService: 'manual', source: 'manual',
    geometry: { type: 'LineString', coordinates }, waypoints: coordinates.map((coordinates, i) => ({ id: `${id}-${i}`, coordinates })),
  }] };
}

function CountryState() {
  const [trips, setTrips] = useState([fixture('Ready trip', -1)]);
  const latest = useRef(trips);
  latest.current = trips;
  const [selection, setSelection] = useState({ ...emptyAnalyticsSelection, countries: true });
  const apply = useCallback((source: Trip[], caches: Record<string, Record<string, number>>) => {
    if (!sameCountryTripInputs(source, latest.current)) return undefined;
    const updated = attachCountryDistances(latest.current, caches);
    if (updated !== latest.current) {
      latest.current = JSON.parse(JSON.stringify(updated));
      setTrips(latest.current);
    }
    return latest.current;
  }, []);
  const countries = useCountryData(trips, true, apply);
  return <>
    <button onClick={() => setTrips(current => JSON.parse(JSON.stringify([...current, fixture('New trip', 0.5)])))}>Add another trip</button>
    <button onClick={() => setTrips(current => JSON.parse(JSON.stringify(current)))}>Reload identical geometry</button>
    <AnalyticsPanel trips={trips} selection={selection} onSelectionChange={setSelection} isReadOnly onGoBack={() => {}}
      onUpdateTrip={() => {}} onOpenSegmentInfo={() => {}} onFocusSegment={() => {}}
      timeSliderVisible={false} onToggleTimeSlider={() => {}} countryData={countries.data}
      countryLoading={countries.loading} countryCurrentTrip={countries.currentTrip} countryError={countries.error} onRetryCountries={countries.retry} />
  </>;
}

createRoot(document.getElementById('root')!).render(<CountryState />);
