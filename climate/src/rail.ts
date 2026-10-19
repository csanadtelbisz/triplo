import type { ClimateResult, RailInput, RailType, Traction } from "./types";
import { Run, requireDistance } from "./run";

const ROW: Record<RailType, string> = { inter_city: "national", high_speed: "international", light_rail: "light", subway: "underground" };

export function calcRail(run: Run, input: RailInput): ClimateResult {
  requireDistance(input.distanceKm);
  const km = input.distanceKm;
  let type: RailType = input.railType ?? "inter_city";
  if (!(type in ROW)) {
    run.warn("RAIL_TYPE_UNKNOWN", `Unknown rail type "${type}"; inter_city used.`);
    type = "inter_city";
  }
  let traction: Traction = input.traction ?? "electric";
  const row = ROW[type];

  // light rail, subway and high speed are electric by nature
  if (type !== "inter_city" && traction === "diesel") {
    run.warn("INVALID_COMBINATION", `${type} with diesel traction is not available; electric traction used.`);
    traction = "electric";
  }
  const electric = type !== "inter_city" || traction === "electric";

  if (!electric) {
    // inter_city, unknown or diesel traction: DEFRA national rail factor (UK diesel/electric mix) as is
    if (traction === "diesel") run.warn("RAIL_DIESEL_APPROXIMATED", "No diesel-only rail factor available; UK national rail mix used.");
    else run.assume("DEFRA national rail factor (UK diesel/electric mix)");
    return run.finish({
      directKg: km * run.factor(`rail.${row}.ttw`),
      upstreamKg: km * run.factor(`rail.${row}.wtt`),
      method: "defra_per_pkm",
      includesRadiativeForcing: false,
      distanceKmUsed: km,
    });
  }

  // electric: implied energy use from DEFRA's UK factor, repriced with the grid of the travelled countries
  const gen = run.factor("elec.uk.generation");
  const td = run.factor("elec.uk.td");
  const kwhPerPkm = run.factor(`rail.${row}.ttw`) / (gen + td); // DEFRA: generation plus T&D
  const g = run.grid(input.countryShares, false);
  const upstream = km * kwhPerPkm * (g / 1000) * (1 + td / gen);
  run.assume(`Implied energy use ${kwhPerPkm.toFixed(3)} kWh per passenger-km (DEFRA UK factor divided by UK generation plus T&D factor)`);
  if (type === "inter_city") run.assume("Electric inter-city: national rail factor treated as all-electric (overestimates energy)");
  return run.finish({ directKg: 0, upstreamKg: upstream, method: "grid_kwh", includesRadiativeForcing: false, distanceKmUsed: km });
}
