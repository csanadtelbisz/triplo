import { useSyncExternalStore } from 'react';
import type { GalleryImage } from './gallery';

type SelectionSource = 'map' | 'strip' | 'viewer' | null;

export type RouteImagesState = {
  enabled: boolean;
  images: GalleryImage[];
  activeId: number | null;
  /** Who selected the active image, so the map only pans for swipes in the panel or viewer. */
  activeSource: SelectionSource;
  /** The full-screen viewer is open on top of the bottom panel. */
  fullscreen: boolean;
};

const ENABLED_KEY = 'showRouteImages';

let state: RouteImagesState = {
  enabled: localStorage.getItem(ENABLED_KEY) === 'true',
  images: [],
  activeId: null,
  activeSource: null,
  fullscreen: false,
};
const listeners = new Set<() => void>();

const update = (patch: Partial<RouteImagesState>) => {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
};

const CLOSED = { activeId: null, activeSource: null, fullscreen: false } as const;

export const routeImages = {
  setEnabled(enabled: boolean) {
    localStorage.setItem(ENABLED_KEY, String(enabled));
    update({ enabled, ...(enabled ? {} : { images: [], ...CLOSED }) });
  },
  setImages(images: GalleryImage[]) {
    if (images.length === state.images.length && images.every((image, index) => image.id === state.images[index].id)) return;
    const stillThere = state.activeId !== null && images.some(image => image.id === state.activeId);
    update({ images, ...(stillThere ? {} : CLOSED) });
  },
  select(id: number, source: Exclude<SelectionSource, null>) {
    update({ activeId: id, activeSource: source });
  },
  /** Opens the viewer on an image, or on the selected one. */
  openFullscreen(id?: number) {
    update({ activeId: id ?? state.activeId, activeSource: id === undefined ? state.activeSource : 'map', fullscreen: true });
  },
  /** Back to the bottom panel. */
  collapseFullscreen() {
    update({ fullscreen: false });
  },
  /** Closes the panel and the viewer. */
  close() {
    if (state.activeId === null && !state.fullscreen) return;
    update(CLOSED);
  },
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const useRouteImages = (): RouteImagesState => useSyncExternalStore(subscribe, () => state);
