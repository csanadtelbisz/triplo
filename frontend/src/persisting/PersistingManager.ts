import type { PersistingService } from './PersistingService';
import { GitHubPersistingService } from './GitHubPersistingService';
import { GoogleDrivePersistingService } from './GoogleDrivePersistingService';

export class PersistingManager {
  private services: PersistingService[] = [
    new GitHubPersistingService(),
    new GoogleDrivePersistingService()
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
      trips.forEach((t: any) => {
        t.metadata = t.metadata || {};
        t.metadata._sourceService = service.name;
        t.metadata.syncedServices = t.metadata.syncedServices || [];
        if (!t.metadata.syncedServices.includes(service.name)) {
          t.metadata.syncedServices.push(service.name);
        }
      });
      allTrips.push(...trips);
    }
    return allTrips;
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
}

export const persistingManager = new PersistingManager();