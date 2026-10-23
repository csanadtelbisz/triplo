"""Stable factor keys -> DEFRA flat-file category paths. Edit here when DEFRA renames categories.
keys_for(year) returns a list of (key, path, uom, ghg_unit). path = Level 1..4 + Column Text joined with ' / ' (empty parts skipped)."""

BANDS = {"dom": "Domestic, to/from UK", "short": "Short-haul, to/from UK",
         "long": "Long-haul, to/from UK", "intl": "International, to/from non-UK"}
CLASSES = {"avg": "Average passenger", "economy": "Economy class", "premium_economy": "Premium economy class",
           "business": "Business class", "first": "First class"}
SIZES = {"small": "Small car", "medium": "Medium car", "large": "Large car", "average": "Average car"}
FUELS = {"diesel": "Diesel", "petrol": "Petrol", "hybrid": "Hybrid", "cng": "CNG", "lpg": "LPG",
         "unknown": "Unknown", "phev": "Plug-in Hybrid Electric Vehicle", "bev": "Battery Electric Vehicle"}
KG = "kg CO2e"


def keys_for(year: int):
    k = []
    # --- flights (kg CO2e per passenger-km); WTT rows are identical with and without RF, we store "without RF"
    for b, bl in BANDS.items():
        for c, cl in CLASSES.items():
            k.append((f"flight.{b}.{c}.rf", f"Business travel- air / Flights / {bl} / {cl} / With RF", "passenger.km", KG))
            k.append((f"flight.{b}.{c}.norf", f"Business travel- air / Flights / {bl} / {cl} / Without RF", "passenger.km", KG))
            k.append((f"flight.{b}.{c}.wtt", f"WTT- business travel- air / WTT- flights / {bl} / {cl} / Without RF", "passenger.km", KG))
    # --- jet fuel per tonne
    jf = "Liquid fuels / Aviation turbine fuel"
    k += [("jetfuel.co2_per_t", f"Fuels / {jf}", "tonnes", "kg CO2e of CO2 per unit"),
          ("jetfuel.ch4_per_t", f"Fuels / {jf}", "tonnes", "kg CO2e of CH4 per unit"),
          ("jetfuel.n2o_per_t", f"Fuels / {jf}", "tonnes", "kg CO2e of N2O per unit"),
          ("jetfuel.wtt_per_t", f"WTT- fuels / {jf}", "tonnes", KG)]
    # --- road fuels per litre (exact consumption override)
    for name, label in (("petrol", "Petrol (average biofuel blend)"), ("diesel", "Diesel (average biofuel blend)")):
        k += [(f"fuel.{name}.co2_per_l", f"Fuels / Liquid fuels / {label}", "litres", "kg CO2e of CO2 per unit"),
              (f"fuel.{name}.ch4_per_l", f"Fuels / Liquid fuels / {label}", "litres", "kg CO2e of CH4 per unit"),
              (f"fuel.{name}.n2o_per_l", f"Fuels / Liquid fuels / {label}", "litres", "kg CO2e of N2O per unit"),
              (f"fuel.{name}.wtt_per_l", f"WTT- fuels / Liquid fuels / {label}", "litres", KG)]
    k += [("fuel.lpg.co2_per_l", "Fuels / Gaseous fuels / LPG", "litres", "kg CO2e of CO2 per unit"),
          ("fuel.lpg.ch4_per_l", "Fuels / Gaseous fuels / LPG", "litres", "kg CO2e of CH4 per unit"),
          ("fuel.lpg.n2o_per_l", "Fuels / Gaseous fuels / LPG", "litres", "kg CO2e of N2O per unit"),
          ("fuel.lpg.wtt_per_l", "WTT- fuels / Gaseous fuels / LPG", "litres", KG)]
    # --- cars by size (kg CO2e per vehicle-km)
    for s, sl in SIZES.items():
        for f, fl in FUELS.items():
            k.append((f"car.{s}.{f}.ttw", f"Passenger vehicles / Cars (by size) / {sl} / {fl}", "km", KG))
            k.append((f"car.{s}.{f}.wtt", f"WTT- pass vehs & travel- land / WTT- cars (by size) / {sl} / {fl}", "km", KG))
        for f in ("phev", "bev"):
            k.append((f"car.{s}.{f}.kwh", f"SECR kWh UK electricity for EVs / Cars (by size) / {sl} / {FUELS[f]}", "km", "kWh (net)"))
    # --- bus, rail, ferry (kg CO2e per passenger-km)
    for key, name in (("local", "Local bus (not London)"), ("coach", "Coach")):
        k.append((f"bus.{key}.ttw", f"Business travel- land / Bus / {name}", "passenger.km", KG))
        k.append((f"bus.{key}.wtt", f"WTT- pass vehs & travel- land / WTT- bus / {name}", "passenger.km", KG))
    for key, name in (("national", "National rail"), ("international", "International rail"),
                      ("light", "Light rail and tram"), ("underground", "London Underground")):
        k.append((f"rail.{key}.ttw", f"Business travel- land / Rail / {name}", "passenger.km", KG))
        k.append((f"rail.{key}.wtt", f"WTT- pass vehs & travel- land / WTT- rail / {name}", "passenger.km", KG))
    for key, name in (("foot", "Foot passenger"), ("car", "Car passenger")):
        k.append((f"ferry.{key}.ttw", f"Business travel- sea / Ferry / {name}", "passenger.km", KG))
        k.append((f"ferry.{key}.wtt", f"WTT- business travel- sea / WTT- ferry / {name}", "passenger.km", KG))
    # --- UK electricity (needed to derive implied rail kWh and the T&D uplift)
    k += [("elec.uk.generation", "UK electricity / Electricity generated / Electricity: UK / kWh", "kWh", KG),
          ("elec.uk.td", "Transmission and distribution / T&D- UK electricity / Electricity: UK / kWh", "kWh", KG)]
    return k
