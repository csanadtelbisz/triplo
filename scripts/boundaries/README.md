# Country boundaries

Triplo uses Overture Divisions country codes, primary names, and territorial
assignments. There are no country overrides. `normalize_country` is the policy
entry point for a future override feature. Region-level areas with their own
country code are included, so extraction is not restricted to `subtype=country`.
For each code, the highest administrative representation supplies its boundaries.

Use Python 3.12 and the pinned conversion tools:

```sh
python -m venv .boundary-cache/venv
.boundary-cache/venv/bin/pip install -r scripts/boundaries/requirements.txt
.boundary-cache/venv/bin/python -m unittest discover -s scripts/boundaries
.boundary-cache/venv/bin/python scripts/boundaries/boundaries.py build
.boundary-cache/venv/bin/python scripts/boundaries/boundaries.py verify
```

On Windows use `.boundary-cache/venv/Scripts/python.exe` and `pip.exe`.
The initial extraction downloads about 4.5 GB of source Parquet, one file at a
time, then retains a smaller extract in `.boundary-cache`. A clean build needs
network access to Overture S3. Rebuilds reuse the extract. DuckDB extensions,
API keys, and runtime access to Overture are not required.

`source.lock.json` pins the release, object names, sizes, ETags, source Parquet
SHA-256 hashes, and the SHA-256 of the canonical extracted records. The checked-in
manifest records those identifiers and checksums, conversion version, upstream
licenses, attribution, and the index checksum. The index checksums every output.
Country files are deterministic gzip JSON, with full territorial and land
geometry; no coordinate rounding or simplification is applied. The `.gz.bin`
suffix keeps static servers from transparently decoding the gzip payload before
the worker verifies its checksum.

To update, explicitly select a release:

```sh
python scripts/boundaries/boundaries.py update --release YYYY-MM-DD.N
```

Inspect `frontend/public/countries-candidate/validation.json` and its catalog.
Review added/removed/renamed codes, changed geometries, overlaps, payload sizes,
and territory assignments. Invalid or missing geometry prevents promotion.
Ambiguous overlaps are reported and remain Unassigned at runtime; they are never
resolved by arbitrary country ordering. After reviewing the candidate:

```sh
python scripts/boundaries/boundaries.py update --release YYYY-MM-DD.N --promote
python scripts/boundaries/boundaries.py verify
```

Commit the source lock and the complete `frontend/public/countries` directory
together. Previous datasets remain available in Git. The preparation workflow
also provides the generated directory and lock as an artifact for inspection.

The boundary database is derived from Overture Divisions, including OpenStreetMap
and geoBoundaries inputs, and is distributed under [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Attribution: © Overture Maps Foundation · © OpenStreetMap contributors.
See [Overture attribution](https://docs.overturemaps.org/attribution/) and the
generated manifest for source licenses. Country statistics use the installed
dataset, including for older trips; historical borders are not modeled.
