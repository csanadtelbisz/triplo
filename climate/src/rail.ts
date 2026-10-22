import type { ClimateResult, RailInput, RailType, Traction } from "./types";
import { Run, requireDistance } from "./run";

const ROW: Record<RailType, string> = { inter_city: "national", high_speed: "international", light_rail: "light", subway: "underground" };

export function defaultRailType(distanceKm: number): RailType {
  return distanceKm < 30 ? "light_rail" : "inter_city";
}

/** Older saved profiles used "unknown" for the same approximation as diesel. */
export function resolveRailTraction(traction?: string): Traction {
  return traction === "diesel" || traction === "unknown" ? "diesel" : "electric";
}

export function calcRail(run: Run, input: RailInput): ClimateResult {
  requireDistance(input.distanceKm);
  const km = input.distanceKm;
  let type: RailType = input.railType ?? defaultRailType(km);
  if (!(type in ROW)) {
    run.warn("RAIL_TYPE_UNKNOWN", `Unknown rail type "${type}"; inter_city used.`);
    type = "inter_city";
  }
  let traction = !input.railType && type !== "inter_city" ? "electric" : resolveRailTraction(input.traction);
  const row = ROW[type];

  // light rail, subway and high speed are electric by nature
  if (type !== "inter_city" && traction === "diesel") {
    run.warn("INVALID_COMBINATION", `${type} with diesel traction is not available; electric traction used.`);
    traction = "electric";
  }
  const electric = type !== "inter_city" || traction === "electric";

  if (!electric) {
    // DEFRA has no diesel-only factor; use its national diesel/electric mix.
    run.warn("RAIL_DIESEL_APPROXIMATED", "No diesel-only rail factor available; UK national rail mix used.");
    return run.finish({
      directKg: km * run.factor(`rail.${row}.ttw`),
      upstreamKg: km * run.factor(`rail.${row}.wtt`),
      method: "defra_per_pkm",
      includesRadiativeForcing: false,
      distanceKmUsed: km,
    });
  }

  let kwhPerPkm: number;
  const benchmark = type === "inter_city" || type === "high_speed";
  if (type === "inter_city" || type === "high_speed") {
    // Matched electric-only energy defaults, independent of UK mixed-traction/Eurostar CO2 factors.
    const energy = run.data.railEnergy[type];
    kwhPerPkm = energy.kwhPerTrainKm / energy.passengers;
    run.keys.add(`rail.energy.${type}.kwh_per_pkm`);
    run.assume(`Electric ${type === "inter_city" ? "inter-city" : "high-speed"} benchmark: ${kwhPerPkm.toFixed(3)} kWh per passenger-km (${energy.kwhPerTrainKm} kWh per train-km / ${energy.passengers} average passengers, including empty running)`);
  } else {
    // Light rail/subway retain DEFRA's implied electric energy use.
    const gen = run.factor("elec.uk.generation");
    const td = run.factor("elec.uk.td");
    kwhPerPkm = run.factor(`rail.${row}.ttw`) / (gen + td);
    run.assume(`Implied energy use ${kwhPerPkm.toFixed(3)} kWh per passenger-km (DEFRA UK factor divided by UK generation plus T&D factor)`);
  }
  const g = run.grid(input.countryShares, false);
  const upstream = km * kwhPerPkm * (g / 1000) * (1 + run.tdUplift());
  return run.finish({ directKg: 0, upstreamKg: upstream, method: "grid_kwh", includesRadiativeForcing: false, distanceKmUsed: km, railEnergy: benchmark });
}
