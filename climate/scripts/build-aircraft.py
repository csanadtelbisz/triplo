#!/usr/bin/env python3
"""Parse the per-aircraft table (Table 33 in the 2026 report) of the DEFRA methodology paper text into data/aircraft.csv.
Usage: python3 -I build-aircraft.py <methodology .pdf.txt> <aircraft-icao-map.json> <out aircraft.csv>
Columns: model,icao,body_type,band,seats,load_factor,kg_co2_per_vkm,avg_flight_km,pkm_share
Fails loudly when a model is missing from the ICAO map."""
import csv, json, re, sys

src, mapfile, out = sys.argv[1:4]
icao_map = json.load(open(mapfile))
lines = [l.strip() for l in open(src, encoding="utf-8", errors="replace")]
start = next(i for i, l in enumerate(lines) if l.startswith("Table 33: Assumptions used in the calculation of revised average"))
# the real table follows the contents-list entry: take the last occurrence that is followed by 'Domestic Flights'
cands = [i for i, l in enumerate(lines) if l.startswith("Table 33: Assumptions used in the calculation of revised average")]
start = next(i for i in cands if any(l == "Domestic Flights" for l in lines[i:i + 40]))
row_re = re.compile(r"^(?P<name>.*?)\s*(?P<seats>\d+)\s+(?P<lf>\d+)%\s+(?P<share>\d+)%\s+(?P<ef>\d+\.\d)\s+(?P<len>[\d,]+)$")
band, pending, rows = None, "", []
for l in lines[start:start + 140]:
    if l in ("Domestic Flights", "Short-haul Flights", "Long-haul Flights"):
        band = {"Domestic Flights": "dom", "Short-haul Flights": "short", "Long-haul Flights": "long"}[l]
        pending = ""
        continue
    if band is None or not l:
        continue
    if l.startswith("Notes:") and band == "long":
        break
    if l.startswith(("Average", "(total)", "2026 Government", "Av.", "Factor", "Proportion", "of", "passenger", "km", "Emissions", "Seats", "No.", "Load", "length", "Table")) or l.isdigit():
        pending = ""
        continue
    m = row_re.match(pending + " " + l if pending else l)
    if m:
        name = re.sub(r"\s+", " ", m["name"]).strip()
        rows.append((name, band, int(m["seats"]), int(m["lf"]) / 100, float(m["ef"]), int(m["len"].replace(",", "")), int(m["share"]) / 100))
        pending = ""
    elif re.search(r"[A-Za-z]", l) and not re.search(r"\d+%", l):
        pending = (pending + " " + l).strip()

WIDE = ("A330", "A350", "A380", "787", "777", "767")
out_rows, unknown = [], set()
for name, b, seats, lf, ef, ln, share in rows:
    base = re.sub(r"\s*(DREAMLINER|dreamliner)\s*", " ", name).strip()
    key = base if base in icao_map else None
    if key is None:
        unknown.add(base)
        continue
    body = "wide" if any(w in base for w in WIDE) else "narrow"
    out_rows.append((key, ";".join(icao_map[key]), body, b, seats, lf, ef, ln, share))
if unknown:
    sys.exit(f"models missing from ICAO map: {sorted(unknown)}")
with open(out, "w", newline="\n") as f:
    w = csv.writer(f, lineterminator="\n")
    w.writerow(["model", "icao", "body_type", "band", "seats", "load_factor", "kg_co2_per_vkm", "avg_flight_km", "pkm_share"])
    w.writerows(out_rows)
print(len(out_rows), "rows;", len({r[0] for r in out_rows}), "models")
