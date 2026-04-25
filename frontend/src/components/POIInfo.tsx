import { useState, useEffect, useMemo } from 'react';
import type { Trip, Segment } from '../../../shared/types';
import { MaterialIcon } from './MaterialIcon';
import '../styles/POIInfo.css';
// Removed unused route import
import { optimizeSegmentRoute } from '../routing/routeOptimizer';
import { getPOIEmoji } from '../utils/poiUtils';
import { getLanguagePreferences, OSM_LANGUAGES } from '../utils/languagePreferences';

interface POIInfoProps {
  poi: any;
  trip: Trip | null;
  onGoBack: () => void;
  onUpdateTrip: (trip: Trip) => void;
  onAddedToTrip: (wpId: string) => void;
  onStartNewTrip?: (poi: any, details?: any) => void;
}

export const POIInfo = ({ poi, trip, onGoBack, onUpdateTrip, onAddedToTrip, onStartNewTrip }: POIInfoProps) => {
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

  const langPrefs = getLanguagePreferences();

  const { preferredOptions, otherOptions } = useMemo(() => {
    const rawDefault = poi.name || poi.name_int || details?.name;
    const prefOpts: { id: string, label: string, value: string }[] = [];
    const otherOpts: { id: string, label: string, value: string }[] = [];
    const addedValues = new Set<string>();
    
    if (rawDefault) {
      prefOpts.push({ id: 'default', label: 'Default (local)', value: rawDefault });
      addedValues.add(rawDefault);
    }
    
    for (const lang of langPrefs) {
      const pName = poi[`name:${lang}`];
      if (pName && !addedValues.has(pName)) {
         const langInfo = OSM_LANGUAGES.find(l => l.code === lang);
         prefOpts.push({ id: lang, label: langInfo ? langInfo.name : lang, value: pName });
         addedValues.add(pName);
      }
    }

    Object.keys(poi).forEach(key => {
      if (key.startsWith('name:')) {
        const lang = key.split(':')[1];
        const pName = poi[key];
        if (pName && !addedValues.has(pName)) {
           const langInfo = OSM_LANGUAGES.find(l => l.code === lang);
           // Handle cases where lang code resolves nicely or fallback to raw key suffix
           otherOpts.push({ id: lang, label: langInfo ? langInfo.name : lang, value: pName });
           addedValues.add(pName);
        }
      }
    });

    return { preferredOptions: prefOpts, otherOptions: otherOpts };
  }, [poi, details, langPrefs]);

  const autoPrefValue = useMemo(() => {
      const fallbackName = poi.name || poi.name_int || details?.name || 'Point of Interest';
      for (const lang of langPrefs) {
        const match = preferredOptions.find(o => o.id === lang);
        if (match) return match.value;
      }
      return preferredOptions.find(o => o.id === 'default')?.value || fallbackName;
  }, [preferredOptions, langPrefs, poi, details]);

  const [selectedName, setSelectedName] = useState<string>(autoPrefValue);
  const [showOtherLangs, setShowOtherLangs] = useState(false);

  useEffect(() => {
    setSelectedName(autoPrefValue);
  }, [autoPrefValue]);

  const handleAddToTrip = async () => {
    if (!trip || trip.segments.length === 0) return;
    
    const newWaypoint = {
      id: 'wp-' + Date.now(),
      name: selectedName || details?.display_name || 'POI',
      coordinates: poi.coordinates,
      importance: 'normal' as 'normal',
      poi: {
        id: poi.id || poi.properties?.id || details?.osm_id,
        name: selectedName || details?.display_name,
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
        const geom = await optimizeSegmentRoute(updatedSegment, lastSegment) as any;
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
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>{selectedName}</h2>
          <div style={{ width: 28 }}></div>
        </div>

      <div className="poi-info-content content">

        <div className="form-group">
           <label className="form-label">Coordinates</label>
           <div className="form-text-value">{poi.coordinates[1].toFixed(5)}, {poi.coordinates[0].toFixed(5)}</div>
        </div>

        {poi.ele && (
            <div className="form-group">
               <label className="form-label">Elevation</label>
               <div className="form-text-value">{poi.ele} m</div>
            </div>
        )}

        {poi.class && (
            <div className="form-group">
                <label className="form-label">Type</label>
                <div className="form-text-value" style={{ textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span>{getPOIEmoji(poi.class, poi.subclass, poi.name)}</span> <span>{[poi.class, poi.subclass].filter(Boolean).join(' - ').replace(/_/g, ' ')}</span>
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

        {trip ? (
            <div className="actions-group" style={{marginTop: '20px'}}>
                <button 
                  onClick={handleAddToTrip}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', borderRadius: '8px', background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)', color: 'white', fontWeight: '600', border: 'none', cursor: 'pointer', boxShadow: '0 4px 6px rgba(25, 118, 210, 0.2)' }}
                >
                    <MaterialIcon name="add_location" /> Add {selectedName} to Trip
                </button>
            </div>
        ) : (
            <div className="actions-group" style={{marginTop: '20px'}}>
                <button
                  onClick={() => onStartNewTrip && onStartNewTrip({ ...poi, name: selectedName }, details)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px', borderRadius: '8px', background: 'linear-gradient(135deg, #1976d2 0%, #1565c0 100%)', color: 'white', fontWeight: '600', border: 'none', cursor: 'pointer', boxShadow: '0 4px 6px rgba(25, 118, 210, 0.2)' }}
                >
                    <MaterialIcon name="add_location" /> Start new trip here
                </button>
            </div>
        )}

        {(preferredOptions.length > 1 || otherOptions.length > 0) && (
            <div className="form-group" style={{ marginTop: '24px' }}>
                <label className="form-label" style={{ marginBottom: '8px' }}>Alternative Names</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {preferredOptions.map(opt => (
                        <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', padding: '12px', borderRadius: '6px', border: selectedName === opt.value ? '2px solid #1976d2' : '1px solid var(--border-color, #ddd)', background: selectedName === opt.value ? '#e3f2fd' : 'white', transition: 'all 0.2s ease' }}>
                            <input 
                                type="radio" 
                                name="poiSelectedName" 
                                value={opt.value}
                                checked={selectedName === opt.value}
                                onChange={() => setSelectedName(opt.value)}
                                style={{ margin: 0, width: '16px', height: '16px', accentColor: '#1976d2' }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ fontSize: '1rem', fontWeight: selectedName === opt.value ? '600' : '400', color: '#333' }}>{opt.value}</span>
                                <span style={{ fontSize: '0.75rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{opt.label}</span>
                            </div>
                        </label>
                    ))}
                    
                    {otherOptions.length > 0 && !showOtherLangs && (
                        <button onClick={() => setShowOtherLangs(true)} style={{ background: 'none', border: 'none', color: '#1976d2', padding: '8px', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline' }}>
                            Show {otherOptions.length} other alternative(s)
                        </button>
                    )}

                    {showOtherLangs && otherOptions.map(opt => (
                        <label key={opt.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', padding: '12px', borderRadius: '6px', border: selectedName === opt.value ? '2px solid #1976d2' : '1px solid var(--border-color, #ddd)', background: selectedName === opt.value ? '#e3f2fd' : 'white', transition: 'all 0.2s ease' }}>
                            <input 
                                type="radio" 
                                name="poiSelectedName" 
                                value={opt.value}
                                checked={selectedName === opt.value}
                                onChange={() => setSelectedName(opt.value)}
                                style={{ margin: 0, width: '16px', height: '16px', accentColor: '#1976d2' }}
                            />
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                <span style={{ fontSize: '1rem', fontWeight: selectedName === opt.value ? '600' : '400', color: '#333' }}>{opt.value}</span>
                                <span style={{ fontSize: '0.75rem', color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{opt.label}</span>
                            </div>
                        </label>
                    ))}
                    
                    {showOtherLangs && (
                        <button onClick={() => setShowOtherLangs(false)} style={{ background: 'none', border: 'none', color: '#666', padding: '8px', cursor: 'pointer', fontSize: '0.85rem', textDecoration: 'underline' }}>
                            Hide alternatives
                        </button>
                    )}
                </div>
            </div>
        )}

      </div>
    </div>
  );
};
