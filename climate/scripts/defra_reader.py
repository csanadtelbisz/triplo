"""Layout-aware reader for DEFRA/DESNZ flat files (2015-2026, .xls or .xlsx).
read_factors(path) -> list of dicts: id, path ('L1 / L2 / L3 / L4 / ColumnText'), uom, ghg, value.
Handles: header row detection; 'GHG/Unit' (2022+) vs 'GHG' (2016-2021) columns; optional ID / UOM (simple) / Lookup columns."""
import re

def _rows(path):
    if path.lower().endswith(".xls"):
        import xlrd
        wb = xlrd.open_workbook(path, ignore_workbook_corruption=True)
        s = wb.sheet_by_name("Factors by Category")
        for i in range(s.nrows):
            yield s.row_values(i)
    else:
        import openpyxl
        wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
        for r in wb["Factors by Category"].iter_rows(values_only=True):
            yield list(r)

def _ghg(x):
    """Canonical gas label: 'total' (kg CO2e), or component rows 'CO2'/'CH4'/'N2O' (older years in kg of the gas; 2022+ in kg CO2e of the gas)."""
    if x in ("kg CO2e", "All Gases (CO2e)"): return "total"
    m = re.match(r"(?:kg )?(?:CO2e of )?(CO2|CH4|N2O)(?: per unit)?$", x)
    return m.group(1) if m else x


def read_factors(path):
    it = iter(_rows(path))
    cols = None
    out = []
    for r in it:
        cells = [str(c).strip() if c is not None else "" for c in r]
        if cols is None:
            if "Scope" in cells and any(c.startswith("Level 1") for c in cells):
                cols = {c: i for i, c in enumerate(cells) if c}
                if "Question ID" in cols:      # 2015 layout: Year/Factor columns, ID columns interleaved
                    valcol = cols["Factor"]
                else:
                    valcol = next(i for c, i in cols.items() if c.lower().startswith("ghg conversion factor"))
                ghgcol = cols.get("GHG/Unit", cols.get("GHG"))
            continue
        v = r[valcol] if valcol < len(r) else None
        if not isinstance(v, (int, float)) or isinstance(v, bool):
            continue
        g = lambda name: cells[cols[name]] if name in cols and cols[name] < len(cells) else ""
        parts = [g("Level 1"), g("Level 2"), g("Level 3"), g("Level 4"), g("Column Text")]
        out.append({"id": g("ID"), "path": " / ".join(p for p in parts if p),
                    "uom": g("UOM"), "ghg": _ghg(cells[ghgcol]), "value": float(v)})
    return out

if __name__ == "__main__":
    import sys
    rows = read_factors(sys.argv[1]); print(len(rows)); print(rows[0]); print(rows[-1])
