import { useState, useEffect } from 'react';
import type { Trip, Segment } from '../../../shared/types';
import { MaterialIcon } from './MaterialIcon';
import '../styles/POIInfo.css';
import { route } from '../routing';
import { getPOIEmoji } from '../utils/poiUtils';

interface POIInfoProps {
  poi: any;
  trip: Trip | null;
  onGoBack: () => void;
  onUpdateTrip: (trip: Trip) => void;
  onAddedToTrip: (wpId: string) => void;
}

export const POIInfo = ({ poi, trip, onGoBack, onUpdateTrip, onAddedToTrip }: POIInfoProps) => {
  const [details, setDetails] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onGoBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onGoBack]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setDetails(null);
    
    // Reverse geocode to get more structured info about the location if available
    const [lon, lat] = poi.coordinates;
    const acceptLanguage = navigator.language || 'en';
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=jsonv2&zoom=18&accept-language=${acceptLanguage}`)
      .then(r => r.json())
      .then(data => {
        if (active) {
          setDetails(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (active) setLoading(false);
      });
      
    return () => { active = false; };
  }, [poi]);

  const handleAddToTrip = async () => {
    if (!trip || trip.segments.length === 0) return;
    
    const newWaypoint = {
      id: 'wp-' + Date.now(),
      name: poi.name || details?.name || details?.display_name || 'POI',
      coordinates: poi.coordinates,
      importance: 'normal' as 'normal',
      poi: {
        id: poi.id || poi.properties?.id || details?.osm_id,
        name: poi.name || details?.name || details?.display_name,
        type: poi.class,
        details: details
      }
    };

    const newSegments = [...trip.segments];
    const lastSegment = newSegments[newSegments.length - 1];

    const updatedSegment: Segment = {
      ...lastSegment,
      waypoints: [...lastSegment.waypoints, newWaypoint as any]
    };
    newSegments[newSegments.length - 1] = updatedSegment;
    
    // Fast optimistic update
    onUpdateTrip({ ...trip, segments: newSegments });
    
    const validCoords = updatedSegment.waypoints
      .filter((w: any) => w.coordinates && w.coordinates.length === 2)
      .map((w: any) => w.coordinates as [number, number]);
      
    if (validCoords.length >= 2 && lastSegment.source === 'router') {
      try {
        const geom = await route(validCoords, lastSegment.routingMode);
        newSegments[newSegments.length - 1] = { ...updatedSegment, geometry: geom };
        onUpdateTrip({ ...trip, segments: [...newSegments] });
      } catch (err) {
        console.error('Failed to update route after adding POI');
      }
    }

      onAddedToTrip(newWaypoint.id);
    };

    return (
      <div className="poi-info-container">
        <div className="poi-info-header toolbar">
          <button className="iconButton" onClick={onGoBack} title="Close POI">  
            <MaterialIcon name="arrow_back" size={20} />
          </button>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{poi.name || details?.name || 'Point of Interest'}</h2>
          <div style={{ width: 28 }}></div>
        </div>

      <div className="poi-info-content content">
        <div className="form-group">
           <label className="form-label">Coordinates</label>
           <div className="form-text-value">{poi.coordinates[1].toFixed(5)}, {poi.coordinates[0].toFixed(5)}</div>
        </div>

        {poi.class && (
            <div className="form-group">
                <label className="form-label">Type</label>
                <div className="form-text-value" style={{ textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{getPOIEmoji(poi.class, poi.subclass)}</span> <span>{[poi.class, poi.subclass].filter(Boolean).join(' - ').replace(/_/g, ' ')}</span>
                </div>
            </div>
        )}

        {loading ? (
            <div className="form-group"><p className="form-text-value">Loading OpenStreetMap details...</p></div>
        ) : details && (
            <>
              {details.address && (
                  <div className="form-group">
                    <label className="form-label">Address</label>
                    <div className="form-text-value">
                        {[details.address.road, details.address.house_number].filter(Boolean).join(' ')}
                        {([details.address.road, details.address.house_number].some(Boolean)) ? <br/> : null}
                        {[details.address.postcode, details.address.city || details.address.town || details.address.village].filter(Boolean).join(' ')}
                        {([details.address.postcode, details.address.city || details.address.town || details.address.village].some(Boolean)) ? <br/> : null}
                        {details.address.country}
                    </div>
                  </div>
              )}
            </>
        )}

        {trip && (
            <div className="actions-group" style={{marginTop: '20px'}}>
                <button 
                  className="action-button primary"
                  onClick={handleAddToTrip}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                    <MaterialIcon name="add_location" /> Add to Trip
                </button>
            </div>
        )}
      </div>
    </div>
  );
};
