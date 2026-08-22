import type { PersistingService } from './PersistingService';
import type { Trip, SharedTripReference } from '../../../shared/types';
import { GoogleDrivePersistingService } from './GoogleDrivePersistingService';
import { GitHubPersistingService } from './GitHubPersistingService';

export class PersistingManager {
  private services: PersistingService[] = [
    new GoogleDrivePersistingService(),
    new GitHubPersistingService(),
  ];

  getServices(): PersistingService[] {
    return this.services;
  }

  getAvailableServices(): PersistingService[] {
    return this.services.filter(s => s.isAvailable());
  }

  // Load trips from all available services and handle conflict resolution if needed
  async loadAllTrips(): Promise<any[]> {
    const allTrips = [];
    for (const service of this.getAvailableServices()) {
      const trips = await service.load();
      // append service indicator to trip metadata
      for (const t of trips) {
        if (t?.metadata?.isSharedTripReference && t.shareLink) {
          const sharedTrip = await this.fetchSharedTrip(t.shareLink);
          if (!sharedTrip || sharedTrip.id !== t.id) {
            // Keep only the saved reference visible. No route geometry or
            // other shared content is retained when the link is unavailable.
            allTrips.push({
              id: t.id,
              name: t.name,
              description: t.description,
              startDate: t.startDate,
              endDate: t.endDate,
              createdAt: t.createdAt || '',
              updatedAt: t.updatedAt || '',
              segments: [],
              metadata: {
                ...(t.metadata || {}),
                shareLink: t.shareLink,
                isSharedTripReference: true,
                sharedTripUnavailable: true,
                _sourceService: service.name,
                syncedServices: Array.from(new Set([...(t.metadata?.syncedServices || []), service.name])),
              },
            } as Trip);
            continue;
          }
          sharedTrip.metadata = {
            ...(sharedTrip.metadata || {}),
            ...t.metadata,
            shareLink: t.shareLink,
            isSharedTripReference: true,
            _sourceService: service.name,
            syncedServices: Array.from(new Set([...(t.metadata?.syncedServices || []), service.name])),
          };
          allTrips.push(sharedTrip);
          continue;
        }
        t.metadata = t.metadata || {};
        t.metadata._sourceService = service.name;
        t.metadata.syncedServices = t.metadata.syncedServices || [];
        if (!t.metadata.syncedServices.includes(service.name)) {
          t.metadata.syncedServices.push(service.name);
        }
        allTrips.push(t);
      }
    }
    return allTrips;
  }

  async saveSharedTripReference(trip: Trip): Promise<SharedTripReference> {
    const reference: SharedTripReference = {
      id: trip.id,
      name: trip.name,
      description: trip.description,
      startDate: trip.startDate,
      endDate: trip.endDate,
      shareLink: trip.metadata?.shareLink,
      metadata: {
        isSharedTripReference: true,
        sharedService: trip.metadata?.sharedService,
      },
    };
    if (!reference.shareLink) throw new Error('Shared trip is missing a share link.');
    for (const service of this.getAvailableServices()) {
      await service.save(reference);
    }
    return reference;
  }

  async uploadToAll(trip: any): Promise<void> {
    const available = this.getAvailableServices();
    if (available.length === 0) return;

    trip.metadata = trip.metadata || {};
    trip.metadata.syncedServices = trip.metadata.syncedServices || [];

    for (const service of available) {
      await service.save(trip);
      if (!trip.metadata.syncedServices.includes(service.name)) {
        trip.metadata.syncedServices.push(service.name);
      }
    }
  }

  async saveAll(trips: any[]): Promise<void> {
    const available = this.getAvailableServices();
    if (available.length === 0 || trips.length === 0) return;

    for (const trip of trips) {
      trip.metadata = trip.metadata || {};
      trip.metadata.syncedServices = trip.metadata.syncedServices || [];
    }

    for (const service of available) {
      await service.saveAll(trips);
      for (const trip of trips) {
        if (!trip.metadata.syncedServices.includes(service.name)) {
          trip.metadata.syncedServices.push(service.name);
        }
      }
    }
  }

  async deleteFromAll(tripId: string): Promise<void> {
    const available = this.getAvailableServices();
    for (const service of available) {
      await service.delete(tripId);
    }
  }

  async loadPreferences(): Promise<any | null> {
    const available = this.getAvailableServices();
    for (const service of available) {
      if (service.loadPreferences) {
        const prefs = await service.loadPreferences();
        if (prefs) {
          return prefs;
        }
      }
    }
    return null;
  }

  async uploadToServices(trip: any, serviceNames: string[]): Promise<void> {
    const services = this.getAvailableServices().filter(service => serviceNames.includes(service.name));
    for (const service of services) {
      await service.save(trip);
      trip.metadata = trip.metadata || {};
      trip.metadata.syncedServices = trip.metadata.syncedServices || [];
      if (!trip.metadata.syncedServices.includes(service.name)) {
        trip.metadata.syncedServices.push(service.name);
      }
    }
  }

  async loadPreferencesFromAll(): Promise<{ source: string; preferences: any }[]> {
    const loaded = await Promise.all(this.getAvailableServices().map(async service => {
      if (!service.loadPreferences) return null;
      const preferences = await service.loadPreferences();
      return preferences ? { source: service.name, preferences } : null;
    }));
    return loaded.filter((item): item is { source: string; preferences: any } => item !== null);
  }

  async savePreferences(prefs: any): Promise<void> {
    const available = this.getAvailableServices();
    for (const service of available) {
      if (service.savePreferences) {
        await service.savePreferences(prefs);
      }
    }
  }

  async loadPreferenceFile(path: string): Promise<string | null> {
    const available = this.getAvailableServices();
    for (const service of available) {
      if (service.loadPreferenceFile) {
        const content = await service.loadPreferenceFile(path);
        if (content !== null) {
          return content;
        }
      }
    }
    return null;
  }

  async loadPreferenceFileFromService(source: string, path: string): Promise<string | null> {
    const service = this.getAvailableServices().find(item => item.name === source);
    return service?.loadPreferenceFile ? service.loadPreferenceFile(path) : null;
  }

  async savePreferenceFile(path: string, content: string): Promise<void> {
    const available = this.getAvailableServices();
    for (const service of available) {
      if (service.savePreferenceFile) {
        await service.savePreferenceFile(path, content);
      }
    }
  }

  async deletePreferenceFile(path: string): Promise<void> {
    const available = this.getAvailableServices();
    for (const service of available) {
      if (service.deletePreferenceFile) {
        await service.deletePreferenceFile(path);
      }
    }
  }

  async fetchSharedTrip(shareLink: string): Promise<Trip | null> {
    for (const service of this.services) {
      const trip = await service.fetchSharedTrip(shareLink);
      if (trip) {
        trip.metadata = trip.metadata || {};
        trip.metadata.shareLink = shareLink;
        trip.metadata.sharedService = service.name;
        return trip;
      }
    }
    return null;
  }

  async updateSharedTrip(shareLink: string, trip: Trip): Promise<void> {
    for (const service of this.services) {
      await service.updateSharedTrip(shareLink, trip);
    }
  }
}

export const persistingManager = new PersistingManager();
