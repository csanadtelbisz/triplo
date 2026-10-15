import { distance } from '@turf/turf';
import type { Map as MapLibreMap } from 'maplibre-gl';

const HOLD_DELAY_MS = 250;
const RELEASE_DISPLAY_MS = 5000;
const MOVEMENT_TOLERANCE_PX = 4;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export function formatMeasurementDistance(meters: number): string {
  return meters > 1000
    ? `${new Intl.NumberFormat('en', { minimumSignificantDigits: 3, maximumSignificantDigits: 3, useGrouping: false }).format(meters / 1000)} km`
    : `${Math.round(meters)} m`;
}

/** Observe touches without consuming events or disabling pinch zoom. */
export function attachMobileDistanceMeasurement(map: MapLibreMap): () => void {
  const surface = map.getCanvasContainer();
  const container = map.getContainer();
  const mobile = window.matchMedia('(max-width: 768px)');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let points: { id: number; x: number; y: number }[] = [];
  let overlay: SVGSVGElement | undefined;

  const cancel = () => {
    clearTimeout(timer);
    timer = undefined;
    points = [];
    overlay?.remove();
    overlay = undefined;
  };

  const render = () => {
    timer = undefined;
    if (points.length !== 2 || !mobile.matches || map.isMoving()) return;

    const canvas = map.getCanvas();
    const rect = canvas.getBoundingClientRect();
    const local = points.map(point => ({
      x: (point.x - rect.left) * canvas.clientWidth / rect.width,
      y: (point.y - rect.top) * canvas.clientHeight / rect.height,
    }));
    const [start, end] = local;
    const from = map.unproject([start.x, start.y]);
    const to = map.unproject([end.x, end.y]);
    const label = formatMeasurementDistance(distance(from.toArray(), to.toArray(), { units: 'meters' }));

    overlay = document.createElementNS(SVG_NAMESPACE, 'svg');
    overlay.classList.add('map-distance-measurement');
    overlay.setAttribute('role', 'img');
    overlay.setAttribute('aria-label', `Distance: ${label}`);

    for (const className of ['map-distance-halo', 'map-distance-line']) {
      const line = document.createElementNS(SVG_NAMESPACE, 'line');
      line.classList.add(className);
      line.setAttribute('x1', String(start.x));
      line.setAttribute('y1', String(start.y));
      line.setAttribute('x2', String(end.x));
      line.setAttribute('y2', String(end.y));
      overlay.append(line);
    }

    for (const point of local) {
      const dot = document.createElementNS(SVG_NAMESPACE, 'circle');
      dot.setAttribute('cx', String(point.x));
      dot.setAttribute('cy', String(point.y));
      dot.setAttribute('r', '4');
      overlay.append(dot);
    }

    const text = document.createElementNS(SVG_NAMESPACE, 'text');
    text.setAttribute('x', String((start.x + end.x) / 2));
    text.setAttribute('y', String((start.y + end.y) / 2));
    text.textContent = label;
    overlay.append(text);
    surface.append(overlay);
  };

  const onTouchStart = (event: TouchEvent) => {
    cancel();
    if (!mobile.matches || event.touches.length !== 2 || map.isMoving()) return;
    const touches = Array.from(event.touches);
    // A finger on the sidebar or a map control must not start a measurement.
    if (touches.some(touch => !surface.contains(touch.target as Node))) return;
    points = touches.map(touch => ({ id: touch.identifier, x: touch.clientX, y: touch.clientY }));
    timer = setTimeout(render, HOLD_DELAY_MS);
  };

  const onTouchMove = (event: TouchEvent) => {
    if (points.length === 0) return;
    const touches = Array.from(event.touches);
    if (touches.length !== 2 || points.some(point => {
      const touch = touches.find(touch => touch.identifier === point.id);
      return !touch || Math.hypot(touch.clientX - point.x, touch.clientY - point.y) > MOVEMENT_TOLERANCE_PX;
    })) cancel();
  };

  const onTouchEnd = (event: TouchEvent) => {
    if (points.length === 0) return;
    if (!overlay) {
      cancel();
      return;
    }
    // Start the five-second reading period once both fingers have lifted.
    if (event.touches.length === 0) {
      // Finish the stationary gesture before MapLibre interprets this release as
      // a two-finger tap-to-zoom-out. Moving gestures have already cancelled us.
      map.stop();
      points = [];
      timer = setTimeout(cancel, RELEASE_DISPLAY_MS);
    }
  };

  surface.addEventListener('touchstart', onTouchStart, { passive: true });
  container.addEventListener('pointerdown', cancel, true);
  container.addEventListener('wheel', cancel, { passive: true });
  container.addEventListener('keydown', cancel);
  document.addEventListener('touchmove', onTouchMove, { passive: true });
  document.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
  document.addEventListener('touchcancel', cancel, { passive: true });
  window.addEventListener('resize', cancel);
  window.addEventListener('blur', cancel);
  document.addEventListener('visibilitychange', cancel);
  mobile.addEventListener('change', cancel);
  map.on('movestart', cancel);
  map.on('click', cancel);
  map.on('style.load', cancel);

  return () => {
    cancel();
    surface.removeEventListener('touchstart', onTouchStart);
    container.removeEventListener('pointerdown', cancel, true);
    container.removeEventListener('wheel', cancel);
    container.removeEventListener('keydown', cancel);
    document.removeEventListener('touchmove', onTouchMove);
    document.removeEventListener('touchend', onTouchEnd, true);
    document.removeEventListener('touchcancel', cancel);
    window.removeEventListener('resize', cancel);
    window.removeEventListener('blur', cancel);
    document.removeEventListener('visibilitychange', cancel);
    mobile.removeEventListener('change', cancel);
    map.off('movestart', cancel);
    map.off('click', cancel);
    map.off('style.load', cancel);
  };
}
