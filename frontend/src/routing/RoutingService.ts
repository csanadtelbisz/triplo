import type { TransportMode } from '../../../shared/types';
import { FlightRouter } from './FlightRouter';
import { StraightLineRouter } from './StraightLineRouter';
import { GraphHopperRouter } from './GraphHopperRouter';

export interface IRoutingService {
  name: string;
  route: (waypoints: [number, number][], profile: string) => Promise<GeoJSON.LineString>;
  isAvailable: () => boolean;
  getAttribution: () => { text: string; link?: string } | undefined;
  getRoutingProfiles: (mode: TransportMode) => string[];
}

export interface DefaultRouter {
  serviceName: string;
  profile: string;
}

class RoutingServiceManager {
  private services: IRoutingService[] = [];
  private defaultRouters: Record<TransportMode, DefaultRouter>;

  constructor() {
    const graphHopper = new GraphHopperRouter();
    const flight = new FlightRouter();
    const straightLine = new StraightLineRouter();
    
    this.services = [graphHopper, flight, straightLine];

    this.defaultRouters = {
      walk: { serviceName: graphHopper.name, profile: 'foot' },
      hike: { serviceName: graphHopper.name, profile: 'hike' },
      run: { serviceName: graphHopper.name, profile: 'foot' },
      bike: { serviceName: graphHopper.name, profile: 'bike' },
      car: { serviceName: graphHopper.name, profile: 'car' },
      flight: { serviceName: flight.name, profile: 'flight' },
      rail: { serviceName: straightLine.name, profile: 'straight' },
      ferry: { serviceName: straightLine.name, profile: 'straight' },
      waterway: { serviceName: straightLine.name, profile: 'straight' }
    };
  }

  public getService(name: string): IRoutingService | undefined {
    return this.services.find(s => s.name === name);
  }

  public async route(waypoints: [number, number][], serviceName: string, profile: string): Promise<GeoJSON.LineString> {
    if (waypoints.length < 2) {
      return { type: 'LineString', coordinates: waypoints };
    }

    const service = this.getService(serviceName) || this.getService('Straight Line Router')!;
    if (!service.isAvailable()) {
       return this.getService('Straight Line Router')!.route(waypoints, 'straight');
    }
    return service.route(waypoints, profile);
  }

  public getServices(): IRoutingService[] {
    return this.services;
  }

  public getDefaultRouter(mode: TransportMode): DefaultRouter {
    return this.defaultRouters[mode];
  }
}

export const routingManager = new RoutingServiceManager();
export const route = (waypoints: [number, number][], serviceName: string, profile: string) => routingManager.route(waypoints, serviceName, profile);