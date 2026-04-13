import { useState } from 'react';
import { Dialog } from './Dialog';
import { MaterialIcon } from './MaterialIcon';
import type { Trip } from '../../../shared/types';
import type { PersistingService } from '../persisting/PersistingService';

interface PersistingConfigDialogProps {
  service: PersistingService | null;
  trips: Trip[];
  onClose: () => void;
  // Trigger update to bubble trip states (if metadata is mutated)
  onUpdateTrips?: (trips: Trip[]) => void;
}

export function PersistingConfigDialog({ service, trips, onClose, onUpdateTrips }: PersistingConfigDialogProps) {
  const [syncingAll, setSyncingAll] = useState(false);
  const [syncingMap, setSyncingMap] = useState<Record<string, boolean>>({});

  if (!service) return null;

  const unsavedTrips = trips.filter(t => !t.metadata?.syncedServices?.includes(service.name));

  const handleSyncTrip = async (trip: Trip) => {
    setSyncingMap(prev => ({ ...prev, [trip.id]: true }));
    try {
      await service.save?.(trip);
      trip.metadata = { ...trip.metadata };
      trip.metadata.syncedServices = trip.metadata.syncedServices ? [...trip.metadata.syncedServices, service.name] : [service.name];
      if (onUpdateTrips) {
        onUpdateTrips([...trips]); // trigger re-render
      }
    } catch (e) {
      console.error(e);
      alert(`Failed to sync trip: ${trip.name}`);
    } finally {
      setSyncingMap(prev => ({ ...prev, [trip.id]: false }));
    }
  };

  const handleSyncAll = async () => {
    setSyncingAll(true);
    const updatingMap: Record<string, boolean> = {};
    unsavedTrips.forEach(t => updatingMap[t.id] = true);
    setSyncingMap(prev => ({ ...prev, ...updatingMap }));

    try {
      await service.saveAll(unsavedTrips);
      unsavedTrips.forEach(trip => {
        trip.metadata = { ...trip.metadata };
        trip.metadata.syncedServices = trip.metadata.syncedServices ? [...trip.metadata.syncedServices, service.name] : [service.name];
      });
      if (onUpdateTrips) {
        onUpdateTrips([...trips]); // trigger re-render
      }
    } catch (e) {
      console.error(e);
      alert('Failed to sync all trips.');
    } finally {
      setSyncingAll(false);
      setSyncingMap(prev => {
        const next = { ...prev };
        unsavedTrips.forEach(t => next[t.id] = false);
        return next;
      });
    }
  };

  return (
    <Dialog
      isOpen={!!service}
      title={`${service.name} Configuration`}
      onClose={onClose}
      actions={
        <button className="dialog-btn dialog-btn-cancel" onClick={onClose}>
          Close
        </button>
      }
    >
      <div style={{ marginBottom: '24px' }}>
        <h4 style={{ margin: '0 0 8px 0', fontSize: '1rem' }}>Settings</h4>
        {service.renderConfigUI ? (
          service.renderConfigUI({ trips, onUpdateTrips })
        ) : (
          <p style={{ fontSize: '0.9rem', color: '#666' }}>No specific settings available for this service.</p>
        )}
      </div>

      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h4 style={{ margin: 0, fontSize: '1rem' }}>Unsynced Trips ({unsavedTrips.length})</h4>
          {unsavedTrips.length > 0 && (
            <button
              className="dialog-btn dialog-btn-primary"
              onClick={handleSyncAll}
              disabled={syncingAll}
              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <MaterialIcon name={syncingAll ? 'sync' : 'cloud_upload'} size={16} className={syncingAll ? 'spinning' : ''} />
              {syncingAll ? 'Syncing...' : 'Sync All'}
            </button>
          )}
        </div>

        {unsavedTrips.length === 0 ? (
          <p style={{ fontSize: '0.9rem', color: '#666' }}>All local trips are synced to {service.name}!</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '200px', overflowY: 'auto' }}>
            {unsavedTrips.map(trip => (
              <div key={trip.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f5f5f5', padding: '8px 12px', borderRadius: '6px' }}>
                <span style={{ fontWeight: 500, fontSize: '0.9rem' }}>{trip.name || 'Untitled Trip'}</span>
                <button
                  className="iconButton"
                  onClick={() => handleSyncTrip(trip)}
                  disabled={syncingMap[trip.id]}
                  title="Sync this trip"
                >
                  {syncingMap[trip.id] ? (
                    <MaterialIcon name="sync" size={18} className="spinning" />
                  ) : (
                    <MaterialIcon name="cloud_upload" size={18} />
                  )}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
