# DEFRA/DESNZ flat files 2015-2026 (for scripts/build-defra.py)

Publication pages: `https://www.gov.uk/government/publications/greenhouse-gas-reporting-conversion-factors-<YEAR>`.
Use the file called "Flat file (for automatic processing only)". `.xls` files are read directly (xlrd); the 2021, 2022 and 2015 `.xls` files were converted to `.xlsx` with LibreOffice first because xlrd failed on them (2021, 2022) or for uniformity.
The category names inside older years differ from 2026; scripts/factor_keys.py may need per-year paths (the script lists keys it cannot find).

| Year | Format | Flat file |
|---|---|---|
| 2015 | xls | https://assets.publishing.service.gov.uk/media/5a7f8868e5274a2e87db66b1/2015_flat_file_set.xls |
| 2016 | xlsx | https://assets.publishing.service.gov.uk/media/5a7485fb40f0b61938c7e22e/2016_Flat_format_file_v01-01.xlsx (corrected version uploaded 5 Oct 2016; use this one) |
| 2017 | xls | https://assets.publishing.service.gov.uk/media/5a74a573ed915d0e8e399e0c/Conversion_factors_2017_-_Flat_file__for_automatic_processing_only__v02-....xls (the "...." is literally part of the file name) |
| 2018 | xls | https://assets.publishing.service.gov.uk/media/5b1e977ce5274a1905e8e986/Conversion_factors_2018_-_Flat_file__for_automatic_processing_only__v01-01.xls |
| 2019 | xls | https://assets.publishing.service.gov.uk/media/5f1ff1cc8fa8f50485f30666/conversion-factors-2019-flat-file-v01-02.xls |
| 2020 | xlsx | https://assets.publishing.service.gov.uk/media/5edfa176d3bf7f1eb2043f01/Conversion_Factors_2020_-_Flat_file__for_automatic_processing_only_.xlsx |
| 2021 | xls | https://assets.publishing.service.gov.uk/media/61ee74c88fa8f505960134ec/conversion-factors-2021-flat-file-automatic-processing.xls (revised Jan 2022) |
| 2022 | xls | https://assets.publishing.service.gov.uk/media/6329dcf2e90e073725585d5c/ghg-conversion-factors-2022-flat-format.xls |
| 2023 | xlsx | https://assets.publishing.service.gov.uk/media/649c536906179b00113f74a9/ghg-conversion-factors-2023-flat-file-update.xlsx |
| 2024 | xlsx | https://assets.publishing.service.gov.uk/media/6722567c10b0d582ee8c4953/ghg-conversion-factors-2024-FlatFormat_v1_1.xlsx |
| 2025 | xlsx | https://assets.publishing.service.gov.uk/media/6846b6ea57f3515d9611f0dd/ghg-conversion-factors-2025-flat-format.xlsx |
| 2026 | xlsx | https://assets.publishing.service.gov.uk/media/6a6c9748862aaf18d9c62ac9/ghg-conversion-factors-2026-flat-format-revised.xlsx |

Methodology papers (PDF), same pages: 2026 `.../6a2940543b15d05a7ce3202e/2026-GHG-conversion-factors-methodology-report.pdf`,
2025 `.../6846b0870392ed9b784c0187/2025-GHG-CF-methodology-paper.pdf`, 2024 `.../66a9fe4ca3c2a28abb50da4a/2024-greenhouse-gas-conversion-factors-methodology.pdf`,
2023 `.../647f50dd103ca60013039a8a/2023-ghg-cf-methodology-paper.pdf` (all under https://assets.publishing.service.gov.uk/media/).
