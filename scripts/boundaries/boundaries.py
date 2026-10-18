"""Build Triplo's country assets from a pinned Overture release."""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

import shapely
from shapely.geometry import mapping, shape
from shapely.ops import unary_union
from shapely.strtree import STRtree

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / "frontend/public/countries"
LOCK = Path(__file__).with_name("source.lock.json")
BUCKET = "https://overturemaps-us-west-2.s3.amazonaws.com/"
CONVERTER = 2
ATTRIBUTION = "© Overture Maps Foundation · © OpenStreetMap contributors · ODbL 1.0"


def encoded(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def checksum(data):
    return hashlib.sha256(data).hexdigest()


def listing(release):
    prefix = f"release/{release}/theme=divisions/type=division_area/"
    url = BUCKET + "?" + urllib.parse.urlencode({"list-type": "2", "prefix": prefix})
    root = ET.fromstring(urllib.request.urlopen(url, timeout=60).read())
    ns = {"s": "http://s3.amazonaws.com/doc/2006-03-01/"}
    if root.findtext("s:IsTruncated", namespaces=ns) == "true":
        raise ValueError("Source listing unexpectedly paginated")
    files = [{"key": n.findtext("s:Key", namespaces=ns), "etag": n.findtext("s:ETag", namespaces=ns), "size": int(n.findtext("s:Size", namespaces=ns))} for n in root.findall("s:Contents", ns)]
    files = sorted([f for f in files if f["key"].endswith(".parquet")], key=lambda f: f["key"])
    if not files:
        raise ValueError("Release has no division areas")
    return files


def extract(release, files, cache):
    import pyarrow.dataset as dataset
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / f"{release}-areas.json.gz"
    checksums_file = cache / f"{release}-checksums.json"
    checksums = json.loads(checksums_file.read_bytes()) if checksums_file.exists() else {}
    for source in files:
        if source["key"] in checksums:
            if source.get("sha256") and source["sha256"] != checksums[source["key"]]:
                raise ValueError("Cached source checksum mismatch")
            source["sha256"] = checksums[source["key"]]
    if target.exists():
        return json.loads(gzip.decompress(target.read_bytes()))
    records = []
    for source in files:
        part = cache / (source["key"].split("/")[-1] + ".json.gz")
        if part.exists():
            selected = json.loads(gzip.decompress(part.read_bytes()))
        else:
            print(f"Extracting {source['key']}", flush=True)
            with tempfile.TemporaryDirectory(dir=cache) as temporary:
                parquet = Path(temporary) / "source.parquet"
                source_digest = hashlib.sha256()
                with urllib.request.urlopen(BUCKET + source["key"], timeout=120) as response, parquet.open("wb") as sink:
                    while chunk := response.read(1024 * 1024):
                        sink.write(chunk)
                        source_digest.update(chunk)
                if parquet.stat().st_size != source["size"]:
                    raise ValueError("Source download size mismatch")
                actual = source_digest.hexdigest()
                if source.get("sha256") and source["sha256"] != actual:
                    raise ValueError("Source Parquet checksum mismatch")
                source["sha256"] = actual
                checksums[source["key"]] = actual
                checksums_file.write_bytes(encoded(checksums))
                table = dataset.dataset(parquet, format="parquet").to_table(
                    columns=["id", "division_id", "country", "names", "subtype", "admin_level", "is_land", "is_territorial", "geometry", "sources"],
                    filter=dataset.field("subtype").isin(["country", "dependency", "region", "macroregion"]))
                selected = [{"id": r["id"], "divisionId": r["division_id"], "country": r["country"], "name": r["names"]["primary"], "subtype": r["subtype"], "level": r["admin_level"], "isLand": r["is_land"], "isTerritorial": r["is_territorial"], "wkb": r["geometry"].hex(), "sources": r["sources"]} for r in table.to_pylist()]
                selected.sort(key=lambda r: r["id"])
            part.write_bytes(gzip.compress(encoded(selected), mtime=0))
        records.extend(selected)
    records.sort(key=lambda r: r["id"])
    target.write_bytes(gzip.compress(encoded(records), mtime=0))
    return records


def normalize_country(record):
    # The sole country-policy entry point. Preserve Overture identity and names.
    code = record["country"]
    if not isinstance(code, str) or not re.fullmatch(r"[A-Z]{2}", code):
        raise ValueError(f"Invalid country code: {code!r}")
    return code


def components(geometry):
    return list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]


def build(records, release, files, output, old_index):
    if not records:
        raise ValueError("Empty country source extract")
    source_hash = checksum(encoded(records))
    version = f"{release}-v{CONVERTER}-{source_hash[:12]}"
    grouped = {}
    for record in records:
        grouped.setdefault(normalize_country(record), []).append(record)
    countries, geometries, repairs = [], [], []
    sources = set()
    for code, rows in sorted(grouped.items()):
        # Choose the topmost representation of each Overture country code.
        level = min(r["level"] for r in rows)
        rows = [r for r in rows if r["level"] == level]
        names = sorted(set(r["name"] for r in rows))
        if len(names) != 1:
            raise ValueError(f"Ambiguous names for {code}: {names}")
        variants = {}
        for flag in ("isLand", "isTerritorial"):
            polygons = []
            for row in rows:
                if not row[flag]:
                    continue
                geom = shapely.from_wkb(bytes.fromhex(row["wkb"]))
                if not geom.is_valid:
                    raise ValueError(f"Invalid source geometry: {code}/{row['id']}")
                if geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
                    raise ValueError(f"Empty/nonpolygon source: {code}")
                polygons.append(geom)
                for src in row["sources"] or []:
                    sources.add((src["dataset"], src["license"]))
            if not polygons:
                raise ValueError(f"Missing {flag} variant for {code}")
            merged = unary_union(polygons)
            if not merged.is_valid:
                raise ValueError(f"Invalid merged geometry: {code}")
            variants[flag] = shapely.normalize(merged)
        territorial, land = variants["isTerritorial"], variants["isLand"]
        geometries.append(territorial)
        payload = encoded({"code": code, "territorial": mapping(territorial), "land": mapping(land)})
        compressed = gzip.compress(payload, mtime=0)
        name = f"{code}.json.gz.bin"
        (output / name).write_bytes(compressed)
        countries.append({"code": code, "name": names[0], "file": name, "sha256": checksum(compressed), "bounds": [list(p.bounds) for p in components(territorial)], "landBounds": list(land.bounds), "landParts": [list(p.bounds) for p in sorted(components(land), key=lambda p: p.area, reverse=True)[:32]], "bytes": len(compressed)})
    tree = STRtree(geometries)
    overlaps = []
    for i, geom in enumerate(geometries):
        for j in tree.query(geom):
            if j <= i:
                continue
            area = geom.intersection(geometries[j]).area
            if area > 1e-9:
                overlaps.append({"countries": [countries[i]["code"], countries[j]["code"]], "squareDegrees": area})
    old = {c["code"]: c for c in old_index.get("countries", [])}
    new = {c["code"]: c for c in countries}
    report = {"release": release, "countryCount": len(countries), "added": sorted(new.keys() - old.keys()), "removed": sorted(old.keys() - new.keys()), "renamed": [c for c in sorted(new.keys() & old.keys()) if new[c]["name"] != old[c]["name"]], "changed": [c for c in sorted(new.keys() & old.keys()) if new[c]["sha256"] != old[c]["sha256"]], "overlaps": overlaps, "repairs": repairs, "totalBytes": sum(c["bytes"] for c in countries)}
    (output / "validation.json").write_bytes(encoded(report))
    index = {"version": version, "countries": countries, "attribution": ATTRIBUTION}
    (output / "index.json").write_bytes(encoded(index))
    manifest = {"release": release, "converterVersion": CONVERTER, "sourceExtractSha256": source_hash, "sourceFiles": files, "indexSha256": checksum(encoded(index)), "sources": [{"dataset": d, "license": l} for d, l in sorted(sources)], "attribution": ATTRIBUTION, "license": "ODbL-1.0", "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/", "sourceUrl": "https://docs.overturemaps.org/guides/divisions/", "simplification": "none", "overlapPolicy": "Ambiguous route pieces are Unassigned; no country overrides."}
    (output / "manifest.json").write_bytes(encoded(manifest))
    print(json.dumps(report, indent=2), flush=True)
    return manifest


def verify(directory):
    index_bytes = (directory / "index.json").read_bytes()
    index = json.loads(index_bytes)
    if not index.get("countries") or len({c["code"] for c in index["countries"]}) != len(index["countries"]):
        raise ValueError("Empty or duplicate country catalog")
    manifest = json.loads((directory / "manifest.json").read_bytes())
    if checksum(index_bytes) != manifest["indexSha256"]:
        raise ValueError("Country index checksum mismatch")
    for entry in index["countries"]:
        payload = (directory / entry["file"]).read_bytes()
        if checksum(payload) != entry["sha256"]:
            raise ValueError(f"Checksum mismatch: {entry['code']}")
        asset = json.loads(gzip.decompress(payload))
        for variant in ("territorial", "land"):
            geom = shape(asset[variant])
            if geom.is_empty or not geom.is_valid:
                raise ValueError(f"Invalid asset: {entry['code']}/{variant}")
    print(f"Verified {len(index['countries'])} country assets ({index['version']})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["build", "update", "verify"])
    parser.add_argument("--release")
    parser.add_argument("--cache", type=Path, default=ROOT / ".boundary-cache")
    parser.add_argument("--output", type=Path, default=DEST)
    parser.add_argument("--promote", action="store_true", help="Promote a validated update and rewrite the source lock")
    args = parser.parse_args()
    if args.command == "verify":
        verify(args.output)
        lock = json.loads(LOCK.read_bytes())
        manifest = json.loads((args.output / "manifest.json").read_bytes())
        if manifest["release"] != lock["release"] or manifest["sourceExtractSha256"] != lock["sourceExtractSha256"] or manifest["sourceFiles"] != lock["files"]:
            raise ValueError("Installed boundaries differ from the source lock")
        return
    lock = json.loads(LOCK.read_bytes())
    release = args.release or lock["release"]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}\.\d+", release):
        raise ValueError("Invalid Overture release identifier")
    files = listing(release)
    locked_files = [{k: v for k, v in f.items() if k != "sha256"} for f in lock["files"]]
    if args.command == "build" and (release != lock["release"] or files != locked_files):
        raise ValueError("Source differs from lock; use update --release instead")
    if args.command == "build":
        for source, locked in zip(files, lock["files"]):
            if "sha256" in locked:
                source["sha256"] = locked["sha256"]
    records = extract(release, files, args.cache)
    if args.command == "build" and lock.get("sourceExtractSha256") and checksum(encoded(records)) != lock["sourceExtractSha256"]:
        raise ValueError("Source extract checksum differs from lock")
    old_index = json.loads((args.output / "index.json").read_bytes()) if (args.output / "index.json").exists() else {}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=args.output.parent, prefix=".countries-") as temporary:
        stage = Path(temporary)
        manifest = build(records, release, files, stage, old_index)
        verify(stage)
        if args.command == "update" and not args.promote:
            candidate = args.output.with_name("countries-candidate")
            shutil.copytree(stage, candidate, dirs_exist_ok=True)
            print(f"Candidate written to {candidate}; inspect validation.json, then repeat with --promote")
            return
        # No installed data is touched until extraction and validation finish.
        backup = args.output.with_name(".countries-previous")
        if backup.exists():
            shutil.rmtree(backup)
        if args.output.exists():
            args.output.rename(backup)
        shutil.copytree(stage, args.output)
        if args.promote or not lock.get("sourceExtractSha256"):
            LOCK.write_bytes(encoded({"release": release, "files": files, "sourceExtractSha256": manifest["sourceExtractSha256"]}))
        if backup.exists():
            shutil.rmtree(backup)


if __name__ == "__main__":
    main()
