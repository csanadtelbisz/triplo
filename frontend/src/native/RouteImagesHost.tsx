import { useEffect, useMemo, useState } from 'react';
import type { Trip } from '../../../shared/types';
import { queryGallery, requestGalleryAccess, sortImagesByTime } from './gallery';
import type { GalleryImage } from './gallery';
import { ImageStrip } from './ImageStrip';
import { ImageViewer } from './ImageViewer';
import { hasGps } from './gallery';
import { routeImages, useRouteImages } from './routeImagesStore';
import { tripPeriod } from './tripPeriod';
import './RouteImages.css';

/** Loads the selected trip's images and shows the bottom panel and full-screen viewer. */
export default function RouteImagesHost({ trip, hidden = false }: { trip: Trip | null; hidden?: boolean }) {
  const { enabled, loading: imagesLoading, images, activeId, activeSource, fullscreen, galleryMode, viewerSourceSelector } = useRouteImages();
  const [loaded, setLoaded] = useState<{ key: string; images: GalleryImage[] } | null>(null);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);

  const startDate = trip?.startDate;
  const endDate = trip?.endDate;
  const period = useMemo(() => tripPeriod({ startDate, endDate }), [startDate, endDate]);
  const key = enabled && period ? `${period.from}:${period.to}` : '';

  useEffect(() => {
    if (!period || !key) {
      routeImages.setLoading(false);
      return;
    }
    let cancelled = false;
    routeImages.setLoading(true);
    const fail = (text: string) => setError(previous => ({ id: (previous?.id ?? 0) + 1, text }));
    (async () => {
      setError(null);
      try {
        if (!(await requestGalleryAccess())) {
          if (cancelled) return;
          routeImages.setEnabled(false);
          fail('Allow access to photos and their location to show images along the route.');
          return;
        }
        const accumulated: GalleryImage[] = [];
        const found = await queryGallery(period.from, period.to, batch => {
          if (cancelled) return;
          accumulated.push(...batch);
          setLoaded({ key, images: [...accumulated] });
        });
        if (!cancelled) setLoaded({ key, images: found });
      } catch (reason) {
        console.error('Loading gallery images failed', reason);
        if (!cancelled) fail('Could not read the photo library.');
      } finally {
        if (!cancelled) routeImages.setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [key, period]);

  const candidates = loaded?.key === key ? loaded.images : null;
  const nearTrip = useMemo(
    () => (trip && candidates ? sortImagesByTime(candidates.filter(hasGps)) : []),
    [trip, candidates],
  );

  useEffect(() => {
    routeImages.setImages(key ? nearTrip : []);
  }, [key, nearTrip]);

  // Another panel took over the sidebar: its image panel and viewer go away with it.
  useEffect(() => {
    if (hidden) routeImages.close();
  }, [hidden]);

  const emptyNotice = candidates && nearTrip.length === 0 && !imagesLoading;
  return (
    <>
      {error && <div className="route-images-notice" key={`error:${error.id}`} role="status">{error.text}</div>}
      {!error && emptyNotice && <div className="route-images-notice" key={`empty:${key}`} role="status">No geotagged photos found along this route.</div>}
      {enabled && !hidden && activeId !== null && (
        <>
          {!galleryMode && <ImageStrip images={images} activeId={activeId} activeSource={activeSource} fullscreen={fullscreen} />}
          {fullscreen && <ImageViewer images={images} activeId={activeId} sourceSelector={viewerSourceSelector || undefined} />}
        </>
      )}
    </>
  );
}
