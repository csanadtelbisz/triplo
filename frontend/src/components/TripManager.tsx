import { useState, useRef, useEffect } from 'react';
import type { Trip } from '../../../shared/types';
import { MaterialIcon } from './MaterialIcon';
import { ConfirmDialog } from './Dialog';
import { persistingManager } from '../persisting/PersistingManager';
import { syncPreferencesToCloud } from '../utils/preferencesSync';
import { getTripListPreferences, saveTripListPreferences } from '../utils/tripListPreferences';
import type { TripListDisplayMode, TripListPreferences, TripSortOrder } from '../utils/tripListPreferences';

interface TripManagerProps {
  isReadOnly?: boolean;
  onToggleReadOnly?: () => void;
  trips: Trip[];
  onSelectTrip: (trip: Trip) => void;
  onDeleteTrip: (tripId: string) => void;
  onUploadTrip: (trip: Trip) => void;
  onReloadTrips: () => Promise<void> | void;
  unsavedTripIds: Set<string>;
  conflictedTripIds: Set<string>;
  onSaveAll: () => Promise<void> | void;
  onCreateTrip: () => void;
  onOpenStatus: () => void;
  onOpenSettings: () => void;
  onOpenAnalytics?: () => void;
  isTripsLoading?: boolean;
}

let tripManagerScrollPos = 0;

export function TripManager({ isReadOnly = false, onToggleReadOnly, trips, onSelectTrip, onDeleteTrip, onUploadTrip, onReloadTrips, unsavedTripIds, conflictedTripIds, onSaveAll, onCreateTrip, onOpenStatus, onOpenSettings, onOpenAnalytics, isTripsLoading }: TripManagerProps) {
  const [tripToDelete, setTripToDelete] = useState<Trip | null>(null);
  const [uploadingTripId, setUploadingTripId] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [tripListPreferences, setTripListPreferences] = useState<TripListPreferences>(getTripListPreferences);

  const contentRef = useRef<HTMLDivElement>(null);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const refreshPreferences = () => setTripListPreferences(getTripListPreferences());
    window.addEventListener('preferences-updated', refreshPreferences);
    return () => window.removeEventListener('preferences-updated', refreshPreferences);
  }, []);

  useEffect(() => {
    if (!showSortMenu) return;
    const closeMenu = (event: MouseEvent) => {
      if (!sortMenuRef.current?.contains(event.target as Node)) setShowSortMenu(false);
    };
    document.addEventListener('click', closeMenu);
    return () => document.removeEventListener('click', closeMenu);
  }, [showSortMenu]);

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = tripManagerScrollPos;
    }
  }, []);

  const handleSaveAllWrapper = async () => {
    setIsSavingAll(true);
    await onSaveAll();
    setIsSavingAll(false);
  };

  const handleReload = async () => {
    setIsReloading(true);
    await onReloadTrips();
    setIsReloading(false);
  };

  const availablePersistingServices = persistingManager.getAvailableServices();

  const handleUpload = async (e: React.MouseEvent, trip: Trip) => {
    e.stopPropagation();
    setUploadingTripId(trip.id);
    await onUploadTrip(trip);
    setUploadingTripId(null);
  };

  const confirmDelete = () => {
    if (tripToDelete) {
      onDeleteTrip(tripToDelete.id);
      setTripToDelete(null);
    }
  };

  const updateTripListPreferences = (updates: Partial<TripListPreferences>) => {
    const next = { ...tripListPreferences, ...updates };
    saveTripListPreferences(next);
    setTripListPreferences(next);
    syncPreferencesToCloud();
  };

  const getTripDate = (trip: Trip) => {
    const date = trip.endDate || trip.startDate;
    const timestamp = date ? new Date(date).getTime() : Number.NaN;
    return Number.isNaN(timestamp) ? null : timestamp;
  };

  const sortedTrips = [...trips].sort((a, b) => {
    if (tripListPreferences.sortOrder === 'name_asc') return (a.name || '').localeCompare(b.name || '');
    if (tripListPreferences.sortOrder === 'name_desc') return (b.name || '').localeCompare(a.name || '');

    const dateA = getTripDate(a);
    const dateB = getTripDate(b);
    if (dateA !== null && dateB !== null) return tripListPreferences.sortOrder === 'newer' ? dateB - dateA : dateA - dateB;
    if (dateA !== null) return -1;
    if (dateB !== null) return 1;
    return (a.name || '').localeCompare(b.name || '');
  });

  const isTimeSorted = tripListPreferences.sortOrder === 'newer' || tripListPreferences.sortOrder === 'older';
  const tripGroups = isTimeSorted
    ? Array.from(sortedTrips.reduce((groups, trip) => {
        const date = trip.endDate || trip.startDate;
        const year = date && !Number.isNaN(new Date(date).getTime()) ? String(new Date(date).getFullYear()) : 'No date';
        const group = groups.get(year) || [];
        group.push(trip);
        groups.set(year, group);
        return groups;
      }, new globalThis.Map<string, Trip[]>()).entries())
    : [['', sortedTrips] as [string, Trip[]]];

  return (
    <>
      <div className="toolbar">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          Triplo
        </h1>
        <div className="toolbar-actions">
           {!isReadOnly && (
             <button className="iconButton" title="New Trip" onClick={onCreateTrip}><MaterialIcon name="add" size={20} /></button>
           )}
           <button className="iconButton" title="Analytics" onClick={onOpenAnalytics}><MaterialIcon name="finance" size={20} /></button>
           {isReadOnly ? (
             <button
               className="iconButton"
               title="Turn Off Read-Only Mode"
               onClick={onToggleReadOnly}
               disabled={isTripsLoading}
             >
               <MaterialIcon name="lock" size={20} />
             </button>
           ) : unsavedTripIds.size === 0 ? (
             <button
               className="iconButton"
               title="Turn On Read-Only Mode"
               onClick={onToggleReadOnly}
               disabled={isTripsLoading}
             >
               <MaterialIcon name="lock_open" size={20} />
             </button>
           ) : (
             <button
               className="iconButton"
               title="Save All Unsaved Trips"
               onClick={handleSaveAllWrapper}
               disabled={isSavingAll}
               style={{ color: isSavingAll ? 'inherit' : '#007bff' }}
             >
               <MaterialIcon name={isSavingAll ? "sync" : "save"} size={20} className={isSavingAll ? "spinning" : undefined} />
             </button>
           )}
           <button className="iconButton" title="Preferences" onClick={onOpenSettings}><MaterialIcon name="build" size={20} /></button>
           <button className="iconButton" title="Status" onClick={onOpenStatus}><MaterialIcon name="info" size={20} /></button>
        </div>
      </div>
      <div
        className="content"
        ref={contentRef}
        onScroll={(e) => { tripManagerScrollPos = e.currentTarget.scrollTop; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: '#f8f9fa', borderRadius: '6px', border: '1px solid #e9ecef', marginBottom: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <div style={{ fontSize: '0.9rem', color: '#495057', display: 'flex', alignItems: 'center', gap: '6px' }}>
              {availablePersistingServices.length > 0 ? (
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>Connected: {availablePersistingServices.map(s => s.icon ? <img key={s.name} src={s.icon} alt={s.name} title={s.name} width={16} height={16} style={{ display: "block", objectFit: "contain" }} /> : <strong key={s.name}>{s.name}</strong>)}</div>
              ) : (
                "Not connected to any service"
              )}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <button className="iconButton" onClick={handleReload} title="Reload from all services">
              <MaterialIcon name="sync" size={20} className={isReloading ? "spinning" : ""} />
            </button>
            <div ref={sortMenuRef} style={{ position: 'relative' }}>
              <button className="iconButton" onClick={() => setShowSortMenu(open => !open)} title="Display and sort trips" aria-label="Display and sort trips">
                <MaterialIcon name="sort" size={20} />
              </button>
              {showSortMenu && (
                <div className="trip-sort-menu">
                  {([
                    ['detailed', 'Detailed'],
                    ['compact', 'Compact'],
                  ] as [TripListDisplayMode, string][]).map(([displayMode, label]) => (
                    <div key={displayMode} className={`trip-sort-menu-option${tripListPreferences.displayMode === displayMode ? ' selected' : ''}`} onClick={() => updateTripListPreferences({ displayMode })}>
                      <span>{label}</span>
                    </div>
                  ))}
                  <div className="trip-sort-menu-divider" />
                  {([
                    ['newer', 'Newer first'],
                    ['older', 'Older first'],
                    ['name_asc', 'A to Z'],
                    ['name_desc', 'Z to A'],
                  ] as [TripSortOrder, string][]).map(([sortOrder, label]) => (
                    <div key={sortOrder} className={`trip-sort-menu-option${tripListPreferences.sortOrder === sortOrder ? ' selected' : ''}`} onClick={() => { updateTripListPreferences({ sortOrder }); setShowSortMenu(false); }}>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {tripGroups.map(([year, groupedTrips]) => (
          <div key={year || 'all-trips'}>
            {isTimeSorted && <div className="trip-year-heading">{year}</div>}
            {groupedTrips.map(trip => {
          const startDateStr = trip.startDate ? new Date(trip.startDate).toLocaleDateString() : '';
          const endDateStr = trip.endDate ? new Date(trip.endDate).toLocaleDateString() : '';
          const dateDisplay = startDateStr && endDateStr && startDateStr !== endDateStr
            ? `${startDateStr} - ${endDateStr}`
            : startDateStr;

          const isUnsaved = unsavedTripIds.has(trip.id);
          const isConflicted = conflictedTripIds.has(trip.id);
          const isCached = trip.metadata?._isCached;
          const syncedServiceNames = trip.metadata?.syncedServices || [];
          const matchedServices = availablePersistingServices.filter(s => syncedServiceNames.includes(s.name));

          return (
            <div
              key={trip.id}
              className="trip-card"
              style={{ border: isConflicted ? '2px solid #d9534f' : undefined }}
              onClick={() => onSelectTrip(trip)}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: tripListPreferences.displayMode === 'detailed' ? '8px' : 0 }}>
                <h3 className="trip-card-title" style={{ margin: 0, fontStyle: isUnsaved ? 'italic' : 'normal', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {trip.name} 
                  {isConflicted ? (
                    <span title="Conflicts found between devices/services" style={{ color: '#d9534f' }}>•</span>
                  ) : isUnsaved ? (
                    <span title="Unsaved changes" style={{ color: '#007bff' }}>•</span>
                  ) : null}
                </h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {isCached ? (
                      <MaterialIcon name="cached" size={16} style={{ color: '#6c757d' }} />
                    ) : matchedServices.length > 0 ? (
                      matchedServices.map(s => (
                        <img
                          key={s.name}
                          src={s.icon}
                          alt={s.name}
                          title={`Synced to ${s.name}`}
                          width={16}
                          height={16}
                          style={{ display: 'block', objectFit: 'contain' }}
                        />
                      ))
                    ) : availablePersistingServices.length > 0 ? (
                      <button
                        className="iconButton"
                        onClick={(e) => handleUpload(e, trip)}
                        title="Upload to all available services"
                        style={{ padding: 2 }}
                      >
                        {uploadingTripId === trip.id ? (
                           <MaterialIcon name="sync" size={16} className="spinning" />
                        ) : (
                           <MaterialIcon name="cloud_upload" size={16} />
                        )}
                      </button>
                    ) : null}
                  </div>
                  {isReadOnly ? (
                    <button className="iconButton" disabled title="Read-Only Mode Active" style={{ padding: 2, opacity: 0.3 }}>
                      <MaterialIcon name="lock" size={18} />
                    </button>
                  ) : (
                    <button className="iconButton" onClick={(e) => {
                      e.stopPropagation();
                      setTripToDelete(trip);
                    }} style={{ padding: 2 }}>
                      <MaterialIcon name="delete" size={18} />
                    </button>
                  )}
                </div>
              </div>
              {tripListPreferences.displayMode === 'detailed' && <p className="trip-card-desc">
                {trip.description && trip.description.length > 50 
                  ? `${trip.description.slice(0, 50)}...` 
                  : trip.description}
              </p>}
              <div
                className="trip-card-footer"
                style={tripListPreferences.displayMode === 'detailed'
                  ? { marginTop: 'auto', paddingTop: '12px' }
                  : { marginTop: 0, paddingTop: '4px' }}
              >
                <small className="trip-card-date">{dateDisplay}</small>
              </div>
            </div>
          );
            })}
          </div>
        ))}
        {trips.length === 0 && isTripsLoading && <p className="empty-state">Loading trips...</p>}
        {trips.length === 0 && !isTripsLoading && <p className="empty-state">No trips found.</p>}
      </div>

      <ConfirmDialog
        isOpen={tripToDelete !== null}
        title="Delete Trip"
        message={
          <p style={{ margin: 0 }}>
            Are you sure you want to delete the trip <strong>{tripToDelete?.name}</strong>?<br /><br />
            This action cannot be undone.
          </p>
        }
        confirmLabel="Delete"
        confirmVariant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setTripToDelete(null)}
      />
    </>
  );
}



