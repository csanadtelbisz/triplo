import type { DataBundle } from "./data";
import type { ClimateResult, CountryShares, GridFactor, Warning } from "./types";

export const FAR_YEARS = 10;

const CONTINENT_KEY: Record<string, string> = {
  Europe: "_EUROPE", Asia: "_ASIA", Africa: "_AFRICA", "North America": "_NORTH_AMERICA",
  "South America": "_SOUTH_AMERICA", Oceania: "_OCEANIA",
};

/** Closest year in the series; ties go to the later year. */
export function closest<T>(series: [number, T][], year: number): [number, T] {
  let best = series[0];
  for (const p of series) {
    const d = Math.abs(p[0] - year), bd = Math.abs(best[0] - year);
    if (d < bd || (d === bd && p[0] > best[0])) best = p;
  }
  return best;
}

export function yearOf(date: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) throw new Error(`Invalid date "${date}", expected YYYY-MM-DD`);
  return Number(m[1]);
}

/** Collects warnings, factor keys and years while one calculation runs. */
export class Run {
  warnings: Warning[] = [];
  assumptions: string[] = [];
  keys = new Set<string>();
  defraYears = new Set<number>();
  gridYears: number[] = [];
  gridLevels = new Set<string>();
  gridFactors: GridFactor[] = [];
  private warned = new Set<string>();
  readonly data: DataBundle;
  readonly year: number;
  constructor(data: DataBundle, year: number) {
    this.data = data;
    this.year = year;
  }

  warn(code: string, message: string): void {
    if (this.warned.has(code + message)) return;
    this.warned.add(code + message);
    this.warnings.push({ code, message });
  }
  assume(text: string): void {
    if (!this.assumptions.includes(text)) this.assumptions.push(text);
  }

  has(key: string): boolean {
    const s = this.data.factors[key];
    return !!s && s.length > 0;
  }

  /** DEFRA factor by stable key, nearest year. Throws when the key does not exist at all. */
  factor(key: string): number {
    const s = this.data.factors[key];
    if (!s || s.length === 0) throw new Error(`Missing factor ${key}`);
    const [y, v] = closest(s, this.year);
    this.keys.add(key);
    this.defraYears.add(y);
    if (Math.abs(y - this.year) > FAR_YEARS) this.warn("FACTOR_YEAR_FAR", `DEFRA factors from ${y} used for ${this.year} (more than ${FAR_YEARS} years apart).`);
    return v;
  }

  /** UK grid-loss uplift (T&D / generation, from DEFRA of the same year). */
  tdUplift(): number {
    return this.factor("elec.uk.td") / this.factor("elec.uk.generation");
  }

  /**
   * Weighted grid carbon intensity in gCO2e/kWh (OWID/Ember, lifecycle, generation based; no T&D losses).
   * Country -> continent -> world fallback per country. `warnOnDefault`: warn when no shares were given.
   */
  grid(shares: CountryShares | undefined, warnOnDefault: boolean): number {
    const entries = Object.entries(shares ?? {}).filter(([, w]) => Number.isFinite(w) && w > 0);
    const sum = entries.reduce((a, [, w]) => a + w, 0);
    if (entries.length === 0 || sum <= 0) {
      if (warnOnDefault) this.warn("GRID_DEFAULT_WORLD", "No country shares given; world average grid intensity used.");
      else this.assume("Grid: world average (no country shares given)");
      return this.gridOne("_WORLD", "world", "_WORLD", 1);
    }
    let total = 0;
    for (const [iso, w] of entries) {
      const code = iso.toUpperCase();
      let g: number;
      if (this.data.grid[code]) g = this.gridOne(code, code === "_WORLD" ? "world" : code.startsWith("_") ? "continent" : "country", code, w / sum);
      else {
        const cont = this.data.regions[code];
        const ck = cont ? CONTINENT_KEY[cont] : undefined;
        if (ck && this.data.grid[ck]) {
          this.warn("GRID_FALLBACK_CONTINENT", `No grid data for ${code}; ${cont} average used.`);
          g = this.gridOne(ck, "continent", code, w / sum);
        } else {
          this.warn("GRID_FALLBACK_WORLD", `No grid data for ${code}; world average used.`);
          g = this.gridOne("_WORLD", "world", code, w / sum);
        }
      }
      total += (w / sum) * g;
    }
    return total;
  }

  private gridOne(code: string, level: "country" | "continent" | "world", country: string, share: number): number {
    const s = this.data.grid[code];
    if (!s) throw new Error(`Missing grid series ${code}`);
    const [y, v] = closest(s, this.year);
    this.gridYears.push(y);
    this.gridLevels.add(level);
    this.gridFactors.push({ country, sourceRegion: code, level, yearUsed: y, intensityGCo2ePerKwh: v, share });
    if (Math.abs(y - this.year) > FAR_YEARS) this.warn("GRID_YEAR_FAR", `Grid data for ${code} from ${y} used for ${this.year} (more than ${FAR_YEARS} years apart).`);
    return v;
  }

  finish(r: { directKg: number; upstreamKg: number; method: ClimateResult["method"]; includesRadiativeForcing: boolean; distanceKmUsed: number; aircraftTable?: boolean; railEnergy?: boolean }): ClimateResult {
    const factorSets: ClimateResult["factorSets"] = {};
    if (this.defraYears.size) factorSets.defra = { yearUsed: Math.max(...this.defraYears) };
    if (this.gridYears.length) {
      const level = this.gridLevels.size > 1 ? "mixed" : ([...this.gridLevels][0] as "country" | "continent" | "world");
      factorSets.grid = {
        yearUsed: Math.max(...this.gridYears), level, source: "OWID/Ember", countries: this.gridFactors,
        intensityGCo2ePerKwh: this.gridFactors.reduce((sum, factor) => sum + factor.share * factor.intensityGCo2ePerKwh, 0),
      };
    }
    if (r.aircraftTable) factorSets.aircraft = { tableVersion: String(this.data.flight.year) };
    if (r.railEnergy) factorSets.railEnergy = { yearUsed: this.data.railEnergy.year, source: this.data.railEnergy.source };
    return {
      co2eKg: r.directKg + r.upstreamKg,
      directKg: r.directKg,
      upstreamKg: r.upstreamKg,
      method: r.method,
      scope: "wtw",
      includesRadiativeForcing: r.includesRadiativeForcing,
      distanceKmUsed: r.distanceKmUsed,
      factorSets,
      factorKeys: [...this.keys].sort(),
      assumptions: this.assumptions,
      warnings: this.warnings,
      status: this.warnings.length ? "fallback" : "ok",
    };
  }
}

export function requireDistance(km: number): void {
  if (!Number.isFinite(km) || km < 0) throw new Error(`Invalid distanceKm: ${km}`);
}
