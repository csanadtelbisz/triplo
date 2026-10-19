import type { CarFuel, CarInput, CarSize, ClimateResult } from "./types";
import { Run, requireDistance } from "./run";

export const DEFAULT_OCCUPANCY = 1.5; // UK National Travel Survey average
const MAX_OCCUPANCY = 9;

/** DEFRA row suffix per fuel type ("average" is DEFRA's "Unknown" fuel row). */
const FUEL_ROW: Record<CarFuel, string> = {
  petrol: "petrol", diesel: "diesel", hybrid: "hybrid", phev: "phev", bev: "bev", cng: "cng", lpg: "lpg", average: "unknown",
};

export function calcCar(run: Run, input: CarInput): ClimateResult {
  requireDistance(input.distanceKm);
  const km = input.distanceKm;
  const fuel: CarFuel = input.fuelType ?? "average";
  let size: CarSize = input.engineSize ?? "average";

  let occ = input.occupancy ?? DEFAULT_OCCUPANCY;
  if (!Number.isFinite(occ)) occ = DEFAULT_OCCUPANCY;
  if (occ < 1 || occ > MAX_OCCUPANCY) {
    const c = Math.min(MAX_OCCUPANCY, Math.max(1, occ));
    run.warn("OCCUPANCY_CLAMPED", `Occupancy ${occ} outside 1..${MAX_OCCUPANCY}; ${c} used.`);
    occ = c;
  }
  run.assume(`Per traveller: vehicle emissions divided by occupancy ${occ}`);

  // ---- exact fuel consumption override
  if (input.exactFuelLPer100Km !== undefined) {
    const litres = (km * input.exactFuelLPer100Km) / 100;
    const f = fuel === "diesel" ? "diesel" : fuel === "lpg" ? "lpg" : fuel === "petrol" || fuel === "hybrid" ? "petrol" : null;
    if (f && Number.isFinite(litres) && litres >= 0) {
      if (fuel === "hybrid") run.assume("Hybrid with exact consumption: petrol factors");
      const ttw = run.factor(`fuel.${f}.co2_per_l`) + run.factor(`fuel.${f}.ch4_per_l`) + run.factor(`fuel.${f}.n2o_per_l`);
      const wtt = run.factor(`fuel.${f}.wtt_per_l`);
      return run.finish({ directKg: (litres * ttw) / occ, upstreamKg: (litres * wtt) / occ, method: "fuel_consumption", includesRadiativeForcing: false, distanceKmUsed: km });
    }
    run.warn("EXACT_FUEL_IGNORED", `Exact fuel consumption is only used for petrol, diesel, hybrid and lpg; DEFRA factors used instead.`);
  }

  // ---- electric / plug-in
  if (fuel === "bev" || fuel === "phev") {
    const g = run.grid(input.gridShares, true); // g CO2e/kWh, lifecycle
    const kwhKey = `car.${size}.${fuel}.kwh`;
    const kwhPerKm = run.factor(kwhKey);
    const uplift = run.tdUplift();
    const elecKg = km * kwhPerKm * (g / 1000) * (1 + uplift);
    let direct = 0, upstream = elecKg;
    if (fuel === "phev") {
      direct = km * run.factor(`car.${size}.phev.ttw`);
      upstream += km * run.factor(`car.${size}.phev.wtt`);
      run.assume("PHEV: DEFRA liquid-fuel part plus electric part priced at the given grid");
    }
    return run.finish({ directKg: direct / occ, upstreamKg: upstream / occ, method: fuel === "bev" ? "grid_kwh" : "defra_per_vkm", includesRadiativeForcing: false, distanceKmUsed: km });
  }

  // ---- DEFRA per vehicle-km
  const row = FUEL_ROW[fuel];
  if (!run.has(`car.${size}.${row}.ttw`)) {
    run.warn("CAR_FACTOR_FALLBACK", `No DEFRA factor for ${size} ${fuel}; average-size car used.`);
    size = "average";
  }
  if (!run.has(`car.${size}.${row}.ttw`)) throw new Error(`No DEFRA car factor for ${fuel}`);
  const direct = km * run.factor(`car.${size}.${row}.ttw`);
  const upstream = km * run.factor(`car.${size}.${row}.wtt`);
  return run.finish({ directKg: direct / occ, upstreamKg: upstream / occ, method: "defra_per_vkm", includesRadiativeForcing: false, distanceKmUsed: km });
}
