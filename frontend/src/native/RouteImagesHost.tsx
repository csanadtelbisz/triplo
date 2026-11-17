import { useEffect, useMemo, useState } from 'react';
import type { Trip } from '../../../shared/types';
import { queryGallery, requestGalleryAccess, sortImagesByTime } from './gallery';
import type { GalleryImage } from './gallery';
import { ImageStrip } from './ImageStrip';
import { ImageViewer } from './ImageViewer';
import { filterImagesNearTrip } from './routeFilter';
import { routeImages, useRouteImages } from './routeImagesStore';
import { tripPeriod } from './tripPeriod';
import './RouteImages.css';

/** Loads the selected trip's images and shows the bottom panel and full-screen viewer. */
export default function RouteImagesHost({ trip }: { trip: Trip | null }) {
  const { enabled, images, activeId, activeSource, fullscreen } = useRouteImages();
  const [loaded, setLoaded] = useState<{ key: string; images: GalleryImage[] } | null>(null);
  const [error, setError] = useState<{ id: number; text: string } | null>(null);

  const startDate = trip?.startDate;
  const endDate = trip?.endDate;
  const period = useMemo(() => tripPeriod({ startDate, endDate }), [startDate, endDate]);
  const key = enabled && period ? `${period.from}:${period.to}` : '';

  useEffect(() => {
    if (!period || !key) return;
    let cancelled = false;
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
        const found = await queryGallery(period.from, period.to);
        if (!cancelled) setLoaded({ key, images: found });
      } catch (reason) {
        console.error('Loading gallery images failed', reason);
        if (!cancelled) fail('Could not read the photo library.');
      }
    })();
    return () => { cancelled = true; };
  }, [key, period]);

  const candidates = loaded?.key === key ? loaded.images : null;
  const nearTrip = useMemo(
    () => (trip && candidates ? sortImagesByTime(filterImagesNearTrip(candidates, trip)) : []),
    [trip, candidates],
  );

  useEffect(() => {
    routeImages.setImages(key ? nearTrip : []);
  }, [key, nearTrip]);

  const emptyNotice = candidates && nearTrip.length === 0;
  return (
    <>
      {error && <div className="route-images-notice" key={`error:${error.id}`} role="status">{error.text}</div>}
      {!error && emptyNotice && <div className="route-images-notice" key={`empty:${key}`} role="status">No geotagged photos found along this route.</div>}
      {enabled && activeId !== null && (
        <>
          <ImageStrip images={images} activeId={activeId} activeSource={activeSource} fullscreen={fullscreen} />
          {fullscreen && <ImageViewer images={images} activeId={activeId} />}
        </>
      )}
    </>
  );
}
