import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { Icon } from '../components/Icon';
import { imageAspect, imageCaption, panelImageUrl, thumbnailUrl } from './gallery';
import type { GalleryImage } from './gallery';
import { LayeredImage } from './LayeredImage';
import { registerNativeBackHandler } from './native';
import { routeImages } from './routeImagesStore';

const SETTLE_DELAY_MS = 80;
const GESTURE_LOCK_PX = 10;
const OPEN_DISTANCE_PX = 40;
const CLOSE_DISTANCE_PX = 60;
const FLING_SPEED = 0.5;
const CLOSE_ANIMATION_MS = 200;
const DEFAULT_ASPECT = 4 / 3;
const MAX_HEIGHT_RATIO = 0.5;
const MAX_PANEL_WIDTH = 640;

type PanelStyle = CSSProperties & { '--route-image-height': string; '--route-image-offset': string };

/** Bottom panel: a swipeable row of the route's images, oldest first. */
export function ImageStrip({ images, activeId, fullscreen }: { images: GalleryImage[]; activeId: number; fullscreen: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const settleTimer = useRef<number | undefined>(undefined);
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
    const element = scroller.current;
    if (!element || index < 0) return;
    if (Math.round(element.scrollLeft / element.clientWidth) !== index) {
      element.scrollTo({ left: index * element.clientWidth, behavior: 'instant' });
    }
  }, [index, images.length]);

  useEffect(() => registerNativeBackHandler(() => routeImages.close()), []);
  useEffect(() => () => window.clearTimeout(settleTimer.current), []);

  // Landscape photos fill the panel width. Portrait photos get the height of a 4:3 landscape photo.
  const aspect = active ? imageAspect(active) : null;
  const panelWidth = Math.min(viewport.width, MAX_PANEL_WIDTH);
  const imageHeight = Math.min(panelWidth / (aspect !== null && aspect >= 1 ? aspect : DEFAULT_ASPECT), viewport.height * MAX_HEIGHT_RATIO);

  const handleScroll = () => {
    window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      const element = scroller.current;
      if (!element) return;
      const visible = images[Math.round(element.scrollLeft / element.clientWidth)];
      if (visible && visible.id !== activeId) routeImages.select(visible.id, 'strip');
    }, SETTLE_DELAY_MS);
  };

  const step = (direction: number) => {
    const element = scroller.current;
    if (element) element.scrollTo({ left: (index + direction) * element.clientWidth, behavior: 'smooth' });
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
      window.setTimeout(() => routeImages.close(), CLOSE_ANIMATION_MS);
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
      <button className="route-image-strip-button route-image-strip-close" onClick={() => routeImages.close()} title="Close">
        <Icon name="close" size={20} />
      </button>
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
            <LayeredImage placeholder={thumbnailUrl(image.id, 640)} src={Math.abs(position - index) <= 1 ? panelImageUrl(image.id) : null} />
          </button>
        ))}
      </div>
      <div className="route-image-caption route-image-strip-caption">{imageCaption(active)} · {index + 1} / {images.length}</div>
    </div>
  );
}
