# Triplo climate-impact calculation: specification v3.1 (draft for review)

Status: **implemented in `climate/src` and integrated through `frontend/src/climate`.** This document records the calculation design; the public types in `climate/src/types.ts` are the authoritative input interface. Everything is computed locally from versioned open data tables.
Items marked **[OPEN]** still need a decision (collected in section 12). Decisions you already made are written as settled.

---

## 1. Principles

1. Pure, synchronous TypeScript functions. No network, no API keys, no new runtime dependencies. All data is imported from versioned JSON generated from CSV.
2. **Scope is always well-to-wheel (WTW)**: `directKg` (emitted at the vehicle) + `upstreamKg` (fuel supply chain, electricity generation and grid losses). Reported in kg CO2e (AR5 GWPs as in DEFRA: CH4 28, N2O 265).
3. **Per traveller**, never per vehicle (cars are divided by occupancy; bus, rail, ferry and flights are per passenger-km).
4. **Radiative forcing is always included** for flights; there is no option to disable it.
5. Soft problems never throw: fall back to a more generic factor and add an entry to `warnings[]`. Throw only for invalid numbers (negative or NaN distance, malformed date).
6. Every result carries the factor-set versions it used, so results are reproducible.
7. Country shares are weights in the 0..1 range and are normalised internally when the sum is not 1.
8. **The module does not know Triplo's transport modes.** Triplo chooses the right `TravelInput` (and may apply user overrides, including for the `other` mode). See section 9.

---

## 2. Data layer

### 2.1 DEFRA / DESNZ conversion factors

- Source: the **flat-format** workbook of each year, sheet `Factors by Category` (columns `ID, Scope, Level 1..4, Column Text, UOM, GHG/Unit, GHG Conversion Factor <year>`). I checked the 2026 file you attached: it covers all categories we need (flights with/without RF and WTT, ferry, bus, rail, cars by size and segment, plug-in hybrid and electric car energy use, jet fuel, UK electricity and its T&D).
- The flat file of a year contains **only that year**. Flat files for **2015-2026 are loaded** (2015-2019, 2021 and 2022 are `.xls`; the build script uses `xlrd`, a script dependency only, not an app dependency). Category names and column layouts differ between years; `scripts/defra_reader.py` and the path normalisation in `build-defra.py` handle that. Keys that did not exist in a year are simply absent for it (no BEV/PHEV before 2017, no SECR kWh rows before 2022) and resolve to the closest year that has them. **2002-2010 have only condensed/full sets** (no flat file) and 2011-2014 are unchecked.
- DEFRA row IDs and category names change between years, so we do not use DEFRA IDs as keys. We define our own stable keys (e.g. `car.size.medium.petrol.ttw_per_km`) in `data/factor-keys.yaml`, listing the category path that matches each key per year. A key missing in a year is allowed; lookup then uses the nearest year (see 2.4).
- Stored as long-format CSV, one row per key and year (diff-friendly):

```
data/defra-factors.csv
key,year,unit,kg_co2e,defra_path,defra_id
flight.intl.economy.rf,2026,passenger.km,0.1092,Business travel- air / Flights / International, to/from non-UK / Economy class / With RF,21_316_3180_11_1
```

- Script `scripts/build-defra.py <file> <year>` appends or replaces that year's rows (idempotent). Runtime JSON is generated from the CSV and never edited by hand.

#### Where to find the older files (all on gov.uk)

Collection page: <https://www.gov.uk/government/collections/government-conversion-factors-for-company-reporting>. One publication page per year, all following `https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-<YEAR>` for 2002..2026. On each page, take the file titled **"Flat file (for automatic processing only)"**. Verified examples:

| Year | Flat file | Format |
|---|---|---|
| 2026 | `.../ghg-conversion-factors-2026-flat-format-revised.xlsx` (what you attached) | xlsx |
| 2022 | https://assets.publishing.service.gov.uk/media/6329dcf2e90e073725585d5c/ghg-conversion-factors-2022-flat-format.xls | xls |
| 2019 | https://assets.publishing.service.gov.uk/media/5f1ff1cc8fa8f50485f30666/conversion-factors-2019-flat-file-v01-02.xls | xls |
| 2018 | https://assets.publishing.service.gov.uk/media/5b1e977ce5274a1905e8e986/Conversion_factors_2018_-_Flat_file__for_automatic_processing_only__v01-01.xls | xls |
| 2015 | https://assets.publishing.service.gov.uk/media/5a7f8868e5274a2e87db66b1/2015_flat_file_set.xls | xls |
| 2002-2010 | no flat file; "full set" xls only, e.g. 2010: https://assets.publishing.service.gov.uk/media/5a80271340f0b62305b897d5/2010_full_factor_set.xls | xls |

The sandbox cannot download from those hosts (proxy policy), so you would attach the files you want. Realistic plan: flat files 2015..2026 first; 2002..2014 later from the full sets with a separate reader (the layout differs and some categories, such as WTT and EV electricity, do not exist yet in early years).

### 2.2 Grid carbon intensity (OWID / Ember)

Checked against your full `owid_energy.csv` (19 494 rows, up to 2025):

- Column: `electricity_carbon_intensity_gco2eq_per_kwh`. It is filled for **213** countries/territories, mostly from **1990** (median first year 2000; the USA starts in 2000). The latest year differs per country (2009..2025). Seven territories have no value at all (Antarctica, Curacao, Micronesia, Netherlands Antilles, Niue, Northern Mariana Islands, Tuvalu).
- **What the number contains (your question):** Ember computes it as generation x lifecycle emission factors per fuel (including upstream methane, supply chain and manufacturing), on a generation basis. So it **already includes the upstream fuel and plant lifecycle**, but, as far as I can tell from Ember's methodology page, **not transmission and distribution losses** (that inference is mine; the page only says T&D is excluded from demand figures). Consequences:
  - We do **not** add DEFRA-style WTT on top of the grid intensity (would double count).
  - We add one constant for **T&D losses**: `TD_UPLIFT = DEFRA T&D factor / DEFRA UK generation factor` of the same year (2026: 0.013 / 0.131 = **9.9%**). Settled as a constant.
- Filtered storage `data/grid-intensity.csv`: `iso3,country,year,gco2e_per_kwh` (rows with an empty value dropped). Script `scripts/build-grid.py <owid_energy.csv>` streams the file, so it never needs to be read manually.
- **Fallback chain**: country (ISO3) -> continent aggregate -> `World`, with a warning naming the level used. The file has 25 aggregate rows without ISO code (World, Europe, Asia, Africa, North America, South America, Oceania, EU 27, income groups, Ember groupings); we use only the six continents and World. The continent of each country is not in the OWID file, so a small hand-kept `data/country-region.csv` (ISO3 -> continent) is needed. Kosovo has no ISO code in the file; mapped by name to Europe.

### 2.3 Fuel burn per aircraft

See section 5.5 (DEFRA's own per-aircraft table; the EEA/EUROCONTROL workbook is **not** usable, see there).

### 2.4 Year selection (settled)

Both for the DEFRA factor year and for the grid year: **use the closest available year, before or after the trip; on a tie use the later year.** A `warning` (`FACTOR_YEAR_FAR`, `GRID_YEAR_FAR`) is added when the distance to the used year is **more than 10 years**. Lookup is by trip year (`date`), see section 3.

---

## 3. Common types

```ts
export type Iso3 = string;                        // "HUN", "DEU", ...
export type CountryShares = Record<Iso3, number>; // weights 0..1, normalised internally

export interface CommonInput {
  date: string;              // ISO date "YYYY-MM-DD" of the segment (required); the year selects factor sets
  distanceKm: number;        // required, > 0
}

export interface Warning { code: string; message: string; }

export interface ClimateResult {
  co2eKg: number;               // total, WTW, per traveller
  directKg: number;             // emitted at the vehicle (0 for grid-electric vehicles)
  upstreamKg: number;           // fuel supply chain / grid generation lifecycle / T&D losses
  method: string;               // "defra_per_pkm" | "defra_per_vkm" | "fuel_consumption" | "grid_kwh" | "fuel_burn_model" | "none"
  scope: "wtw";
  includesRadiativeForcing: boolean;
  distanceKmUsed: number;       // after uplift where applicable
  factorSets: {
    defra?: { yearUsed: number };
    grid?: { yearUsed: number; level: "country" | "continent" | "world" | "mixed"; source: "OWID/Ember" };
    aircraft?: { tableVersion: string };
    railEnergy?: { yearUsed: number; source: string };
  };
  factorKeys: string[];         // stable keys used (auditing)
  assumptions: string[];        // short human-readable lines
  warnings: Warning[];          // fallbacks/caveats; empty if all exact
  status: "ok" | "fallback";    // "fallback" iff warnings is non-empty
}
```

---

## 4. Zero-emission input

```ts
export interface NoEmissionInput { mode: "none"; }   // result: 0 kg, method "none", no warnings
```

Triplo uses it for walk, hike, run and bike (it may also use it for anything else the user wants to be 0).

---

## 5. Flight

### 5.1 Input

```ts
export type CabinClass = "economy" | "premium_economy" | "business" | "first" | "average";

export interface FlightInput extends CommonInput {
  mode: "flight";
  geometry?: "great_circle" | "exact"; // default "great_circle"
  cabinClass?: CabinClass;             // default "average"
  aircraftType?: string;               // ICAO type designator, e.g. "A21N", "B738"
  operator?: string;                   // ICAO airline code, e.g. "RYR", "BAW"
  seats?: Partial<Record<Exclude<CabinClass, "average">, number>>; // explicit configuration override
  loadFactor?: number;                 // explicit override, 0..1
}
```

### 5.2 Distance

`distanceKm` is required. Two distances are derived:

- `flownKm`: if `geometry === "great_circle"` (default), `distanceKm * (1 + DISTANCE_UPLIFT)` with `DISTANCE_UPLIFT = 0.08`; if `"exact"` (e.g. a GPX track), `distanceKm`.
- `gcEquivalentKm`: if `"great_circle"`, `distanceKm`; if `"exact"`, `distanceKm / 1.08`.

**Which one is used where (correction):** the DEFRA methodology (paragraph 8.38) says the 8% great-circle uplift **is already applied to the published per-passenger-km factors** (the underlying Table 36 values exclude it, the worksheet values include it; check: 69.1 g/pkm x 1.08 = 74.6, and the worksheet short-haul value without RF is 0.0756 kg CO2e). So:
- **Tier 2** (DEFRA per-pkm factors) multiplies by `gcEquivalentKm`: **no additional uplift** (my earlier text said DEFRA excludes it; that was wrong).
- **Tier 1** (fuel model) works on `flownKm`.

DEFRA's 8% is the UK Greenhouse Gas Inventory value (used since 2014; IPCC suggests 9-10%; agreed with DfT as more appropriate for UK flights). For reference, Google's Travel Impact Model uses a route-specific factor with default 1.052. The 8% is one constant in `data/geo.json`.

### 5.3 Two tiers

**Tier 1, aircraft model** (used when `aircraftType` is in `aircraft.csv`; seats from `seats` input, operator layout, or the aircraft's DEFRA typical seats):

```
kgCO2PerVkm    = interpolate(aircraft.co2PerVkmByFlightLength, flownKm)     // 5.5; DEFRA Table 33
tripCO2        = kgCO2PerVkm * flownKm                                        // kg CO2 of the whole flight
tripFuelKg     = tripCO2 / JETFUEL_CO2_PER_KG                                  // only to apply CH4/N2O/WTT per kg fuel
seats_k        = seats ?? operatorLayout(operator, aircraftType) ?? aircraft.typicalSeats
w_c            = classWeight(c, aircraft.bodyType)                            // 5.4
loadFactor     = loadFactor ?? operator.loadFactor ?? aircraft.defraLoadFactor // DEFRA Table 33 (UK airlines, 2023)
cabinShare_c   = w_c / sum_k(seats_k * w_k)
direct         = (tripCO2 * RF_MULTIPLIER + tripFuelKg * JETFUEL_CH4_N2O_PER_KG) * cabinShare_c / loadFactor   // RF on the CO2 part only
upstream       = tripFuelKg * JETFUEL_WTT_KG_CO2E_PER_KG * cabinShare_c / loadFactor                           // no RF on upstream
```

- `cabinClass: "average"`: per-passenger value = trip emissions / (sum_k seats_k * loadFactor).
- **`RF_MULTIPLIER = 1.7`, applied to the CO2 component only** (DEFRA methodology 8.42-8.43, central estimate from Lee et al. 2021 / GWP100; "subject to significant uncertainty"). Confirmed in the PDF and matches the with/without-RF ratio of the 2026 flight rows (about 1.69). Settled.
- Jet-fuel constants (CO2 3.150 kg per kg, CH4 and N2O parts, and the WTT row) come from the DEFRA Fuels sheets of the same year.
- No fixed-LTO-plus-distance curve is available (5.5), so very short flights are the weak point of Tier 1 (a note goes into `assumptions` when `flownKm` is far outside the aircraft's reference range).

**Tier 2, DEFRA average factors** (aircraft unknown, or no seat layout):

- DEFRA rows per passenger-km, class-specific, with and without RF. `directKg` = "With RF" row x `gcEquivalentKm`; `upstreamKg` = matching WTT row x `gcEquivalentKm` (no RF). The 8% uplift is already inside the factors.
- **Which rows:** the "International, to/from non-UK" set has no haul-band split. Settled (OPEN-5b): use the **short-haul rows up to 3 700 km and the long-haul rows above**. Note on the threshold: the 2026 methodology (8.8-8.9) says the older crude rule "<3,700 km = short-haul" has been replaced by a geographic definition (UK-Europe and UK-North Africa short-haul); since Triplo has no country information, the old distance rule is the practical proxy.
- Short-haul has no premium economy or first class: `premium_economy` -> `economy`, `first` -> `business`, recorded in `assumptions`, no warning. `average` uses the "Average passenger" row.
- `AIRCRAFT_TYPE_UNKNOWN` warning only if an `aircraftType` was given but not found.

### 5.4 Operator profile and class weights (settled, with your clarification)

| Item | Where | Notes |
|---|---|---|
| `loadFactor` | `data/operators.csv`, one value per airline | the "Ryanair fills more seats than BA" effect |
| `seats` per class | `data/operator-layouts.csv`, optional rows `operator+aircraft -> seats` | the "189 seats in a 737-800" effect; without a row we use the aircraft's typical seats |
| class weight `w_c` | global, **by body type of the aircraft** | see below |

```ts
export const CLASS_WEIGHT = {   // relative space/emissions vs economy
  narrow: { economy: 1, premium_economy: 1,   business: 1.5, first: 1.5 },
  wide:   { economy: 1, premium_economy: 1.6, business: 2.9, first: 4.0 },   // DEFRA Table 37 (2026), long-haul
};
```

- These are **DEFRA's own** weights (methodology Table 37): short-haul first/business 1.5; long-haul economy+ 1.6, business 2.9, first 4.0. The IATA RP 1726 / Google TIM / myclimate values are 1 / 1.5 / 4 / 5 for wide-body (and 1.5 for business and first on narrow-body, the same as DEFRA). Using DEFRA's keeps one source and one licence and keeps Tier 1 consistent with Tier 2. **[OPEN-13]**
- **Rule as you described it:** when the aircraft type is known (so its body type is known, e.g. a B777 is wide-body even on a short route), use that body type's weights regardless of distance. Only when the aircraft type is unknown or no seat configuration exists do we fall back to the distance-based class distinction of Tier 2.

```
data/operators.csv         operator,name,load_factor,source,year
data/operator-layouts.csv  operator,aircraft,economy,premium_economy,business,first,source,year
```

Both files may be empty; the calculator then uses the aircraft's DEFRA load factor and typical seats.

### 5.5 Aircraft table: source decision

**The EEA/EUROCONTROL workbook cannot be used.** I inspected the file you attached. Its "EUROCONTROL calculator" sheet carries a legal notice: the data are "strictly for the use of the European Union and its Member States in developing and updating standardised emissions inventories", "should not ... be used for comparative analysis of fuel efficiency or emissions across different aircraft models", the file is password-protected, and "it is strictly forbidden to bypass this password security or to utilize the underlying data without the prior written consent of EUROCONTROL" (c) EUROCONTROL 2023. That conflicts with putting the numbers in an app repository, and the EEA's general CC BY policy does not override such a specific notice. **I did not extract any data from it.** (Google's Travel Impact Model builds on this data; whatever permission arrangement they have is theirs.) If you want it anyway, the proper route is asking EUROCONTROL for written consent.

**Recommended source: DEFRA's own per-aircraft table** (2026 methodology report, "Table 33: Assumptions used in the calculation of revised average CO2 conversion factors for passenger flights", published under the Open Government Licence). For each aircraft type and band (domestic, short-haul, long-haul) it gives: **average seats, average load factor, kg CO2 per vehicle-km, average flight length (km)** for UK airlines' 2023 fleets. About 40 type/band rows, e.g. A320neo (short-haul: 183 seats, 79%, 9.2 kg/vkm at 1 540 km), A321neo, B737-800, A350-900, A380, B777-300ER, B787-9.

How it is used:
- `data/aircraft.csv`: `icao, name, body_type, band, seats, load_factor, kg_co2_per_vkm, avg_flight_km, source_year`, entered once per year by a script that parses the report text (same yearly update routine as the other data).
- Fuel for a flight: kg CO2 per vkm at the type's reference flight length. If a type has rows in several bands (A320neo: domestic 13.3 kg/vkm at 453 km, short-haul 9.2 at 1 540, long-haul 8.6 at 3 650), interpolate between those points by `flownKm`; if only one row exists, use it as constant.
- Body type is read off the model: A330, A350, A380, B767, B777, B787 are wide-body; A220, A319-A321, B737, B757, ERJ, ATR, Dash 8 are narrow-body or smaller.
- Typical seats: the table's average seats (total, not split by class); the class split comes from operator layouts or, absent those, from DEFRA's seat shares (short-haul 96.7% economy / 3.3% business; long-haul 83.0 / 3.0 / 11.9 / 2.0 %, Table 37).

Limits you should know about: (1) only the aircraft that UK airlines fly, around 40 types, and ICAO codes have to be mapped by hand (`A20N` -> A320neo); (2) the kg/vkm values are fleet averages for UK airlines at their typical flight lengths, not a distance curve, so very short and very long flights of one aircraft carry an error (visible in the A320neo row: 13.3 at 453 km versus 9.2 at 1 540 km); (3) the seats and load factors are UK-airline averages (the operator profile corrects that where known). Unknown aircraft stay on Tier 2.

Alternatives checked: Google TIM (its data derives from the restricted EUROCONTROL data and is CC BY-SA); myclimate (publishes polynomial coefficients for 5 aircraft groups, but no licence terms found); ICAO Carbon Emissions Calculator (methodology PDF, I could not open it); OpenAP (code and data licences not confirmed). A true distance curve per aircraft is therefore not available from a clearly reusable source.

---

## 6. Ground transport

### 6.1 Car (also used for taxis)

```ts
export type CarFuel = "petrol" | "diesel" | "hybrid" | "phev" | "bev" | "cng" | "lpg" | "average";
export type CarSize = "small" | "medium" | "large" | "average";

export interface CarInput extends CommonInput {
  mode: "car";
  fuelType?: CarFuel;           // default "average"
  engineSize?: CarSize;         // default "average"
  exactFuelLPer100Km?: number;  // override for petrol/diesel/lpg/cng: litres x DEFRA fuel factor (TTW) + WTT
  occupancy?: number;           // persons in the vehicle incl. the traveller; default 1.5 (UK National Travel Survey); clamped to 1..9 with a warning
  gridShares?: CountryShares;   // only for phev/bev; default: world, with warning
}
```

- **Taxi is not a separate mode.** Triplo passes taxi segments as `CarInput` with the occupancy the user sets (sharing a taxi with four people versus alone changes the result by a factor of 4, as you said). DEFRA has taxi-specific rows (regular taxi 0.2081 kg per vehicle-km, black cab 0.306), but they are not used; a taxi is modelled as a car.
- Fuel-based: DEFRA car factors per vehicle-km by size and fuel (TTW and WTT), divided by occupancy. DEFRA already includes a real-world uplift; the factors are per vehicle, which is why dividing by occupancy is valid.
- `exactFuelLPer100Km`: `litres = km x L/100km / 100`; direct = litres x fuel TTW factor, upstream = litres x fuel WTT factor. `method = "fuel_consumption"`.
- **BEV:** DEFRA car rows give 0 for the vehicle (electricity is accounted separately). Energy use: `SECR kWh UK electricity for EVs` rows (kWh per km, by size). `upstream = kWhPerKm x gridIntensity(shares) x (1 + TD_UPLIFT)`, `direct = 0`.
- **PHEV (split, as you decided):** liquid-fuel part from DEFRA's plug-in hybrid row (km basis; for the average car 0.0896 kg/km in 2026) as TTW + its WTT, and electric part from the PHEV kWh/km row priced at the grid (as for BEV). The split is fixed by DEFRA, with no user-adjustable electric share.
- Hybrid (non-plug-in): the "Hybrid" row. CNG/LPG: rows exist only for some sizes; if a row is empty (DEFRA leaves it blank), fall back to `average` size with a warning.

#### Comparing petrol and diesel

The stored 2026 factors were checked against the official DEFRA flat workbook by row ID: medium petrol = 0.17411 direct + 0.04957 upstream = 0.22368 kg CO₂e/vehicle-km; medium diesel = 0.17209 + 0.04103 = 0.21312. These class averages incorporate different fleet fuel consumption. The average-size rows reverse the ordering: petrol 0.20751 vs diesel 0.21411 kg/vehicle-km. At equal litres consumed, diesel is higher (2026 well-to-wheel: 3.19455 kg CO₂e/litre vs petrol 2.65594). Occupancy divides both consistently. These are climate estimates and do not compare NOₓ or particulate air pollution; no factor or fuel mapping changes were required.

#### Car size examples (for UI hints only; illustrative, not used in calculations)

DEFRA's size classes are defined by engine size (petrol: small up to 1.4 L, medium 1.4-2.0 L, large above 2.0 L; diesel: small up to 1.7 L, medium 1.7-2.0 L, large above 2.0 L; verified in DEFRA's 2019 methodology paper, Table 15; the 2026 paper's text was not reachable, but the definitions are unchanged as far as I can tell). For electric vehicles the size is the vehicle class.

```ts
export const CAR_SIZE_EXAMPLES: Record<Exclude<CarSize, "average">, { fuelBased: string[]; electric: string[] }> = {
  small:  { fuelBased: ["Volkswagen Polo", "Ford Fiesta", "Toyota Yaris"],
            electric:  ["Renault Zoe", "Fiat 500e", "Peugeot e-208"] },
  medium: { fuelBased: ["Volkswagen Golf", "Skoda Octavia", "Toyota Corolla"],
            electric:  ["Volkswagen ID.3", "Tesla Model 3", "Hyundai Kona Electric"] },
  large:  { fuelBased: ["Volvo XC90", "BMW 5 Series (3.0 L)", "Range Rover"],
            electric:  ["Tesla Model X", "Audi e-tron", "Mercedes EQS"] },
};
```

### 6.2 Bus

```ts
export interface BusInput extends CommonInput {
  mode: "bus";
  busType?: "local" | "coach";   // omit: local below 10 km, coach at 10 km or above
}
```

DEFRA per-passenger-km factors, 2026: coach 0.0395 kg (TTW), local bus **"Local bus (not London)"** 0.1255 (the London and "average" rows are not used; the "average local bus" row 0.1015 includes London, which you excluded as too specific). Fuel and Euro standard are not part of DEFRA, so they are dropped. With no explicit `busType`, select local for segment distance < 10 km and coach otherwise (including exactly 10 km). The editor defaults to Automatic, displays the resolved choice when segment distance is available, and permits explicit Local/Coach overrides. Invalid `busType` -> coach with a warning. Changes to distance or these rules invalidate cached estimates.

### 6.3 Rail (including subway)

```ts
export type RailType = "inter_city" | "high_speed" | "light_rail" | "subway";
export type Traction = "electric" | "diesel";

export interface RailInput extends CommonInput {
  mode: "rail";
  railType?: RailType;            // default "inter_city"
  traction?: Traction;            // default "electric"
  countryShares?: CountryShares;  // share of the distance per country (0..1 weights); default: world
}
```

Electric inter-city and high-speed rail use a matched pair of electric-only energy benchmarks from the [French transport-reporting order, Annex II](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000034554253), version in force from 1 June 2017. These Level 1 defaults are stored with their source in `climate/data/rail-energy.json`:

| `railType` | kWh/train-km | Average passengers | Derived kWh/passenger-km |
|---|---|---|---|
| `inter_city` (electric grandes lignes) | 20 | 188 | 20 / 188 ≈ 0.10638 |
| `high_speed` (electric) | 20 | 285 | 20 / 285 ≈ 0.07018 |

Passenger averages account for empty running. These are dated regulatory benchmarks, not measured consumption for every train. Their difference reflects average passenger counts; on the same route and electricity mix, inter-city emissions are about **1.52 times** high-speed emissions. The benchmark year stays 2017 regardless of the trip date and is recorded separately in `factorSets.railEnergy` and the segment's calculation details.

Calculation:
- Electric `inter_city` (the default) and `high_speed`: `upstreamKg = distanceKm × kWhPerPkm × gridIntensity(countryShares) / 1000 × (1 + TD_UPLIFT)`, `directKg = 0`. Route-country grid intensity and DEFRA's grid-loss uplift use the closest available year to the trip. The UK mixed-traction national rail and Eurostar CO2 factors are **not** used to infer energy for these electric models.
- `light_rail` and `subway` retain their existing electric model: implied energy = DEFRA light rail/tram or London Underground TTW factor / (UK generation + UK T&D factor of the same year), then the same route-grid calculation as above.
- `inter_city` with `traction: "diesel"` uses DEFRA's national diesel/electric mix without country scaling, with warning `RAIL_DIESEL_APPROXIMATED`. Unknown was removed from the available traction options because it used the same emission factors. Older profiles with `traction: "unknown"` are interpreted as Diesel, including the approximation warning; editing and saving a profile replaces the legacy value. This does not affect the electric defaults.
- High-speed, light rail and subway are always electric; requesting diesel for them produces `INVALID_COMBINATION` and uses electricity.

The benchmark data participates in the generated data revision. Changes to the energy defaults or calculation rules invalidate persisted segment climate estimates; compact serialization preserves the benchmark metadata.

---

## 7. Ferry

```ts
export interface FerryInput extends CommonInput {
  mode: "ferry";
  withVehicle?: boolean;   // default false = foot passenger
}
```

- `false` -> DEFRA "Foot passenger" (TTW 0.0187 + WTT 0.0042 kg per pkm, 2026). `true` -> "Car passenger" (0.1293 + 0.0293 per pkm).
- **Electric ferries:** DEFRA has only three ferry rows (foot passenger, car passenger, average) and no energy intensity (kWh per pkm) for electric vessels; no public data source that I know of covers it consistently. So **no electric/non-electric distinction**; dropped as you allowed.
- **Occupancy for `withVehicle`: not offered (settled).** DEFRA methodology 7.8 says the passengers-with-cars factors "should be used on a **single-person basis**, not account for the whole vehicle". They were derived by weight allocation (Table 31: passenger + luggage 0.100 t, average car 1.250 t, freight unit 22.173 t; passengers and cars together get just under 12% of ferry emissions, from 11 of 17 PSA operators' RoPax data) and then split between foot passengers and passengers with cars. DEFRA states no car occupancy, so scaling by occupancy is not defined. (Back-calculating from the two factors would suggest about 2.1 people per car, 0.1293/0.0187 = 6.9 = (0.1 + 1.25/n)/0.1, but that is my inference, not a DEFRA figure, and is not used.) Recorded assumption: "DEFRA ferry factor for a passenger travelling with a car, single-person basis." Also note DEFRA 7.10: factors are for RoPax ferries; passenger-only ferries are "likely to be significantly higher".
- No high-speed ferry type in DEFRA.

---

## 8. Output example

```json
{
  "co2eKg": 123.4, "directKg": 101.2, "upstreamKg": 22.2,
  "method": "fuel_burn_model", "scope": "wtw", "includesRadiativeForcing": true,
  "distanceKmUsed": 1620,
  "factorSets": { "defra": { "yearUsed": 2026 }, "aircraft": { "tableVersion": "eea-2023-v1.5" } },
  "factorKeys": ["jetfuel.ttw_per_kg", "jetfuel.wtt_per_kg", "flight.rf_multiplier"],
  "assumptions": ["Load factor 0.93 (operator RYR)", "Great-circle distance +8%"],
  "warnings": [], "status": "ok"
}
```

---

## 9. Dispatcher, batch and Triplo integration

### Implemented profile integration

Triplo stores reusable named profiles in synced preferences. A profile contains the calculator's algorithm and algorithm-specific options; date and distance come from the segment and trip. Built-in and custom transport modes can select Car [built-in], Bus [built-in], Rail [built-in], Flight [built-in], Ferry [built-in], No emission, or a named preference profile. Built-in profiles use the base algorithm's default options. The reorderable preferences table supports editing, deleting and adding named profiles. Segment custom options override trip defaults, which override transport-mode preferences, which override built-in algorithms. Walk, hike, run, bike and unconfigured other modes use the zero-emission algorithm. Teleport segments always contribute zero.

`Segment.climateProfile` stores inline custom options. `Trip.climateProfiles` is keyed by transport mode (or `other:<icon>`) and stores either custom options or a named preference reference with an embedded fallback snapshot. Explicit trip references remain usable when the originating preferences are unavailable. Clearing a trip choice restores the transport-mode default. Editing a named preference updates references while it is available. Segment cards show inherited profile options as disabled inputs; choosing Custom starts with independent options from that inherited profile.

The shared profile editor supports named dialogs, unnamed trip dialogs and unnamed inline segment editing. It exposes algorithm-specific options, including flight seating/load overrides, without copying controls. Empty editable fields identify their automatic default; numeric defaults such as occupancy and aircraft load factor are shown where available, while factor-based estimates name their default source. Rail country shares and electric-car grid shares always use cached route-country distances, converted from alpha-2 to alpha-3 codes; there is no manual electricity-source input. Legacy profile shares are ignored by the adapter. Unassigned pieces retain their weight using world electricity. Imported GPX flight tracks default to exact flown distance; other flight routes default to great-circle distance, with an explicit profile override available.

The calculation date is the first dated segment waypoint, then the trip start/end date, then its creation date. Undated records use the current year and show this assumption. Zero-distance routes produce zero; invalid estimates are isolated from other segments and shown as unavailable in the segment card. Each segment persists a `climateImpact` cache containing the calculator result (total, direct/upstream breakdown, factors, assumptions and warnings) or an isolated calculation error. Trip JSON omits default-valued fields: zero quantities, `scope: wtw`, `includesRadiativeForcing: false`, empty arrays/maps and `status: ok`. No-emission results are stored as `{"inputKey":"none"}`. Cache access restores omitted values before use and accepts older expanded caches. Save-state comparison uses the same compact representation, so hydration does not create unsaved changes. Aircraft table metadata reports its publication year. For emitting calculations, its canonical `inputKey` includes the resolved profile, date, distance, automatic country shares, flight geometry mode, adapter/calculator rule version and generated SHA-256 data revision. Valid results survive JSON reloads and are reused. Distance-cache computation, route-country updates and preference changes refresh invalid entries; undo/redo restores a cache valid for the current preferences. Cache-only changes create no undo entry and are excluded from provider content conflict comparisons, but remain visible in the normal unsaved/save state and are written into segment JSON, including compact country-part segments. Factor-table updates regenerate the data revision automatically; calculator/adapter rule changes must bump `CLIMATE_CALCULATION_VERSION`.

Trip summaries show total and per-mode kg CO₂e. Analytics uses the same three-state grouping button for distance and climate: transport modes, trips, countries. Metric changes retain the grouping and trip/country/mode selections; grouping changes clear those selections. Country selection exposes mode filtering. Trip selection exposes both country and mode tables, whose independent selections intersect and update the other table's available rows. Table totals, segment lists, map routes and markers share the same trip/country/mode/date filters. Climate filtering includes only segments with a positive climate result (including custom profiles), excluding unavailable results and no-emission segments even when their transport mode normally emits. Country climate totals allocate the cached segment result by country distance share. Year/date allocation remains proportional to days in the trip.

Trip grouping without a selected trip also shows a scatter plot with distance (km) and climate impact (kg CO₂e) axes. Both axes respect current filters; distance mode includes no-emission travel, while climate mode uses emitting segments only. Trips with incomplete estimates are omitted from the scatter rather than shown as zero. Pointer hover, keyboard focus and captured touch scrubbing highlight the nearest point; a fixed readout above the plot shows the trip name and values without changing chart layout.

Data attribution and calculation assumptions are available in the profile preferences and segment Climate Impact cards.

```ts
export type TravelInput = NoEmissionInput | FlightInput | CarInput | BusInput | RailInput | FerryInput;

export function calculate(input: TravelInput): ClimateResult;
export function calculateMany(inputs: TravelInput[]): BatchItem[];     // BatchItem = { ok: true; result } | { ok: false; error }; one bad item never breaks the batch
```

**Choosing the `TravelInput` is Triplo's job.** Triplo knows the user's own settings and overrides (for instance a user who sets a bike as electric, or who configures `other` as a bus). The module never sees Triplo's mode names. Default mapping, as a suggestion for the adapter (it lives in the app, not here):

| Triplo mode | Default `TravelInput` |
|---|---|
| walk, hike, run, bike | `{ mode: "none" }` |
| car, taxi | `{ mode: "car", ... }` (taxi: user's occupancy) |
| bus | `{ mode: "bus" }` |
| rail, subway | `{ mode: "rail", railType: "inter_city", traction: "electric" }` (built-in default; subway can be configured in a custom profile) |
| flight | `{ mode: "flight", ... }` |
| ferry | `{ mode: "ferry" }` |
| other | whatever the user configured; if nothing: `{ mode: "none" }` |

---

## 10. Repository layout

```
climate/
  data/  defra-factors.csv  factor-keys.yaml  grid-intensity.csv  country-region.csv
         aircraft.csv  aircraft-fuel.csv  operators.csv  operator-layouts.csv  geo.json
  scripts/  build-defra.py  build-grid.py  build-aircraft.py  build-json.py
  src/  types.ts  calculate.ts  flight.ts  car.ts  bus.ts  rail.ts  ferry.ts  grid.ts  factors.ts  examples.ts
  test/  golden tests with hand-computed values
```

Yearly update: add the new DEFRA flat file and the new OWID CSV, run the scripts, review the CSV diff, bump `FACTOR_SET_VERSION`.

---

## 11. Licences and required attributions

Put this block in the app's about/credits screen and keep it next to the data files (`data/LICENSES.md`). Wording marked "(verify)" should be copied from the source's own citation text before release.

| Data | Source | Licence | Attribution to show |
|---|---|---|---|
| Emission conversion factors (all modes, jet fuel, UK electricity, T&D) | UK Government GHG Conversion Factors for Company Reporting, DESNZ and DEFRA (published each year on gov.uk) | **Open Government Licence v3.0** (commercial reuse and adaptation allowed) | "Contains public sector information licensed under the Open Government Licence v3.0." Add: source name and year(s) used, a link to the OGL, and a note that the data was processed/modified (derived tables). |
| Electricity carbon intensity | Our World in Data energy dataset, built from **Ember** (Yearly Electricity Data) and the **Energy Institute** (Statistical Review of World Energy) | **CC BY 4.0** (OWID and Ember); underlying data is subject to the original providers' terms | "Data: Ember; Energy Institute - with major processing by Our World in Data" (verify against the OWID citation text), link to the licence, note of changes (filtered to country, year, intensity). |
| Per-aircraft seats, load factors, kg CO2 per vehicle-km | DEFRA/DESNZ 2026 methodology report, Table 33 (derived from UK CAA statistics and the EUROCONTROL small emitters tool by DESNZ) | **OGL v3.0** | As for the DEFRA row. **The EEA/EUROCONTROL master emissions calculator is not used** (its legal notice requires EUROCONTROL's written consent). |
| Class weights, default load factors | DEFRA 2026 methodology, Tables 36-37 | OGL v3.0 | As for the DEFRA row. |
| Airline load factors | company reports, U.S. DOT BTS T-100 (public domain), ch-aviation (commercial, **not used**) | per source | Record `source` and `year` per row in `operators.csv`. |
| Aircraft typical seats / body type | hand-collected from manufacturer data and ICAO type designators | to be checked per source | `source` column per row. |
| Flight distance uplift 8% | UK Greenhouse Gas Inventory, via DESNZ journey-emissions methodology note (OGL) | OGL v3.0 | Cite in the methodology text. |

No attribution is needed for values we compute ourselves, but derived tables inherit the licence of their sources (all of the above allow reuse, including commercial, with attribution).

---

## 12. Decisions log and remaining points

All earlier open points are settled: DEFRA flat files 2015-2026; Tier 2 flights use short-haul (up to 3 700 km) and long-haul rows; electric inter-city/high-speed rail use distinct French 2017 energy benchmarks (section 6.3), while light rail/subway retain DEFRA-implied energy; RF 1.7 on the CO2 component only; the 8% uplift is already inside DEFRA's per-pkm factors; ferry without occupancy scaling; car size limits verified; **aircraft data from DEFRA Table 33** (the EEA/EUROCONTROL data is not used); **class weights from DEFRA Table 37**.

Remaining (non-blocking, handled during implementation):
- Seat-class shares per aircraft when no operator layout exists: DEFRA's band shares (Table 37).
- ICAO-code mapping of the roughly 40 DEFRA aircraft types is hand-made (`data/aircraft-icao-map.json`).
- Older DEFRA years (2015-2025) are loaded when you attach the flat files; the build script accepts any year.
