import type { Trip } from '../../../shared/types';

export const mockTrips: Trip[] = [
  {
    id: '123e4567-e89b-12d3-a456-426614174000',
    name: 'Alps Road Trip & Hike',
    description: 'A brief drive up the mountains, followed by a hike to the peak and a train back.',
    startDate: '2025-06-15T08:00:00Z',
    endDate: '2025-06-16T18:00:00Z',
    createdAt: '2025-06-01T12:00:00Z',
    updatedAt: '2025-06-01T12:00:00Z',
    segments: [
      {
        id: 'seg-1',
        transportMode: 'car',
        routingService: 'GraphHopper Router',
        routingProfile: 'car',
        source: 'router',
        waypoints: [
          { id: 'wp-1', coordinates: [11.3933, 47.2692], name: 'Innsbruck Hbf', icon: 'train' },
          { id: 'wp-1a', coordinates: [11.4100, 47.2550], name: 'Amras Waypoint' },
          { id: 'wp-1b', coordinates: [11.4050, 47.2300], name: 'Igls Village', icon: 'house' },
          { id: 'wp-2', coordinates: [11.3945, 47.1950], name: 'Patscherkofelbahn Bottom' }
        ],
        geometry: {
          type: 'LineString',
          coordinates: [
            [11.3933, 47.2692],
            [11.4000, 47.2600],
            [11.4100, 47.2550],
            [11.4080, 47.2400],
            [11.4050, 47.2300],
            [11.3980, 47.2100],
            [11.3945, 47.1950]
          ]
        }
      },
      {
        id: 'seg-2',
        name: 'Patscherkofel Hike',
        transportMode: 'hike',
        routingService: 'GraphHopper Router',
        routingProfile: 'foot',
        source: 'router',
        waypoints: [
          { id: 'wp-2', coordinates: [11.3945, 47.1950], name: 'Patscherkofelbahn Bottom' },
          { id: 'wp-2a', coordinates: [11.4000, 47.1850], name: 'Patscher Alm Connector' },
          { id: 'wp-3', coordinates: [11.4116, 47.1706], name: 'Patscherkofel Summit', icon: 'landscape' }
        ],
        geometry: {
          type: 'LineString',
          coordinates: [
            [11.3945, 47.1950],
            [11.3970, 47.1900],
            [11.4000, 47.1850],
            [11.4050, 47.1800],
            [11.4116, 47.1706]
          ]
        }
      }
    ]
  },
  {
    id: '234e5678-f90c-12d3-b567-526614175111',
    name: 'Munich City Sprint',
    description: 'A quick train commute followed by a run through the English Garden.',
    startDate: '2025-08-10T09:00:00Z',
    endDate: '2025-08-10T12:00:00Z',
    createdAt: '2025-07-01T10:00:00Z',
    updatedAt: '2025-07-01T10:00:00Z',
    segments: [
      {
        id: 'seg-m1',
        transportMode: 'rail',
        routingService: 'Straight Line Router',
        routingProfile: 'straight',
        source: 'router',
        waypoints: [
          { id: 'wp-m1', coordinates: [11.5583, 48.1408], name: 'Munich Hbf', icon: 'directions_subway' },
          { id: 'wp-m2', coordinates: [11.5912, 48.1500], name: 'Lehel Station' }
        ],
        geometry: {
          type: 'LineString',
          coordinates: [
            [11.5583, 48.1408],
            [11.5650, 48.1420],
            [11.5750, 48.1450],
            [11.5850, 48.1480],
            [11.5912, 48.1500]
          ]
        }
      },
      {
        id: 'seg-m2',
        name: 'English Garden Run',
        transportMode: 'run',
        routingService: 'GraphHopper Router',
        routingProfile: 'foot',
        source: 'router',
        waypoints: [
          { id: 'wp-m2', coordinates: [11.5912, 48.1500], name: 'Lehel Station' },
          { id: 'wp-m3', coordinates: [11.5950, 48.1600], name: 'Monopteros', icon: 'account_balance' },
          { id: 'wp-m4', coordinates: [11.6050, 48.1750], name: 'Kleinhesseloher See', icon: 'water' }
        ],
        geometry: {
          type: 'LineString',
          coordinates: [
            [11.5912, 48.1500],
            [11.5930, 48.1550],
            [11.5950, 48.1600],
            [11.5980, 48.1650],
            [11.6010, 48.1700],
            [11.6050, 48.1750]
          ]
        }
      }
    ]
  },
  {
    id: 'fly-trip-001',
    name: 'Alps Flight & Italian Drive',
    description: 'A flight segment from Munich to Milan Bergamo via Innsbruck, plus a drive to Verona.',
    startDate: '2026-05-10T08:00:00Z',
    endDate: '2026-05-20T18:00:00Z',
    createdAt: '2026-04-01T12:00:00Z',
    updatedAt: '2026-04-01T12:00:00Z',
    segments: [
      {
        id: 'seg-fly-alps',
        transportMode: 'flight',
        routingService: 'Flight Router',
        routingProfile: 'flight',
        source: 'router',
        waypoints: [
          { id: 'wp-muc', coordinates: [11.7861, 48.3538], name: 'Munich Airport (MUC)', icon: 'flight_takeoff' },
          { id: 'wp-inn', coordinates: [11.3440, 47.2602], name: 'Innsbruck Airport (INN)', icon: 'flight' },
          { id: 'wp-bgy', coordinates: [9.7042, 45.6739], name: 'Milan Bergamo (BGY)', icon: 'flight_land' }
        ],
        geometry: {
          type: 'LineString',
          coordinates: [
            [11.7861, 48.3538],
            [11.3440, 47.2602],
            [9.7042, 45.6739]
          ]
        }
      },
      {
        id: 'seg-car-ita',
        transportMode: 'car',
        routingService: 'GraphHopper Router',
        routingProfile: 'car',
        source: 'router',
        waypoints: [
          { id: 'wp-bgy-2', coordinates: [9.7042, 45.6739], name: 'Milan Bergamo (BGY)' },
          { id: 'wp-verona', coordinates: [10.9916, 45.4384], name: 'Verona', icon: 'location_city' }
        ],
        geometry: {
          type: 'LineString',
          coordinates: [
            [9.7042, 45.6739],
            [10.3500, 45.5000],
            [10.9916, 45.4384]
          ]
        }
      }
    ]
  }
];
