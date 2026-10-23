#!/usr/bin/env python3
"""One-off generator for data/country-region.csv (ISO3 -> continent, OWID continent names).
Hand-kept list; edit here and re-run. Usage: python3 make-country-region.py <out.csv>"""
import sys
R = {
 "Europe": "ALB AND AUT BEL BGR BIH BLR CHE CYP CZE DEU DNK ESP EST FIN FRA FRO GBR GIB GRC GRL HRV HUN IRL ISL ITA LIE LTU LUX LVA MCO MDA MKD MLT MNE NLD NOR POL PRT ROU RUS SMR SRB SVK SVN SWE UKR VAT OWID_KOS",
 "Asia": "AFG ARE ARM AZE BGD BHR BRN BTN CHN GEO HKG IDN IND IRN IRQ ISR JOR JPN KAZ KGZ KHM KOR KWT LAO LBN LKA MAC MDV MMR MNG MYS NPL OMN PAK PHL PRK PSE QAT SAU SGP SYR THA TJK TKM TLS TUR TWN UZB VNM YEM",
 "Africa": "AGO BDI BEN BFA BWA CAF CIV CMR COD COG COM CPV DJI DZA EGY ERI ESH ETH GAB GHA GIN GMB GNB GNQ KEN LBR LBY LSO MAR MDG MLI MOZ MRT MUS MWI NAM NER NGA REU RWA SDN SEN SHN SLE SOM SSD STP SWZ SYC TCD TGO TUN TZA UGA ZAF ZMB ZWE",
 "North America": "ABW ATG BHS BLZ BMU BRB CAN CRI CUB CYM DMA DOM GLP GRD GTM HND HTI JAM KNA LCA MEX MSR MTQ NIC PAN PRI SLV SPM TCA TTO USA VCT VGB VIR CUW ANT",
 "South America": "ARG BOL BRA CHL COL ECU FLK GUF GUY PER PRY SUR URY VEN",
 "Oceania": "ASM AUS COK FJI FSM GUM KIR MNP NCL NIU NRU NZL PNG PYF SLB TON TUV VUT WSM",
}
out = sys.argv[1]
seen = set()
with open(out, "w", newline="\n") as f:
    f.write("iso3,continent\n")
    for cont, codes in R.items():
        for c in sorted(codes.split()):
            assert c not in seen, c
            seen.add(c)
            f.write(f"{c},{cont}\n")
print("wrote", len(seen))
