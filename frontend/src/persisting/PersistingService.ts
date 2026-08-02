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

  // load synced preferences
  loadPreferences?(): Promise<any | null>;

  // save synced preferences
  savePreferences?(prefs: any): Promise<void>;

  // load an auxiliary synced preference file, such as a style script
  loadPreferenceFile?(path: string): Promise<string | null>;

  // save an auxiliary synced preference file, such as a style script
  savePreferenceFile?(path: string, content: string): Promise<void>;

  // delete an auxiliary synced preference file, such as a removed style script
  deletePreferenceFile?(path: string): Promise<void>;

  // disconnect from the service and clear the local connection state
  disconnect(): Promise<void>;

  // check if the service is currently available
  isAvailable(): boolean;

  // returns HTML description/action button on how to connect to the service
  getConnectionInstruction(): ConnectionInstruction;

  // optional component rendering specific settings inside the configuration dialog
  renderConfigUI?(props: { trips: Trip[], onUpdateTrips?: (trips: Trip[]) => void }): ReactNode;
}
