import gzip
import json
from pathlib import Path
import tempfile
import unittest

from shapely.geometry import Polygon
from boundaries import build, normalize_country, verify


def record(code="GL", name="Greenland", level=1, subtype="dependency", x=0):
    geometry = Polygon([(x, 0), (x + 1, 0), (x + 1, 1), (x, 1), (x, 0)])
    return {"id": code, "divisionId": code, "country": code, "name": name, "level": level, "subtype": subtype, "isLand": True, "isTerritorial": True, "wkb": geometry.wkb_hex, "sources": [{"dataset": "fixture", "license": "ODbL-1.0"}]}


class BoundaryTests(unittest.TestCase):
    def test_build_is_reproducible_and_preserves_territory_identity(self):
        rows = [record(), record("RE", "Réunion", 2, "region", 2), record("FK", "Falkland Islands", x=4)]
        with tempfile.TemporaryDirectory() as temporary:
            a, b = Path(temporary) / "a", Path(temporary) / "b"
            a.mkdir(); b.mkdir()
            build(rows, "test", [], a, {})
            build(rows, "test", [], b, {})
            self.assertEqual({p.name: p.read_bytes() for p in a.iterdir()}, {p.name: p.read_bytes() for p in b.iterdir()})
            verify(a)
            self.assertEqual([c["code"] for c in json.loads((a / "index.json").read_bytes())["countries"]], ["FK", "GL", "RE"])
            self.assertEqual(json.loads(gzip.decompress((a / "RE.json.gz.bin").read_bytes()))["code"], "RE")

    def test_verification_rejects_corruption(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            build([record()], "test", [], directory, {})
            (directory / "GL.json.gz.bin").write_bytes(b"corrupt")
            with self.assertRaisesRegex(ValueError, "Checksum mismatch"):
                verify(directory)

    def test_invalid_source_is_rejected(self):
        row = record()
        row["wkb"] = Polygon([(0, 0), (1, 1), (1, 0), (0, 1), (0, 0)]).wkb_hex
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "Invalid source"):
                build([row], "test", [], Path(directory), {})

    def test_missing_variant_and_ambiguous_names_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            row = record(); row["isTerritorial"] = False
            with self.assertRaisesRegex(ValueError, "Missing isTerritorial"):
                build([row], "test", [], Path(directory), {})
            with self.assertRaisesRegex(ValueError, "Ambiguous names"):
                build([record(), record(name="Another identity")], "test", [], Path(directory), {})

    def test_synthetic_codes_are_preserved_without_overrides(self):
        self.assertEqual(normalize_country({"country": "XK"}), "XK")
        with self.assertRaises(ValueError):
            normalize_country({"country": "not-a-country-code"})


if __name__ == "__main__":
    unittest.main()
