import { useState } from 'react';
import type { Segment, Trip } from '../../../shared/types';
import { sameCountryInputs } from '../countries/cache';

function sameProperties(a: object, b: object, ignored: string[]) {
  const left = a as Record<string, unknown>, right = b as Record<string, unknown>;
  const keys = Object.keys(left).filter(key => !ignored.includes(key));
  return keys.length === Object.keys(right).filter(key => !ignored.includes(key)).length && keys.every(key => left[key] === right[key]);
}

const sameSegment = (a: Segment | null, b: Segment | null): boolean => a === b || !!a && !!b && sameCountryInputs(a, b) && sameProperties(a, b, ['geometry', 'countryParts', 'countryDistances', 'climateImpact']);
const sameTrip = (a: Trip | null, b: Trip | null): boolean => a === b || !!a && !!b && sameProperties(a, b, ['segments', 'countryDataRevision']) &&
  a.segments.length === b.segments.length && a.segments.every((segment, i) => sameSegment(segment, b.segments[i]));

export function useMapRenderInputs(trips: Trip[], selectedTrip: Trip | null, selectedSegment: Segment | null) {
  const inputs = { trips, selectedTrip, selectedSegment };
  const [previous, setPrevious] = useState({ inputs, render: inputs });
  if (previous.inputs.trips !== trips || previous.inputs.selectedTrip !== selectedTrip || previous.inputs.selectedSegment !== selectedSegment) {
    const current = previous.render;
    // Splitting a route does not change its unfiltered map.
    const unchanged = (current.trips === trips || current.trips.length === trips.length && current.trips.every((trip, i) => sameTrip(trip, trips[i]))) &&
      sameTrip(current.selectedTrip, selectedTrip) && sameSegment(current.selectedSegment, selectedSegment);
    const render = unchanged ? current : inputs;
    setPrevious({ inputs, render });
    return render;
  }
  return previous.render;
}
