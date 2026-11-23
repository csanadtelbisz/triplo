import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { along, length, lineString, nearestPointOnLine } from '@turf/turf';
import type { Trip } from '../../../shared/types';
import { GalleryThumbnail } from './GalleryThumbnail';
import { getModeColor } from '../utils/builtInModesPreferences';
import { getEffectiveGeometry } from '../utils/effectiveGeometry';

export type RouteTimelinePiece = { coordinates: GeoJSON.Position[]; startKm: number; lengthKm: number; color: string };
export type RouteTimelineModel = { pieces: RouteTimelinePiece[]; totalKm: number };
export type RouteTimelinePhoto = { id: number; progressKm: number; position: [number, number] };

export function createRouteTimeline(trip: Trip): RouteTimelineModel {
  const pieces: RouteTimelinePiece[] = [];
  let totalKm = 0;
  for (const segment of trip.segments) {
    if (segment.isHidden) continue;
    const color = segment.customColor || getModeColor(segment.transportMode) || '#007bff';
    for (const coordinates of getEffectiveGeometry(segment).coordinates) {
      if (coordinates.length < 2) continue;
      const lengthKm = length(lineString(coordinates), { units: 'kilometers' });
      if (!Number.isFinite(lengthKm) || lengthKm <= 0) continue;
      pieces.push({ coordinates, startKm: totalKm, lengthKm, color });
      totalKm += lengthKm;
    }
  }
  return { pieces, totalKm };
}

export function timelineProgressAt(model: RouteTimelineModel, position: [number, number]): number {
  if (!model.totalKm) return 0;
  const point: GeoJSON.Position = position;
  let best = { distance: Number.POSITIVE_INFINITY, progressKm: 0 };
  for (const piece of model.pieces) {
    const nearest = nearestPointOnLine(lineString(piece.coordinates), point, { units: 'kilometers' });
    if (nearest.properties.dist < best.distance) {
      best = { distance: nearest.properties.dist, progressKm: piece.startKm + nearest.properties.location };
    }
  }
  return Math.max(0, Math.min(model.totalKm, best.progressKm));
}

export function timelinePositionAt(model: RouteTimelineModel, progressKm: number): [number, number] | null {
  if (!model.pieces.length || !model.totalKm) return null;
  const progress = Math.max(0, Math.min(model.totalKm, progressKm));
  const piece = model.pieces.find(candidate => progress <= candidate.startKm + candidate.lengthKm) || model.pieces.at(-1)!;
  const point = along(lineString(piece.coordinates), Math.max(0, Math.min(piece.lengthKm, progress - piece.startKm)), { units: 'kilometers' });
  return [point.geometry.coordinates[0], point.geometry.coordinates[1]];
}

export function RouteTimeline({ model, position, previousPhoto, nextPhoto, onSelect }: { model: RouteTimelineModel; position: [number, number] | null; previousPhoto?: RouteTimelinePhoto; nextPhoto?: RouteTimelinePhoto; onSelect: (position: [number, number]) => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [zoom, setZoom] = useState(1);
  const programmaticScroll = useRef<number | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ pointerId: number; x: number; scrollLeft: number } | null>(null);
  const pinch = useRef<{ distance: number; zoom: number; progressKm: number } | null>(null);
  const zoomAnchor = useRef<number | null>(null);
  const fitWidth = Math.min(viewportWidth * 4, Math.max(viewportWidth, model.totalKm * 20));
  const trackWidth = Math.max(100, Math.min(viewportWidth * 64, fitWidth * zoom));
  const sidePadding = viewportWidth / 2;
  const nearestProgress = useMemo(() => position ? timelineProgressAt(model, position) : 0, [model, position]);

  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewportWidth(element.clientWidth || window.innerWidth));
    observer.observe(element);
    setViewportWidth(element.clientWidth || window.innerWidth);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!previousPhoto || !nextPhoto || !model.totalKm) { setZoom(1); return; }
    const span = Math.abs(nextPhoto.progressKm - previousPhoto.progressKm);
    if (span < 0.001) { setZoom(32); return; }
    const targetWidth = Math.max(100, viewportWidth - 80) * model.totalKm / span;
    setZoom(Math.max(0.25, Math.min(32, targetWidth / Math.max(1, fitWidth))));
  }, [previousPhoto?.id, previousPhoto?.progressKm, nextPhoto?.id, nextPhoto?.progressKm, model.totalKm, viewportWidth, fitWidth]);

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element || !model.totalKm) return;
    const anchor = zoomAnchor.current;
    const desired = Math.max(0, Math.min(element.scrollWidth - element.clientWidth, sidePadding + (anchor ?? nearestProgress) / model.totalKm * trackWidth - element.clientWidth / 2));
    if (Math.abs(element.scrollLeft - desired) < 2) { zoomAnchor.current = null; return; }
    programmaticScroll.current = desired;
    element.scrollTo({ left: desired, behavior: 'instant' });
    zoomAnchor.current = null;
  }, [model, nearestProgress, sidePadding, trackWidth]);

  const handleScroll = () => {
    const element = scroller.current;
    if (!element || !model.totalKm) return;
    if (programmaticScroll.current !== null && Math.abs(element.scrollLeft - programmaticScroll.current) < 2) {
      programmaticScroll.current = null;
      return;
    }
    programmaticScroll.current = null;
    const cursorX = element.scrollLeft + element.clientWidth / 2 - sidePadding;
    const progressKm = Math.max(0, Math.min(model.totalKm, cursorX / trackWidth * model.totalKm));
    const point = timelinePositionAt(model, progressKm);
    if (point) onSelect(point);
  };

  const markerLeft = (progressKm: number) => `${Math.max(0, Math.min(model.totalKm, progressKm)) / model.totalKm * trackWidth}px`;
  const pointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if ((event.target as Element).closest('.trip-route-timeline-photo-marker')) return;
    event.preventDefault();
    const element = scroller.current;
    if (!element) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer may have ended. */ }
    if (pointers.current.size === 1) {
      drag.current = { pointerId: event.pointerId, x: event.clientX, scrollLeft: element.scrollLeft };
      return;
    }
    if (pointers.current.size === 2) {
      drag.current = null;
      const [first, second] = [...pointers.current.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      pinch.current = { distance: Math.max(1, distance), zoom, progressKm: nearestProgress };
    }
  };
  const pointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    event.stopPropagation();
    event.preventDefault();
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const element = scroller.current;
    if (!element) return;
    if (pointers.current.size >= 2 && pinch.current) {
      const [first, second] = [...pointers.current.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const nextZoom = Math.max(0.25, Math.min(32, pinch.current.zoom * distance / pinch.current.distance));
      if (Math.abs(nextZoom - zoom) > 0.002) {
        zoomAnchor.current = pinch.current.progressKm;
        setZoom(nextZoom);
      }
    } else if (drag.current?.pointerId === event.pointerId) {
      element.scrollLeft = drag.current.scrollLeft - (event.clientX - drag.current.x);
    }
  };
  const pointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.stopPropagation();
    pointers.current.delete(event.pointerId);
    pinch.current = null;
    if (pointers.current.size === 1 && scroller.current) {
      const [pointerId, point] = [...pointers.current.entries()][0];
      drag.current = { pointerId, x: point.x, scrollLeft: scroller.current.scrollLeft };
    } else drag.current = null;
  };
  return <div className="trip-route-timeline" ref={viewport} aria-label="Trip route timeline">
    <div className="trip-route-timeline-scroll" ref={scroller} onScroll={handleScroll} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
      <div className="trip-route-timeline-content" style={{ width: `${trackWidth + sidePadding * 2}px` }}>
        <div className="trip-route-timeline-track" style={{ left: `${sidePadding}px`, width: `${trackWidth}px` }}>
          {model.pieces.map((piece, index) => <span key={index} style={{ left: `${piece.startKm / model.totalKm * 100}%`, width: `${piece.lengthKm / model.totalKm * 100}%`, backgroundColor: piece.color }} />)}
          {nextPhoto && <span className="trip-route-timeline-photo-marker next" style={{ left: markerLeft(nextPhoto.progressKm) }} title="Copy location from next photo" onClick={event => { event.stopPropagation(); onSelect(nextPhoto.position); }}><GalleryThumbnail id={nextPhoto.id} size={128} /></span>}
          {previousPhoto && <span className="trip-route-timeline-photo-marker previous" style={{ left: markerLeft(previousPhoto.progressKm) }} title="Copy location from previous photo" onClick={event => { event.stopPropagation(); onSelect(previousPhoto.position); }}><GalleryThumbnail id={previousPhoto.id} size={128} /></span>}
        </div>
      </div>
    </div>
    <span className="trip-route-timeline-cursor" aria-hidden="true" />
  </div>;
}
