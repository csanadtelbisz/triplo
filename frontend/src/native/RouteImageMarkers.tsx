import { useEffect, useRef } from 'react';
import { Marker } from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { fullImageUrl, hasGps, thumbnailUrl } from './gallery';
import type { GalleryImage } from './gallery';
import { requestDeclutter, setExtraMarkers, setMarkerForceVisible } from './markerRegistry';
import type { ExtraMarker } from './markerRegistry';
import { routeImages, useRouteImages } from './routeImagesStore';
import { visibleMapArea } from './visibleArea';
import './RouteImages.css';

// Images outrank every waypoint, and the selected image outranks the other images.
const IMAGE_RANK = -1;
const ACTIVE_IMAGE_RANK = -2;
const IMAGE_RADIUS_PX = 26;
const LONG_PRESS_MS = 500;
const PRESS_MOVE_TOLERANCE_PX = 8;

function createMarkerElement(image: GalleryImage, active: boolean, map: MapLibreMap, onSelect?: (galleryMode: boolean) => void): HTMLElement {
  const element = document.createElement('div');
  element.className = 'route-image-marker';
  element.dataset.imageId = String(image.id);
  element.classList.toggle('active', active);
  const body = document.createElement('div');
  body.className = 'route-image-marker-body';
  const thumbnail = document.createElement('img');
  thumbnail.src = thumbnailUrl(image.id, 128);
  thumbnail.alt = '';
  thumbnail.draggable = false;
  thumbnail.addEventListener('error', () => {
    if (thumbnail.dataset.fullImageFallback) return;
    thumbnail.dataset.fullImageFallback = 'true';
    thumbnail.src = fullImageUrl(image.id);
  });
  body.append(thumbnail);
  element.append(body);

  let timer: number | undefined;
  let pressStart: { x: number; y: number } | null = null;
  let longPressed = false;
  let dragging = false;
  let marker: Marker | null = null;
  const cancelPress = () => {
    window.clearTimeout(timer);
    timer = undefined;
  };
  element.addEventListener('pointerdown', event => {
    const pointerId = event.pointerId;
    longPressed = false;
    pressStart = { x: event.clientX, y: event.clientY };
    cancelPress();
    timer = window.setTimeout(() => {
      longPressed = true;
      if (useRouteImagesState().editMode) {
        dragging = true;
        try { element.setPointerCapture(pointerId); } catch { /* Pointer may have ended. */ }
        map.dragPan.disable();
        element.classList.add('dragging');
        setMarkerForceVisible(element, true);
      } else routeImages.openFullscreen(image.id, `.route-image-marker[data-image-id="${image.id}"] img`);
    }, LONG_PRESS_MS);
  });
  element.addEventListener('pointermove', event => {
    if (dragging && marker) {
      const rect = map.getCanvas().getBoundingClientRect();
      const position = map.unproject([event.clientX - rect.left, event.clientY - rect.top]);
      marker.setLngLat(position);
      window.dispatchEvent(new CustomEvent('triplo-photo-gps-draft', { detail: { id: image.id, lat: position.lat, lon: position.lng } }));
      return;
    }
    if (pressStart && Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > PRESS_MOVE_TOLERANCE_PX) cancelPress();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) element.addEventListener(type, () => {
    cancelPress();
    if (dragging) { dragging = false; map.dragPan.enable(); element.classList.remove('dragging'); setMarkerForceVisible(element, false); }
  });
  element.addEventListener('click', event => {
    event.stopPropagation();
    if (longPressed) {
      longPressed = false;
      return;
    }
    routeImages.select(image.id, 'map');
    onSelect?.(useRouteImagesState().galleryMode);
  });
  element.addEventListener('dblclick', event => {
    if (!useRouteImagesState().editMode) return;
    event.preventDefault();
    event.stopPropagation();
    routeImages.openFullscreen(image.id, `.route-image-marker[data-image-id="${image.id}"] img`);
  });
  // The system long-press menu and the map's own context menu would otherwise open.
  element.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  Object.defineProperty(element, 'setMarker', { value: (value: Marker) => { marker = value; } });
  return element;
}

const useRouteImagesState = () => routeImages.getState();

// The pin is 48 px wide and 56 px tall with its tip on the location.
const PIN_HALF_WIDTH_PX = 24;
const PIN_HEIGHT_PX = 56;
const VISIBLE_MARGIN_PX = 8;
const CENTERING_MS = 400;
const PANEL_WAIT_FRAMES = 20;

function applyMarkerState(element: HTMLElement, id: number, state: ReturnType<typeof routeImages.getState>) {
  // While a photo's location is edited, no pin is highlighted: the edited photo is drawn by the panel.
  const active = state.locationEditId === null && id === state.activeId;
  element.classList.toggle('active', active);
  element.classList.toggle('gps-unsaved', state.unsavedImageIds.includes(id));
  element.classList.toggle('location-editing', id === state.locationEditId);
  element.style.zIndex = element.classList.contains('dragging') ? '999999' : active ? '2' : '';
}

// Brings a selected pin into view with a single smooth move. A pin that was clicked on the map and is
// already fully visible stays where it is.
function centerPin(map: MapLibreMap, image: GalleryImage & { lat: number; lon: number }, source: string, sheet?: 'open' | 'collapsed') {
  const container = map.getContainer();
  const area = visibleMapArea(container, sheet);
  const point = map.project([image.lon, image.lat]);
  const fullyVisible = point.x - PIN_HALF_WIDTH_PX >= area.left + VISIBLE_MARGIN_PX
    && point.x + PIN_HALF_WIDTH_PX <= area.right - VISIBLE_MARGIN_PX
    && point.y - PIN_HEIGHT_PX >= area.top + VISIBLE_MARGIN_PX
    && point.y <= area.bottom - VISIBLE_MARGIN_PX;
  if (source === 'map' && fullyVisible) return;
  // easeTo places the center at the middle of the map's current padding, which earlier moves left behind.
  // Reading that padding makes the target independent of it, without changing the padding itself.
  const padding = map.getPadding();
  const paddedCenterX = ((padding.left ?? 0) + container.clientWidth - (padding.right ?? 0)) / 2;
  const paddedCenterY = ((padding.top ?? 0) + container.clientHeight - (padding.bottom ?? 0)) / 2;
  const offset: [number, number] = [area.centerX - paddedCenterX, area.centerY + PIN_HEIGHT_PX / 2 - paddedCenterY];
  if (!offset.every(Number.isFinite)) return;
  map.easeTo({ center: [image.lon, image.lat], offset, duration: CENTERING_MS, essential: true });
}
/** Thumbnail pins for the route's images. They join the map's overlap check in Map.tsx. */
export default function RouteImageMarkers({ map, onSelect }: { map: MapLibreMap | null; onSelect?: (galleryMode: boolean) => void }) {
  const { images, activeId, selectionRevision, unsavedImageIds, locationEditId } = useRouteImages();
  const markers = useRef<ExtraMarker[]>([]);
  const imageIds = useRef<number[]>([]);

  useEffect(() => {
    if (!map) return;
    const state = routeImages.getState();
    const geotagged = images.filter(hasGps);
    const created = geotagged.map(image => {
      const element = createMarkerElement(image, image.id === state.activeId, map, onSelect);
      const marker = new Marker({ element, anchor: 'bottom' }).setLngLat([image.lon, image.lat]).addTo(map);
      (element as HTMLElement & { setMarker: (marker: Marker) => void }).setMarker(marker);
      // New elements replace the old ones whenever a location changes, so they start with the current state.
      applyMarkerState(element, image.id, state);
      return { marker, element, rank: image.id === state.activeId ? ACTIVE_IMAGE_RANK : IMAGE_RANK, radius: IMAGE_RADIUS_PX };
    });
    markers.current = created;
    imageIds.current = geotagged.map(image => image.id);
    setExtraMarkers(created);
    return () => {
      created.forEach(entry => entry.marker.remove());
      markers.current = [];
      setExtraMarkers([]);
    };
  }, [map, images, onSelect]);

  useEffect(() => {
    const state = routeImages.getState();
    markers.current.forEach((entry, index) => {
      const id = imageIds.current[index];
      entry.rank = entry.forceVisible ? Number.NEGATIVE_INFINITY : id === state.activeId ? ACTIVE_IMAGE_RANK : IMAGE_RANK;
      applyMarkerState(entry.element, id, state);
    });
    requestDeclutter();
  }, [activeId, unsavedImageIds, locationEditId]);

  // Runs once per selection, after the panels around the map have changed, so the target is final.
  useEffect(() => {
    const { activeId: id, activeSource: source, images: all } = routeImages.getState();
    const image = all.filter(hasGps).find(candidate => candidate.id === id);
    // Picking a photo in the gallery list moves the map through the panel's own focus action.
    if (!map || !image || !source || source === 'gallery') return;
    // A clicked pin opens the gallery panel or collapses the sheet behind the image panel; the page may not show that yet.
    const state = routeImages.getState();
    const sheet = source === 'map' ? (state.galleryMode ? 'open' : 'collapsed') : undefined;
    // The image panel is part of the final layout, so wait for it to show up (it is missing when
    // another panel keeps it hidden).
    const expectPanel = !state.galleryMode;
    let waited = 0;
    let frame = 0;
    const tick = () => {
      if (expectPanel && !document.querySelector('.route-image-strip') && waited++ < PANEL_WAIT_FRAMES) frame = requestAnimationFrame(tick);
      else centerPin(map, image, source, sheet);
    };
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(tick); });
    return () => cancelAnimationFrame(frame);
  }, [map, selectionRevision]);

  return null;
}
