# Product Requirements Document
## Health Financing Dashboard

**Version:** 1.1  
**Date:** 2026-04-16  
**Status:** Approved  
**Audience:** Public-facing  
**Stack:** Next.js 15 + Plotly.js + shadcn/ui + DuckDB-WASM

---

## 1. Problem Statement

Global health financing data exists across multiple fragmented sources (World Bank, WHO, IMF, GAVI) with no unified way to explore the relationships between how countries finance health, what they spend, and what outcomes they achieve. Policymakers, researchers, and advocates need a single coherent tool that transforms raw indicators into actionable insight — answering questions like *"Is this country's health spending sustainable?"*, *"Are people being impoverished by out-of-pocket costs?"*, and *"Are investments translating to better outcomes?"*

A data pipeline already exists that consolidates **101 indicators** from 4 sources covering **217 countries** over **2000–2023** into a clean master dataset. What's missing is the presentation layer — a dashboard that makes this data visually clear, analytically coherent, and genuinely compelling to use.

---

## 2. Goals

| Goal | Measure of Success |
|------|-------------------|
| **Clarity** — Complex financing flows become immediately understandable | A user can identify a country's financing mix, fiscal constraints, and outcome trends within 30 seconds |
| **Coherence** — Indicators are grouped to tell a health financing story, not just listed | Each view answers a specific policy question with supporting context |
| **Cool factor** — The dashboard feels modern, polished, and a pleasure to use | Smooth transitions, consistent design system, responsive across devices |
| **Comparability** — Countries can be benchmarked against peers and international targets | Every view supports single-country, multi-country, and peer-group modes |
| **Self-service** — Non-technical users can explore without guidance | Intuitive navigation, sensible defaults, contextual tooltips |

---

## 3. Users

| User Type | Needs | Context |
|-----------|-------|---------|
| **Health policy analyst** | Compare financing strategies across peer countries, identify fiscal space | Works in government or multilateral (WHO, World Bank) |
| **Global health researcher** | Explore relationships between spending and outcomes, find anomalies | Academic or think-tank setting |
| **Development partner / donor** | Assess country transition readiness, track external dependency | GAVI, Global Fund, bilateral agencies |
| **Advocacy organization** | Create compelling visualizations for reports and presentations | Needs exportable charts and clear narratives |

---

## 4. Data Foundation

### 4.1 Existing Pipeline

The data pipeline is fully built in Python (`pipeline/` directory) and produces:

| File | Records | Content |
|------|---------|---------|
| `master.parquet` | 362,496 | All indicators consolidated |
| `world_bank.parquet` | 255,748 | 52 WB indicators |
| `who_gho.parquet` | 44,364 | 47 WHO GHO indicators |
| `imf.parquet` | 54,391 | 14 IMF indicators |
| `who_immunization.parquet` | 7,993 | 3 vaccine financing indicators |
| `country_metadata.parquet` | 217 | Classifications & regions |

**Schema** (all source files share this):
```
iso3            — ISO 3166-1 alpha-3 country code
country_name    — Human-readable country name
year            — Integer (2000–2023)
indicator_code  — Source-specific code
indicator_name  — Human-readable description
value           — Float
source          — Origin dataset
pulled_at       — Timestamp of extraction
```

**Country metadata** provides: `income_group`, `region` (WB), `who_region`, `lending_type`, `is_lmic`, `is_ssa`, `is_ldc`, `is_lldc`, `gavi_status`.

### 4.2 Source Priority for Overlapping Indicators

| Domain | Primary Source | Fallback |
|--------|---------------|----------|
| Health financing (GHED) | WHO GHO | World Bank |
| Macroeconomic / fiscal | IMF | World Bank |
| Demographics | World Bank | — |
| Disease burden | WHO GHO | World Bank |
| Immunization coverage | WHO GHO | World Bank |
| Vaccine financing | WHO Immunization | — |

---

## 5. Dashboard Views

The dashboard is organized into **7 thematic views**, each answering a specific health financing question. Every view supports three interaction modes:

- **Country deep-dive** — single country, full time series (2000–2023)
- **Country comparison** — select 2–5 countries, same indicators
- **Peer benchmarking** — country vs income group / region / custom group average

### 5.1 The Financing Landscape

> *"Where does health money come from and how much is there?"*

This is the default landing view for any country — the executive summary of health financing.

**Primary visualization:** Stacked area chart showing the 4 financing sources as % of CHE over time (2000–2023), with total CHE per capita as a line overlay.

| Indicator | Code | Chart Role |
|-----------|------|------------|
| Current health expenditure (% GDP) | `GHED_CHEGDP_SHA2011` | KPI card |
| Current health expenditure per capita (USD) | `GHED_CHE_pc_US_SHA2011` | KPI card + line overlay |
| Govt health exp (% of CHE) | `GHED_GGHE-DCHE_SHA2011` | Stacked area — segment |
| Out-of-pocket exp (% of CHE) | `GHED_OOPSCHE_SHA2011` | Stacked area — segment |
| External health exp (% of CHE) | `GHED_EXTCHE_SHA2011` | Stacked area — segment |
| Domestic private exp (% of CHE) | `GHED_PVT-DCHE_SHA2011` | Stacked area — segment |
| Govt health exp (% of GGE) | `GHED_GGHE-DGGE_SHA2011` | Secondary time series |
| GDP per capita | `NGDPDPC` | Context sparkline |

**KPI cards** (latest year): CHE % GDP, CHE per capita, Govt share of CHE, OOP share of CHE.

**Insight panel:** Auto-generated text summarizing the trend — e.g., *"Kenya's government share of health spending has increased from 29% to 38% since 2010, while external dependency fell from 26% to 18%."*

---

### 5.2 Fiscal Space for Health

> *"Can the government afford to spend more on health?"*

**Primary visualization:** Dual-axis chart — govt revenue and expenditure (% GDP) on left axis, health spending (% GGE) on right axis, with Abuja 15% target line.

| Indicator | Code | Chart Role |
|-----------|------|------------|
| Govt revenue excl. grants (% GDP) | `GGR_NGDP` | Time series — fiscal envelope |
| Tax revenue (% GDP) | `GC.TAX.TOTL.GD.ZS` | Time series — revenue composition |
| Govt total expenditure (% GDP) | `GGX_NGDP` | Time series — spending envelope |
| Govt health exp (% GDP) | `GHED_GGHE-DGDP_SHA2011` | Time series — health share |
| Govt health exp (% GGE) | `GHED_GGHE-DGGE_SHA2011` | Time series + **Abuja 15% line** |
| Govt gross debt (% GDP) | `GGXWDG_NGDP` | Time series — debt pressure |
| Debt service (% GNI) | `DT.TDS.DECT.GN.ZS` | Time series — competing priority |
| External debt (% GDP) | `DT.DOD.DECT.GD.ZS` | Context |
| Net lending/borrowing (% GDP) | `GGXCNL_NGDP` | Surplus/deficit indicator |
| Inflation (annual %) | `PCPIPCH` | Context sparkline |
| GDP growth (annual %) | `NGDP_RPCH` | Context sparkline |

**Key analytics:**
- Health spending vs debt service — competing priorities bar chart
- Revenue gap analysis: tax revenue vs total expenditure
- Traffic light indicator: Abuja target status (met / approaching / far)

**Benchmark:** Abuja Declaration — 15% of general government expenditure allocated to health.

---

### 5.3 Financial Protection & Equity

> *"Are people being impoverished by health costs?"*

**Primary visualization:** OOP (% of CHE) time series with WHO 20% threshold line, colored red above / green below.

| Indicator | Code | Chart Role |
|-----------|------|------------|
| Out-of-pocket (% of CHE) | `GHED_OOPSCHE_SHA2011` | **Primary line + 20% threshold** |
| OOP per capita (USD) | `GHED_OOP_pc_US_SHA2011` | Secondary time series |
| Poverty headcount ($2.15/day) | `SI.POV.DDAY` | Correlated time series |
| Gini index | `SI.POV.GINI` | Context KPI |
| External health exp (% CHE) | `GHED_EXTCHE_SHA2011` | Donor dependency line |
| External health exp per capita | `GHED_EXT_pc_US_SHA2011` | Context |
| Domestic private exp (% CHE) | `GHED_PVT-DCHE_SHA2011` | Financing composition |
| Net ODA received (USD) | `DT.ODA.ALLD.CD` | Aid trend line |

**Cross-country scatter** (comparison mode): OOP % of CHE (x) vs poverty headcount (y), bubble size = population. Reveals which countries have both high OOP burden AND high poverty.

**Benchmark:** WHO recommends OOP < 20% of CHE for adequate financial protection.

---

### 5.4 Health Outcomes & Value for Money

> *"What are we getting for the money spent?"*

**Primary visualization:** Scatter plot — CHE per capita (x, log scale) vs life expectancy or UHC index (y), all countries as dots, selected country highlighted, income group colored. This is the "efficiency frontier."

| Indicator | Code | Chart Role |
|-----------|------|------------|
| Life expectancy at birth | `WHOSIS_000001` | Outcome metric (y-axis option) |
| Healthy life expectancy (HALE) | `WHOSIS_000015` | Outcome metric (y-axis option) |
| Under-5 mortality | `MDG_0000000001` | Outcome metric (y-axis option) |
| Neonatal mortality | `MDG_0000000026` | Outcome metric (y-axis option) |
| Maternal mortality ratio | `SH.STA.MMRT` | Outcome metric (y-axis option) |
| UHC Service Coverage Index | `UHC_INDEX_REPORTED` | Outcome metric (y-axis option) |
| UHC — RMNCH sub-index | `UHC_SCI_RMNCH` | Radar chart arm |
| UHC — Infectious disease sub-index | `UHC_SCI_INFECT` | Radar chart arm |
| UHC — NCD sub-index | `UHC_SCI_NCD` | Radar chart arm |
| UHC — Capacity sub-index | `UHC_SCI_CAPSP` | Radar chart arm |
| CHE per capita (USD) | `GHED_CHE_pc_US_SHA2011` | X-axis for scatter |

**UHC radar chart:** 4-arm radar showing a country's UHC profile across RMNCH, infectious disease, NCD, and health system capacity. Compare against peer group average overlay.

**Animated scatter:** Optionally animate the scatter by year (2000→2023) to show how countries move along the efficiency frontier over time.

**Benchmark:** SDG 3.8 target — UHC index >= 80.

---

### 5.5 Disease-Specific Financing & Burden

> *"Are disease-specific investments matching the burden?"*

**Layout:** Tabbed sub-views for HIV/AIDS, Tuberculosis, and Malaria.

#### HIV/AIDS Tab
| Indicator | Code | Chart Role |
|-----------|------|------------|
| HIV incidence (per 1,000) | `MDG_0000000020` | Primary time series |
| HIV prevalence (% 15-49) | `SH.DYN.AIDS.ZS` | Context line |
| ART coverage (%) | `SH.HIV.ARTC.ZS` | Response metric |
| HIV-related deaths | `HIV_0000000006` | Outcome time series |

#### Tuberculosis Tab
| Indicator | Code | Chart Role |
|-----------|------|------------|
| TB incidence (per 100k) | `SH.TBS.INCD` | Primary time series |
| TB mortality (per 100k) | `MDG_0000000017` | Outcome time series |

#### Malaria Tab
| Indicator | Code | Chart Role |
|-----------|------|------------|
| Malaria incidence (per 1,000) | `MALARIA_EST_INCIDENCE` | Primary time series |
| Malaria mortality (per 100k) | `MALARIA_EST_MORTALITY` | Outcome time series |
| Malaria cases (number) | `MALARIA_EST_CASES` | Absolute burden |
| Malaria deaths (number) | `MALARIA_EST_DEATHS` | Absolute burden |
| ITN coverage (%) | `MALARIA_ITN_COVERAGE` | Response metric |

**Cross-cutting overlay:** External health expenditure trend alongside disease metrics — shows whether donor funding is driving the improvements and what happens when it declines.

---

### 5.6 Primary Health Care & Service Delivery

> *"Is money reaching the front lines?"*

**Primary visualization:** PHC expenditure per capita bar chart with WHO $86 minimum threshold line, plus workforce density gauge charts.

| Indicator | Code | Chart Role |
|-----------|------|------------|
| PHC expenditure per capita (USD) | `GHED_PHC_pc_US_SHA2011` | **Bar + $86 threshold** |
| Govt PHC exp (% of PHC) | `GHED_PHC_GGHE-D_PHC_SHA2011` | Time series |
| Physicians per 1,000 | `HWF_0001` | Gauge / KPI |
| Nurses & midwives per 1,000 | `HWF_0007` | Gauge / KPI |
| Dentists per 10,000 | `HWF_0004` | KPI card |
| Pharmacists per 10,000 | `HWF_0006` | KPI card |
| Hospital beds per 1,000 | `SH.MED.BEDS.ZS` | KPI card |
| Skilled birth attendance (%) | `WHS4_543` | Service coverage line |
| Antenatal care — 1 visit (%) | `WHS4_100` | Service coverage line |
| Antenatal care — 4 visits (%) | `WHS4_544` | Service coverage line |
| Contraceptive prevalence (%) | `FP_CXALLFP` | Service coverage line |

**Workforce density combined gauge:** Doctors + nurses + midwives per 1,000 population, benchmarked against WHO threshold of 4.45 per 1,000.

**Benchmarks:**
- WHO PHC minimum: $86 per capita
- WHO workforce threshold: 4.45 per 1,000 (doctors + nurses + midwives combined)

---

### 5.7 Immunization Financing & Coverage

> *"Are countries financing their own immunization programs?"*

**Primary visualization:** Dual-axis — govt share of vaccine expenditure (left axis, area fill) with immunization coverage lines (right axis), GAVI status annotated on timeline.

| Indicator | Code | Chart Role |
|-----------|------|------------|
| Govt vaccine expenditure (USD) | `WHO_IMM_GOV_VAX_USD` | Stacked bar component |
| Total vaccine expenditure (USD) | `WHO_IMM_TOT_VAX_USD` | Stacked bar component |
| Govt share of vaccine spending | `WHO_IMM_GOV_SHARE` | **Primary area fill** |
| DPT immunization (%) | `SH.IMM.IDPT` | Coverage line |
| Measles MCV1 (%) | `WHS8_110` | Coverage line |
| MCV2 (%) | `MCV2` | Coverage line |
| PCV3 (%) | `PCV3` | Coverage line |
| Rotavirus (%) | `ROTAC` | Coverage line |
| HepB3 (%) | `SH.IMM.HEPB` | Coverage line |
| Polio (%) | `SH.IMM.POL3` | Coverage line |

**GAVI timeline annotation:** Mark transition phases (Initial Self-Financing → Preparatory Transition → Accelerated Transition → Fully Self-Financing) on the chart using country metadata.

**Key question answered:** Does increasing government self-financing maintain or improve coverage? Show the correlation.

**Benchmark:** DPT3 national target: 90% coverage.

---

## 6. Cross-Cutting Features

### 6.1 Country Selector
- Search by name or ISO3 code
- Quick access to recently viewed countries
- Income group and region filters
- "Compare with..." adds countries to multi-country mode

### 6.2 Time Controls
- Year range slider (2000–2023)
- Play/pause animation for scatter plots
- Snap to latest year

### 6.3 Peer Benchmarking
- Automatic peer group based on income group
- Optional: same region, same GAVI status, custom selection
- Shown as shaded band (25th–75th percentile) or average line

### 6.4 Export & Share
- Download chart as PNG/SVG
- Download underlying data as CSV
- Copy chart link (shareable URL with state encoded)
- Export view as PDF for reports

### 6.5 Contextual Help
- Indicator tooltips explaining what each metric measures and its source
- Benchmark explanations (why 15%, why 20%, why $86)
- Data coverage indicator — flag when data is sparse or outdated for a country

---

## 7. Technology Stack

### 7.1 Evaluation Criteria

| Criteria | Weight | Notes |
|----------|--------|-------|
| Visual polish & "cool factor" | High | Must feel modern, not a data dump |
| Chart richness | High | Stacked areas, radar, animated scatter, dual-axis, gauges, maps |
| Development speed | High | Existing Python pipeline should be leveraged, not rewritten |
| Interactivity | High | Filtering, tooltips, drill-down, animation |
| Responsive design | Medium | Desktop-first, but should work on tablet |
| Deployment simplicity | Medium | Easy to host and share |
| Maintainability | Medium | Team likely has Python expertise |

### 7.2 Chosen Stack: Next.js + Plotly.js + shadcn/ui + DuckDB-WASM

```
┌──────────────────────────────────────────────────────┐
│                    Frontend                           │
│  Next.js 15 (App Router, Server Components)          │
│  TypeScript                                          │
│  Tailwind CSS + shadcn/ui (design system)            │
│  Plotly.js (charts — familiar from existing pipeline)│
│  Framer Motion (transitions & animations)            │
│  @tanstack/react-table (data tables)                 │
│  Plotly.js choropleth (landing page world map)       │
├──────────────────────────────────────────────────────┤
│                    Data Layer                         │
│  DuckDB-WASM (query parquet directly in browser)     │
│  No backend server required                          │
├──────────────────────────────────────────────────────┤
│                    Data Pipeline                      │
│  Existing Python pipeline (unchanged)                │
│  Outputs: Parquet files in data/processed/           │
├──────────────────────────────────────────────────────┤
│                    Hosting                            │
│  Vercel (free tier) — static export + edge            │
│  Public URL, no authentication                       │
└──────────────────────────────────────────────────────┘
```

**Why each piece:**

| Component | What it does for this project |
|-----------|------|
| **Next.js 15** | Fast page loads, file-based routing (`/country/KEN/fiscal` just works), built-in image/font optimization, deploys to Vercel in one click |
| **Plotly.js** | Already used in the Jupyter notebook — same chart types, same mental model. Supports every chart type we need: stacked area, radar, scatter, dual-axis, choropleth map. Built-in PNG/SVG export |
| **shadcn/ui + Tailwind** | Professional design system out of the box — buttons, dropdowns, cards, tabs, sliders all look polished and consistent. Fully customizable. Dark mode built in |
| **Framer Motion** | Smooth page transitions, animated year scrubber on scatter plots, chart entrance animations — this is where "cool" comes from |
| **DuckDB-WASM** | The key architectural decision. Loads parquet files directly in the user's browser and runs SQL queries on them. No backend server needed. Handles 360K rows easily. Update flow: re-run Python pipeline → copy parquet files → redeploy |
| **TypeScript** | Catches errors before they reach users. Type-safe indicator codes and country metadata |
| **Vercel** | Free hosting for public sites. Automatic HTTPS, global CDN, deploys from git push |

---

## 8. Design Principles

### 8.1 Visual Language
- **Color palette:** Muted, professional base with a consistent accent scale for data categories. Health financing sources should always use the same colors (e.g., government = blue, OOP = amber, external = teal, private = gray) across all views.
- **Typography:** Clean sans-serif (Inter or similar). Numbers in tabular-nums for alignment. Large KPI values use semibold at 2-3x body size.
- **Spacing:** Generous whitespace. Charts should breathe — never feel cramped.
- **Dark mode:** Full support. Charts and data colors must work in both themes.

### 8.2 Chart Design
- Default to Plotly's `plotly_white` template (already used in the notebook)
- Minimal gridlines — only horizontal, light gray
- Direct labels on chart elements where possible (not just legends)
- Benchmark lines should be dashed, labeled, and use a distinct muted color
- Hover tooltips show: country name, year, value, unit, source
- Animated transitions when switching years or countries

### 8.3 Layout Pattern
Each view follows a consistent structure:
```
┌─────────────────────────────────────────────────────┐
│  View Title + Question                    [Controls]│
├──────────┬──────────┬──────────┬───────────────────-┤
│  KPI 1   │  KPI 2   │  KPI 3   │  KPI 4            │
├──────────┴──────────┴──────────┴───────────────────-┤
│                                                     │
│            Primary Visualization                    │
│            (full width, hero chart)                  │
│                                                     │
├─────────────────────┬───────────────────────────────┤
│  Secondary Chart 1  │  Secondary Chart 2            │
├─────────────────────┴───────────────────────────────┤
│  Context Sparklines / Supporting Metrics            │
└─────────────────────────────────────────────────────┘
```

### 8.4 Responsive Behavior
- Desktop (1440px+): Full 12-column grid, side-by-side charts
- Tablet (768–1439px): Stacked layout, charts full-width
- Mobile (< 768px): Simplified view — KPI cards + primary chart only

---

## 9. Information Architecture

```
/                           → Landing: choropleth world map (colored by CHE % GDP or selectable metric) + country search overlay
/country/[iso3]             → Country dashboard (default: Financing Landscape)
/country/[iso3]/fiscal      → Fiscal Space for Health
/country/[iso3]/protection  → Financial Protection & Equity
/country/[iso3]/outcomes    → Health Outcomes & Value for Money
/country/[iso3]/diseases    → Disease-Specific (tabs: HIV, TB, Malaria)
/country/[iso3]/phc         → Primary Health Care & Service Delivery
/country/[iso3]/immunization→ Immunization Financing & Coverage
/compare                    → Multi-country comparison mode
/about                      → Methodology, sources, benchmarks explained
```

**Navigation:** Persistent sidebar with the 7 views. Country selector always visible in header. Breadcrumb: Region > Country > View.

---

## 10. International Benchmarks Reference

| Benchmark | Value | Source | Used In |
|-----------|-------|--------|---------|
| Abuja Declaration | 15% of GGE on health | African Union, 2001 | Fiscal Space |
| WHO financial protection | OOP < 20% of CHE | WHO Health Financing Strategy | Financial Protection |
| WHO PHC minimum | $86 per capita | WHO PHC operational framework | PHC & Service Delivery |
| WHO workforce density | 4.45 per 1,000 (doctors + nurses + midwives) | WHO Global Strategy on HRH | PHC & Service Delivery |
| SDG 3.8 (UHC) | UHC index >= 80 | UN Sustainable Development Goals | Outcomes |
| DPT3 coverage | 90% national | WHO/UNICEF | Immunization |
| Chatham House domestic financing | 5% of GDP on health | Chatham House, 2014 | Financing Landscape |

---

## 11. Data Refresh Strategy

| Frequency | Action |
|-----------|--------|
| **Annual** | Run full pipeline (`python run_pipeline.py`) when WHO GHED and WB update (typically Q2–Q3) |
| **On-demand** | Pipeline supports re-running individual sources if specific data updates early |
| **Dashboard** | If using DuckDB-WASM, swap parquet files and redeploy. If using API, data refreshes automatically on pipeline run |

---

## 12. Development Phases

### Phase 1: Foundation (MVP)
- [ ] Project scaffolding (Next.js + Tailwind + shadcn/ui)
- [ ] Data layer: load parquet files via DuckDB-WASM (or FastAPI)
- [ ] Country selector with search, income group, and region filters
- [ ] View 5.1: Financing Landscape (stacked area + KPI cards)
- [ ] View 5.4: Outcomes & Value for Money (scatter plot + UHC radar)
- [ ] Basic routing (`/country/[iso3]`)
- [ ] Responsive layout shell

### Phase 2: Core Views
- [ ] View 5.2: Fiscal Space for Health
- [ ] View 5.3: Financial Protection & Equity
- [ ] View 5.6: PHC & Service Delivery
- [ ] Peer benchmarking overlay (income group / region averages)
- [ ] Time range slider
- [ ] Dark mode

### Phase 3: Specialized Views
- [ ] View 5.5: Disease-Specific (tabbed: HIV, TB, Malaria)
- [ ] View 5.7: Immunization Financing & Coverage
- [ ] GAVI status timeline annotation
- [ ] Animated scatter (year scrubber)

### Phase 4: Polish & Share
- [ ] Landing page with global choropleth map
- [ ] Multi-country comparison mode (`/compare`)
- [ ] Export: PNG/SVG charts, CSV data, PDF view
- [ ] Shareable URLs with state
- [ ] Auto-generated insight text
- [ ] Contextual tooltips for all indicators and benchmarks
- [ ] Performance optimization (virtualized lists, lazy-loaded charts)
- [ ] About/methodology page

---

## 13. Decisions Log

| # | Question | Decision |
|---|----------|----------|
| 1 | **Deployment target** | Vercel (free tier). Static export + DuckDB-WASM. No server needed |
| 2 | **Authentication** | Public — no login required |
| 3 | **Geographic visualization** | Yes — Plotly.js choropleth map on landing page (no Mapbox dependency) |
| 4 | **Tech stack** | Next.js 15 + Plotly.js + shadcn/ui + DuckDB-WASM + Framer Motion |
| 5 | **Development model** | Claude builds the code; user reviews, runs, and maintains |

### Remaining Open Questions

| # | Question | Impact |
|---|----------|--------|
| 1 | **Custom domain** — Do you want a custom domain (e.g. healthfinancing.org) or is the Vercel default URL fine? | Cosmetic, can be added later |
| 2 | **Localization** — English only or multi-language in future? | Can be deferred; English first |

---

## Appendix A: Full Indicator–View Mapping

| View | Indicator Count | Primary Source |
|------|----------------|----------------|
| 5.1 Financing Landscape | 8 | WHO GHED |
| 5.2 Fiscal Space | 11 | IMF + WHO GHED |
| 5.3 Financial Protection | 8 | WHO GHED + World Bank |
| 5.4 Outcomes & Value for Money | 11 | WHO GHO |
| 5.5 Disease-Specific | 11 | WHO GHO + World Bank |
| 5.6 PHC & Service Delivery | 11 | WHO GHED + WHO GHO |
| 5.7 Immunization | 10 | WHO Immunization + WHO GHO |
| **Total unique indicators used** | **~70 of 101** | — |

*Remaining ~31 indicators (NCDs, mental health, nutrition, WASH, some demographics) are available for future views or as contextual layers.*

## Appendix B: Color System for Financing Sources

Used consistently across ALL views:

| Source | Color Token | Hex (light) | Meaning |
|--------|------------|-------------|---------|
| Government domestic | `--color-govt` | `#2563eb` (blue-600) | Public financing |
| Out-of-pocket | `--color-oop` | `#d97706` (amber-600) | Household burden |
| External / donor | `--color-external` | `#0d9488` (teal-600) | Aid dependency |
| Domestic private | `--color-private` | `#6b7280` (gray-500) | Insurance, NGOs |
| Total / aggregate | `--color-total` | `#111827` (gray-900) | Combined |
