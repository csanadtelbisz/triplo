import type { ReactNode } from 'react';
import type { Trip } from '../../../shared/types';

export interface PersistingSettings {
  [key: string]: any;
}

export interface ConnectionInstruction {
  htmlDescription: string;
  actionButtonLabel: string;
  onAction: (onSuccess?: () => void, openConfigDialog?: () => void) => void;
}

export interface PersistingService {
  name: string;
  icon: string; // URL or identifier for an icon

  // load all trips from this service
  load(): Promise<any[]>;

  // update an existing trip in the storage service, or create a new trip entry in the storage
  save(trip: any): Promise<void>;

  // saves all unsaved trips
  saveAll(trips: any[]): Promise<void>;

  // deletes a trip from this service
  delete(tripId: string): Promise<void>;

  // check if the service is currently available
  isAvailable(): boolean;

  // returns HTML description/action button on how to connect to the service
  getConnectionInstruction(): ConnectionInstruction;

  // optional component rendering specific settings inside the configuration dialog
  renderConfigUI?(props: { trips: Trip[], onUpdateTrips?: (trips: Trip[]) => void }): ReactNode;
}
