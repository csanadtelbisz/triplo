import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import type { ReactNode } from 'react';
import { Icon } from '../components/Icon';
import { fullImageUrl, imageAspect, imageCaption, panelImageUrl, thumbnailUrl } from './gallery';
import type { GalleryImage } from './gallery';
import { LayeredImage } from './LayeredImage';
import { registerNativeBackHandler } from './native';
import { routeImages } from './routeImagesStore';

const SETTLE_DELAY_MS = 80;
// Share of a slide the panel must move before the neighbour counts as selected.
const SWIPE_START_FRACTION = 0.04;
const GESTURE_LOCK_PX = 10;
const OPEN_DISTANCE_PX = 40;
const CLOSE_DISTANCE_PX = 60;
const FLING_SPEED = 0.5;
const CLOSE_ANIMATION_MS = 200;
const DEFAULT_ASPECT = 4 / 3;
const MAX_HEIGHT_RATIO = 0.5;
const MAX_PANEL_WIDTH = 640;

type PanelStyle = CSSProperties & { '--route-image-height': string; '--route-image-offset': string };

function measureSlideTargets(element: HTMLElement): number[] {
  if (!element.clientWidth) return [];
  const viewport = element.getBoundingClientRect();
  const center = viewport.left + element.clientLeft + element.clientWidth / 2;
  return Array.from(element.children, child => {
    const slide = child.getBoundingClientRect();
    return element.scrollLeft + slide.left + slide.width / 2 - center;
  });
}

function slidePositionAt(scrollLeft: number, targets: number[]): number {
  if (targets.length < 2) return 0;
  if (scrollLeft <= targets[0]) return 0;
  for (let index = 0; index < targets.length - 1; index++) {
    const start = targets[index], end = targets[index + 1];
    if (scrollLeft <= end) return index + (scrollLeft - start) / (end - start);
  }
  return targets.length - 1;
}

/** Bottom panel: a swipeable row of the route's images, oldest first. */
export function ImageStrip({ images, activeId, activeSource, fullscreen, hideCloseButton = false, onDismiss, onSwipeChange, timeline }: { images: GalleryImage[]; activeId: number; activeSource: string | null; fullscreen: boolean; hideCloseButton?: boolean; onDismiss?: () => void; onSwipeChange?: (image: GalleryImage) => void; timeline?: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | undefined>(undefined);
  const scrollStart = useRef<number | null>(null);
  const slideTargets = useRef<number[]>([]);
  const latest = useRef({ images, activeId });
  const gesture = useRef<{ x: number; y: number; time: number; axis: 'x' | 'y' | null } | null>(null);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const index = images.findIndex(image => image.id === activeId);
  const active = images[index];

  useEffect(() => {
    const onResize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useLayoutEffect(() => {
    latest.current = { images, activeId };
  });

  // Selections made by swiping this panel must not scroll it again.
  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    if (activeSource !== 'strip') {
      window.clearTimeout(settleTimer.current);
      scrollStart.current = null;
    }
    const measureAndAlign = () => {
      const targets = measureSlideTargets(element);
      if (!targets.length) return;
      slideTargets.current = targets;
      if (activeSource !== 'strip' && index >= 0 && Math.abs(element.scrollLeft - targets[index]) > 1) {
        element.scrollLeft = targets[index];
      }
    };
    measureAndAlign();
    const observer = new ResizeObserver(measureAndAlign);
    observer.observe(element);
    return () => observer.disconnect();
  }, [activeId, index, images, activeSource]);

  useEffect(() => registerNativeBackHandler(() => routeImages.close()), []);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  // Landscape photos fill the panel width. Portrait photos get the height of a 4:3 landscape photo.
  const aspect = active ? imageAspect(active) : null;
  const panelWidth = Math.min(viewport.width, MAX_PANEL_WIDTH);
  const imageHeight = Math.min(panelWidth / (aspect !== null && aspect >= 1 ? aspect : DEFAULT_ASPECT), viewport.height * MAX_HEIGHT_RATIO);

  // The neighbour becomes the selected image as soon as the swipe starts, so the map moves
  // right away. When the scrolling stops, the image that is actually in view is selected.
  const handleScroll = () => {
    const element = scroller.current;
    if (!element) return;
    const { images: all, activeId: selectedId } = latest.current;
    const position = slidePositionAt(element.scrollLeft, slideTargets.current);
    if (scrollStart.current === null) scrollStart.current = all.findIndex(image => image.id === selectedId);
    const delta = position - scrollStart.current;
    const target = Math.abs(delta) > SWIPE_START_FRACTION ? scrollStart.current + Math.sign(delta) : scrollStart.current;
    const heading = all[Math.max(0, Math.min(all.length - 1, target))];
    if (!onSwipeChange && heading && heading.id !== selectedId) routeImages.select(heading.id, 'strip');

    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      scrollStart.current = null;
      const visible = latest.current.images[Math.round(slidePositionAt(element.scrollLeft, slideTargets.current))];
      if (visible && visible.id !== latest.current.activeId) {
        if (onSwipeChange) onSwipeChange(visible);
        else routeImages.select(visible.id, 'strip');
      }
    }, SETTLE_DELAY_MS);
  };

  const step = (direction: number) => {
    const element = scroller.current;
    const target = slideTargets.current[index + direction];
    if (element && target !== undefined) element.scrollTo({ left: target, behavior: 'smooth' });
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest('.route-image-strip-button')) return;
    gesture.current = { x: event.clientX, y: event.clientY, time: event.timeStamp, axis: null };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current) return;
    const dx = event.clientX - current.x, dy = event.clientY - current.y;
    if (!current.axis && Math.hypot(dx, dy) > GESTURE_LOCK_PX) {
      current.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      if (current.axis === 'y') {
        root.current?.setPointerCapture(event.pointerId);
        setDragging(true);
      }
    }
    if (current.axis === 'y') setOffset(Math.max(0, dy));
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    gesture.current = null;
    if (!current || current.axis !== 'y') return;
    setDragging(false);
    const dy = event.clientY - current.y;
    const speed = dy / Math.max(1, event.timeStamp - current.time);
    if (event.type !== 'pointercancel' && (dy < -OPEN_DISTANCE_PX || (dy < -GESTURE_LOCK_PX && speed < -FLING_SPEED))) {
      setOffset(0);
      routeImages.openFullscreen();
    } else if (event.type !== 'pointercancel' && (dy > CLOSE_DISTANCE_PX || (dy > GESTURE_LOCK_PX && speed > FLING_SPEED))) {
      setOffset(root.current?.getBoundingClientRect().height ?? viewport.height);
      window.setTimeout(() => onDismiss ? onDismiss() : routeImages.close(), CLOSE_ANIMATION_MS);
    } else {
      setOffset(0);
    }
  };

  if (!active) return null;
  const style: PanelStyle = { '--route-image-height': `${imageHeight}px`, '--route-image-offset': `${offset}px` };
  const classes = ['route-image-strip', fullscreen && 'fullscreen', dragging && 'dragging'].filter(Boolean).join(' ');
  return (
    <div
      className={classes}
      style={style}
      ref={root}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      {!hideCloseButton && <button className="route-image-strip-button route-image-strip-close" onClick={() => routeImages.close()} title="Close">
        <Icon name="close" size={20} />
      </button>}
      {index > 0 && (
        <button className="route-image-strip-button route-image-strip-nav route-image-strip-prev" onClick={() => step(-1)} title="Previous image">
          <Icon name="chevron_left" size={24} />
        </button>
      )}
      {index < images.length - 1 && (
        <button className="route-image-strip-button route-image-strip-nav route-image-strip-next" onClick={() => step(1)} title="Next image">
          <Icon name="chevron_right" size={24} />
        </button>
      )}
      <div className="route-image-strip-scroller" ref={scroller} onScroll={handleScroll}>
        {images.map((image, position) => (
          <button
            key={image.id}
            className={`route-image-slide${image.id === activeId ? ' active' : ''}`}
            onClick={() => routeImages.openFullscreen(image.id)}
          >
            {/* The neighbours load their sharp version ahead of time for smooth swiping. */}
            <LayeredImage placeholder={thumbnailUrl(image.id, 640)} placeholderFallback={fullImageUrl(image.id)} src={Math.abs(position - index) <= 1 ? panelImageUrl(image.id) : null} />
          </button>
        ))}
      </div>
      {timeline}
      <div className="route-image-caption route-image-strip-caption">{imageCaption(active)} · {index + 1} / {images.length}</div>
    </div>
  );
}
