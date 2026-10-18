#!/usr/bin/env python3
"""Filter the OWID energy CSV down to electricity carbon intensity.
Usage: python3 -I build-grid.py <owid_energy.csv> <country-region.csv> <out grid-intensity.csv>
Output columns: iso3,country,year,gco2e_per_kwh
Countries keep their ISO3; continent aggregates and World are written as _EUROPE, _ASIA, ... , _WORLD.
Rows without a value are dropped. Prints a coverage report (including countries missing a continent)."""
import csv, sys

COL = "electricity_carbon_intensity_gco2eq_per_kwh"
AGG = {"Europe": "_EUROPE", "Asia": "_ASIA", "Africa": "_AFRICA", "North America": "_NORTH_AMERICA",
       "South America": "_SOUTH_AMERICA", "Oceania": "_OCEANIA", "World": "_WORLD"}

src, regions, out = sys.argv[1:4]
known = {r["iso3"] for r in csv.DictReader(open(regions, newline=""))}
rows, missing = [], set()
with open(src, newline="", encoding="utf-8") as f:
    for r in csv.DictReader(f):
        v = r.get(COL, "")
        if not v:
            continue
        iso = r["iso_code"]
        if iso:
            code = iso
            if code not in known:
                missing.add((code, r["country"]))
        elif r["country"] in AGG:
            code = AGG[r["country"]]
        elif r["country"] == "Kosovo":
            code = "OWID_KOS"
        else:
            continue  # other aggregates (EU, income groups, Ember groupings) are not used
        rows.append((code, r["country"], int(r["year"]), round(float(v), 2)))
rows.sort()
with open(out, "w", newline="\n") as f:
    w = csv.writer(f, lineterminator="\n")
    w.writerow(["iso3", "country", "year", "gco2e_per_kwh"])
    w.writerows(rows)
print(f"{len(rows)} rows, {len({r[0] for r in rows})} codes; years {min(r[2] for r in rows)}-{max(r[2] for r in rows)}")
if missing:
    print("WARNING no continent for:", sorted(missing))
