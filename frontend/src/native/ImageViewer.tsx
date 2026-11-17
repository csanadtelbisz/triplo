import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from 'react';
import { flushSync } from 'react-dom';
import { Icon } from '../components/Icon';
import { fullImageUrl, imageAspect, imageCaption, panelImageUrl } from './gallery';
import type { GalleryImage } from './gallery';
import { LayeredImage } from './LayeredImage';
import { registerNativeBackHandler } from './native';
import { routeImages } from './routeImagesStore';

type View = { scale: number; x: number; y: number };
type Point = { x: number; y: number };
type Box = { cx: number; cy: number; w: number; h: number };
type Swipe = { start: Point; last: Point; time: number; vx: number; vy: number; axis: 'x' | 'y' | null };

const IDENTITY: View = { scale: 1, x: 0, y: 0 };
const MAX_SCALE = 8;
const DOUBLE_TAP_SCALE = 3;
const DOUBLE_TAP_MS = 300;
const TAP_TOLERANCE_PX = 12;
const SWIPE_LOCK_PX = 10;
const STEP_FRACTION = 0.2;
const FLING_SPEED = 0.5;
const COLLAPSE_DISTANCE_PX = 100;
const COLLAPSE_SPEED = 0.6;
const FLIP_TIMING: KeyframeAnimationOptions = { duration: 260, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' };
const SNAP_TIMING: KeyframeAnimationOptions = { duration: 180, easing: 'ease-out', fill: 'forwards' };

// Where an object-fit: contain image is drawn inside a box.
function containBox(rect: DOMRect, aspect: number | null): Box {
  const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
  if (!aspect) return { cx, cy, w: rect.width, h: rect.height };
  return aspect > rect.width / rect.height
    ? { cx, cy, w: rect.width, h: rect.width / aspect }
    : { cx, cy, w: rect.height * aspect, h: rect.height };
}

// The transform that makes the image drawn in `to` appear where it is drawn in `from`.
const flipTransform = (from: Box, to: Box) =>
  `translate(${from.cx - to.cx}px, ${from.cy - to.cy}px) scale(${from.w / to.w})`;

// Where the selected image sits in the bottom panel, and which of its corners the panel rounds off.
type PanelImage = { rect: DOMRect; radius: number };

function panelImage(): PanelImage | null {
  const layers = document.querySelector('.route-image-slide.active .route-image-layers');
  const scroller = document.querySelector('.route-image-strip-scroller');
  if (!layers || !scroller) return null;
  return { rect: layers.getBoundingClientRect(), radius: parseFloat(getComputedStyle(scroller).borderTopLeftRadius) || 0 };
}

// Keyframes for the image drawn in the bottom panel and in full screen. The clip hugs the image
// and carries the panel's rounded corners, so they grow and shrink with the movement.
function morph(panel: PanelImage, stage: DOMRect, aspect: number | null) {
  const small = containBox(panel.rect, aspect);
  const large = containBox(stage, aspect);
  const scroller = document.querySelector('.route-image-strip-scroller')!.getBoundingClientRect();
  const touches = (edge: number, panelEdge: number) => Math.abs(edge - panelEdge) < 1.5;
  const top = touches(small.cy - small.h / 2, scroller.top);
  const topLeft = top && touches(small.cx - small.w / 2, scroller.left);
  const topRight = top && touches(small.cx + small.w / 2, scroller.right);
  const radius = panel.radius * (large.w / small.w);
  const inset = (left: number, right: number) => {
    const edges = `${large.cy - large.h / 2 - stage.top}px ${stage.right - (large.cx + large.w / 2)}px ${stage.bottom - (large.cy + large.h / 2)}px ${large.cx - large.w / 2 - stage.left}px`;
    return `inset(${edges} round ${left}px ${right}px 0px 0px)`;
  };
  return {
    panel: { transform: flipTransform(small, large), clipPath: inset(topLeft ? radius : 0, topRight ? radius : 0) },
    screen: { transform: contentTransform(IDENTITY, 0), clipPath: inset(0, 0) },
  };
}

const contentTransform = (view: View, dragY: number) => `translate(${view.x}px, ${view.y + dragY}px) scale(${view.scale})`;

function imageAspectOf(image: GalleryImage, element: Element | null): number | null {
  const loaded = element?.querySelector('img');
  return imageAspect(image) ?? (loaded && loaded.naturalWidth > 0 ? loaded.naturalWidth / loaded.naturalHeight : null);
}

/** Full-screen images: swipe sideways for the next one, down to return to the panel, pinch to zoom. */
export function ImageViewer({ images, activeId }: { images: GalleryImage[]; activeId: number }) {
  const index = images.findIndex(image => image.id === activeId);
  const active = images[index];
  const stage = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const backdrop = useRef<HTMLDivElement>(null);
  const chrome = useRef<HTMLDivElement>(null);
  const [viewState, setViewState] = useState({ id: activeId, ...IDENTITY });
  const view: View = viewState.id === activeId ? viewState : IDENTITY;
  const [drag, setDrag] = useState<Point>({ x: 0, y: 0 });
  const viewRef = useRef<View>(IDENTITY);
  const latest = useRef({ images, index });
  const pointers = useRef(new Map<number, Point>());
  const pinch = useRef<{ distance: number; scale: number; anchor: Point } | null>(null);
  const swipe = useRef<Swipe | null>(null);
  const moved = useRef(false);
  const lastTap = useRef({ time: 0, x: 0, y: 0 });
  const leaving = useRef(false);

  useEffect(() => {
    latest.current = { images, index };
  });

  useEffect(() => {
    viewRef.current = IDENTITY;
  }, [activeId]);

  // Grow from the image in the bottom panel.
  useLayoutEffect(() => {
    const panel = panelImage();
    const element = content.current, area = stage.current;
    if (!panel || !element || !area) return;
    const aspect = imageAspectOf(images[index], element);
    const frames = morph(panel, area.getBoundingClientRect(), aspect);
    element.animate([frames.panel, frames.screen], FLIP_TIMING);
    backdrop.current?.animate([{ opacity: 0 }, { opacity: 1 }], FLIP_TIMING);
    chrome.current?.animate([{ opacity: 0 }, { opacity: 1 }], FLIP_TIMING);
    // Only the opening animates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Shrink back into the bottom panel.
  const collapse = () => {
    if (leaving.current) return;
    leaving.current = true;
    const element = content.current, area = stage.current, panel = panelImage();
    if (!element || !area || !panel || !latest.current.images[latest.current.index]) {
      routeImages.collapseFullscreen();
      return;
    }
    const aspect = imageAspectOf(latest.current.images[latest.current.index], element);
    const frames = morph(panel, area.getBoundingClientRect(), aspect);
    const animation = element.animate(
      [{ transform: getComputedStyle(element).transform, clipPath: frames.screen.clipPath }, frames.panel],
      { ...FLIP_TIMING, fill: 'forwards' },
    );
    const fade = { ...FLIP_TIMING, fill: 'forwards' as const };
    backdrop.current?.animate([{ opacity: getComputedStyle(backdrop.current).opacity }, { opacity: 0 }], fade);
    chrome.current?.animate([{ opacity: 1 }, { opacity: 0 }], fade);
    animation.onfinish = () => routeImages.collapseFullscreen();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') collapse(); };
    document.addEventListener('keydown', onKey);
    const unregister = registerNativeBackHandler(collapse);
    return () => {
      document.removeEventListener('keydown', onKey);
      unregister();
    };
  }, []);

  // Positions are relative to the stage center, which is the transform origin.
  const relative = (point: Point): Point => {
    const rect = stage.current!.getBoundingClientRect();
    return { x: point.x - rect.left - rect.width / 2, y: point.y - rect.top - rect.height / 2 };
  };

  const apply = (next: View) => {
    const rect = stage.current!.getBoundingClientRect();
    const scale = Math.min(MAX_SCALE, Math.max(1, next.scale));
    const limitX = (rect.width * (scale - 1)) / 2;
    const limitY = (rect.height * (scale - 1)) / 2;
    const clamped = {
      scale,
      x: Math.min(limitX, Math.max(-limitX, next.x)),
      y: Math.min(limitY, Math.max(-limitY, next.y)),
    };
    viewRef.current = clamped;
    setViewState({ id: activeId, ...clamped });
  };

  const zoomAt = (point: Point, scale: number) => {
    const current = viewRef.current;
    const anchor = { x: (point.x - current.x) / current.scale, y: (point.y - current.y) / current.scale };
    apply({ scale, x: point.x - anchor.x * scale, y: point.y - anchor.y * scale });
  };

  const settle = (animation: Animation | undefined, then: () => void) => {
    if (!animation) return then();
    animation.onfinish = () => {
      flushSync(then);
      animation.cancel();
    };
  };

  const finishSideways = (current: Swipe) => {
    const dx = current.last.x - current.start.x;
    const direction = dx < 0 ? 1 : -1;
    const neighbor = latest.current.images[latest.current.index + direction];
    const flung = Math.abs(current.vx) > FLING_SPEED && Math.sign(current.vx) === Math.sign(dx);
    const commit = !!neighbor && (Math.abs(dx) > window.innerWidth * STEP_FRACTION || flung);
    const target = commit ? -direction * window.innerWidth : 0;
    const animation = track.current?.animate([{ transform: `translateX(${drag.x}px)` }, { transform: `translateX(${target}px)` }], SNAP_TIMING);
    settle(animation, () => {
      if (commit && neighbor) routeImages.select(neighbor.id, 'viewer');
      setDrag({ x: 0, y: 0 });
    });
  };

  const finishDown = (current: Swipe) => {
    const dy = current.last.y - current.start.y;
    if (dy > COLLAPSE_DISTANCE_PX || (dy > SWIPE_LOCK_PX && current.vy > COLLAPSE_SPEED)) {
      collapse();
      return;
    }
    const animation = content.current?.animate(
      [{ transform: contentTransform(view, drag.y) }, { transform: contentTransform(view, 0) }],
      SNAP_TIMING,
    );
    backdrop.current?.animate([{ opacity: getComputedStyle(backdrop.current).opacity }, { opacity: 1 }], SNAP_TIMING);
    settle(animation, () => setDrag({ x: 0, y: 0 }));
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (leaving.current) return;
    stage.current!.setPointerCapture(event.pointerId);
    const point = { x: event.clientX, y: event.clientY };
    if (pointers.current.size === 0) {
      moved.current = false;
      swipe.current = { start: point, last: point, time: event.timeStamp, vx: 0, vy: 0, axis: null };
    }
    pointers.current.set(event.pointerId, point);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const middle = relative({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const current = viewRef.current;
      swipe.current = null;
      setDrag({ x: 0, y: 0 });
      pinch.current = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        scale: current.scale,
        anchor: { x: (middle.x - current.x) / current.scale, y: (middle.y - current.y) / current.scale },
      };
    }
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const previous = pointers.current.get(event.pointerId);
    if (!previous || leaving.current) return;
    const point = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, point);

    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()];
      const middle = relative({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const scale = Math.min(MAX_SCALE, Math.max(1, pinch.current.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance));
      apply({ scale, x: middle.x - pinch.current.anchor.x * scale, y: middle.y - pinch.current.anchor.y * scale });
      moved.current = true;
      return;
    }
    if (pointers.current.size !== 1) return;

    const current = viewRef.current;
    const gesture = swipe.current;
    if (gesture && Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > TAP_TOLERANCE_PX) moved.current = true;
    if (current.scale > 1) {
      apply({ ...current, x: current.x + point.x - previous.x, y: current.y + point.y - previous.y });
      return;
    }
    if (!gesture) return;

    const dx = point.x - gesture.start.x, dy = point.y - gesture.start.y;
    if (!gesture.axis && Math.hypot(dx, dy) > SWIPE_LOCK_PX) gesture.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    const elapsed = Math.max(1, event.timeStamp - gesture.time);
    gesture.vx = (point.x - gesture.last.x) / elapsed;
    gesture.vy = (point.y - gesture.last.y) / elapsed;
    gesture.last = point;
    gesture.time = event.timeStamp;

    if (gesture.axis === 'x') {
      const hasNeighbor = !!latest.current.images[latest.current.index + (dx < 0 ? 1 : -1)];
      setDrag({ x: hasNeighbor ? dx : dx * 0.25, y: 0 });
    } else if (gesture.axis === 'y') {
      setDrag({ x: 0, y: Math.max(0, dy) });
    }
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.delete(event.pointerId)) return;
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size > 0) return;
    if (viewRef.current.scale < 1.05) apply(IDENTITY);

    const gesture = swipe.current;
    swipe.current = null;
    if (event.type === 'pointercancel') {
      setDrag({ x: 0, y: 0 });
      return;
    }
    if (gesture?.axis === 'x') return finishSideways(gesture);
    if (gesture?.axis === 'y') return finishDown(gesture);
    if (moved.current) return;

    const now = Date.now();
    const isDoubleTap = now - lastTap.current.time < DOUBLE_TAP_MS
      && Math.hypot(event.clientX - lastTap.current.x, event.clientY - lastTap.current.y) < TAP_TOLERANCE_PX * 2;
    if (isDoubleTap) {
      zoomAt(relative({ x: event.clientX, y: event.clientY }), viewRef.current.scale > 1 ? 1 : DOUBLE_TAP_SCALE);
      lastTap.current = { time: 0, x: 0, y: 0 };
    } else {
      lastTap.current = { time: now, x: event.clientX, y: event.clientY };
    }
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    zoomAt(relative({ x: event.clientX, y: event.clientY }), viewRef.current.scale * Math.exp(-event.deltaY * 0.002));
  };

  if (!active) return null;
  const backdropOpacity = 1 - Math.min(0.7, drag.y / (window.innerHeight * 0.7));
  return (
    <div className="route-image-viewer">
      <div className="route-image-viewer-backdrop" ref={backdrop} style={{ opacity: backdropOpacity }} />
      <div
        className="route-image-viewer-stage"
        ref={stage}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        onWheel={handleWheel}
      >
        <div className="route-image-viewer-track" ref={track} style={{ transform: `translateX(${drag.x}px)` }}>
          {[-1, 0, 1].map(delta => {
            const image = images[index + delta];
            if (!image) return null;
            const current = delta === 0;
            return (
              <div className="route-image-viewer-slide" key={image.id} style={{ left: `${delta * 100}%` }}>
                <div
                  className="route-image-viewer-content"
                  ref={current ? content : undefined}
                  style={current ? { transform: contentTransform(view, drag.y) } : undefined}
                >
                  <LayeredImage placeholder={panelImageUrl(image.id)} src={current ? fullImageUrl(image.id) : null} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="route-image-viewer-chrome" ref={chrome}>
        <button className="route-image-strip-button route-image-viewer-close" onClick={() => routeImages.close()} title="Close">
          <Icon name="close" size={22} />
        </button>
      </div>
      {/* Same box as the caption in the bottom panel, so the text does not move between the views. */}
      <div className="route-image-caption route-image-viewer-caption">{imageCaption(active)} · {index + 1} / {images.length}</div>
    </div>
  );
}
