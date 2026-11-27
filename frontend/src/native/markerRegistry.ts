import type { Marker } from 'maplibre-gl';

/** Markers owned by the native image layer that join the map's overlap check. */
export type ExtraMarker = {
  marker: Marker;
  element: HTMLElement;
  /** Lower ranks are kept first, like the waypoint ranks in Map.tsx. */
  rank: number;
  /** Half of the space the marker needs around it, in pixels. */
  radius: number;
  forceVisible?: boolean;
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

export function setMarkerForceVisible(element: HTMLElement, forceVisible: boolean) {
  const entry = extraMarkers.find(candidate => candidate.element === element);
  if (!entry) return;
  entry.forceVisible = forceVisible;
  entry.rank = forceVisible ? Number.NEGATIVE_INFINITY : (element.classList.contains('active') ? -2 : -1);
  element.style.zIndex = forceVisible ? '999999' : element.classList.contains('active') ? '2' : '';
  requestDeclutter();
}
