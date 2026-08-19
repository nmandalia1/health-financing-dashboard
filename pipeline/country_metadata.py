"""
country_metadata.py — Build a comprehensive country characteristics lookup table.

Produces one row per country with attributes useful for:
  - Filtering / grouping by region, income, or programmatic cluster
  - Overlaying eligibility / vulnerability classifications on indicators
  - Identifying priority populations in health financing analysis

Attributes captured
───────────────────
  iso3                ISO 3166-1 alpha-3 code (primary key)
  iso2                ISO 3166-1 alpha-2 code (for flag display)
  country_name        English name (World Bank preferred)

  World Bank (fetched live via wbgapi)
  ─────────────────────────────────────
  wb_region_code      e.g. "SSF"
  wb_region           e.g. "Sub-Saharan Africa"
  wb_income_code      e.g. "LIC"
  wb_income_group     e.g. "Low income"
  wb_lending_type     IDA / IBRD / Blend / Not classified
  capital_city        Capital city name
  latitude / longitude

  WHO (static map — 6 WHO regional offices)
  ──────────────────────────────────────────
  who_region          AFR / AMR / SEAR / EUR / EMR / WPR
  who_region_name     Full region name

  UNICEF (static map — 7 UNICEF programmatic regional offices)
  ─────────────────────────────────────────────────────────────
  unicef_region       EAPR / ESAR / ECAR / LACR / MENA / SAR / WCAR
  unicef_region_name  Full regional office name

  Gavi eligibility (extracted from cached WHO immunization Excel)
  ───────────────────────────────────────────────────────────────
  gavi_status         Raw JRF tier string (e.g. "Initial self-financing (fragile)")
  gavi_phase          Simplified phase: "Eligible" / "Transitioning" / "Graduated" / "Not eligible"
  gavi_is_eligible    True if country currently receives Gavi support

  UN special country groups (static — UN OHRLLS, updated 2024-01)
  ────────────────────────────────────────────────────────────────
  is_ldc              Least Developed Country  (44 countries)
  is_lldc             Landlocked Developing Country (32 countries)
  is_sids             Small Island Developing State (39 countries)

  World Bank Fragile & Conflict Situations (current context)
  ───────────────────────────────────────────────────────────
  fcv_current         True if on the WB FY2026 harmonized FCV list
  fcv_vintage         Classification vintage ("FY2026")
  fcv_reference_year  Calendar reference year (2025)
  is_fcs              Deprecated compatibility alias of fcv_current

  IMF Debt Sustainability Analysis (static — IMF DSA 2024, PRGT-eligible countries only)
  ───────────────────────────────────────────────────────────────────────────────────────
  dsa_risk_rating     "Low" / "Moderate" / "High" / "In Debt Distress" / "" (not rated)
  dsa_is_high_risk    True if "High" or "In Debt Distress"

  Derived boolean flags
  ─────────────────────
  is_lmic             True if LIC or LMC income group
  is_ssa              True if Sub-Saharan Africa (WB region SSF)
  is_ida              True if IDA-eligible (lending type IDX or IDB)

  pulled_at           UTC timestamp when metadata was fetched

Data sources
────────────
  World Bank     wbgapi (live), https://datahelpdesk.worldbank.org/knowledgebase/articles/906519
  WHO regions    https://www.who.int/countries  (static, rarely changes)
  UNICEF regions https://www.unicef.org/about-unicef/regional-offices  (static)
  Gavi           WHO JRF Excel, extracted from cached who_immunization data
  LDC list       https://www.un.org/development/desa/dpad/ldc-information/ldc-list.html  (2024-01)
  LLDC list      https://www.un.org/ohrlls/content/about-landlocked-developing-countries  (2024-01)
  SIDS list      https://www.un.org/ohrlls/content/list-sids  (2024-01)
  FCV list       https://www.worldbank.org/en/topic/fragilityconflictviolence/brief/harmonized-list-of-fragile-situations  (FY2026)
  IMF DSA        https://www.imf.org/en/Publications/DSA  (2024 ratings for PRGT-eligible countries)
"""

from __future__ import annotations

import logging
from pathlib import Path

import pandas as pd
import pycountry
import requests

from .config import PROCESSED_DIR, RAW_DIR
from .utils import now_utc, save_reference
from .wgi import FCV_CURRENT_ISO3, FCV_REFERENCE_YEAR, FCV_VINTAGE

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# WHO REGIONAL OFFICES  (static — 6 regions, 194 member states)
# Source: https://www.who.int/countries
# Last reviewed: 2024-01
# ═══════════════════════════════════════════════════════════════════════════════
WHO_REGION_MAP: dict[str, str] = {
    # AFR — African Region (47 member states)
    **{c: "AFR" for c in [
        "AGO", "BEN", "BWA", "BFA", "BDI", "CMR", "CPV", "CAF", "TCD", "COM",
        "COD", "COG", "CIV", "GNQ", "ERI", "SWZ", "ETH", "GAB", "GMB", "GHA",
        "GIN", "GNB", "KEN", "LSO", "LBR", "MDG", "MWI", "MLI", "MRT", "MUS",
        "MOZ", "NAM", "NER", "NGA", "RWA", "STP", "SEN", "SLE", "ZAF", "SSD",
        "TZA", "TGO", "UGA", "ZMB", "ZWE", "SYC",
    ]},
    # AMR — Region of the Americas (35 member states)
    **{c: "AMR" for c in [
        "ATG", "ARG", "BHS", "BRB", "BLZ", "BOL", "BRA", "CAN", "CHL", "COL",
        "CRI", "CUB", "DMA", "DOM", "ECU", "SLV", "GRD", "GTM", "GUY", "HTI",
        "HND", "JAM", "MEX", "NIC", "PAN", "PRY", "PER", "KNA", "LCA", "VCT",
        "SUR", "TTO", "USA", "URY", "VEN",
    ]},
    # SEAR — South-East Asia Region (11 member states)
    **{c: "SEAR" for c in [
        "BGD", "BTN", "PRK", "IND", "IDN", "MDV", "MMR", "NPL", "LKA", "THA", "TLS",
    ]},
    # EUR — European Region (53 member states)
    **{c: "EUR" for c in [
        "ALB", "AND", "ARM", "AUT", "AZE", "BLR", "BEL", "BIH", "BGR", "HRV",
        "CYP", "CZE", "DNK", "EST", "FIN", "FRA", "GEO", "DEU", "GRC", "HUN",
        "ISL", "IRL", "ISR", "ITA", "KAZ", "KGZ", "LVA", "LTU", "LUX", "MLT",
        "MDA", "MCO", "MNE", "NLD", "MKD", "NOR", "POL", "PRT", "ROU", "RUS",
        "SMR", "SRB", "SVK", "SVN", "ESP", "SWE", "CHE", "TJK", "TUR", "TKM",
        "UKR", "GBR", "UZB",
    ]},
    # EMR — Eastern Mediterranean Region (22 member states)
    **{c: "EMR" for c in [
        "AFG", "BHR", "DJI", "EGY", "IRN", "IRQ", "JOR", "KWT", "LBN", "LBY",
        "MAR", "OMN", "PAK", "QAT", "SAU", "SOM", "SDN", "SYR", "TUN", "ARE",
        "YEM", "PSE",
    ]},
    # WPR — Western Pacific Region (37 member states)
    **{c: "WPR" for c in [
        "AUS", "BRN", "KHM", "CHN", "COK", "FJI", "JPN", "KIR", "LAO", "MYS",
        "MHL", "FSM", "MNG", "NRU", "NZL", "NIU", "PLW", "PNG", "PHL", "WSM",
        "SGP", "SLB", "KOR", "TKL", "TON", "TUV", "VUT", "VNM",
    ]},
}

WHO_REGION_NAMES: dict[str, str] = {
    "AFR":  "African Region",
    "AMR":  "Region of the Americas",
    "SEAR": "South-East Asia Region",
    "EUR":  "European Region",
    "EMR":  "Eastern Mediterranean Region",
    "WPR":  "Western Pacific Region",
}


# ═══════════════════════════════════════════════════════════════════════════════
# UNICEF PROGRAMMATIC REGIONAL OFFICES  (static — 7 regional offices)
# Source: https://www.unicef.org/about-unicef/regional-offices
# Note: covers ~145 programme countries; high-income non-programme countries
#       are left blank.
# Last reviewed: 2024-01
# ═══════════════════════════════════════════════════════════════════════════════
UNICEF_REGION_MAP: dict[str, str] = {
    # EAPR — East Asia and Pacific Regional Office (Bangkok)
    **{c: "EAPR" for c in [
        "KHM", "CHN", "COK", "PRK", "FJI", "IDN", "KIR", "LAO", "MYS", "MHL",
        "FSM", "MNG", "MMR", "NRU", "NIU", "PLW", "PNG", "PHL", "WSM", "SGP",
        "SLB", "THA", "TLS", "TKL", "TON", "TUV", "VUT", "VNM",
    ]},
    # ESAR — Eastern and Southern Africa Regional Office (Nairobi)
    **{c: "ESAR" for c in [
        "AGO", "BWA", "BDI", "COM", "ERI", "ETH", "KEN", "LSO", "MDG", "MWI",
        "MUS", "MOZ", "NAM", "RWA", "SYC", "SOM", "ZAF", "SSD", "SWZ", "TZA",
        "UGA", "ZMB", "ZWE",
    ]},
    # ECAR — Europe and Central Asia Regional Office (Geneva)
    **{c: "ECAR" for c in [
        "ALB", "ARM", "AZE", "BLR", "BIH", "GEO", "KAZ", "XKX", "KGZ", "MDA",
        "MNE", "MKD", "ROU", "RUS", "SRB", "TJK", "TUR", "TKM", "UKR", "UZB",
    ]},
    # LACR — Latin America and Caribbean Regional Office (Panama City)
    **{c: "LACR" for c in [
        "ATG", "ARG", "BHS", "BRB", "BLZ", "BOL", "BRA", "CHL", "COL", "CRI",
        "CUB", "DMA", "DOM", "ECU", "SLV", "GRD", "GTM", "GUY", "HTI", "HND",
        "JAM", "MEX", "NIC", "PAN", "PRY", "PER", "KNA", "LCA", "VCT", "SUR",
        "TTO", "URY", "VEN",
    ]},
    # MENA — Middle East and North Africa Regional Office (Amman)
    **{c: "MENA" for c in [
        "DZA", "BHR", "DJI", "EGY", "IRN", "IRQ", "JOR", "KWT", "LBN", "LBY",
        "MAR", "OMN", "PAK", "QAT", "SAU", "SDN", "SYR", "TUN", "ARE", "YEM",
        "PSE",
    ]},
    # SAR — South Asia Regional Office (Kathmandu)
    **{c: "SAR" for c in [
        "AFG", "BGD", "BTN", "IND", "MDV", "NPL", "LKA",
    ]},
    # WCAR — West and Central Africa Regional Office (Dakar)
    **{c: "WCAR" for c in [
        "BEN", "BFA", "CPV", "CMR", "CAF", "TCD", "COD", "COG", "CIV", "GNQ",
        "GAB", "GMB", "GHA", "GIN", "GNB", "LBR", "MLI", "MRT", "NER", "NGA",
        "STP", "SEN", "SLE", "TGO",
    ]},
}

UNICEF_REGION_NAMES: dict[str, str] = {
    "EAPR": "East Asia and Pacific",
    "ESAR": "Eastern and Southern Africa",
    "ECAR": "Europe and Central Asia",
    "LACR": "Latin America and Caribbean",
    "MENA": "Middle East and North Africa",
    "SAR":  "South Asia",
    "WCAR": "West and Central Africa",
}


# ═══════════════════════════════════════════════════════════════════════════════
# UN SPECIAL COUNTRY GROUPS  (static)
# Source: UN OHRLLS (https://www.un.org/ohrlls/)
# LDC / LLDC last reviewed: 2024-01  |  SIDS: 2024-01
# ═══════════════════════════════════════════════════════════════════════════════

# LDC — 44 Least Developed Countries (UN General Assembly resolution A/RES/78/230, Dec 2023)
LDC_ISO3: frozenset[str] = frozenset({
    "AFG", "AGO", "BGD", "BEN", "BTN", "BFA", "BDI", "KHM", "CAF", "TCD",
    "COM", "COD", "DJI", "ERI", "ETH", "GMB", "GIN", "GNB", "HTI", "KIR",
    "LAO", "LSO", "LBR", "MDG", "MWI", "MLI", "MRT", "MOZ", "MMR", "NPL",
    "NER", "RWA", "STP", "SEN", "SLE", "SLB", "SOM", "SSD", "SDN", "TLS",
    "TGO", "TUV", "UGA", "TZA", "YEM", "ZMB",
})

# LLDC — 32 Landlocked Developing Countries (UN OHRLLS)
LLDC_ISO3: frozenset[str] = frozenset({
    "AFG", "ARM", "AZE", "BTN", "BOL", "BWA", "BFA", "BDI", "CAF", "TCD",
    "SWZ", "ETH", "KAZ", "XKX", "KGZ", "LAO", "LSO", "MWI", "MLI", "MDA",
    "MNG", "NPL", "NER", "MKD", "PRY", "RWA", "SSD", "TJK", "TKM", "UGA",
    "UZB", "ZMB", "ZWE",
})

# SIDS — 39 Small Island Developing States (UN OHRLLS + AOSIS members)
SIDS_ISO3: frozenset[str] = frozenset({
    "ATG", "BHS", "BHR", "BRB", "BLZ", "CPV", "COM", "COK", "CUB", "DMA",
    "DOM", "FJI", "GRD", "GNB", "GUY", "HTI", "JAM", "KIR", "MDV", "MHL",
    "MUS", "FSM", "NRU", "NIU", "PLW", "PNG", "WSM", "STP", "SYC", "SGP",
    "SLB", "KNA", "LCA", "VCT", "SUR", "TLS", "TON", "TTO", "TUV", "VUT",
})


# Backwards-compatible name for code that imports this constant. New code
# should use FCV_CURRENT_ISO3 and must treat it as current context, not history.
FCS_ISO3: frozenset[str] = FCV_CURRENT_ISO3


# ═══════════════════════════════════════════════════════════════════════════════
# IMF DEBT SUSTAINABILITY ANALYSIS (DSA) RISK RATINGS  (static)
# Applies to PRGT-eligible (low-income) countries only.
# Source: IMF List of LIC DSAs for PRGT-Eligible Countries
# https://www.imf.org/en/Publications/DSA
# Last reviewed: 2024-04 (reflects April 2024 IMF/World Bank Spring Meetings)
# High-income and most upper-middle-income countries are not rated ("").
# ═══════════════════════════════════════════════════════════════════════════════
DSA_RISK_RATINGS: dict[str, str] = {
    # ── In Debt Distress ────────────────────────────────────────────────────
    "TCD": "In Debt Distress",   # Chad
    "ERI": "In Debt Distress",   # Eritrea
    "ETH": "In Debt Distress",   # Ethiopia (debt restructuring ongoing)
    "GHA": "In Debt Distress",   # Ghana (debt restructuring ongoing)
    "MOZ": "In Debt Distress",   # Mozambique (debt restructuring ongoing)
    "SOM": "In Debt Distress",   # Somalia
    "SDN": "In Debt Distress",   # Sudan
    "ZMB": "In Debt Distress",   # Zambia (debt restructuring ongoing)
    "ZWE": "In Debt Distress",   # Zimbabwe

    # ── High Risk ────────────────────────────────────────────────────────────
    "BDI": "High",   # Burundi
    "CMR": "High",   # Cameroon
    "CAF": "High",   # Central African Republic
    "COM": "High",   # Comoros
    "COG": "High",   # Congo, Republic
    "COD": "High",   # DR Congo
    "DJI": "High",   # Djibouti
    "GNB": "High",   # Guinea-Bissau
    "HTI": "High",   # Haiti
    "KIR": "High",   # Kiribati
    "KGZ": "High",   # Kyrgyz Republic
    "LAO": "High",   # Lao PDR
    "LBR": "High",   # Liberia
    "MDG": "High",   # Madagascar
    "MWI": "High",   # Malawi
    "MLI": "High",   # Mali
    "MHL": "High",   # Marshall Islands
    "MRT": "High",   # Mauritania
    "FSM": "High",   # Micronesia
    "MMR": "High",   # Myanmar
    "NIC": "High",   # Nicaragua
    "NER": "High",   # Niger
    "PNG": "High",   # Papua New Guinea
    "STP": "High",   # São Tomé and Príncipe
    "SLE": "High",   # Sierra Leone
    "TJK": "High",   # Tajikistan
    "TON": "High",   # Tonga
    "TUV": "High",   # Tuvalu
    "YEM": "High",   # Yemen

    # ── Moderate Risk ────────────────────────────────────────────────────────
    "AFG": "Moderate",   # Afghanistan
    "BGD": "Moderate",   # Bangladesh
    "BEN": "Moderate",   # Benin
    "BTN": "Moderate",   # Bhutan
    "BOL": "Moderate",   # Bolivia
    "CPV": "Moderate",   # Cabo Verde
    "KHM": "Moderate",   # Cambodia
    "DMA": "Moderate",   # Dominica
    "GMB": "Moderate",   # Gambia
    "GEO": "Moderate",   # Georgia
    "GIN": "Moderate",   # Guinea
    "HND": "Moderate",   # Honduras
    "KEN": "Moderate",   # Kenya
    "XKX": "Moderate",   # Kosovo
    "LSO": "Moderate",   # Lesotho
    "MDV": "Moderate",   # Maldives
    "MNG": "Moderate",   # Mongolia
    "NPL": "Moderate",   # Nepal
    "NGA": "Moderate",   # Nigeria
    "RWA": "Moderate",   # Rwanda
    "SEN": "Moderate",   # Senegal
    "SLB": "Moderate",   # Solomon Islands
    "LKA": "Moderate",   # Sri Lanka
    "TZA": "Moderate",   # Tanzania
    "TLS": "Moderate",   # Timor-Leste
    "UGA": "Moderate",   # Uganda
    "UZB": "Moderate",   # Uzbekistan
    "VUT": "Moderate",   # Vanuatu

    # ── Low Risk ─────────────────────────────────────────────────────────────
    "ARM": "Low",   # Armenia
    "AZE": "Low",   # Azerbaijan
    "BFA": "Low",   # Burkina Faso
    "CIV": "Low",   # Côte d'Ivoire
    "EGY": "Low",   # Egypt
    "SLV": "Low",   # El Salvador
    "FJI": "Low",   # Fiji
    "GUY": "Low",   # Guyana
    "IND": "Low",   # India
    "IDN": "Low",   # Indonesia
    "JOR": "Low",   # Jordan
    "MDA": "Low",   # Moldova
    "MAR": "Low",   # Morocco
    "PHL": "Low",   # Philippines
    "WSM": "Low",   # Samoa
    "TUN": "Low",   # Tunisia
    "VNM": "Low",   # Viet Nam
    "PSE": "Low",   # West Bank and Gaza
}

# Colour-coded ordering for charts: In Debt Distress > High > Moderate > Low > ""
DSA_RISK_ORDER: list[str] = ["In Debt Distress", "High", "Moderate", "Low", ""]


# ═══════════════════════════════════════════════════════════════════════════════
# WORLD BANK METADATA  (reference dicts for offline fallback)
# ═══════════════════════════════════════════════════════════════════════════════
WB_REGION_NAMES: dict[str, str] = {
    "EAS": "East Asia & Pacific",
    "ECS": "Europe & Central Asia",
    "LCN": "Latin America & Caribbean",
    "MEA": "Middle East & North Africa",
    "NAC": "North America",
    "SAS": "South Asia",
    "SSF": "Sub-Saharan Africa",
}

WB_INCOME_NAMES: dict[str, str] = {
    "HIC": "High income",
    "UMC": "Upper middle income",
    "LMC": "Lower middle income",
    "LIC": "Low income",
    "INX": "Not classified",
}


# ═══════════════════════════════════════════════════════════════════════════════
# GAVI ELIGIBILITY  (derived from cached WHO immunization Excel)
# ═══════════════════════════════════════════════════════════════════════════════

def _load_gavi_eligibility() -> dict[str, str]:
    """
    Extract the most recent Gavi eligibility tier per country from the cached
    WHO JRF immunization Excel.  Returns {iso3: raw_tier_string}.
    Falls back to an empty dict gracefully if the cache file is missing.
    """
    cache_path = Path(RAW_DIR) / "who_immunization" / "jrf_vaccine_expenditure.xlsx"
    if not cache_path.exists():
        logger.warning(
            "WHO immunization Excel not found at %s — Gavi status will be empty. "
            "Run fetch_who_immunization() first.", cache_path,
        )
        return {}

    try:
        df = pd.read_excel(cache_path, sheet_name="Government vaccine expenditure", header=None)
        # Row 0 is the header; row 1+ is data
        # Columns: country(0), iso(1), report(2), region(3), income/gavi_tier(4)
        data = df.iloc[1:].copy()
        data.columns = df.iloc[0].tolist()
        result: dict[str, str] = {}
        for _, row in data.iterrows():
            iso3 = str(row.get("iso", "")).strip()
            tier = str(row.get("income", "")).strip()
            if iso3 and len(iso3) == 3 and iso3.isalpha() and tier and tier != "nan":
                result[iso3] = tier
        logger.info("Loaded Gavi eligibility for %d countries", len(result))
        return result
    except Exception as exc:
        logger.warning("Could not load Gavi eligibility from Excel: %s", exc)
        return {}


def _simplify_gavi_phase(raw: str) -> str:
    """
    Map the verbose JRF tier string to a simplified 4-value phase label.

      Eligible        — country currently receives Gavi support
      Transitioning   — country in a transition/accelerated co-financing phase
      Graduated       — country has graduated (former Gavi recipient, now self-financing)
      Not eligible    — never eligible or ineligible by income
    """
    if not raw:
        return ""
    r = raw.lower()
    if "not eligible" in r or "not eligible (former)" in r:
        return "Not eligible"
    if "former" in r or "never" in r:
        return "Graduated"
    if "transition" in r:
        return "Transitioning"
    if "initial self-financing" in r:
        return "Eligible"
    if "preparatory" in r or "accelerated" in r or "catalytic" in r:
        return "Transitioning"
    return "Eligible"


def _gavi_is_eligible(phase: str) -> bool:
    return phase in ("Eligible", "Transitioning")


# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _get_iso2(iso3: str) -> str:
    try:
        c = pycountry.countries.get(alpha_3=iso3)
        return c.alpha_2 if c else ""
    except Exception:
        return ""


def _fetch_wb_income_labels() -> dict[str, str]:
    """Fetch current income-level labels from World Bank REST API (falls back to static)."""
    try:
        resp = requests.get(
            "https://api.worldbank.org/v2/incomelevel?format=json&per_page=20",
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list) and len(data) > 1:
            return {item["id"]: item["value"] for item in data[1]}
    except Exception as exc:
        logger.debug("WB income label fetch failed (%s) — using static fallback", exc)
    return WB_INCOME_NAMES


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN FUNCTION
# ═══════════════════════════════════════════════════════════════════════════════

def fetch_country_metadata(save: bool = True) -> pd.DataFrame:
    """
    Build the comprehensive country characteristics lookup table.

    Combines live World Bank economy metadata with static WHO/UNICEF regional
    mappings, UN special-group flags, World Bank FCS status, IMF DSA risk
    ratings, and Gavi eligibility extracted from the cached WHO JRF Excel.

    Returns:
        DataFrame with one row per country (non-aggregate economies only).
    """
    import wbgapi as wb

    logger.info("Building country metadata…")
    pulled_at = now_utc()

    # ── 1. World Bank economy metadata (live) ───────────────────────────────
    logger.info("  Fetching World Bank economy metadata…")
    try:
        econ_df = wb.economy.DataFrame()
    except Exception as exc:
        logger.error("Failed to fetch World Bank economy data: %s", exc)
        return pd.DataFrame()

    econ_df = econ_df[~econ_df["aggregate"]].copy()
    econ_df.index.name = "wb_code"
    econ_df = econ_df.reset_index()

    # ── 2. Gavi eligibility from cached Excel ───────────────────────────────
    gavi_map = _load_gavi_eligibility()

    # ── 3. Income labels (live with static fallback) ─────────────────────────
    income_labels = _fetch_wb_income_labels()

    # ── 4. Assemble one row per country ─────────────────────────────────────
    records: list[dict] = []
    skipped = 0

    for _, row in econ_df.iterrows():
        wb_code     = str(row["wb_code"]).strip()
        name        = str(row.get("name", "")).strip()
        region_code = str(row.get("region", "")).strip()
        income_code = str(row.get("incomeLevel", "")).strip()
        lending     = str(row.get("lendingType", "")).strip()
        capital     = str(row.get("capitalCity", "")).strip()
        lat         = row.get("latitude")
        lon         = row.get("longitude")

        # Resolve ISO3
        iso3: str | None = None
        pc = pycountry.countries.get(alpha_3=wb_code)
        if pc:
            iso3 = pc.alpha_3
        elif len(wb_code) == 3 and wb_code.isalpha():
            iso3 = wb_code   # Kosovo, Taiwan, etc.
        else:
            skipped += 1
            continue

        wb_region       = WB_REGION_NAMES.get(region_code, "")
        wb_income_group = income_labels.get(income_code, WB_INCOME_NAMES.get(income_code, ""))

        who_region      = WHO_REGION_MAP.get(iso3, "")
        who_region_name = WHO_REGION_NAMES.get(who_region, "")

        unicef_region      = UNICEF_REGION_MAP.get(iso3, "")
        unicef_region_name = UNICEF_REGION_NAMES.get(unicef_region, "")

        gavi_raw     = gavi_map.get(iso3, "")
        gavi_phase   = _simplify_gavi_phase(gavi_raw)
        gavi_elig    = _gavi_is_eligible(gavi_phase)

        dsa_risk     = DSA_RISK_RATINGS.get(iso3, "")

        records.append({
            # Identity
            "iso3":               iso3,
            "iso2":               _get_iso2(iso3),
            "country_name":       name,
            "capital_city":       capital,
            "latitude":           lat,
            "longitude":          lon,
            # World Bank
            "wb_region_code":     region_code,
            "wb_region":          wb_region,
            "wb_income_code":     income_code,
            "wb_income_group":    wb_income_group,
            "wb_lending_type":    lending,
            # WHO
            "who_region":         who_region,
            "who_region_name":    who_region_name,
            # UNICEF
            "unicef_region":      unicef_region,
            "unicef_region_name": unicef_region_name,
            # Gavi
            "gavi_status":        gavi_raw,
            "gavi_phase":         gavi_phase,
            "gavi_is_eligible":   gavi_elig,
            # UN special groups
            "is_ldc":             iso3 in LDC_ISO3,
            "is_lldc":            iso3 in LLDC_ISO3,
            "is_sids":            iso3 in SIDS_ISO3,
            # Fragile / Conflict
            "fcv_current":        iso3 in FCV_CURRENT_ISO3,
            "fcv_vintage":        FCV_VINTAGE,
            "fcv_reference_year": FCV_REFERENCE_YEAR,
            "is_fcs":             iso3 in FCV_CURRENT_ISO3,
            # IMF DSA
            "dsa_risk_rating":    dsa_risk,
            "dsa_is_high_risk":   dsa_risk in ("High", "In Debt Distress"),
            # Derived flags (backwards-compatible with existing code)
            "is_lmic":            income_code in ("LIC", "LMC"),
            "is_ssa":             region_code == "SSF",
            "is_ida":             lending in ("IDX", "IDB"),
            "pulled_at":          pulled_at,
        })

    df = pd.DataFrame(records).sort_values("iso3").reset_index(drop=True)

    # ── 5. Log summary ───────────────────────────────────────────────────────
    logger.info("  %d countries loaded | %d aggregate entries skipped", len(df), skipped)
    logger.info(
        "  WHO region coverage:    %d / %d countries",
        (df["who_region"] != "").sum(), len(df),
    )
    logger.info(
        "  UNICEF region coverage: %d / %d countries",
        (df["unicef_region"] != "").sum(), len(df),
    )
    logger.info(
        "  Gavi eligibility data:  %d / %d countries",
        (df["gavi_phase"] != "").sum(), len(df),
    )
    logger.info(
        "  LDC: %d  |  LLDC: %d  |  SIDS: %d  |  FCS: %d",
        df["is_ldc"].sum(), df["is_lldc"].sum(),
        df["is_sids"].sum(), df["is_fcs"].sum(),
    )
    logger.info(
        "  DSA risk rated: %d countries  (In Distress: %d  |  High: %d  |  Moderate: %d  |  Low: %d)",
        (df["dsa_risk_rating"] != "").sum(),
        (df["dsa_risk_rating"] == "In Debt Distress").sum(),
        (df["dsa_risk_rating"] == "High").sum(),
        (df["dsa_risk_rating"] == "Moderate").sum(),
        (df["dsa_risk_rating"] == "Low").sum(),
    )

    if save and not df.empty:
        save_reference(df, "country_metadata", PROCESSED_DIR)

    return df
