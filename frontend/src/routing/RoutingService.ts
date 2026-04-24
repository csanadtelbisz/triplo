import type { TransportMode } from '../../../shared/types';
import { FlightRouter } from './FlightRouter';
import { StraightLineRouter } from './StraightLineRouter';
import { GraphHopperRouter } from './GraphHopperRouter';
import { RailRouter } from './RailRouter';
import { MapyRouter } from './MapyRouter';

export interface IRoutingService {
  name: string;
  icon?: string;
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
  private graphHopper = new GraphHopperRouter();
  private mapy = new MapyRouter();
  private flight = new FlightRouter();
  private straightLine = new StraightLineRouter();
  private rail = new RailRouter();

  private services: IRoutingService[] = [
    this.graphHopper,
    this.mapy,
    this.flight,
    this.rail,
    this.straightLine
  ];

  private defaultRouters: Record<TransportMode, DefaultRouter> = {
      walk: { serviceName: this.graphHopper.name, profile: 'foot' },
      hike: { serviceName: this.graphHopper.name, profile: 'hike' },
      run: { serviceName: this.graphHopper.name, profile: 'foot' },
      bike: { serviceName: this.graphHopper.name, profile: 'bike' },
      car: { serviceName: this.graphHopper.name, profile: 'car' },
      taxi: { serviceName: this.graphHopper.name, profile: 'car' },
      bus: { serviceName: this.graphHopper.name, profile: 'car' },
      rail: { serviceName: this.rail.name, profile: 'rail' },
      subway: { serviceName: this.rail.name, profile: 'rail' },
      flight: { serviceName: this.flight.name, profile: 'flight' },
      ferry: { serviceName: this.straightLine.name, profile: 'straight' },
      other: { serviceName: this.straightLine.name, profile: 'straight' }
    };

  constructor() {}

  public getService(name: string): IRoutingService | undefined {
    return this.services.find(s => s.name === name);
  }

  public async route(waypoints: [number, number][], serviceName: string, profile: string): Promise<GeoJSON.LineString> {
    if (waypoints.length < 2) {
      return { type: 'LineString', coordinates: waypoints };
    }

    const service = this.getService(serviceName) || this.straightLine;
    if (!service.isAvailable()) {
       return this.straightLine.route(waypoints, 'straight');
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