import { useState } from 'react';
import type { Trip } from '../../../shared/types';
import { MaterialIcon } from './MaterialIcon';
import { Dialog } from './Dialog';

interface TripManagerProps {
  trips: Trip[];
  onSelectTrip: (trip: Trip) => void;
  onDeleteTrip: (tripId: string) => void;
  unsavedTripIds: Set<string>;
  onSaveAll: () => void;
  onCreateTrip: () => void;
}

export function TripManager({ trips, onSelectTrip, onDeleteTrip, unsavedTripIds, onSaveAll, onCreateTrip }: TripManagerProps) {
  const [tripToDelete, setTripToDelete] = useState<Trip | null>(null);

  const confirmDelete = () => {
    if (tripToDelete) {
      onDeleteTrip(tripToDelete.id);
      setTripToDelete(null);
    }
  };

  return (
    <>
      <div className="toolbar">
        <h1>Triplo Manager</h1>
        <div className="toolbar-actions">
           <button 
             className="iconButton" 
             title="Save All Unsaved Trips" 
             onClick={onSaveAll}
             disabled={unsavedTripIds.size === 0}
             style={{ 
               opacity: unsavedTripIds.size > 0 ? 1 : 0.3, 
               color: unsavedTripIds.size > 0 ? '#007bff' : 'inherit' 
             }}
           >
             <MaterialIcon name="save" size={20} />
           </button>
           <button className="iconButton" title="Preferences"><MaterialIcon name="build" size={20} /></button>
           <button className="iconButton" title="New Trip" onClick={onCreateTrip}><MaterialIcon name="add" size={20} /></button>
        </div>
      </div>
      <div className="content">
        {trips.map(trip => {
          const startDateStr = trip.startDate ? new Date(trip.startDate).toLocaleDateString() : '';
          const endDateStr = trip.endDate ? new Date(trip.endDate).toLocaleDateString() : '';
          const dateDisplay = startDateStr && endDateStr && startDateStr !== endDateStr
            ? `${startDateStr} - ${endDateStr}`
            : startDateStr;

          const isUnsaved = unsavedTripIds.has(trip.id);

          return (
            <div
              key={trip.id}
              className="trip-card"
              onClick={() => onSelectTrip(trip)}
            >
              <h3 className="trip-card-title" style={isUnsaved ? { fontStyle: 'italic' } : {}}>
                  {trip.name} {isUnsaved && <span title="Unsaved changes" style={{ color: '#007bff' }}>•</span>}
              </h3>
              <p className="trip-card-desc">{trip.description?.slice(0, 50)}...</p>
              <div className="trip-card-footer">
                <small className="trip-card-date">{dateDisplay}</small>
                <button className="iconButton" onClick={(e) => { 
                  e.stopPropagation(); 
                  setTripToDelete(trip);
                }}><MaterialIcon name="delete" size={18} /></button>
              </div>
            </div>
          );
        })}
        {trips.length === 0 && <p className="empty-state">Loading trips...</p>}
      </div>

      <Dialog
        isOpen={tripToDelete !== null}
        title="Delete Trip"
        onClose={() => setTripToDelete(null)}
        actions={
          <>
            <button className="dialog-btn dialog-btn-cancel" onClick={() => setTripToDelete(null)}>
              Cancel
            </button>
            <button className="dialog-btn dialog-btn-confirm" onClick={confirmDelete}>
              Delete
            </button>
          </>
        }
      >
        <p>
          Are you sure you want to delete the trip <strong>{tripToDelete?.name}</strong>?
          <br /><br />
          This action cannot be undone.
        </p>
      </Dialog>
    </>
  );
}