import type { BusInput, ClimateResult } from "./types";
import { Run, requireDistance } from "./run";

export function calcBus(run: Run, input: BusInput): ClimateResult {
  requireDistance(input.distanceKm);
  let t: string = input.busType ?? "coach";
  if (t !== "local" && t !== "coach") {
    run.warn("BUS_TYPE_UNKNOWN", `Unknown bus type "${t}"; coach used.`);
    t = "coach";
  }
  const km = input.distanceKm;
  return run.finish({
    directKg: km * run.factor(`bus.${t}.ttw`),
    upstreamKg: km * run.factor(`bus.${t}.wtt`),
    method: "defra_per_pkm",
    includesRadiativeForcing: false,
    distanceKmUsed: km,
  });
}
