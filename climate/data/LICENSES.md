# Data licences and attribution texts

## Our World in Data / Ember (grid-intensity.csv)
Licence: Creative Commons BY 4.0 (https://creativecommons.org/licenses/by/4.0/). OWID: "All visualizations, data, and code produced by Our World in Data are completely open access under the Creative Commons BY license. You have the permission to use, distribute, and reproduce these in any medium, provided the source and authors are credited." Third-party data stays "subject to the license terms from the original third-party authors". The OWID energy-data repository asks to cite both Our World in Data and the underlying data sources.

Attribution texts as published by OWID (fetched 2026-10-17 from the OWID electricity-mix page, which builds on the same Ember data):

- Data source line: "Ember (2026); Energy Institute – Statistical Review of World Energy (2026); Pinto et al. (2023); Department for Energy Security and Net Zero of the UK (2023) – with major processing by Our World in Data"
- Short in-line attribution (recommended by OWID): "Ember (2026) and other sources – with major processing by Our World in Data"
- Full dataset citation: "Ember (2026); Energy Institute – Statistical Review of World Energy (2026); Pinto et al. (2023); Department for Energy Security and Net Zero of the UK (2023) – with major processing by Our World in Data. “Total electricity generation” [dataset]. Ember, “Yearly Electricity Data Europe”; Ember, “Yearly Electricity Data”; Energy Institute, “Statistical Review of World Energy”; Pinto et al., “Global historical electricity”; Department for Energy Security and Net Zero of the UK, “UK electricity capacity and generation by fuel between 1920 and 2020” [original data]. Retrieved October 17, 2026 from https://archive.ourworldindata.org/20261016-113448/grapher/electricity-mix.html (archived on October 16, 2026)."

Note: the citation above is for the electricity-mix page. Our file is OWID's energy dataset (owid_energy.csv, column electricity_carbon_intensity_gco2eq_per_kwh, Ember lifecycle intensity). I could not find the exact column-level citation text; the safest in-app line is the short one above, plus "Data: Ember, Energy Institute; processed by Our World in Data (CC BY 4.0)" with a link to https://ourworldindata.org/energy and the licence. For the dataset itself OWID says to cite both Our World in Data and the underlying sources (https://github.com/owid/energy-data).

## DEFRA / DESNZ (defra-factors.csv, aircraft.csv, flight-params.json)
Open Government Licence v3.0 (https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
Required: "Contains public sector information licensed under the Open Government Licence v3.0." Add: "UK Government GHG Conversion Factors for Company Reporting <year>, DESNZ and DEFRA", and state that the data was processed.

## Operator profiles (operators.csv, operator-layouts.csv)
Facts (load factors, seat counts) with their source per row: Ryanair Form 20-F (SEC), Wizz Air traffic statistics, easyJet results presentation and website, Lufthansa Group Annual Report, Caspian Post (Turkish Airlines traffic); seat counts partly from Wikipedia fleet tables (check against airline sites before relying on them; Wikipedia text is CC BY-SA, we copy only facts).

## Not used
EEA/EUROCONTROL master emissions calculator (legal notice requires EUROCONTROL's written consent).
