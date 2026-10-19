/** Public types of the climate-impact module. See CLIMATE_IMPACT_CALCULATION.md. */

export type Iso3 = string;
/** Weights in the 0..1 range per country (ISO 3166 alpha-3). Normalised internally when the sum is not 1. */
export type CountryShares = Record<Iso3, number>;

export interface CommonInput {
  /** ISO date "YYYY-MM-DD" of the segment; its year selects factor sets and the grid year. */
  date: string;
  /** Distance in km (> 0). For flights see FlightInput.geometry. */
  distanceKm: number;
}

export interface NoEmissionInput {
  mode: "none";
}

export type CabinClass = "economy" | "premium_economy" | "business" | "first" | "average";
export type SeatClass = Exclude<CabinClass, "average">;

export interface FlightInput extends CommonInput {
  mode: "flight";
  /** "great_circle" (default): distanceKm is the airport-to-airport great-circle distance; "exact": distanceKm is the real flown track. */
  geometry?: "great_circle" | "exact";
  cabinClass?: CabinClass;
  /** ICAO aircraft type designator, e.g. "A21N", "B738". */
  aircraftType?: string;
  /** ICAO airline designator, e.g. "RYR", "BAW". */
  operator?: string;
  /** Explicit seat configuration override. */
  seats?: Partial<Record<SeatClass, number>>;
  /** Explicit passenger load factor override, 0..1. */
  loadFactor?: number;
}

export type CarFuel = "petrol" | "diesel" | "hybrid" | "phev" | "bev" | "cng" | "lpg" | "average";
export type CarSize = "small" | "medium" | "large" | "average";

/** Also used for taxis (pass the occupancy of the taxi). */
export interface CarInput extends CommonInput {
  mode: "car";
  fuelType?: CarFuel;
  engineSize?: CarSize;
  /** Litres per 100 km; only for petrol, diesel, hybrid (as petrol) and lpg. */
  exactFuelLPer100Km?: number;
  /** Persons in the vehicle including the traveller. Default 1.5, clamped to 1..9. */
  occupancy?: number;
  /** Where the electricity of phev/bev comes from. Default: world average. */
  gridShares?: CountryShares;
}

export interface BusInput extends CommonInput {
  mode: "bus";
  /** Omit for automatic selection: local below 10 km, coach otherwise. */
  busType?: "local" | "coach";
}

export type RailType = "inter_city" | "high_speed" | "light_rail" | "subway";
export type Traction = "electric" | "diesel";

export interface RailInput extends CommonInput {
  mode: "rail";
  railType?: RailType;
  /** Default "electric" for inter-city rail. */
  traction?: Traction;
  countryShares?: CountryShares;
}

export interface FerryInput extends CommonInput {
  mode: "ferry";
  /** false (default): foot passenger; true: passenger travelling with a car (single-person basis). */
  withVehicle?: boolean;
}

export type TravelInput = NoEmissionInput | FlightInput | CarInput | BusInput | RailInput | FerryInput;

export interface Warning {
  code: string;
  message: string;
}

export interface ClimateResult {
  /** Total, well-to-wheel, per traveller, kg CO2e. */
  co2eKg: number;
  /** Emitted at the vehicle (0 for grid-electric vehicles). */
  directKg: number;
  /** Fuel supply chain, grid generation lifecycle and grid losses. */
  upstreamKg: number;
  method: "none" | "defra_per_pkm" | "defra_per_vkm" | "fuel_consumption" | "grid_kwh" | "aircraft_model";
  scope: "wtw";
  includesRadiativeForcing: boolean;
  distanceKmUsed: number;
  factorSets: {
    defra?: { yearUsed: number };
    grid?: { yearUsed: number; level: "country" | "continent" | "world" | "mixed"; source: "OWID/Ember" };
    aircraft?: { tableVersion: string };
    railEnergy?: { yearUsed: number; source: string };
  };
  factorKeys: string[];
  assumptions: string[];
  warnings: Warning[];
  status: "ok" | "fallback";
}

export type BatchItem = { ok: true; result: ClimateResult } | { ok: false; error: string };

/** Electric-only Level 1 benchmarks; passenger averages include empty running. */
export interface RailEnergyParams {
  year: number;
  source: string;
  inter_city: { kwhPerTrainKm: number; passengers: number };
  high_speed: { kwhPerTrainKm: number; passengers: number };
}

export interface AircraftRow {
  model: string;
  icao: string[];
  bodyType: "narrow" | "wide";
  band: "dom" | "short" | "long";
  seats: number;
  loadFactor: number;
  kgCo2PerVkm: number;
  avgFlightKm: number;
}

export interface FlightParams {
  year: number;
  distanceUplift: number;
  rfMultiplier: number;
  shortHaulMaxKm: number;
  defaultLoadFactorByBand: Record<"dom" | "short" | "long", number>;
  classWeights: Record<"narrow" | "wide", Record<SeatClass, number>>;
  classSeatShares: Record<"narrow" | "wide", Record<SeatClass, number>>;
}
