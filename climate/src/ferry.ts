import type { ClimateResult, FerryInput } from "./types";
import { Run, requireDistance } from "./run";

export function calcFerry(run: Run, input: FerryInput): ClimateResult {
  requireDistance(input.distanceKm);
  const km = input.distanceKm;
  const k = input.withVehicle ? "car" : "foot";
  if (input.withVehicle) run.assume("DEFRA ferry factor for a passenger travelling with a car, single-person basis (not scaled by car occupancy)");
  run.assume("DEFRA factors are for RoPax ferries; passenger-only ferries are likely higher");
  return run.finish({
    directKg: km * run.factor(`ferry.${k}.ttw`),
    upstreamKg: km * run.factor(`ferry.${k}.wtt`),
    method: "defra_per_pkm",
    includesRadiativeForcing: false,
    distanceKmUsed: km,
  });
}
