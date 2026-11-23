import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Trip } from '../../../shared/types';
import { Icon } from '../components/Icon';
import { ConfirmDialog } from '../components/Dialog';
import { Dialog } from '../components/Dialog';
import { hasGps, persistGpsEdits, queryGallery, requestGalleryAccess, sortImagesByTime } from './gallery';
import type { GalleryImage } from './gallery';
import { tripPeriod } from './tripPeriod';
import { visibleCenterOnScreen } from './visibleArea';
import { routeImages, useRouteImages } from './routeImagesStore';
import { ImageStrip } from './ImageStrip';
import { GalleryThumbnail } from './GalleryThumbnail';
import { createRouteTimeline, RouteTimeline, timelineProgressAt } from './RouteTimeline';
import { registerNativeBackHandler } from './native';
import './TripGalleryPanel.css';

// Where a photo placed on the map would be shown: the middle of the part of the map nothing covers.
function readPinPoint(): { x: number; y: number } | null {
  const map = document.getElementById('map');
  if (!map) return null;
  const { x, y } = visibleCenterOnScreen(map);
  return { x: Math.round(x), y: Math.round(y) };
}

const GRID_GAP_PX = 3;
// Set once the user has accepted that backup apps may show an edited photo as a duplicate.
const BACKUP_RISK_ACCEPTED_KEY = 'gpsEditBackupWarningAccepted';
const SCROLL_FALLBACK_MS = 700;

const nextFrames = (count: number) => new Promise<void>(resolve => {
  const step = (left: number) => requestAnimationFrame(() => left <= 1 ? resolve() : step(left - 1));
  step(count);
});

export function TripGalleryPanel({ trip, onGoBack, onFocus, onEditLocation, onTimelineSelect, getMapCenter }: { trip: Trip; onGoBack: () => void; onFocus: (image: GalleryImage) => void; onEditLocation: (image: GalleryImage | null, defaultPosition?: [number, number]) => void; onTimelineSelect: (position: [number, number]) => void; getMapCenter: () => [number, number] | null }) {
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [editing, setEditing] = useState(false);
  const [changes, setChanges] = useState<Record<number, [number, number]>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveProgress, setSaveProgress] = useState<{ id: number | null; current: number; total: number; phase: string; name?: string } | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState<GalleryImage | null>(null);
  const [draft, setDraft] = useState<[number, number] | null>(null);
  const [excludeScreenshots, setExcludeScreenshots] = useState(true);
  const [onlyGeotagged, setOnlyGeotagged] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmBackupRisk, setConfirmBackupRisk] = useState(false);
  const [locationFeedback, setLocationFeedback] = useState('');
  const [addBarBottom, setAddBarBottom] = useState(0);
  const [pinPoint, setPinPoint] = useState<{ x: number; y: number } | null>(null);
  const focusFrame = useRef<number | null>(null);
  const feedbackTimer = useRef<number | null>(null);
  const initialDraft = useRef<{ id: number; position: [number, number] | null }>({ id: -1, position: null });
  const originalImages = useRef<GalleryImage[]>([]);
  const pressTimer = useRef<number | null>(null);
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const priorEnabled = useRef(routeImages.getState().enabled);
  const period = tripPeriod(trip);
  const { activeId, activeSource, selectionRevision, locationEditId } = useRouteImages();
  const visibleImages = useMemo(
    () => images.filter(image => (!excludeScreenshots || !image.screenshot) && (!onlyGeotagged || hasGps(image))),
    [images, excludeScreenshots, onlyGeotagged],
  );
  const geotaggedCount = visibleImages.filter(hasGps).length;
  const chronologicalImages = useMemo(() => sortImagesByTime(visibleImages), [visibleImages]);
  const timelineModel = useMemo(() => createRouteTimeline(trip), [trip]);
  const neighboringPhotos = useMemo(() => {
    if (!adding || !timelineModel.totalKm) return { previous: undefined, next: undefined };
    const index = chronologicalImages.findIndex(image => image.id === adding.id);
    const previousImage = chronologicalImages.slice(0, index).reverse().find(hasGps);
    const nextImage = chronologicalImages.slice(index + 1).find(hasGps);
    return {
      previous: previousImage ? { id: previousImage.id, position: [previousImage.lon, previousImage.lat] as [number, number], progressKm: timelineProgressAt(timelineModel, [previousImage.lon, previousImage.lat]) } : undefined,
      next: nextImage ? { id: nextImage.id, position: [nextImage.lon, nextImage.lat] as [number, number], progressKm: timelineProgressAt(timelineModel, [nextImage.lon, nextImage.lat]) } : undefined,
    };
  }, [adding, chronologicalImages, timelineModel]);

  useEffect(() => {
    if (!filtersOpen) return;
    const onClick = (event: MouseEvent) => {
      if (!filterMenuRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [filtersOpen]);

  useEffect(() => {
    if (!adding) return;
    const timer = window.setInterval(() => { setDraft(getMapCenter()); setPinPoint(readPinPoint()); }, 150);
    return () => window.clearInterval(timer);
  }, [adding, getMapCenter]);

  useEffect(() => {
    if (!adding) return;
    const updatePosition = () => {
      const strip = document.querySelector('.route-image-strip');
      if (strip) setAddBarBottom(Math.max(8, window.innerHeight - strip.getBoundingClientRect().top + 8));
      setPinPoint(readPinPoint());
    };
    const observer = new ResizeObserver(updatePosition);
    const strip = document.querySelector('.route-image-strip');
    if (strip) observer.observe(strip);
    window.addEventListener('resize', updatePosition);
    const frame = requestAnimationFrame(updatePosition);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', updatePosition); };
  }, [adding]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (!period || !(await requestGalleryAccess())) throw new Error('Photo library access is required.');
        const found = await queryGallery(period.from, period.to);
        if (!cancelled) { originalImages.current = found; setImages(found); }
      } catch (error) {
        if (!cancelled) setImages([]);
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not access the photo library.');
        console.error('Trip gallery could not load', error);
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [period?.from, period?.to]);

  useEffect(() => {
    routeImages.setGalleryMode(true);
    routeImages.setEnabled(true);
    return () => { endLocationEdit(); routeImages.close(); routeImages.clearUnsaved(); routeImages.setLocationEditId(null); routeImages.setEditMode(false); routeImages.setGalleryMode(false); routeImages.setEnabled(priorEnabled.current); };
  }, []);

  useEffect(() => () => { if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current); }, []);

  useEffect(() => { routeImages.setEditMode(editing); }, [editing]);

  const openViewer = (id: number) => routeImages.openFullscreen(id, `.trip-gallery-image[data-image-id="${id}"] img`);

  useEffect(() => {
    routeImages.setImages(visibleImages.filter(hasGps));
  }, [visibleImages]);

  useEffect(() => {
    if (activeSource !== 'map' || activeId === null) return;
    const tile = document.querySelector<HTMLElement>(`.trip-gallery-image[data-image-id="${activeId}"]`);
    const grid = tile?.parentElement;
    if (!tile || !grid) return;
    let cancelled = false;
    const remove = () => tile.classList.remove('map-selection-pulse');
    void (async () => {
      // Let the sheet finish opening, then scroll the grid itself. scrollIntoView would also scroll the
      // sheet and the page around the grid, which left every panel shifted.
      await nextFrames(2);
      await Promise.allSettled((tile.closest('.sidebar')?.getAnimations() ?? []).map(animation => animation.finished));
      if (cancelled) return;
      const top = tile.getBoundingClientRect().top - grid.getBoundingClientRect().top;
      const hidden = top < 0 ? top - GRID_GAP_PX : top + tile.offsetHeight > grid.clientHeight ? top + tile.offsetHeight - grid.clientHeight + GRID_GAP_PX : 0;
      if (hidden) {
        grid.scrollBy({ top: hidden, behavior: 'smooth' });
        await new Promise<void>(resolve => {
          const done = () => { grid.removeEventListener('scrollend', done); window.clearTimeout(fallback); resolve(); };
          const fallback = window.setTimeout(done, SCROLL_FALLBACK_MS);
          grid.addEventListener('scrollend', done);
        });
        if (cancelled) return;
      }
      // Start the pulse only now, so it plays while the tile can be seen.
      remove();
      void tile.offsetWidth;
      tile.classList.add('map-selection-pulse');
      tile.addEventListener('animationend', remove, { once: true });
    })();
    return () => { cancelled = true; tile.removeEventListener('animationend', remove); remove(); };
  }, [activeId, activeSource, selectionRevision]);

  useEffect(() => {
    const onPosition = (event: Event) => {
      const { id, lat, lon } = (event as CustomEvent<{ id: number; lat: number; lon: number }>).detail;
      setChanges(previous => ({ ...previous, [id]: [lat, lon] }));
      routeImages.setUnsaved(id, true);
    };
    window.addEventListener('triplo-photo-gps-draft', onPosition);
    return () => window.removeEventListener('triplo-photo-gps-draft', onPosition);
  }, []);

  const showLocationFeedback = (message: string) => {
    setLocationFeedback(message);
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setLocationFeedback(''), 2400);
  };

  const stageLocation = (id: number, position: [number, number]) => {
    setChanges(previous => ({ ...previous, [id]: position }));
    setImages(previous => previous.map(image => image.id === id ? { ...image, lat: position[0], lon: position[1] } : image));
    routeImages.setUnsaved(id, true);
  };

  const draftHasMoved = (image: GalleryImage, position: [number, number] | null) => {
    const baseline = initialDraft.current.id === image.id ? initialDraft.current.position : hasGps(image) ? [image.lon, image.lat] as [number, number] : null;
    return !!position && (!baseline || Math.abs(position[0] - baseline[0]) > 0.000001 || Math.abs(position[1] - baseline[1]) > 0.000001);
  };

  const finishCurrentEdit = (): GalleryImage | null => {
    if (!adding) return null;
    if (draftHasMoved(adding, draft)) {
      const position: [number, number] = [draft![1], draft![0]];
      stageLocation(adding.id, position);
      showLocationFeedback('New location stored');
      return { ...adding, lat: position[0], lon: position[1] };
    } else {
      if (!changes[adding.id]) routeImages.setUnsaved(adding.id, false);
      const original = originalImages.current.find(image => image.id === adding.id) || adding;
      if (!hasGps(original)) showLocationFeedback('New location discarded');
      return hasGps(adding) ? adding : null;
    }
  };

  const resetPhotoLocation = (id: number) => {
    setChanges(previous => {
      const next = { ...previous };
      delete next[id];
      return next;
    });
    const original = originalImages.current.find(image => image.id === id);
    if (original) setImages(previous => previous.map(image => image.id === id ? original : image));
    routeImages.setUnsaved(id, false);
  };

  const startEditing = () => {
    if (localStorage.getItem(BACKUP_RISK_ACCEPTED_KEY) === 'true') setEditing(true);
    else setConfirmBackupRisk(true);
  };

  const discardChanges = () => {
    setConfirmDiscard(false);
    setChanges({}); setAdding(null); setDraft(null); endLocationEdit(); routeImages.clearUnsaved(); routeImages.setLocationEditId(null);
    routeImages.close();
    onGoBack();
  };

  const close = () => {
    if (saving) return;
    if (Object.keys(changes).length || adding) { setConfirmDiscard(true); return; }
    endLocationEdit(); routeImages.close(); onGoBack();
  };

  const cancelLocationEdit = () => {
    if (adding && !changes[adding.id]) routeImages.setUnsaved(adding.id, false);
    setAdding(null); setDraft(null); endLocationEdit(); routeImages.setLocationEditId(null);
  };

  // Place the photo's location where the pin will be drawn, after the image panel has appeared.
  const endLocationEdit = () => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    focusFrame.current = null;
    onEditLocation(null);
  };

  const beginLocationEdit = (image: GalleryImage, precedingPhoto?: GalleryImage | null) => {
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    const imageIndex = chronologicalImages.findIndex(candidate => candidate.id === image.id);
    const precedingIndex = precedingPhoto ? chronologicalImages.findIndex(candidate => candidate.id === precedingPhoto.id) : -1;
    const previousGps = !hasGps(image) ? (precedingPhoto && hasGps(precedingPhoto) && precedingIndex < imageIndex ? precedingPhoto : chronologicalImages.slice(0, imageIndex).reverse().find(hasGps)) : undefined;
    const position = hasGps(image) ? [image.lon, image.lat] as [number, number] : previousGps ? [previousGps.lon, previousGps.lat] as [number, number] : getMapCenter();
    initialDraft.current = { id: image.id, position };
    focusFrame.current = requestAnimationFrame(() => { focusFrame.current = requestAnimationFrame(() => {
      focusFrame.current = null;
      onEditLocation(image, hasGps(image) ? undefined : position || undefined);
      if (!hasGps(image)) requestAnimationFrame(() => {
        const aligned = getMapCenter();
        initialDraft.current = { id: image.id, position: aligned };
        setDraft(aligned);
      });
    }); });
    routeImages.select(image.id, 'gallery');
    routeImages.setLocationEditId(image.id);
    routeImages.setUnsaved(image.id, true);
    setAdding(image);
    setDraft(position);
  };

  useEffect(() => registerNativeBackHandler(close), [editing, changes, adding, saving]);
  const showImage = (image: GalleryImage) => {
    routeImages.setImages(visibleImages);
    if (hasGps(image)) {
      if (editing) beginLocationEdit(image);
      else { onFocus(image); routeImages.select(image.id, 'gallery'); }
    } else if (editing) {
      routeImages.select(image.id, 'gallery');
      beginLocationEdit(image);
    } else {
      routeImages.setImages(visibleImages);
      openViewer(image.id);
    }
  };

  const save = async () => {
    if (!Object.keys(changes).length) { setEditing(false); return; }
    setSaving(true); setError('');
    try {
      const names = Object.fromEntries(images.map(image => [image.id, image.name || `Photo ${image.id}`]));
      const result = await persistGpsEdits(changes, progress => {
        setSaveProgress({ ...progress, name: progress.id === null ? undefined : names[progress.id] });
      }, names);
      const failedIds = new Set(result.failures.map(failure => failure.id));
      const failedEdits = Object.fromEntries(Object.entries(changes).filter(([id]) => failedIds.has(Number(id))));
      for (const id of Object.keys(changes).map(Number)) routeImages.setUnsaved(id, failedIds.has(id));
      setChanges(failedEdits);
      if (!result.failures.length) setEditing(false);
      const period = tripPeriod(trip);
      if (period) {
        setSaveProgress({ id: null, current: result.savedIds.length + result.failures.length, total: Object.keys(changes).length, phase: 'Refreshing photos' });
        try {
          const refreshed = await queryGallery(period.from, period.to);
          originalImages.current = refreshed;
          setImages(refreshed.map(image => failedEdits[image.id] ? { ...image, lat: failedEdits[image.id][0], lon: failedEdits[image.id][1] } : image));
        } catch (refreshError) {
          setError(`Locations were saved, but the gallery could not refresh: ${refreshError instanceof Error ? refreshError.message : String(refreshError)}`);
        }
      }
      if (result.failures.length) {
        setError(`Could not save ${result.failures.length} photo${result.failures.length === 1 ? '' : 's'}: ${result.failures.map(failure => `${failure.name || `Photo ${failure.id}`}: ${failure.error}`).join('; ')}`);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Some photo locations could not be saved.');
    } finally { setSaving(false); setSaveProgress(null); }
  };

  return <section className={`trip-gallery-panel${adding ? ' adding-gps' : ''}`}>
    <header className="toolbar">
      <button className="iconButton" aria-label="Back" disabled={saving} onClick={close}><Icon name="arrow_back" size={20} /></button>
      <h2 className="status-panel-header-title">Trip Gallery</h2>
      <div className="status-panel-header-spacer" />
      <div className="trip-gallery-filter-control" ref={filterMenuRef}>
        <button className={`iconButton${filtersOpen ? ' active' : ''}`} aria-label="Filter photos" aria-expanded={filtersOpen} onClick={() => setFiltersOpen(open => !open)}><Icon name="filter_list" size={20} /></button>
        {filtersOpen && <div className="trip-sort-menu trip-gallery-filter-menu" role="menu">
          <div className={`trip-sort-menu-option${excludeScreenshots ? ' selected' : ''}`} role="menuitemcheckbox" aria-checked={excludeScreenshots} onClick={() => setExcludeScreenshots(value => !value)}>
            <span>Exclude screenshots</span>{excludeScreenshots && <Icon name="check" size={18} />}
          </div>
          <div className={`trip-sort-menu-option${onlyGeotagged ? ' selected' : ''}`} role="menuitemcheckbox" aria-checked={onlyGeotagged} onClick={() => setOnlyGeotagged(value => !value)}>
            <span>Only geotagged photos</span>{onlyGeotagged && <Icon name="check" size={18} />}
          </div>
        </div>}
      </div>
      {!editing && <button className="iconButton" aria-label="Edit GPS metadata" onClick={startEditing}><Icon name="edit" size={20} /></button>}
      {editing && Object.keys(changes).length === 0 && <button className="iconButton" aria-label="Cancel editing" onClick={() => setEditing(false)}><Icon name="close" size={20} /></button>}
      {editing && Object.keys(changes).length > 0 && <button className="iconButton trip-gallery-save" style={{ color: '#0878d1' }} aria-label={saving ? 'Saving GPS metadata' : 'Save GPS metadata'} title={saving ? 'Saving' : 'Save'} disabled={saving} onClick={() => void save()}><Icon name={saving ? 'sync' : 'save'} size={20} className={saving ? 'spinning' : undefined} /></button>}
    </header>
    {error && <p className="trip-gallery-error" role="alert">{error}</p>}
    {loadError && <p className="trip-gallery-error" role="alert">{loadError}</p>}
    <div className="trip-gallery-scroll-container">
      {!loading && <p className="trip-gallery-summary">{visibleImages.length} photos ({geotaggedCount} geotagged)</p>}
      {loading ? <p className="trip-gallery-message">Loading photos…</p> : visibleImages.length === 0
        ? <p className="trip-gallery-message">No photos match these filters.</p>
        : <div className="trip-gallery-grid">{visibleImages.map(image => <button key={image.id} data-image-id={image.id} className={`trip-gallery-image${activeId === image.id && locationEditId === null ? ' active' : ''}${changes[image.id] ? ' gps-unsaved' : ''}`} onPointerDown={() => {
          pressTimer.current = window.setTimeout(() => { routeImages.setImages(visibleImages); openViewer(image.id); }, 500);
        }} onPointerUp={() => { if (pressTimer.current !== null) window.clearTimeout(pressTimer.current); pressTimer.current = null; }} onPointerCancel={() => { if (pressTimer.current !== null) window.clearTimeout(pressTimer.current); pressTimer.current = null; }} onClick={() => showImage(image)} onDoubleClick={() => { routeImages.setImages(visibleImages); openViewer(image.id); }}>
          <GalleryThumbnail id={image.id} alt="" loading="lazy" />
          {changes[image.id] ? <span className="trip-gallery-reset" title="Reset location" onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); resetPhotoLocation(image.id); }}><Icon name="restart_alt" size={18} /></span> : !hasGps(image) && <span className="trip-gallery-no-gps" title="No GPS location"><Icon name="location_off" size={18} /></span>}
        </button>)}</div>}
    </div>
    {adding && createPortal(<>
      <div className="trip-gallery-add-bar" style={{ bottom: `${addBarBottom}px` }}><button aria-label="Discard location" onClick={cancelLocationEdit}><Icon name="close" size={20} /></button><span>{hasGps(adding) ? 'Editing GPS metadata' : 'Adding GPS metadata'}</span><button aria-label="Set location" disabled={!draft} onClick={() => {
        if (!draft) return;
        stageLocation(adding.id, [draft[1], draft[0]]);
        routeImages.setUnsaved(adding.id, true); setAdding(null); setDraft(null); endLocationEdit(); routeImages.setLocationEditId(null);
      }}><Icon name="check" size={20} /></button></div>
      <div className="trip-gallery-edit-marker" aria-hidden="true" style={pinPoint ? { left: `${pinPoint.x}px`, top: `${pinPoint.y}px` } : undefined}><div className="route-image-marker-body"><GalleryThumbnail id={adding.id} size={128} /></div></div>
      <ImageStrip images={visibleImages} activeId={adding.id} activeSource={activeSource} fullscreen={false} hideCloseButton onDismiss={cancelLocationEdit} onSwipeChange={image => { const precedingPhoto = finishCurrentEdit(); beginLocationEdit(image, precedingPhoto); }} timeline={timelineModel.totalKm > 0 && draft ? <RouteTimeline model={timelineModel} position={draft} previousPhoto={neighboringPhotos.previous} nextPhoto={neighboringPhotos.next} onSelect={position => { setDraft(position); onTimelineSelect(position); }} /> : undefined} />
    </>, document.body)}
    {locationFeedback && createPortal(<div className="trip-gallery-location-feedback" role="status">{locationFeedback}</div>, document.body)}
    <ConfirmDialog isOpen={confirmBackupRisk} title="Edit photo locations?" message="Editing photo GPS metadata is not advised if backup is turned on (e.g., Google Photos) as the photo may appear as duplicated. Do you want to continue editing photo locations?" confirmLabel="Continue" cancelLabel="Cancel" onConfirm={() => { localStorage.setItem(BACKUP_RISK_ACCEPTED_KEY, 'true'); setConfirmBackupRisk(false); setEditing(true); }} onCancel={() => setConfirmBackupRisk(false)} />
    <ConfirmDialog isOpen={confirmDiscard} title="Discard GPS edits?" message="Unsaved photo location changes will be discarded." confirmLabel="Discard" confirmVariant="danger" onConfirm={discardChanges} onCancel={() => setConfirmDiscard(false)} />
    <Dialog isOpen={saving} title="Saving photo locations" onClose={() => {}}>
      {saveProgress && <div className="trip-gallery-save-progress">
        {saveProgress.id !== null && <div className="trip-gallery-save-photo"><GalleryThumbnail id={saveProgress.id} size={160} alt="" /><div><strong>{saveProgress.name || `Photo ${saveProgress.id}`}</strong><span>{saveProgress.phase === 'permission' ? 'Waiting for Android permission' : `${saveProgress.phase} · ${Math.min(saveProgress.current + (saveProgress.phase === 'editing' || saveProgress.phase === 'writing' ? 1 : 0), saveProgress.total)} of ${saveProgress.total}`}</span></div></div>}
        {saveProgress.id === null && <p>{saveProgress.phase}…</p>}
        <div className="trip-gallery-progress-track"><div style={{ width: `${saveProgress.total ? saveProgress.current / saveProgress.total * 100 : 0}%` }} /></div>
        <div className="trip-gallery-progress-caption">{saveProgress.current} of {saveProgress.total} photos</div>
      </div>}
    </Dialog>
  </section>;
}
