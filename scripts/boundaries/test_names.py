import unittest

from names import display_names


class CountryNameTests(unittest.TestCase):
    def test_english_names_preserve_synthetic_codes_and_highest_level(self):
        rows = [
            {"country": "XA", "admin_level": 0, "names": {"primary": "Хабомаи", "common": [("en", "Habomai Islands")]}},
            {"country": "XA", "admin_level": 2, "names": {"primary": "Local district", "common": [("en", "Local district")]}},
        ]
        self.assertEqual(display_names(rows), {"XA": {"primary": "Хабомаи", "english": "Habomai Islands"}})

    def test_missing_translation_preserves_primary_name(self):
        rows = [{"country": "XB", "admin_level": 0, "names": {"primary": "An island", "common": None}}]
        self.assertEqual(display_names(rows)["XB"]["english"], "An island")

    def test_ambiguous_translations_are_rejected(self):
        rows = [{"country": "AT", "admin_level": 0, "names": {"primary": "Österreich", "common": [("en", english)]}} for english in ["Austria", "Another country"]]
        with self.assertRaisesRegex(ValueError, "Ambiguous"):
            display_names(rows)
