import type { AircraftRow, CabinClass, ClimateResult, FlightInput, SeatClass } from "./types";
import { Run, requireDistance } from "./run";
import type { DataBundle } from "./data";

const CLASSES: SeatClass[] = ["economy", "premium_economy", "business", "first"];

/** Resolve the same aircraft, layout and load defaults for calculations and editors. */
export function getFlightDefaults(input: Pick<FlightInput, 'aircraftType' | 'operator' | 'distanceKm' | 'geometry'>, data: DataBundle) {
  const rows = data.aircraft.filter(row => row.icao.includes(input.aircraftType?.toUpperCase() || ''));
  if (!rows.length) return undefined;
  const flownKm = input.distanceKm * (input.geometry === 'exact' ? 1 : 1 + data.flight.distanceUplift);
  const reference = rows.reduce((a, b) => Math.abs(b.avgFlightKm - flownKm) < Math.abs(a.avgFlightKm - flownKm) ? b : a);
  const operator = input.operator?.toUpperCase();
  const layout = data.layouts.find(row => row.operator === operator && reference.icao.includes(row.aircraft));
  const seats = layout?.seats || Object.fromEntries(CLASSES.map(c => [c, reference.seats * data.flight.classSeatShares[reference.bodyType][c]])) as Record<SeatClass, number>;
  return { reference, layout, seats, loadFactor: (operator ? data.operators[operator]?.loadFactor : undefined) ?? reference.loadFactor };
}

function interpolate(points: { x: number; y: number }[], x: number): number {
  const p = [...points].sort((a, b) => a.x - b.x);
  if (x <= p[0].x) return p[0].y;
  if (x >= p[p.length - 1].x) return p[p.length - 1].y;
  for (let i = 1; i < p.length; i++) {
    if (x <= p[i].x) {
      const a = p[i - 1], b = p[i];
      return b.x === a.x ? b.y : a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
    }
  }
  return p[p.length - 1].y;
}

export function calcFlight(run: Run, input: FlightInput): ClimateResult {
  requireDistance(input.distanceKm);
  const P = run.data.flight;
  const cabin: CabinClass = input.cabinClass ?? "average";
  const exact = input.geometry === "exact";
  const flownKm = exact ? input.distanceKm : input.distanceKm * (1 + P.distanceUplift);
  const gcKm = exact ? input.distanceKm / (1 + P.distanceUplift) : input.distanceKm;
  run.assume(exact ? "Exact flown distance used" : `Great-circle distance +${Math.round(P.distanceUplift * 100)}%`);
  run.assume(`Radiative forcing: CO2 x ${P.rfMultiplier}`);

  const type = input.aircraftType?.toUpperCase();
  const rows = type ? run.data.aircraft.filter((a) => a.icao.includes(type)) : [];
  if (type && rows.length === 0) run.warn("AIRCRAFT_TYPE_UNKNOWN", `Aircraft type ${type} not in the table; DEFRA average factors used.`);

  if (rows.length) {
    const r = tier1(run, input, rows, cabin, flownKm);
    if (r) return r;
  }
  return tier2(run, cabin, gcKm, flownKm);
}

// ---------------------------------------------------------------- tier 2: DEFRA average factors
function tier2(run: Run, cabin: CabinClass, gcKm: number, flownKm: number): ClimateResult {
  const P = run.data.flight;
  const band = gcKm <= P.shortHaulMaxKm ? "short" : "long";
  let cls: string = cabin === "average" ? "avg" : cabin;
  if (band === "short") {
    if (cls === "premium_economy") cls = "economy";
    else if (cls === "first") cls = "business";
  }
  const base = `flight.${band}.${cls}`;
  run.assume(`DEFRA ${band}-haul average factors (up to ${P.shortHaulMaxKm} km short-haul); 8% distance uplift already included in the factors`);
  run.assume(`Seat weight: included in the DEFRA ${band}-haul ${cls === "avg" ? "average" : cls.replaceAll("_", " ")} passenger factor`);
  return run.finish({
    directKg: gcKm * run.factor(`${base}.rf`),
    upstreamKg: gcKm * run.factor(`${base}.wtt`),
    method: "defra_per_pkm",
    includesRadiativeForcing: true,
    distanceKmUsed: flownKm,
  });
}

// ---------------------------------------------------------------- tier 1: aircraft model
function tier1(run: Run, input: FlightInput, rows: AircraftRow[], cabin: CabinClass, flownKm: number): ClimateResult | null {
  const P = run.data.flight;
  const defaults = getFlightDefaults(input, run.data)!;
  const ref = defaults.reference;
  const body = ref.bodyType;
  const efPoints = rows.map((r) => ({ x: r.avgFlightKm, y: r.kgCo2PerVkm }));
  const minKm = Math.min(...efPoints.map((p) => p.x)), maxKm = Math.max(...efPoints.map((p) => p.x));
  if (flownKm < minKm / 2 || flownKm > maxKm * 1.5) {
    run.warn("AIRCRAFT_DISTANCE_OUT_OF_RANGE", `${ref.model}: DEFRA per-km data covers ${minKm}-${maxKm} km flights; ${Math.round(flownKm)} km is far outside, so the estimate is rough.`);
  }
  const tripCo2 = interpolate(efPoints, flownKm) * flownKm; // kg CO2 of the whole flight

  const jetCo2PerKg = run.factor("jetfuel.co2_per_t") / 1000;
  const fuelKg = tripCo2 / jetCo2PerKg;
  const nonCo2PerKg = (run.factor("jetfuel.ch4_per_t") + run.factor("jetfuel.n2o_per_t")) / 1000;
  const wttPerKg = run.factor("jetfuel.wtt_per_t") / 1000;

  // seats
  const op = input.operator?.toUpperCase();
  let seats: Record<SeatClass, number> | undefined;
  if (input.seats) {
    seats = { economy: 0, premium_economy: 0, business: 0, first: 0, ...input.seats };
    run.assume("Seat configuration given by the caller");
  } else if (op) {
    const lay = defaults.layout;
    if (lay) {
      seats = lay.seats;
      run.assume(`Seat layout of ${op} for ${lay.aircraft}`);
    }
  }
  if (!seats) {
    seats = defaults.seats;
    run.assume(`${ref.model}: ${ref.seats} seats (DEFRA UK-airline average), DEFRA class shares for ${body}-body`);
  }
  const totalSeats = CLASSES.reduce((a, c) => a + seats![c], 0);
  if (!(totalSeats > 0)) {
    run.warn("SEATS_INVALID", "Seat configuration has no seats; DEFRA average factors used.");
    return null;
  }

  // load factor
  let lf = input.loadFactor;
  if (lf !== undefined && !(lf > 0 && lf <= 1)) {
    run.warn("LOAD_FACTOR_INVALID", `Load factor ${lf} outside (0, 1]; default used.`);
    lf = undefined;
  }
  if (lf === undefined && op && run.data.operators[op]?.loadFactor !== undefined) {
    lf = defaults.loadFactor;
    run.assume(`Load factor ${lf} (operator ${op})`);
  }
  if (lf === undefined) {
    lf = defaults.loadFactor;
    run.assume(`Load factor ${lf} (DEFRA UK-airline average for ${ref.model})`);
  }

  // share of the flight's emissions that one passenger carries
  const w = P.classWeights[body];
  const weighted = CLASSES.reduce((a, c) => a + seats![c] * w[c], 0);
  let perPaxFactor: number;
  if (cabin === "average") {
    perPaxFactor = 1 / (lf * totalSeats); // whole flight divided by occupied seats
    run.assume("Seat weight: equal weighting across occupied seats (average cabin)");
  } else {
    if (!(seats[cabin] > 0)) run.warn("CLASS_NOT_IN_LAYOUT", `${cabin} has no seats in this configuration; calculated as if it existed.`);
    perPaxFactor = w[cabin] / weighted / lf;
    run.assume(`Seat weight: ${w[cabin]} × economy (${cabin.replaceAll("_", " ")}, ${body}-body aircraft)`);
  }

  const direct = (tripCo2 * P.rfMultiplier + fuelKg * nonCo2PerKg) * perPaxFactor;
  const upstream = fuelKg * wttPerKg * perPaxFactor;
  return run.finish({ directKg: direct, upstreamKg: upstream, method: "aircraft_model", includesRadiativeForcing: true, distanceKmUsed: flownKm, aircraftTable: true });
}
