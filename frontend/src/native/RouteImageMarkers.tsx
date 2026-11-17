import { useEffect, useRef } from 'react';
import { Marker } from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';
import { thumbnailUrl } from './gallery';
import type { GalleryImage } from './gallery';
import { requestDeclutter, setExtraMarkers } from './markerRegistry';
import type { ExtraMarker } from './markerRegistry';
import { routeImages, useRouteImages } from './routeImagesStore';
import './RouteImages.css';

// Images outrank every waypoint, and the selected image outranks the other images.
const IMAGE_RANK = -1;
const ACTIVE_IMAGE_RANK = -2;
const IMAGE_RADIUS_PX = 26;
const LONG_PRESS_MS = 500;
const PRESS_MOVE_TOLERANCE_PX = 8;

function createMarkerElement(image: GalleryImage, active: boolean): HTMLElement {
  const element = document.createElement('div');
  element.className = 'route-image-marker';
  element.classList.toggle('active', active);
  const body = document.createElement('div');
  body.className = 'route-image-marker-body';
  const thumbnail = document.createElement('img');
  thumbnail.src = thumbnailUrl(image.id, 128);
  thumbnail.alt = '';
  thumbnail.draggable = false;
  body.append(thumbnail);
  element.append(body);

  let timer: number | undefined;
  let pressStart: { x: number; y: number } | null = null;
  let longPressed = false;
  const cancelPress = () => {
    window.clearTimeout(timer);
    timer = undefined;
  };
  element.addEventListener('pointerdown', event => {
    longPressed = false;
    pressStart = { x: event.clientX, y: event.clientY };
    cancelPress();
    timer = window.setTimeout(() => {
      longPressed = true;
      routeImages.openFullscreen(image.id);
    }, LONG_PRESS_MS);
  });
  element.addEventListener('pointermove', event => {
    if (pressStart && Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y) > PRESS_MOVE_TOLERANCE_PX) cancelPress();
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) element.addEventListener(type, cancelPress);
  element.addEventListener('click', event => {
    event.stopPropagation();
    if (longPressed) {
      longPressed = false;
      return;
    }
    routeImages.select(image.id, 'map');
  });
  // The system long-press menu and the map's own context menu would otherwise open.
  element.addEventListener('contextmenu', event => {
    event.preventDefault();
    event.stopPropagation();
  });
  return element;
}

/** Thumbnail pins for the route's images. They join the map's overlap check in Map.tsx. */
export default function RouteImageMarkers({ map }: { map: MapLibreMap | null }) {
  const { images, activeId, activeSource } = useRouteImages();
  const markers = useRef<ExtraMarker[]>([]);
  const imageIds = useRef<number[]>([]);
  const activeRef = useRef<number | null>(activeId);

  useEffect(() => {
    if (!map) return;
    const created = images.map(image => {
      const active = image.id === activeRef.current;
      const element = createMarkerElement(image, active);
      const marker = new Marker({ element, anchor: 'bottom' }).setLngLat([image.lon, image.lat]).addTo(map);
      return { marker, element, rank: active ? ACTIVE_IMAGE_RANK : IMAGE_RANK, radius: IMAGE_RADIUS_PX };
    });
    markers.current = created;
    imageIds.current = images.map(image => image.id);
    setExtraMarkers(created);
    return () => {
      created.forEach(entry => entry.marker.remove());
      markers.current = [];
      setExtraMarkers([]);
    };
  }, [map, images]);

  useEffect(() => {
    activeRef.current = activeId;
    markers.current.forEach((entry, index) => {
      const active = imageIds.current[index] === activeId;
      entry.rank = active ? ACTIVE_IMAGE_RANK : IMAGE_RANK;
      entry.element.classList.toggle('active', active);
      entry.element.style.zIndex = active ? '2' : '';
    });
    requestDeclutter();

    const image = images.find(candidate => candidate.id === activeId);
    if (map && image && (activeSource === 'strip' || activeSource === 'viewer')) {
      // Keep the pin visible above the bottom panel.
      const panelHeight = document.querySelector('.route-image-strip')?.getBoundingClientRect().height ?? 0;
      map.easeTo({ center: [image.lon, image.lat], offset: [0, -panelHeight / 2], duration: 300 });
    }
    // Only a change of selection should move the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, activeSource]);

  return null;
}
