"""Generate English display names from the pinned Overture division areas."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import urllib.request

from boundaries import BUCKET, LOCK, ROOT, checksum, encoded, normalize_country

OUTPUT = ROOT / "frontend/src/countries/englishNames.ts"
NAMES_LOCK = Path(__file__).with_name("names.lock.json")
COLUMNS = ("country", "names", "subtype", "admin_level")
SUBTYPES = ("country", "dependency", "region", "macroregion")


class LockedParquet(io.RawIOBase):
    def __init__(self, source):
        self.source, self.position, self.ranges = source, 0, []

    def readable(self):
        return True

    def seekable(self):
        return True

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = offset if whence == 0 else self.position + offset if whence == 1 else self.source["size"] + offset
        if self.position < 0:
            raise ValueError("Negative Parquet offset")
        return self.position

    def fetch(self, bounds):
        start, end = bounds
        request = urllib.request.Request(BUCKET + self.source["key"], headers={"Range": f"bytes={start}-{end - 1}", "If-Match": self.source["etag"]})
        with urllib.request.urlopen(request, timeout=120) as response:
            if response.status != 206 or response.headers.get("ETag") != self.source["etag"]:
                raise ValueError("Source does not match the locked object")
            if response.headers.get("Content-Range") != f"bytes {start}-{end - 1}/{self.source['size']}":
                raise ValueError("Incorrect source byte range")
            payload = response.read()
        if len(payload) != end - start:
            raise ValueError("Incomplete source byte range")
        return start, payload

    def read(self, length=-1):
        end = self.source["size"] if length < 0 else min(self.source["size"], self.position + length)
        if end <= self.position:
            return b""
        for start, payload in self.ranges:
            if start <= self.position and end <= start + len(payload):
                result = payload[self.position - start:end - start]
                self.position = end
                return result
        start, payload = self.fetch((self.position, end))
        self.ranges.append((start, payload))
        self.position = end
        return payload


def extract_names(lock):
    import pyarrow.parquet as parquet
    records = []
    for source in lock["files"]:
        print(f"Reading names: {source['key']}", flush=True)
        reader = LockedParquet(source)
        table = parquet.ParquetFile(reader)
        ranges = []
        for i in range(table.num_row_groups):
            columns = [table.metadata.row_group(i).column(j) for j in range(table.metadata.num_columns)]
            selected = [column for column in columns if column.path_in_schema.split(".")[0] in COLUMNS]
            starts = [column.dictionary_page_offset or column.data_page_offset for column in selected]
            ranges.append((min(starts), max(start + column.total_compressed_size for start, column in zip(starts, selected))))
        with ThreadPoolExecutor(max_workers=8) as executor:
            reader.ranges.extend(executor.map(reader.fetch, ranges))
        for batch in table.iter_batches(columns=list(COLUMNS)):
            records.extend(row for row in batch.to_pylist() if row["subtype"] in SUBTYPES)
    return records


def display_names(records):
    grouped = {}
    for row in records:
        grouped.setdefault(normalize_country(row), []).append(row)
    result = {}
    for code, rows in sorted(grouped.items()):
        level = min(row["admin_level"] for row in rows)
        rows = [row for row in rows if row["admin_level"] == level]
        primary = {row["names"]["primary"] for row in rows}
        english = {dict(row["names"].get("common") or []).get("en") for row in rows} - {None, ""}
        if len(primary) != 1 or len(english) > 1:
            raise ValueError(f"Ambiguous country names: {code}")
        name = next(iter(primary))
        result[code] = {"primary": name, "english": next(iter(english)) if english else name}
    return result


def verify():
    lock = json.loads(NAMES_LOCK.read_bytes())
    if lock["sourceLockSha256"] != checksum(LOCK.read_bytes()) or lock["outputSha256"] != checksum(OUTPUT.read_bytes()):
        raise ValueError("English names differ from the source or output lock")
    print(f"Verified English country names ({lock['release']})")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["build", "verify"])
    args = parser.parse_args()
    if args.command == "verify":
        verify()
        return
    lock = json.loads(LOCK.read_bytes())
    names = display_names(extract_names(lock))
    index = json.loads((ROOT / "frontend/public/countries/index.json").read_bytes())
    if set(names) != {country["code"] for country in index["countries"]} or any(names[country["code"]]["primary"] != country["name"] for country in index["countries"]):
        raise ValueError("English name identities differ from installed boundaries")
    payload = b"export const englishCountryNames: Record<string, { primary: string; english: string }> = " + encoded(names) + b";\n"
    OUTPUT.write_bytes(payload)
    NAMES_LOCK.write_bytes(encoded({"release": lock["release"], "sourceLockSha256": checksum(LOCK.read_bytes()), "outputSha256": checksum(payload), "property": "names.common.en", "fallback": "names.primary"}))
    verify()


if __name__ == "__main__":
    main()
