// Mock client for Trip data operations
import type { Trip } from '../../../shared/types';
import { mockTrips as defaultMockTrips } from './mockData';

const isLocalhostOrIP = window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1' || 
                        /^\d{1,3}(\.\d{1,3}){3}$/.test(window.location.hostname);

const mockTrips: Trip[] = isLocalhostOrIP ? [...defaultMockTrips] : [];

export const TripAPI = {
  getTrips: async (): Promise<Trip[]> => {
    return new Promise(resolve => setTimeout(() => resolve(mockTrips), 500));
  },
  getTrip: async (id: string): Promise<Trip | undefined> => {
    return new Promise(resolve => setTimeout(() => resolve(mockTrips.find(t => t.id === id)), 500));
  },
  saveTrip: async (trip: Trip): Promise<Trip> => {
    return new Promise(resolve => setTimeout(() => {
      const idx = mockTrips.findIndex(t => t.id === trip.id);
      if (idx !== -1) mockTrips[idx] = trip;
      else mockTrips.push(trip);
      resolve(trip);
    }, 500));
  },
  deleteTrip: async (id: string): Promise<void> => {
    return new Promise(resolve => setTimeout(() => {
      const idx = mockTrips.findIndex(t => t.id === id);
      if (idx !== -1) mockTrips.splice(idx, 1);
      resolve();
    }, 500));
  }
};
