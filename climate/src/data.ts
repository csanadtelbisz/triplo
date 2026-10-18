import type { AircraftRow, FlightParams, SeatClass } from "./types";

/** All numeric data the calculator needs; generated from data/*.csv by scripts/build-json.py. Tests can pass their own. */
export interface DataBundle {
  version: string;
  /** key -> [year, value][] (DEFRA factors, see scripts/factor_keys.py) */
  factors: Record<string, [number, number][]>;
  /** iso3 or _EUROPE/_ASIA/_AFRICA/_NORTH_AMERICA/_SOUTH_AMERICA/_OCEANIA/_WORLD -> [year, gCO2e/kWh][] */
  grid: Record<string, [number, number][]>;
  /** iso3 -> continent name as in OWID */
  regions: Record<string, string>;
  aircraft: AircraftRow[];
  operators: Record<string, { name: string; loadFactor: number }>;
  layouts: { operator: string; aircraft: string; seats: Record<SeatClass, number> }[];
  flight: FlightParams;
}
