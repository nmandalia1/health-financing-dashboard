# Research data in Positron

This folder is the analysis entry point. The underlying research data are generated in
`data/research/` by:

```bash
python3 -m pipeline.research_data
```

Open `research/start_here.py` in Positron and run it cell by cell. The starter deliberately
uses an outer join and does not impute missing values or define a study sample.

## Which files to use

- `dim_entities.parquet`: stable entity IDs, entity types, geography, and versioned current
  FCV context. Use `is_country_or_territory` to exclude World Bank/IMF aggregates.
- `dim_indicators.parquet` or `.csv`: indicator definitions, units, source coverage,
  research domains, canonical-code relationships, and GHED codebook metadata.
- `health_financing.parquet`: WHO GHED, relevant World Bank series, immunization financing,
  and other financing sources when available.
- `health_programs.parquet`: outcomes, service coverage, disease, workforce, nutrition,
  immunization coverage, and program data.
- `country_context.parquet`: macroeconomic, fiscal, demographic, governance, and current FCV
  context.
- `public_financial_management.parquet`: PEFA observations.
- `observations_all_sources.parquet`: complete audit layer, including aggregates and legacy
  WHO-GHO GHED mirrors.
- `ghed_series_metadata.parquet`: country-by-GHED-series source notes, comments, data type,
  estimation notes, and footnotes from the original workbook.
- `inventory_by_domain_source.csv`: compact list of what is present.
- `validation_report.json`: checks and package-generation assumptions.

## Important interpretation rules

1. `entity_id` is the research join key. `source_entity_code` preserves the original source
   code; for example, `KOS` and `UVK` are linked to `XKX`.
2. `indicator_code` is the source series. `canonical_indicator_code` links sparse legacy
   WHO-GHO GHED mirrors to the fuller WHO GHED workbook series. Legacy rows are preserved
   only in the all-sources audit file.
3. WHO GHED 2024 observations have `is_preliminary = True`, following the workbook's version
   statement.
4. `fcv_current` is the World Bank FY2026 classification. It is current context and must not
   be interpreted as a country's historical FCV status.
5. No values have been imputed, interpolated, winsorised, deflated, currency-converted, or
   selected into a complete-case sample by this research preparation step.

## Research-dependent work that remains

For each eventual study, document the population and years, outcome/exposure definitions,
price and currency basis, lag structure, missing-data handling, weighting, source precedence,
and sensitivity checks before constructing an analytic dataset.
