import { useState } from 'react';
import type { Trip } from '../../../shared/types';
import { MaterialIcon } from './MaterialIcon';
import { ConfirmDialog } from './Dialog';
import { persistingManager } from '../persisting/PersistingManager';

interface TripManagerProps {
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
}

export function TripManager({ trips, onSelectTrip, onDeleteTrip, onUploadTrip, onReloadTrips, unsavedTripIds, conflictedTripIds, onSaveAll, onCreateTrip, onOpenStatus }: TripManagerProps) {
  const [tripToDelete, setTripToDelete] = useState<Trip | null>(null);
  const [uploadingTripId, setUploadingTripId] = useState<string | null>(null);
  const [isReloading, setIsReloading] = useState(false);
  const [isSavingAll, setIsSavingAll] = useState(false);

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

  return (
    <>
      <div className="toolbar">
        <h1 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          Triplo Manager
        </h1>
        <div className="toolbar-actions">
           <button className="iconButton" title="Status" onClick={onOpenStatus}><MaterialIcon name="info" size={20} /></button>
           <button
             className="iconButton"
             title="Save All Unsaved Trips"
             onClick={handleSaveAllWrapper}
             disabled={unsavedTripIds.size === 0 || isSavingAll}
             style={{
               opacity: unsavedTripIds.size > 0 ? 1 : 0.3,
               color: (unsavedTripIds.size > 0 && !isSavingAll) ? '#007bff' : 'inherit'
             }}
           >
             <MaterialIcon name={isSavingAll ? "sync" : "save"} size={20} className={isSavingAll ? "spinning" : undefined} />
           </button>
           <button className="iconButton" title="Preferences"><MaterialIcon name="build" size={20} /></button>
           <button className="iconButton" title="New Trip" onClick={onCreateTrip}><MaterialIcon name="add" size={20} /></button>
        </div>
      </div>
      <div className="content">
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
          <button 
            className="iconButton" 
            onClick={handleReload} 
            title="Reload from all services"
          >
            <MaterialIcon name="sync" size={20} className={isReloading ? "spinning" : ""} />
          </button>
        </div>

        {trips.map(trip => {
          const startDateStr = trip.startDate ? new Date(trip.startDate).toLocaleDateString() : '';
          const endDateStr = trip.endDate ? new Date(trip.endDate).toLocaleDateString() : '';
          const dateDisplay = startDateStr && endDateStr && startDateStr !== endDateStr
            ? `${startDateStr} - ${endDateStr}`
            : startDateStr;

          const isUnsaved = unsavedTripIds.has(trip.id);
          const isConflicted = conflictedTripIds.has(trip.id);
          const syncedServiceNames = trip.metadata?.syncedServices || [];
          const matchedServices = availablePersistingServices.filter(s => syncedServiceNames.includes(s.name));

          return (
            <div
              key={trip.id}
              className="trip-card"
              style={{ border: isConflicted ? '2px solid #d9534f' : undefined }}
              onClick={() => onSelectTrip(trip)}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
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
                    {matchedServices.length > 0 ? (
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
                  <button className="iconButton" onClick={(e) => {
                    e.stopPropagation();
                    setTripToDelete(trip);
                  }} style={{ padding: 2 }}>
                    <MaterialIcon name="delete" size={18} />
                  </button>
                </div>
              </div>
              <p className="trip-card-desc">{trip.description?.slice(0, 50)}...</p>
              <div className="trip-card-footer" style={{ marginTop: 'auto', paddingTop: '12px' }}>
                <small className="trip-card-date">{dateDisplay}</small>
              </div>
            </div>
          );
        })}
        {trips.length === 0 && <p className="empty-state">Loading trips...</p>}
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



