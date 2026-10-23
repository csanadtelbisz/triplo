# Triplo climate-impact module

Pure TypeScript calculator (no runtime dependencies). Specification: `../CLIMATE_IMPACT_CALCULATION.md`. Triplo's profile adapter lives in `../frontend/src/climate`; the calculator remains independent of app transport modes and React.

```ts
import { calculate } from "./src";
calculate({ mode: "car", date: "2026-06-01", distanceKm: 100, fuelType: "bev", gridShares: { HUN: 1 } });
```

## Data and yearly update
All numbers come from `data/*` and are compiled into `src/generated/data.ts`, including a content revision used to invalidate in-memory segment climate caches when the data changes. Climate results are recalculated after trips load and are excluded from saved trips and offline browser storage.

```
python3 -I scripts/build-defra.py data/defra-factors.csv 2025=<flat file> 2026=<flat file> ...   # any years, .xls or .xlsx (needs openpyxl + xlrd)
# if xlrd chokes on an .xls (2021 did), convert it first:  soffice --headless --convert-to xlsx --outdir <other dir> <file.xls>
python3 -I scripts/build-grid.py <owid_energy.csv> data/country-region.csv data/grid-intensity.csv
python3 -I scripts/build-aircraft.py <DEFRA methodology report as text> data/aircraft-icao-map.json data/aircraft.csv
python3 -I scripts/build-json.py data src/generated/data.ts
npm run typecheck && npm test
```
If DEFRA renames a category, edit `scripts/factor_keys.py` (the build script lists keys it could not find).
Operator profiles: edit `data/operators.csv` and `data/operator-layouts.csv`. Airline names may be listed without load factor, source or year; leave those CSV cells blank. A missing load factor uses the aircraft's DEFRA average while preserving any operator-specific seat layout. The airline selector combines both CSVs. Triplo regenerates `src/generated/data.ts` automatically when the Vite development server starts, when these CSVs change during development, and on production/preview builds. Python 3 is required for this generation step. The npm build lifecycle regenerates before type-checking; the Vite plugin also covers direct `vite build` deployments. Unchanged generated content is not rewritten, so startup causes no unnecessary reload. `npm run climate:generate` in `frontend/` is also available for manual regeneration.
Electric inter-city and high-speed rail use the separate energy benchmarks in `data/rail-energy.json` (French transport-reporting defaults, 2017). These are not inferred from DEFRA's mixed-traction national rail or Eurostar emission factors. Update the benchmark values and source together, then regenerate `src/generated/data.ts`; the content revision invalidates Triplo's in-memory estimates. Route-country grid intensity and the year's DEFRA grid-loss uplift are applied at calculation time.

## Licences / attribution (show in the app)
See `data/LICENSES.md` (exact OWID and DEFRA attribution texts) and `data/DEFRA_SOURCES.md` (download links 2015-2026).
