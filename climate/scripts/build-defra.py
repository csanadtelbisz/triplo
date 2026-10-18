#!/usr/bin/env python3
"""Build data/defra-factors.csv from DEFRA/DESNZ flat files (2015-2026; .xls or .xlsx).
Usage: python3 -I scripts/build-defra.py <data/defra-factors.csv> <year>=<flat file> [<year>=<flat file> ...]
Replaces only the given years' rows (idempotent). Reading is done by scripts/defra_reader.py (needs openpyxl, and xlrd for .xls).
Output columns: key,year,value,uom,ghg_unit,defra_id   (defra_id empty for years whose flat file has no ID column)
Category names drift between years; paths are matched after normalisation (see norm()) and with alternates (alts())."""
import csv, os, re, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from factor_keys import keys_for
from defra_reader import read_factors

TAIL = re.compile(r"^(volume|tonnes|mass|kwh|\d{4})$")


def norm(path):
    path = re.sub(r"\s*\((air|land|sea)\)", r"- \1", path)         # 'WTT- business travel (air)' -> '... travel- air'
    path = re.sub(r"\s+", " ", path).lower().replace(" / wtt- ", " / ")   # 2021 'WTT- liquid fuels' == 2026 'Liquid fuels' 
    parts = [p.strip() for p in path.split(" / ")]
    while len(parts) > 1 and TAIL.match(parts[-1]):                # 'Aviation turbine fuel / Tonnes', 'Electricity: UK / 2020'
        parts.pop()
    return " / ".join(parts)


def alts(path):
    yield path
    if path.startswith("Passenger vehicles / Cars (by size)"):
        yield path.replace("Passenger vehicles", "Business travel- land", 1)


def canon(ghg):
    if ghg == "kg CO2e": return "total"
    m = re.match(r"kg CO2e of (CO2|CH4|N2O)", ghg)
    return m.group(1) if m else ghg


def build(year, src):
    index = {}
    for r in read_factors(src):
        index.setdefault((norm(r["path"]), r["uom"], r["ghg"]), (r["value"], r["id"]))
    rows, missing = [], []
    for key, path, uom, ghg in keys_for(year):
        hit = next((index[(norm(p), uom, canon(ghg))] for p in alts(path) if (norm(p), uom, canon(ghg)) in index), None)
        if hit is None:
            missing.append(key); continue
        rows.append((key, year, repr(float(hit[0])), uom, ghg, hit[1]))
    return rows, missing


if __name__ == "__main__":
    out, pairs = sys.argv[1], dict((int(a.split("=", 1)[0]), a.split("=", 1)[1]) for a in sys.argv[2:])
    built = {}
    for y in sorted(pairs):
        built[y] = build(y, pairs[y])
        print(f"{y}: {len(built[y][0])} factors, {len(built[y][1])} keys without a value")
        if os.environ.get("DEFRA_VERBOSE"): print("   missing:", ", ".join(built[y][1]))
    existing = []
    if os.path.exists(out):
        existing = [r for r in csv.reader(open(out, newline="")) if r and r[0] != "key" and int(r[1]) not in built]
    allrows = sorted(existing + [list(map(str, r)) for y in built for r in built[y][0]], key=lambda r: (r[0], int(r[1])))
    with open(out, "w", newline="\n") as f:
        w = csv.writer(f, lineterminator="\n"); w.writerow(["key", "year", "value", "uom", "ghg_unit", "defra_id"]); w.writerows(allrows)
