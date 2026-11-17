import type { Marker } from 'maplibre-gl';

/** Markers owned by the native image layer that join the map's overlap check. */
export type ExtraMarker = {
  marker: Marker;
  element: HTMLElement;
  /** Lower ranks are kept first, like the waypoint ranks in Map.tsx. */
  rank: number;
  /** Half of the space the marker needs around it, in pixels. */
  radius: number;
};

let extraMarkers: ExtraMarker[] = [];
let declutter: (() => void) | null = null;

export const getExtraMarkers = (): ExtraMarker[] => extraMarkers;

export function setExtraMarkers(markers: ExtraMarker[]) {
  extraMarkers = markers;
  declutter?.();
}

/** The map registers its overlap check here. */
export function setDeclutterHandler(handler: (() => void) | null) {
  declutter = handler;
}

export const requestDeclutter = () => declutter?.();
