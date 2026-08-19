"""
config.py — Central configuration for the Health Financing Dashboard pipeline.

All indicator codes, API endpoints, and output paths are defined here.
Edit this file to add or remove indicators without touching any other code.
"""

import os

# ─────────────────────────────────────────────
# TIME RANGE
# ─────────────────────────────────────────────
START_YEAR = 2000
# Upper bound of the pipeline panel. Keep in step with the latest year any
# source legitimately emits — e.g. wgi.py emits the FCV classification at its
# current-list calendar year (2025 for the FY26 list). Bump as new data lands.
END_YEAR   = 2025

# ─────────────────────────────────────────────
# OUTPUT PATHS
# ─────────────────────────────────────────────
BASE_DIR      = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR      = os.path.join(BASE_DIR, "data")
RAW_DIR       = os.path.join(DATA_DIR, "raw")
PROCESSED_DIR = os.path.join(DATA_DIR, "processed")
MANUAL_DIR    = os.path.join(DATA_DIR, "manual_downloads")
LOGS_DIR      = os.path.join(BASE_DIR, "logs")

# ─────────────────────────────────────────────
# WORLD BANK — HNP & MACRO INDICATORS
# Pulled via the `wbgapi` Python package (free, no auth required)
# Full indicator list: https://data.worldbank.org/indicator
# ─────────────────────────────────────────────
WORLD_BANK_INDICATORS = {

    # === HEALTH FINANCING ===
    "SH.XPD.CHEX.GD.ZS":      "Current health expenditure (% of GDP)",
    "SH.XPD.CHEX.PC.CD":      "Current health expenditure per capita (USD)",
    "SH.XPD.GHED.GD.ZS":      "Govt health expenditure (% of GDP)",
    "SH.XPD.GHED.CH.ZS":      "Govt health expenditure (% of current health expenditure)",
    "SH.XPD.GHED.PC.CD":      "Govt health expenditure per capita (USD)",
    "SH.XPD.PVTD.CH.ZS":      "Domestic private health expenditure (% of CHE)",
    "SH.XPD.OOPC.CH.ZS":      "Out-of-pocket expenditure (% of CHE)",
    "SH.XPD.OOPC.PC.CD":      "Out-of-pocket expenditure per capita (USD)",
    "SH.XPD.EHEX.CH.ZS":      "External health expenditure (% of CHE)",
    "SH.XPD.EHEX.PC.CD":      "External health expenditure per capita (USD)",

    # === HEALTH OUTCOMES ===
    "SP.DYN.LE00.IN":          "Life expectancy at birth (years)",
    "SP.DYN.LE00.FE.IN":       "Life expectancy at birth, female (years)",
    "SP.DYN.LE00.MA.IN":       "Life expectancy at birth, male (years)",
    "SH.DYN.MORT":             "Under-5 mortality rate (per 1,000 live births)",
    "SH.DYN.NMRT":             "Neonatal mortality rate (per 1,000 live births)",
    "SH.STA.MMRT":             "Maternal mortality ratio (per 100,000 live births)",
    "SH.STA.BRTC.ZS":          "Births attended by skilled health staff (%)",

    # === DISEASE — HIV/AIDS ===
    "SH.DYN.AIDS.ZS":          "HIV prevalence (% of population ages 15-49)",
    "SH.HIV.INCD.ZS":          "HIV incidence rate (per 1,000 uninfected population)",
    "SH.HIV.ARTC.ZS":          "ART coverage (% of people living with HIV)",

    # === DISEASE — TB & MALARIA ===
    "SH.TBS.INCD":             "TB incidence (per 100,000 people)",
    "SH.TBS.MORT.100K":        "TB mortality rate (per 100,000, excluding HIV)",
    "SH.MLR.INCD.P3":          "Malaria incidence (per 1,000 population at risk)",
    "SH.MLR.MORT.FN.ZS":       "Malaria mortality rate (per 100,000 population)",

    # === IMMUNISATION ===
    # Removed — replaced by WUENIC (see WUENIC_INDICATORS). World Bank
    # repackages WUENIC estimates with fewer antigens and a shorter year range.

    # === HEALTH SYSTEM CAPACITY ===
    "SH.MED.BEDS.ZS":          "Hospital beds (per 1,000 people)",
    "SH.MED.PHYS.ZS":          "Physicians (per 1,000 people)",
    "SH.MED.NUMW.P3":          "Nurses and midwives (per 1,000 people)",
    "SH.UHC.SRVS.CV.XD":       "UHC Service Coverage Index",

    # === NUTRITION ===
    "SH.STA.STNT.ZS":          "Stunting prevalence (% children under 5)",
    "SH.STA.WAST.ZS":          "Wasting prevalence (% children under 5)",
    "SN.ITK.DEFC.ZS":          "Undernourishment prevalence (% of population)",
    "SH.ANM.CHLD.ZS":          "Anaemia prevalence, children (% under 5)",
    "SH.ANM.NPRG.ZS":          "Anaemia prevalence, non-pregnant women (%)",

    # === WATER & SANITATION (WASH) ===
    "SH.H2O.BASW.ZS":          "Access to basic drinking water services (%)",
    "SH.STA.BASS.ZS":          "Access to basic sanitation services (%)",
    "SH.STA.ODFC.ZS":          "Open defecation prevalence (% of population)",
    "SH.H2O.SMDW.ZS":          "Access to safely managed drinking water (%)",
    "SH.STA.SMSS.ZS":          "Access to safely managed sanitation (%)",

    # === REPRODUCTIVE & MATERNAL HEALTH ===
    "SH.FPL.SATM.ZS":          "Met need for contraception (% married women 15-49)",
    "SP.DYN.TFRT.IN":          "Fertility rate (births per woman)",
    "SP.ADO.TFRT":             "Adolescent fertility rate (per 1,000 women 15-19)",

    # === MACROECONOMIC ===
    "NY.GDP.MKTP.CD":          "GDP (current USD)",
    "NY.GDP.MKTP.KD.ZG":       "GDP growth (annual %)",
    "NY.GDP.PCAP.CD":          "GDP per capita (current USD)",
    "NY.GDP.PCAP.PP.CD":       "GDP per capita, PPP (current international $)",
    "GC.REV.XGRT.GD.ZS":       "Govt revenue, excl. grants (% of GDP)",
    "GC.XPN.TOTL.GD.ZS":       "Govt expense (% of GDP)",
    "GC.TAX.TOTL.GD.ZS":       "Tax revenue (% of GDP)",
    "GC.DOD.TOTL.GD.ZS":       "Central govt debt, total (% of GDP)",
    "FP.CPI.TOTL.ZG":          "Inflation, consumer prices (annual %)",
    "DT.ODA.ALLD.CD":          "Net ODA and official aid received (current USD)",
    "BX.KLT.DINV.CD.WD":       "FDI net inflows (current USD)",
    # === DEBT & FISCAL SPACE ===
    "DT.TDS.DECT.GN.ZS":       "Debt service (% of GNI)",
    "DT.DOD.DECT.GD.ZS":       "External debt stocks, total (% of GDP)",
    "DT.DOD.DECT.CD":          "External debt stocks, total (current USD)",

    # === DEMOGRAPHICS ===
    "SP.POP.TOTL":             "Population, total",
    "SP.URB.TOTL.IN.ZS":       "Urban population (% of total)",
    "SP.POP.65UP.TO.ZS":       "Population 65+ (% of total)",
    "SP.POP.0014.TO.ZS":       "Population 0-14 (% of total)",
    "SI.POV.DDAY":             "Poverty headcount ratio at $2.15/day (% of population)",
    "SI.POV.GINI":             "Gini index (income inequality)",
}

# ─────────────────────────────────────────────
# WHO GLOBAL HEALTH OBSERVATORY (GHO)
# OData API — free, no auth required
# Docs: https://www.who.int/data/gho/info/gho-odata-api
# API base: https://ghoapi.azureedge.net/api/
# ─────────────────────────────────────────────
WHO_GHO_INDICATORS = {

    # === UHC ===
    "UHC_INDEX_REPORTED":           "UHC Service Coverage Index",
    "UHC_SCI_RMNCH":                "UHC — RMNCH sub-index",
    "UHC_SCI_INFECT":               "UHC — Infectious disease sub-index",
    "UHC_SCI_NCD":                  "UHC — NCD sub-index",
    "UHC_SCI_CAPSP":                "UHC — Health system capacity sub-index",

    # === MORTALITY & LIFE EXPECTANCY ===
    "WHOSIS_000001":                "Life expectancy at birth (years)",
    "WHOSIS_000015":                "Healthy life expectancy (HALE) at birth",
    "MDG_0000000001":               "Under-5 mortality rate (per 1,000 live births)",
    "MDG_0000000026":               "Neonatal mortality rate (per 1,000 live births)",
    "MORT_MATERNALNUM":             "Maternal deaths (number)",

    # === NON-COMMUNICABLE DISEASES ===
    "NCD_CCS_Hypertension":         "Raised blood pressure prevalence (18+)",
    "NCD_GLUC_04":                  "Raised blood glucose / diabetes (18+)",
    "NCD_BMI_30A":                  "Obesity prevalence, adults (age-standardised)",
    "NCD_PAC_A":                    "Physical inactivity prevalence, adults",
    "SDGNTD":                       "NTD — people requiring interventions",
    "SDGSUICIDE":                   "Crude suicide rate (per 100,000)",

    # === MENTAL HEALTH ===
    "SA_0000001688":                "Alcohol use disorders (15+, %)",
    "MH_12":                        "Mental health outpatient rate (per 100,000)",

    # === HEALTH WORKFORCE ===
    "HWF_0001":                     "Medical doctors (per 10,000 population)",
    "HWF_0006":                     "Nursing and midwifery personnel (per 10,000 population)",
    "HWF_0007":                     "Nursing and midwifery personnel (total number)",
    "HWF_0004":                     "Dentists (per 10,000 population)",

    # === MATERNAL & REPRODUCTIVE ===
    "WHS4_100":                     "Antenatal care coverage (at least 1 visit, %)",
    "WHS4_154":                     "Antenatal care coverage (≥4 visits, %)",
    "WHS4_544":                     "Polio (Pol3) immunisation coverage among 1-year-olds (%)",
    "MDG_0000000025":               "Births attended by skilled health personnel (%)",
    "WHS4_543":                     "Births attended by skilled health personnel (%, alt series)",
    "FP_CXALLFP":                   "Contraceptive prevalence rate (%)",

    # === HIV / AIDS ===
    "MDG_0000000020":               "HIV incidence rate (per 1,000 uninfected)",
    "HIV_0000000006":               "HIV-related deaths (number)",

    # === TUBERCULOSIS ===
    "MDG_0000000017":               "TB deaths excl. HIV (per 100,000)",

    # === MALARIA ===
    "MALARIA_EST_CASES":            "Estimated malaria cases (number)",
    "MALARIA_EST_DEATHS":           "Estimated malaria deaths (number)",
    "MALARIA_EST_INCIDENCE":        "Estimated malaria incidence (per 1,000 at risk)",
    "MALARIA_EST_MORTALITY":        "Estimated malaria mortality rate (per 100,000)",
    "MALARIA_ITN_COVERAGE":         "Population with access to ITN for malaria (%)",

    # === IMMUNISATION ===
    # Removed — replaced by WUENIC (see WUENIC_INDICATORS). WHO GHO exposes
    # only a subset of WUENIC antigens; the canonical WUENIC workbook covers
    # 16 antigens back to 1997.

    # === HEALTH FINANCING (GHED via GHO — replaces manual Excel download) ===
    "GHED_CHE_pc_US_SHA2011":       "Current health expenditure per capita (USD)",
    "GHED_CHEGDP_SHA2011":          "Current health expenditure (% of GDP)",
    "GHED_GGHE-D_pc_US_SHA2011":    "Domestic govt health expenditure per capita (USD)",
    "GHED_GGHE-DGDP_SHA2011":       "Domestic govt health expenditure (% of GDP)",
    "GHED_GGHE-DCHE_SHA2011":       "Domestic govt health expenditure (% of CHE)",
    "GHED_GGHE-DGGE_SHA2011":       "Domestic govt health expenditure (% of GGE)",
    "GHED_OOP_pc_US_SHA2011":       "Out-of-pocket expenditure per capita (USD)",
    "GHED_OOPSCHE_SHA2011":         "Out-of-pocket expenditure (% of CHE)",
    "GHED_EXT_pc_US_SHA2011":       "External health expenditure per capita (USD)",
    "GHED_EXTCHE_SHA2011":          "External health expenditure (% of CHE)",
    "GHED_PVT-D_pc_US_SHA2011":     "Domestic private health expenditure per capita (USD)",
    "GHED_PVT-DCHE_SHA2011":        "Domestic private health expenditure (% of CHE)",
    "GHED_PHC_pc_US_SHA2011":       "Primary health care expenditure per capita (USD)",
    "GHED_PHC_GGHE-D_PHC_SHA2011":  "Govt PHC expenditure (% of PHC expenditure)",
}

# ─────────────────────────────────────────────
# IMF DATAMAPPER API
# Free, no auth required
# Docs: https://www.imf.org/external/datamapper/api/v1/
# ─────────────────────────────────────────────
IMF_BASE_URL = "https://www.imf.org/external/datamapper/api/v1"

# The DataMapper API returns forward projections (WEO horizon). Historical
# actuals (year <= END_YEAR) go into the master panel; projection years up to
# this bound are saved separately to data/processed/imf_projections.parquet for
# the fiscal-space scenario / outlook charts. Set to None to disable.
IMF_PROJECTION_END_YEAR = 2030

IMF_INDICATORS = {
    "NGDP_RPCH":       "GDP growth (annual %)",
    "NGDPD":           "GDP, current prices (USD billions)",
    "NGDPDPC":         "GDP per capita, current prices (USD)",
    "PPPGDP":          "GDP, PPP (current international $ billions)",
    "PPPPC":           "GDP per capita, PPP (current international $)",
    "GGR_NGDP":        "Govt revenue (% of GDP)",
    "GGX_NGDP":        "Govt total expenditure (% of GDP)",
    "GGXCNL_NGDP":     "Govt net lending/borrowing (% of GDP)",
    "GGXWDG_NGDP":     "Govt gross debt (% of GDP)",
    "GGXONLB_NGDP":    "Govt primary net lending (% of GDP)",
    "BCA_NGDPD":        "Current account balance (% of GDP)",
    "PCPIPCH":         "Inflation, average consumer prices (annual %)",
    "LUR":             "Unemployment rate (%)",
    "LP":              "Population (millions)",
}

# ─────────────────────────────────────────────
# WHO IMMUNIZATION FINANCING (JRF Excel)
# Published annually by WHO/UNICEF Joint Reporting Form
# URL updated October 2025
# ─────────────────────────────────────────────
WHO_IMMUNIZATION_URL = (
    "https://cdn.who.int/media/docs/default-source/immunization/financing/"
    "reviewed-jrf-reported-expenditure-data-on-vaccines---october-2025.xlsx"
    "?sfvrsn=e6140e00_4"
)

WHO_IMMUNIZATION_INDICATORS = {
    "WHO_IMM_GOV_VAX_USD": "Govt vaccine expenditure (current USD)",
    "WHO_IMM_TOT_VAX_USD": "Total vaccine expenditure (current USD)",
    "WHO_IMM_GOV_SHARE":   "Govt share of vaccine expenditure (proportion, 0–1)",
}

# ─────────────────────────────────────────────
# WUENIC — WHO/UNICEF Estimates of National Immunization Coverage
# Published annually in July. Canonical source for vaccine coverage
# (what World Bank SH.IMM.* and WHO GHO WHS8_110/MCV2/PCV3/ROTAC repackage).
# Single Excel workbook, long-format sheet 'wuenic_master'.
# Coverage: 194 countries, 1997–latest, 16 antigens.
# ─────────────────────────────────────────────
WUENIC_URL = "https://cdn.who.int/media/docs/default-source/immunization/wuenic_input_to_pdf.xlsx"

# Map of source Vaccine value (from the 'Vaccine' column) → (indicator_code, name)
WUENIC_INDICATORS: dict[str, tuple[str, str]] = {
    "BCG":   ("WUENIC_BCG",    "BCG immunisation coverage (%)"),
    "DTP1":  ("WUENIC_DTP1",   "DTP1 immunisation coverage (%)"),
    "DTP3":  ("WUENIC_DTP3",   "DTP3 immunisation coverage (%)"),
    "Pol3":  ("WUENIC_POL3",   "Polio (Pol3) immunisation coverage (%)"),
    "MCV1":  ("WUENIC_MCV1",   "Measles first-dose (MCV1) coverage (%)"),
    "MCV2":  ("WUENIC_MCV2",   "Measles second-dose (MCV2) coverage (%)"),
    "HepB3": ("WUENIC_HEPB3",  "Hepatitis B 3rd dose (HepB3) coverage (%)"),
    "HepBB": ("WUENIC_HEPBB",  "Hepatitis B birth-dose (HepB_BD) coverage (%)"),
    "Hib3":  ("WUENIC_HIB3",   "Haemophilus influenzae type b (Hib3) coverage (%)"),
    "PCV3":  ("WUENIC_PCV3",   "Pneumococcal conjugate vaccine (PCV3) coverage (%)"),
    "RotaC": ("WUENIC_ROTAC",  "Rotavirus final-dose coverage (%)"),
    "IPV1":  ("WUENIC_IPV1",   "Inactivated polio vaccine 1st dose (IPV1) coverage (%)"),
    "IPV2":  ("WUENIC_IPV2",   "Inactivated polio vaccine 2nd dose (IPV2) coverage (%)"),
    "RCV1":  ("WUENIC_RCV1",   "Rubella-containing vaccine 1st dose (RCV1) coverage (%)"),
    "YFV":   ("WUENIC_YFV",    "Yellow fever vaccine coverage (%)"),
    "MENGA": ("WUENIC_MENGA",  "Meningitis A vaccine coverage (%)"),
}

# ─────────────────────────────────────────────
# GLOBAL FUND ODATA API
# Free, no auth required
# Docs: https://data-service.theglobalfund.org/
# ─────────────────────────────────────────────
GLOBAL_FUND_BASE_URL = "https://fetch.theglobalfund.org/v3.3/odata"

# Disease components pulled from Global Fund grants
GLOBAL_FUND_DISEASES = ["HIV", "Tuberculosis", "Malaria", "RSSH", "Multicomponent"]

# ─────────────────────────────────────────────
# UNAIDS — AIDSinfo GAM & Estimates data
# Manual download — no public API
#
# HOW TO DOWNLOAD:
#   1. Go to https://aidsinfo.unaids.org/dataset
#   2. Download "Estimates Data" ZIP  → extract CSV(s) into data/manual_downloads/unaids/
#   3. Download "GAM Data" ZIP        → extract CSV(s) into the same folder
#
# The pipeline will auto-detect and parse any CSV found in that directory.
# ─────────────────────────────────────────────
UNAIDS_DIR = os.path.join(MANUAL_DIR, "unaids")

# AIDSinfo bulk download URLs — updated annually (pattern: year suffix in filename).
# The pipeline tries the current year first, then falls back one year.
# Update UNAIDS_LATEST_YEAR if UNAIDS releases a new edition.
UNAIDS_LATEST_YEAR = 2025
UNAIDS_ESTIMATES_URL = "https://aidsinfo.unaids.org/public/documents/Estimates_{year}_en.zip"
UNAIDS_GAM_URL       = "https://aidsinfo.unaids.org/public/documents/GAM_{year}_en.zip"

# Maps UNAIDS indicator display names (as they appear in the CSV) →
# (indicator_code, human-readable name).
# Any indicator not listed here gets an auto-generated UNAIDS_<SLUG> code.
# Maps UNAIDS indicator display names (from the Indicator column) →
# (indicator_code, human-readable name).
# Names are taken verbatim from the AIDSinfo 2025 CSV exports.
UNAIDS_INDICATORS: dict[str, tuple[str, str]] = {
    # ── Epidemiology (Estimates file) ─────────────────────────────────────────
    "People living with HIV":
        ("UNAIDS_PLHIV",            "People living with HIV (number)"),
    "New HIV Infections":
        ("UNAIDS_NEW_INFECTIONS",   "New HIV infections (number)"),
    "AIDS-related deaths":
        ("UNAIDS_AIDS_DEATHS",      "AIDS-related deaths (number)"),
    "HIV Prevalence":
        ("UNAIDS_PREVALENCE_ADULTS","HIV prevalence, adults 15–49 (%)"),
    "HIV Incidence per 1000 population":
        ("UNAIDS_INCIDENCE_RATE",   "HIV incidence rate (per 1,000 population)"),

    # ── 95-95-95 treatment cascade (Estimates file) ───────────────────────────
    "Percent of people living with HIV who know their status":
        ("UNAIDS_95_DIAGNOSED",     "PLHIV who know their status (%)"),
    "Percent of people who know their status who are on ART":
        ("UNAIDS_95_ON_ART",        "Diagnosed PLHIV on ART (%)"),
    "Percent of people on ART who achieve viral suppression":
        ("UNAIDS_95_SUPPRESSED",    "PLHIV on ART with viral suppression (%)"),

    # ── PMTCT (Estimates file) ────────────────────────────────────────────────
    "Coverage of pregnant women who receive ARV for preventing MTCT":
        ("UNAIDS_PMTCT",            "PMTCT — ART coverage for pregnant women (%)"),

    # ── ART coverage (Estimates file) ─────────────────────────────────────────
    "Coverage of people living with HIV receiving ART":
        ("UNAIDS_ART_COVERAGE",     "ART coverage — people living with HIV (%)"),
}

# GAM 'Country-reported HIV expenditure by funding source' indicator:
# subgroup values map to distinct indicator codes.
UNAIDS_FINANCE_SUBGROUPS: dict[str, tuple[str, str]] = {
    "Total":
        ("UNAIDS_FIN_TOTAL",         "Total HIV financing (USD)"),
    "Domestic (Public and Private)":
        ("UNAIDS_FIN_DOMESTIC_ALL",  "Total domestic HIV financing (USD)"),
    "Domestic Public":
        ("UNAIDS_FIN_DOMESTIC_GOV",  "Domestic government HIV financing (USD)"),
    "Domestic Private":
        ("UNAIDS_FIN_DOMESTIC_PRIV", "Domestic private HIV financing (USD)"),
    "International":
        ("UNAIDS_FIN_INTERNATIONAL", "International HIV financing received (USD)"),
    "Global Fund":
        ("UNAIDS_FIN_GLOBAL_FUND",   "HIV financing from Global Fund (USD)"),
    "PEPFAR":
        ("UNAIDS_FIN_PEPFAR",        "HIV financing from PEPFAR (USD)"),
    "United States (bilateral)":
        ("UNAIDS_FIN_US_BILATERAL",  "US bilateral HIV financing (USD)"),
    "Other international":
        ("UNAIDS_FIN_OTHER_INTL",    "Other international HIV financing (USD)"),
}
