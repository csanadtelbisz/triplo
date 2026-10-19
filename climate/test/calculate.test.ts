import { test } from "node:test";
import assert from "node:assert/strict";
import { calculate, calculateMany, makeCalculator, defaultData } from "../src/index";
import type { DataBundle } from "../src/index";

const D = "2026-05-01";
const near = (a: number, b: number, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} !~ ${b}`);

// Expected values below were computed by hand/independently in Python from the DEFRA 2026 and OWID values.

test("none mode is zero", () => {
  const r = calculate({ mode: "none" });
  assert.equal(r.co2eKg, 0);
  assert.equal(r.method, "none");
  assert.equal(r.status, "ok");
});

test("bus: long routes default to coach, 100 km = 100 x (0.03948 + 0.00656)", () => {
  const r = calculate({ mode: "bus", date: D, distanceKm: 100 });
  near(r.co2eKg, 4.604);
  near(r.directKg, 3.948);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.factorSets.defra?.yearUsed, 2026);
});

test("bus: automatic selection uses local strictly below 10 km and coach from 10 km", () => {
  for (const [distanceKm, type, factor] of [[9.999, "local", .15726], [10, "coach", .04604], [10.001, "coach", .04604]] as const) {
    const result = calculate({ mode: "bus", date: D, distanceKm });
    near(result.co2eKg, distanceKm * factor, 1e-12);
    assert.deepEqual(result.factorKeys, [`bus.${type}.ttw`, `bus.${type}.wtt`]);
    assert.deepEqual(result.warnings, []);
  }
});

test("bus: explicit local and coach choices override distance-based selection", () => {
  near(calculate({ mode: "bus", date: D, distanceKm: 5, busType: "coach" }).co2eKg, .2302, 1e-12);
  near(calculate({ mode: "bus", date: D, distanceKm: 20, busType: "local" }).co2eKg, 3.1452, 1e-12);
});

test("bus: unknown type falls back to coach with a warning", () => {
  const r = calculate({ mode: "bus", date: D, distanceKm: 100, busType: "tram" as never });
  near(r.co2eKg, 4.604);
  assert.equal(r.warnings[0].code, "BUS_TYPE_UNKNOWN");
  assert.equal(r.status, "fallback");
});

test("ferry: foot passenger and with vehicle (no occupancy scaling)", () => {
  near(calculate({ mode: "ferry", date: D, distanceKm: 50 }).co2eKg, 1.1475);
  near(calculate({ mode: "ferry", date: D, distanceKm: 50, withVehicle: true }).co2eKg, 7.9325);
});

test("car: average petrol-ish car, occupancy 1.5 default", () => {
  const r = calculate({ mode: "car", date: D, distanceKm: 200, fuelType: "petrol" });
  near(r.co2eKg, 27.668);
  near(r.directKg, (200 * 0.16152) / 1.5);
});

test("car: occupancy divides the result and is clamped to 1..9", () => {
  const alone = calculate({ mode: "car", date: D, distanceKm: 100, fuelType: "petrol", occupancy: 1 }).co2eKg;
  const four = calculate({ mode: "car", date: D, distanceKm: 100, fuelType: "petrol", occupancy: 4 }).co2eKg;
  near(alone / four, 4);
  const c = calculate({ mode: "car", date: D, distanceKm: 100, fuelType: "petrol", occupancy: 0 });
  assert.equal(c.warnings[0].code, "OCCUPANCY_CLAMPED");
  near(c.co2eKg, alone);
});

test("car: exact fuel consumption, 6 L/100 km petrol, 100 km, occupancy 2", () => {
  const r = calculate({ mode: "car", date: D, distanceKm: 100, fuelType: "petrol", exactFuelLPer100Km: 6, occupancy: 2 });
  near(r.co2eKg, 7.96782);
  assert.equal(r.method, "fuel_consumption");
});

test("car: BEV in Hungary uses OWID intensity 2025 (163.02 g/kWh) plus 9.9% grid losses", () => {
  const r = calculate({ mode: "car", date: D, distanceKm: 100, fuelType: "bev", gridShares: { HUN: 1 } });
  near(r.co2eKg, 2.43197, 2e-3);
  assert.equal(r.directKg, 0);
  assert.equal(r.factorSets.grid?.level, "country");
  assert.deepEqual(r.warnings, []);
});

test("car: PHEV is split into liquid part and electric part", () => {
  const r = calculate({ mode: "car", date: D, distanceKm: 100, fuelType: "phev", occupancy: 1, gridShares: { HUN: 1 } });
  near(r.co2eKg, 13.0681, 2e-3);
  near(r.directKg, 8.959);
});

test("car: BEV without shares warns and uses world average", () => {
  const r = calculate({ mode: "car", date: D, distanceKm: 100, fuelType: "bev" });
  assert.equal(r.warnings[0].code, "GRID_DEFAULT_WORLD");
  assert.equal(r.factorSets.grid?.level, "world");
});

test("car: small CNG has no DEFRA value -> average size, with a warning", () => {
  const r = calculate({ mode: "car", date: D, distanceKm: 10, fuelType: "cng", engineSize: "small" });
  assert.equal(r.warnings[0].code, "CAR_FACTOR_FALLBACK");
  assert.ok(r.co2eKg > 0);
});

test("grid shares are weights: normalised, 50/50 equals the mean", () => {
  const a = calculate({ mode: "car", date: D, distanceKm: 100, fuelType: "bev", occupancy: 1, gridShares: { HUN: 1, DEU: 1 } });
  const h = calculate({ mode: "car", date: D, distanceKm: 100, fuelType: "bev", occupancy: 1, gridShares: { HUN: 1 } });
  const d = calculate({ mode: "car", date: D, distanceKm: 100, fuelType: "bev", occupancy: 1, gridShares: { DEU: 1 } });
  near(a.co2eKg, (h.co2eKg + d.co2eKg) / 2, 1e-6);
});

test("grid: unknown country falls back to continent, then world", () => {
  const eu = calculate({ mode: "car", date: D, distanceKm: 100, fuelType: "bev", gridShares: { OWID_KOS: 1 } });
  assert.equal(eu.factorSets.grid?.level, "country"); // Kosovo has its own series
  const x = calculate({ mode: "car", date: D, distanceKm: 100, fuelType: "bev", gridShares: { LIE: 1 } });
  assert.equal(x.factorSets.grid?.level, "continent");
  assert.equal(x.warnings[0].code, "GRID_FALLBACK_CONTINENT");
  const y = calculate({ mode: "car", date: D, distanceKm: 100, fuelType: "bev", gridShares: { ZZZ: 1 } });
  assert.equal(y.factorSets.grid?.level, "world");
});

test("grid year: closest year, ties to the later year, >10 years warns", () => {
  const data: DataBundle = { ...defaultData, grid: { ...defaultData.grid, TST: [[2000, 100], [2010, 200]] } };
  const c = makeCalculator(data);
  const at = (year: number) => c.calculate({ mode: "car", date: `${year}-06-01`, distanceKm: 1000, fuelType: "bev", occupancy: 1, gridShares: { TST: 1 } });
  assert.equal(at(2005).factorSets.grid?.yearUsed, 2010); // tie -> later
  assert.equal(at(2004).factorSets.grid?.yearUsed, 2000);
  const gridWarnings = (r: { warnings: { code: string }[] }) => r.warnings.filter((w) => w.code.startsWith("GRID"));
  assert.deepEqual(gridWarnings(at(2004)), []);
  const far = at(2021);
  assert.equal(far.factorSets.grid?.yearUsed, 2010);
  assert.equal(gridWarnings(far)[0].code, "GRID_YEAR_FAR");
  assert.equal(gridWarnings(at(2020)).length, 0); // exactly 10 years: no warning
});

test("rail: inter_city default assumes electric traction", () => {
  const r = calculate({ mode: "rail", date: D, distanceKm: 100, countryShares: { FRA: 1 } });
  const explicit = calculate({ mode: "rail", date: D, distanceKm: 100, traction: "electric", countryShares: { FRA: 1 } });
  near(r.co2eKg, explicit.co2eKg);
  assert.deepEqual(r.warnings, []);
});

test("electric inter-city and high-speed use separate energy benchmarks, not mixed-traction CO2 factors", () => {
  const factors = { ...defaultData.factors,
    "elec.uk.generation": [[2026, .2]] as [number, number][],
    "elec.uk.td": [[2026, .02]] as [number, number][],
  };
  // Neither the national diesel/electric mix nor the Eurostar CO2 row may feed these electric models.
  delete factors["rail.national.ttw"];
  delete factors["rail.international.ttw"];
  const c = makeCalculator({ ...defaultData, factors, grid: { TST: [[2026, 400]] } });
  const input = { mode: "rail", date: D, distanceKm: 100, countryShares: { TST: 1 } } as const;
  const ic = c.calculate({ ...input, railType: "inter_city" });
  const hs = c.calculate({ ...input, railType: "high_speed" });
  // Independent golden values: 100 km × (20/188 or 20/285) kWh/pkm × 0.4 kg/kWh × 1.1 losses.
  near(ic.co2eKg, 4.680851063829787, 1e-12);
  near(hs.co2eKg, 3.087719298245614, 1e-12);
  near(ic.co2eKg / hs.co2eKg, 285 / 188, 1e-12);
  for (const r of [ic, hs]) {
    assert.equal(r.directKg, 0);
    assert.equal(r.upstreamKg, r.co2eKg);
    assert.equal(r.method, "grid_kwh");
    assert.deepEqual(r.factorSets.railEnergy, { yearUsed: 2017, source: "French transport reporting" });
    assert.equal(r.factorSets.grid?.yearUsed, 2026);
    assert.equal(r.factorSets.defra?.yearUsed, 2026);
    assert.deepEqual(r.warnings, []);
    assert.ok(!r.factorKeys.some(k => k.startsWith("rail.national") || k.startsWith("rail.international")));
  }
  assert.ok(ic.factorKeys.includes("rail.energy.inter_city.kwh_per_pkm"));
  assert.ok(hs.factorKeys.includes("rail.energy.high_speed.kwh_per_pkm"));
});

test("electric rail retains route-country weighting, distance scaling and trip-year grid selection", () => {
  const c = makeCalculator({ ...defaultData,
    grid: { AAA: [[2020, 100], [2026, 200]], BBB: [[2020, 300], [2026, 600]] },
    factors: { ...defaultData.factors, "elec.uk.generation": [[2020, .2], [2026, .2]], "elec.uk.td": [[2020, .02], [2026, .02]] },
  });
  for (const railType of ["inter_city", "high_speed"] as const) {
    const input = { mode: "rail", date: D, distanceKm: 100, railType } as const;
    const a = c.calculate({ ...input, countryShares: { AAA: 1 } });
    const b = c.calculate({ ...input, countryShares: { BBB: 1 } });
    const weighted = c.calculate({ ...input, countryShares: { AAA: 3, BBB: 1 } });
    near(weighted.co2eKg, a.co2eKg * .75 + b.co2eKg * .25, 1e-12);
    near(c.calculate({ ...input, distanceKm: 200, countryShares: { AAA: 1 } }).co2eKg, 2 * a.co2eKg, 1e-12);
    const old = c.calculate({ ...input, date: "2020-05-01", countryShares: { AAA: 1 } });
    near(old.co2eKg, a.co2eKg / 2, 1e-12);
    assert.equal(old.factorSets.grid?.yearUsed, 2020);
    assert.equal(old.factorSets.railEnergy?.yearUsed, 2017);
  }
});

test("rail: legacy unknown traction is interpreted as diesel, with the same approximation warning", () => {
  const input = { mode: "rail", date: D, distanceKm: 100, countryShares: { FRA: 1 } } as const;
  const r = calculate({ ...input, traction: "unknown" as never });
  near(r.co2eKg, 3.989);
  assert.deepEqual(r, calculate({ ...input, traction: "diesel" }));
});

test("rail: diesel keeps the approximation warning", () => {
  const r = calculate({ mode: "rail", date: D, distanceKm: 100, traction: "diesel" });
  near(r.co2eKg, 3.989);
  assert.equal(r.warnings[0].code, "RAIL_DIESEL_APPROXIMATED");
});

test("rail: subway in Germany = implied kWh (DEFRA / (gen+T&D)) x OWID Germany 2025 x (1+losses)", () => {
  const r = calculate({ mode: "rail", date: D, distanceKm: 10, railType: "subway", countryShares: { DEU: 1 } });
  near(r.co2eKg, 0.389911, 2e-3);
  assert.equal(r.directKg, 0);
  assert.deepEqual(r.warnings, []);
});

test("rail: high speed and light rail diesel combination is invalid -> electric with warning", () => {
  const r = calculate({ mode: "rail", date: D, distanceKm: 10, railType: "light_rail", traction: "diesel" });
  assert.equal(r.warnings[0].code, "INVALID_COMBINATION");
});

test("flight tier 2: 1000 km great-circle economy = short-haul rows, uplift already in the factors", () => {
  const r = calculate({ mode: "flight", date: D, distanceKm: 1000, cabinClass: "economy" });
  near(r.co2eKg, 148.25);
  assert.equal(r.method, "defra_per_pkm");
  assert.equal(r.includesRadiativeForcing, true);
  near(r.distanceKmUsed, 1080);
});

test("flight tier 2: exact geometry removes the uplift (1080 exact = 1000 great-circle)", () => {
  const a = calculate({ mode: "flight", date: D, distanceKm: 1080, geometry: "exact", cabinClass: "economy" });
  near(a.co2eKg, 148.25);
  near(a.distanceKmUsed, 1080);
});

test("flight tier 2: long-haul business 5000 km; short-haul maps first->business, premium->economy", () => {
  near(calculate({ mode: "flight", date: D, distanceKm: 5000, cabinClass: "business" }).co2eKg, 2053.85);
  const a = calculate({ mode: "flight", date: D, distanceKm: 1000, cabinClass: "first" }).co2eKg;
  const b = calculate({ mode: "flight", date: D, distanceKm: 1000, cabinClass: "business" }).co2eKg;
  near(a, b, 1e-9);
});

test("flight tier 1: A320neo 1000 km average passenger", () => {
  const r = calculate({ mode: "flight", date: D, distanceKm: 1000, aircraftType: "A20N" });
  assert.equal(r.method, "aircraft_model");
  near(r.co2eKg, 156.78, 2e-3);
  near(r.distanceKmUsed, 1080);
  assert.equal(r.factorSets.aircraft?.tableVersion, String(defaultData.flight.year));
});

test("flight tier 1: economy passenger of the same aircraft", () => {
  const r = calculate({ mode: "flight", date: D, distanceKm: 1000, aircraftType: "A20N", cabinClass: "economy" });
  near(r.co2eKg, 154.2358, 2e-3);
});

test("flight tier 1: class weights follow the aircraft body type, not the distance (B77W on 1000 km)", () => {
  const e = calculate({ mode: "flight", date: D, distanceKm: 1000, aircraftType: "B77W", cabinClass: "economy" });
  const b = calculate({ mode: "flight", date: D, distanceKm: 1000, aircraftType: "B77W", cabinClass: "business" });
  near(b.co2eKg / e.co2eKg, 2.9, 1e-9); // wide-body weight business 2.9 vs economy 1
});

test("flight: unknown aircraft type warns and uses DEFRA averages", () => {
  const r = calculate({ mode: "flight", date: D, distanceKm: 1000, aircraftType: "ZZZZ" });
  assert.equal(r.warnings[0].code, "AIRCRAFT_TYPE_UNKNOWN");
  assert.equal(r.method, "defra_per_pkm");
});

test("flight: operator profile changes load factor and seats", () => {
  const data: DataBundle = {
    ...defaultData,
    operators: { RYR: { name: "Test carrier", loadFactor: 0.95 } },
    layouts: [{ operator: "RYR", aircraft: "B738", seats: { economy: 189, premium_economy: 0, business: 0, first: 0 } }],
  };
  const c = makeCalculator(data);
  const base = calculate({ mode: "flight", date: D, distanceKm: 1500, aircraftType: "B738" });
  const ryr = c.calculate({ mode: "flight", date: D, distanceKm: 1500, aircraftType: "B738", operator: "RYR" });
  assert.ok(ryr.co2eKg < base.co2eKg); // fuller plane, all economy
  // same trip fuel, so the ratio is the load-factor effect times the seat-count effect: 0.86/0.95 (DEFRA B738 short-haul LF) x 189/189
  near(ryr.co2eKg / base.co2eKg, 0.86 / 0.95, 1e-6);
});

test("flight: explicit seats and load factor override", () => {
  const r = calculate({ mode: "flight", date: D, distanceKm: 1500, aircraftType: "A20N", seats: { economy: 180 }, loadFactor: 0.9 });
  const q = calculate({ mode: "flight", date: D, distanceKm: 1500, aircraftType: "A20N" });
  assert.ok(r.co2eKg > 0 && r.co2eKg !== q.co2eKg);
});

test("flight: very short distance for a long-haul aircraft warns", () => {
  const r = calculate({ mode: "flight", date: D, distanceKm: 300, aircraftType: "B77W" });
  assert.ok(r.warnings.some((w) => w.code === "AIRCRAFT_DISTANCE_OUT_OF_RANGE"));
});

test("factor year: closest year, a warning beyond 10 years", () => {
  const r = calculate({ mode: "bus", date: "2010-01-01", distanceKm: 10 });   // DEFRA data starts in 2015 -> 5 years away, no warning
  assert.equal(r.factorSets.defra?.yearUsed, 2015);
  assert.ok(!r.warnings.some((w) => w.code === "FACTOR_YEAR_FAR"));
  const far = calculate({ mode: "bus", date: "2003-06-01", distanceKm: 10 });  // 12 years before 2015
  assert.equal(far.factorSets.defra?.yearUsed, 2015);
  assert.equal(far.warnings.filter((w) => w.code === "FACTOR_YEAR_FAR").length, 1);
});

test("historic DEFRA years are used: UK rail gets cleaner as the grid decarbonises", () => {
  // Compare the UK national mix explicitly; the default now models electric traction.
  const old = calculate({ mode: "rail", railType: "inter_city", traction: "diesel", date: "2016-05-01", distanceKm: 100, countryShares: { GBR: 1 } });
  const now = calculate({ mode: "rail", railType: "inter_city", traction: "diesel", date: "2025-05-01", distanceKm: 100, countryShares: { GBR: 1 } });
  assert.equal(old.factorSets.defra?.yearUsed, 2016);
  assert.ok(old.co2eKg > now.co2eKg);
});

test("invalid input: bad date throws; batch isolates the failure", () => {
  assert.throws(() => calculate({ mode: "bus", date: "yesterday", distanceKm: 10 }));
  assert.throws(() => calculate({ mode: "bus", date: D, distanceKm: -5 }));
  const out = calculateMany([{ mode: "bus", date: D, distanceKm: 10 }, { mode: "bus", date: "x", distanceKm: 10 }, { mode: "none" }]);
  assert.equal(out[0].ok, true);
  assert.equal(out[1].ok, false);
  assert.equal(out[2].ok, true);
});

test("results are always well-to-wheel and add up", () => {
  for (const m of [
    { mode: "car", date: D, distanceKm: 50 }, { mode: "bus", date: D, distanceKm: 50 }, { mode: "rail", date: D, distanceKm: 50 },
    { mode: "ferry", date: D, distanceKm: 50 }, { mode: "flight", date: D, distanceKm: 500 },
  ] as const) {
    const r = calculate(m);
    assert.equal(r.scope, "wtw");
    near(r.co2eKg, r.directKg + r.upstreamKg, 1e-12);
    assert.ok(r.upstreamKg > 0);
  }
});

test("real operator profiles: Ryanair B738 is cleaner per passenger than the DEFRA-average B738 (LF 0.94 vs 0.86)", () => {
  const base = calculate({ mode: "flight", date: D, distanceKm: 1500, aircraftType: "B738" });
  const ryr = calculate({ mode: "flight", date: D, distanceKm: 1500, aircraftType: "B738", operator: "RYR" });
  near(ryr.co2eKg / base.co2eKg, 0.86 / 0.94, 1e-6);
  assert.ok(ryr.assumptions.some((a) => a.includes("operator RYR")));
});

test("real operator profiles: Turkish B77W business uses wide-body weights with the real layout", () => {
  const e = calculate({ mode: "flight", date: D, distanceKm: 7000, aircraftType: "B77W", operator: "THY", cabinClass: "economy" });
  const b = calculate({ mode: "flight", date: D, distanceKm: 7000, aircraftType: "B77W", operator: "THY", cabinClass: "business" });
  near(b.co2eKg / e.co2eKg, 2.9, 1e-9);
  assert.deepEqual(e.warnings, []);
});

test("operator codes are case-insensitive and unknown operators fall back silently to DEFRA load factor", () => {
  const a = calculate({ mode: "flight", date: D, distanceKm: 1500, aircraftType: "b738", operator: "ryr" });
  const b = calculate({ mode: "flight", date: D, distanceKm: 1500, aircraftType: "B738", operator: "RYR" });
  near(a.co2eKg, b.co2eKg, 1e-12);
  const c = calculate({ mode: "flight", date: D, distanceKm: 1500, aircraftType: "B738", operator: "XXX" });
  const d = calculate({ mode: "flight", date: D, distanceKm: 1500, aircraftType: "B738" });
  near(c.co2eKg, d.co2eKg, 1e-12);
});
