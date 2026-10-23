import type { ReactNode } from 'react';
import type { SharedTripReference, Trip } from '../../../shared/types';

export type PersistedTrip = Trip | SharedTripReference;

export interface PersistingSettings {
  [key: string]: any;
}

export interface ConnectionInstruction {
  htmlDescription: string;
  actionButtonLabel: string;
  onAction: (onSuccess?: () => void, openConfigDialog?: () => void) => void;
}

export abstract class PersistingService {
  abstract name: string;
  abstract icon: string; // URL or identifier for an icon

  // load all trips from this service
  abstract load(): Promise<any[]>;

  // update an existing trip in the storage service, or create a new trip entry in the storage
  abstract save(trip: PersistedTrip): Promise<void>;

  // Providers may override this with a native batch operation. A rejected save
  // leaves the batch unsaved in the UI, including any partially completed loop.
  async saveAll(trips: PersistedTrip[]): Promise<void> {
    for (const trip of trips) await this.save(trip);
  }

  // deletes a trip from this service
  abstract delete(tripId: string): Promise<void>;

  // load synced preferences
  abstract loadPreferences?(): Promise<any | null>;

  // save synced preferences
  abstract savePreferences?(prefs: any): Promise<void>;

  // load an auxiliary synced preference file, such as a style script
  abstract loadPreferenceFile?(path: string): Promise<string | null>;

  // save an auxiliary synced preference file, such as a style script
  abstract savePreferenceFile?(path: string, content: string): Promise<void>;

  // delete an auxiliary synced preference file, such as a removed style script
  abstract deletePreferenceFile?(path: string): Promise<void>;

  // create a public share for a trip and return an encoded share reference
  abstract shareTrip(trip: Trip): Promise<string>;

  // revoke a previously created public share reference
  abstract revokeShare(shareLink: string): Promise<void>;

  // fetch a shared trip from an encoded share reference
  abstract fetchSharedTrip(shareLink: string): Promise<Trip | null>;

  // replace the contents exposed by an existing share reference
  abstract updateSharedTrip(shareLink: string, trip: Trip): Promise<void>;

  // disconnect from the service and clear the local connection state
  abstract disconnect(): Promise<void>;

  // check if the service is currently available
  abstract isAvailable(): boolean;

  // returns HTML description/action button on how to connect to the service
  abstract getConnectionInstruction(): ConnectionInstruction;

  // optional component rendering specific settings inside the configuration dialog
  abstract renderConfigUI?(props: { trips: Trip[], onUpdateTrips?: (trips: Trip[]) => void }): ReactNode;
}
