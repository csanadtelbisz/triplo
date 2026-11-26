import { useSyncExternalStore } from 'react';
import type { GalleryImage } from './gallery';

type SelectionSource = 'map' | 'gallery' | 'strip' | 'viewer' | null;

export type RouteImagesState = {
  enabled: boolean;
  loading: boolean;
  images: GalleryImage[];
  activeId: number | null;
  selectionRevision: number;
  /** Who selected the active image, so the map only pans for swipes in the panel or viewer. */
  activeSource: SelectionSource;
  /** The full-screen viewer is open on top of the bottom panel. */
  fullscreen: boolean;
  editMode: boolean;
  galleryMode: boolean;
  viewerSourceSelector: string | null;
  unsavedImageIds: number[];
  locationEditId: number | null;
};

const ENABLED_KEY = 'showRouteImages';

let state: RouteImagesState = {
  enabled: localStorage.getItem(ENABLED_KEY) === 'true',
  loading: false,
  images: [],
  activeId: null,
  selectionRevision: 0,
  activeSource: null,
  fullscreen: false,
  editMode: false,
  galleryMode: false,
  viewerSourceSelector: null,
  unsavedImageIds: [],
  locationEditId: null,
};
const listeners = new Set<() => void>();

const update = (patch: Partial<RouteImagesState>) => {
  state = { ...state, ...patch };
  listeners.forEach(listener => listener());
};

const CLOSED = { activeId: null, activeSource: null, fullscreen: false, viewerSourceSelector: null } as const;

export const routeImages = {
  getState() { return state; },
  setEnabled(enabled: boolean) {
    localStorage.setItem(ENABLED_KEY, String(enabled));
    update({ enabled, ...(enabled ? {} : { images: [], ...CLOSED }) });
  },
  setLoading(loading: boolean) {
    if (state.loading !== loading) update({ loading });
  },
  setImages(images: GalleryImage[]) {
    if (images.length === state.images.length && images.every((image, index) => image.id === state.images[index].id
      && image.lat === state.images[index].lat && image.lon === state.images[index].lon)) return;
    const stillThere = state.activeId !== null && images.some(image => image.id === state.activeId);
    update({ images, ...(stillThere ? {} : CLOSED) });
  },
  select(id: number, source: Exclude<SelectionSource, null>) {
    update({ activeId: id, activeSource: source, selectionRevision: state.selectionRevision + 1 });
  },
  setEditMode(editMode: boolean) { update({ editMode }); },
  setGalleryMode(galleryMode: boolean) { update({ galleryMode }); },
  setUnsaved(id: number, unsaved: boolean) {
    const ids = new Set(state.unsavedImageIds);
    if (unsaved) ids.add(id); else ids.delete(id);
    update({ unsavedImageIds: [...ids] });
  },
  clearUnsaved() { update({ unsavedImageIds: [] }); },
  setLocationEditId(locationEditId: number | null) { update({ locationEditId }); },
  /** Opens the viewer on an image, or on the selected one. */
  openFullscreen(id?: number, sourceSelector?: string) {
    update({ activeId: id ?? state.activeId, activeSource: id === undefined ? state.activeSource : 'viewer', fullscreen: true, viewerSourceSelector: sourceSelector || null });
  },
  /** Back to the bottom panel. */
  collapseFullscreen() {
    update({ fullscreen: false, viewerSourceSelector: null });
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
