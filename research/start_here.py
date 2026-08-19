"""Positron starting point for exploring the canonical research package."""

# %% Imports and paths
from pathlib import Path

import pandas as pd

PROJECT_ROOT = Path(__file__).resolve().parents[1]
RESEARCH_DATA = PROJECT_ROOT / "data" / "research"

# %% Dimensions: inspect these before choosing indicators or countries
entities = pd.read_parquet(RESEARCH_DATA / "dim_entities.parquet")
indicators = pd.read_parquet(RESEARCH_DATA / "dim_indicators.parquet")

print(entities["entity_type"].value_counts())
print(
    indicators.groupby(["research_domain", "source"], observed=True)
    .size()
    .rename("indicator_series")
)

# %% Separate financing and program data
financing = pd.read_parquet(RESEARCH_DATA / "health_financing.parquet")
programs = pd.read_parquet(RESEARCH_DATA / "health_programs.parquet")

print(financing[["source", "indicator_code", "indicator_name"]].drop_duplicates().head(20))
print(programs[["source", "indicator_code", "indicator_name"]].drop_duplicates().head(20))

# %% Example: inspect one country without silently creating a complete-case panel
country = "KEN"
country_financing = financing[financing["entity_id"].eq(country)].copy()
country_programs = programs[programs["entity_id"].eq(country)].copy()

print(country_financing.groupby("source", observed=True).size())
print(country_programs.groupby("source", observed=True).size())

# %% Example research join -- explicit indicator choices, outer join preserves gaps
che = financing[
    financing["canonical_indicator_code"].eq("GHED_che_gdp")
][["entity_id", "year", "value", "is_preliminary"]].rename(
    columns={"value": "current_health_expenditure_pct_gdp"}
)
u5mr = programs[
    (programs["source"].eq("World Bank"))
    & (programs["indicator_code"].eq("SH.DYN.MORT"))
][["entity_id", "year", "value"]].rename(columns={"value": "under5_mortality_per_1000"})

example_panel = che.merge(u5mr, on=["entity_id", "year"], how="outer", validate="one_to_one")
print(example_panel.info())

# Do not add imputation, lags, weights, exclusions, or a causal model here until
# the research question and estimand make those choices defensible.
