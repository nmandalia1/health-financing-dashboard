# Tooltip and Label Copy Audit

Reviewed as a health financing / PFM content audit with a global health communications lens. The aim is to keep the economic nuance, but make labels and tooltips easier to scan for policy, research, and country-team users.

## Overall Recommendations

| Theme | Recommendation |
| --- | --- |
| Acronyms | Keep technical acronyms in labels only when space is tight, but spell them out in first-line tooltip copy: CHE = current health expenditure, GGE = general government expenditure, GGHE-D = domestic government health expenditure, CFA = compulsory financing arrangements, PCBE = predictability and control in budget execution. |
| Tooltip structure | Use a consistent three-part rhythm: what it measures, why it matters, how to interpret the signal. Most current tooltips already do this, but some merge all three into long sentences. |
| Threshold language | Use "reference point", "watch line", or "policy benchmark" unless the threshold is a formal target. Avoid implying universal standards for Abuja, 5 percent of GDP, 20 percent OOP, 75 percent public financing, debt thresholds, and tax-to-GDP heuristics. |
| Tone | Replace "fight", "critical", "toxic", "collapse", "evaporate", and "single most effective" with calmer policy language unless used in narrative pages. The dashboard should feel analytic, not alarmist. |
| Labels | Replace "Govt" with "Government" in visible labels where there is space. Keep "Govt" in chart legends only if needed for layout. |
| Benchmarks | For UHC Service Coverage Index, avoid "SDG 3.8 target = 80". Better: "WHO high-coverage reference: 80". SDG 3.8 is universal coverage, not a numeric 80 target. |
| Data quality | When using modeled estimates or country-reported expenditure, say so plainly. This is especially important for UNAIDS, WHO malaria estimates, and JRF immunization financing. |

## Global Components

| Location | Current text | Suggested revision | Rationale |
| --- | --- | --- | --- |
| `InfoTooltip` interpretation label | "What it suggests:" | "How to read it:" | More intuitive, less deterministic. |
| `InfoTooltip` reference link | "Reference ->" | "Source details" | Clearer for non-technical users. |
| `BenchmarkToggle` label | "Peer group" | "Peer range" | The control shows P25-P75 bands, not the peer group itself. |
| `BenchmarkToggle` title | "Show P25-P75 bands for [income group] countries" | "Show the middle 50% range for [income group] peers" | Explains P25-P75 without statistical shorthand. |
| `DataCoverage` | "complete data for all series" | "data for every series shown" | Easier to understand at a glance. |
| `NoData` hints | "not routinely reported" | "not reported in the source data used here" | Avoids implying the country does not collect the data. |

## Landing page — revised to expert register

The hero and the six landing-map descriptions were rewritten to read correctly
to a health financing specialist. Two calls in the "Landing Map" table below
were **reversed** in the process; they are kept for the record, but the current
copy is deliberate:

| Superseded suggestion | Why it was changed | Now reads |
| --- | --- | --- |
| "Total health spending as a share of GDP … a smaller share of national income" | Two imprecisions: the series is *current* health expenditure, which excludes gross capital formation, so it is not total health spending; and GDP is domestic product, not national income (that is GNI). | "Current health expenditure (CHE) as a share of GDP — final consumption of health goods and services, excluding gross capital formation." |
| "Health spending per person in current US dollars." | Accurate but omits the comparability caveat that matters most: current US$ at market exchange rates is not price-adjusted, so cross-country levels conflate price and volume. | Adds the market-exchange-rate and price-adjustment caveat, and points to the constant-US$ series on the country pages. |

The subhead lists only what nearly every country has. An earlier draft ended
"…fiscal space, budget execution and disease-programme financing", which
overstated the third of those and badly overstated the second:

| Claim | Backed by | Countries | Latest |
| --- | --- | --- | --- |
| fiscal space | `mart_fiscal_space` | 193 | 2023 |
| budget execution | PEFA 2016 pillar 3 | **41** | **2019** |
| disease-programme financing | UNAIDS + WHO JRF | 176 | 2024 |

PEFA is assessment-based rather than a panel — countries are assessed
episodically and the 2016 framework reset the scoring — so 41 countries is a
property of the source, not a pipeline gap. "Open **any** country for its budget
execution" was untrue for four countries in five, so the front page no longer
claims it. The PFM lens still surfaces it and is honest about its own basis
(assessment-year histogram, scores forward-carried at most 4 years with
provenance retained); the landing page was the only place overselling it.

Rule of thumb for this page: do not name a dataset in the hero unless coverage
is comparable to the financing series (~190 countries, current to last year).

Other landing-page corrections in the same pass:

- **Government priority** said "% of government budget". The series is domestic
  general government health expenditure (GGHE-D) over general government
  expenditure (GGE) — executed spending, not appropriation, and excluding
  external funds channelled through government.
- **Out-of-pocket** now names the denominator (current health expenditure) and
  states the actual empirical claim behind the 20% line: association with a
  rising incidence of catastrophic health spending.
- **UHC Service Coverage Index** now names SDG indicator 3.8.1 and describes the
  construction (geometric mean of 14 tracer indicators). The audit's guidance on
  not presenting 80 as an SDG target is retained.
- **Life expectancy** is flagged as a population-health outcome shown for
  context, so it is not read as a financing measure.
- The hero headline no longer says "what it buys": it asserted a
  spending-to-outcomes link the data does not support, and collided with
  "purchasing" as a term of art.

The register here is deliberately expert-first — technical vocabulary is used
unglossed. That is a scoping decision for the landing page specifically; the
in-app tooltip guidance below still applies elsewhere.

## Landing Map

| Location | Current text | Suggested revision | Rationale |
| --- | --- | --- | --- |
| Metric label | "Share of the economy" | "Health share of GDP" | More direct and still plain English. |
| Description | "Total health spending as a share of GDP. Darker = smaller investment in health." | "Total health spending as a share of GDP. Darker countries spend a smaller share of national income on health." | Clarifies denominator and avoids "investment" when spending composition is unknown. |
| Metric label | "Spending per person" | "Health spending per person" | Avoids ambiguity. |
| Description | "Health spending per person, in US dollars. Darker = fewer dollars available per person." | "Health spending per person in current US dollars. Darker countries have lower spending per person." | More precise and less conversational. |
| Metric label | "Household burden" | "Household payments" | Clearer connection to OOP. |
| Description | "Share paid directly by households. WHO recommends < 20%..." | "Share of health spending paid directly by households. The 20% line is a financial-protection watch point, not a guarantee of safety." | Adds nuance. |
| Metric label | "Govt priority" | "Government priority" | Spell out in visible label. |
| Description | "Darker = lower priority. Abuja Declaration target is 15%." | "Share of the government budget allocated to health. The Abuja 15% target applies to African Union members; elsewhere it is a useful reference point." | Avoids overgeneralization. |
| UHC description | "SDG 3.8 target: >= 80." | "A score of 80 is commonly used as a high-coverage reference point; SDG 3.8 calls for universal health coverage." | Corrects SDG framing. |

## Financing Landscape

| Location | Current text | Suggested revision | Rationale |
| --- | --- | --- | --- |
| Header question | "What are the sources and levels of health financing?" | "How much is spent on health, and who pays?" | More intuitive. |
| KPI label | "Current Health Expenditure (% GDP)" | "Health spending (% of GDP)" | Shorter, clearer. Tooltip can preserve CHE terminology. |
| KPI tooltip | "Total national spending on health from all sources..." | "Total current health expenditure from government, households, private sources, and external partners, shown as a share of GDP." | Accurate and compact. |
| KPI label | "Health Expenditure Per Capita (USD)" | "Health spending per person (US$)" | Plain-language label. |
| KPI tooltip | "current US dollars at market exchange rates" | "current US dollars. Use constant-dollar trends when comparing real change over time." | Keeps nuance in less space. |
| KPI label | "Government Health Expenditure (% CHE)" | "Government share of health spending" | Easier to scan. |
| Tooltip title | "Domestic Government Health Expenditure (% of CHE)" | "Government share of current health expenditure" | Removes acronym from title. |
| Tooltip interpretation | "fiscal consolidation pressures or a shift..." | "A higher share usually means stronger pooling through public financing. A falling share can signal fiscal pressure or rising household/private financing." | Cleaner and balanced. |
| KPI label | "Out-of-Pocket Expenditure (% CHE)" | "Out-of-pocket share of health spending" | Avoids CHE in card label. |
| Tooltip interpretation | "The WHO threshold for financial risk is 20%" | "OOP above about 20% of current health expenditure is a commonly used warning sign for financial-protection risk; country context still matters." | Nuanced threshold. |
| Chart title | "Health financing sources (% of current health expenditure)" | "Who pays for current health expenditure?" | Direct user-facing question. |
| Chart subtitle | "Government + External + Domestic private = 100%" | "SHA 2011 financing sources: government, external, and domestic private financing sum to 100%." | More precise. |
| Series label | "Domestic private (incl. OOP)" | "Domestic private, including OOP" | Less abbreviation. |
| Chart title | "Compulsory Financing vs Out-of-Pocket Expenditure (% CHE)" | "Pooled financing vs household payments" | More intuitive while tooltip defines CFA/OOP. |
| Tooltip title | same | "Compulsory financing and out-of-pocket payments" | Cleaner and spellable. |
| Tooltip interpretation | "Systems where pooled financing is the dominant source..." | "When compulsory or pooled financing rises and OOP falls, households are better protected from paying at the point of care." | More direct. |
| Chart title | "Current Health Expenditure Per Capita (constant 2023 USD)" | "Real health spending per person" | Put technical detail in subtitle. |
| Subtitle | "Inflation-adjusted - constant 2023 USD" | "Inflation-adjusted, constant 2023 US$" | Cleaner. |

## Fiscal Space

| Location | Current text | Suggested revision | Rationale |
| --- | --- | --- | --- |
| Header question | "Can the government afford to spend more on health?" | "Is there room to increase public spending on health?" | Avoids implying affordability is only fiscal. |
| Index tooltip | "winsorised P5-P95 min-max..." | "A 0-100 composite across seven pillars. Each pillar is scored relative to income-group peers, then combined so a very weak pillar lowers the overall score." | Use methods detail in methodology page, not first tooltip. |
| Index interpretation | "not a DEA/SFA frontier..." | "Read the index as a structured signal, not a causal estimate. The pillar breakdown shows what is driving the score." | Plain language. |
| Verdict labels | "Strong / Moderate / Constrained" | "More room / Mixed / Constrained" | Better aligned with fiscal-space interpretation. If retained, add "vs peers". |
| KPI label | "Govt health (% GGE)" | "Health share of government spending" | Clearer for non-specialists. |
| Tooltip | "Health's political priority within the budget" | "Shows how much priority health receives within the public budget." | Less jargon. |
| KPI label | "Govt health (% GDP)" | "Public health spending (% of GDP)" | More standard health financing phrasing. |
| Tooltip | "WHO suggests ~5% of GDP..." | "Around 5% of GDP from public sources is often used as a reference for progress toward UHC, but it is not a binding global standard." | Nuance. |
| KPI label | "Govt revenue (% GDP)" | "Government revenue (% of GDP)" | Spell out. |
| Tooltip | "top-line tax-mobilization metric" | "Total domestic public revenue excluding grants, shown as a share of GDP. It captures the size of the public resource envelope before allocation decisions." | Corrects revenue vs tax. |
| Tooltip interpretation | "Below 15% of GDP is often flagged..." | "For tax revenue, about 15% of GDP is often cited as a state-capacity reference point. This series is total revenue excluding grants, so compare carefully." | Important technical correction. |
| Abuja banner | "MET / BELOW TARGET" | "Meets Abuja reference / Below Abuja reference" | Reduces overclaim for non-AU contexts. |
| Hero chart title | "Fiscal capacity and health priority" | "Public resource envelope and health priority" | More concrete. |
| Hero tooltip | "revenue and total government expenditure... the envelope" | "Compares the size of the public resource envelope (% of GDP) with the share of that envelope allocated to health (% of government spending)." | Simpler. |
| Debt tooltip | "debt distress risk above ~60%..." | "Debt thresholds vary by country context and debt-carrying capacity. Rising debt can reduce future health fiscal space through higher debt service." | Avoid one-size thresholds. |
| Fiscal balance tooltip | "Persistent deficits over 3%+..." | "Persistent large deficits can raise debt-service pressures. The 3% line is a fiscal-rule reference point, not a universal danger threshold." | Nuanced. |
| Inflation tooltip | "erodes the real value of health budgets and OOP payments alike" | "High or volatile inflation erodes the purchasing power of health budgets and household payments." | Clearer. |

## Fiscal Pillars and Indicator Registry

| Location | Current text | Suggested revision | Rationale |
| --- | --- | --- | --- |
| Pillar question | "Is health winning the budget fight?" | "Is health gaining priority in the public budget?" | More professional. |
| Pillar question | "How donor-dependent is health - and is a transition cliff ahead?" | "How exposed is health financing to changes in external aid?" | Less alarmist. |
| Pillar question | "Can the government actually execute the budget?" | "Can public funds be executed as planned?" | More PFM-specific. |
| Score tooltip | "direction-aware, so higher always means more fiscal space" | "Each indicator is converted so a higher score means more fiscal space relative to peers." | Easier to read. |
| Efficiency tooltip | "value-for-money proxy" | "Efficiency compares health outcomes with spending levels among peer countries. It is a proxy, not a causal efficiency estimate." | Important caveat. |
| Indicator: real GDP growth | "Conducive macro conditions..." | "Sustained real GDP growth can expand the public resource envelope, making health budget increases easier to finance. The 2% line is a heuristic, not a formal standard." | Plain language. |
| Indicator: inflation | "Price (in)stability..." | "High or volatile inflation reduces the purchasing power of health budgets and households. The 10% line is a warning reference, not a hard threshold." | Cleaner. |
| Indicator: tax revenue | "tax-capacity 'tipping point'" | "Tax revenue is the most policy-actionable part of the public resource envelope. About 15% of GDP is often cited as a minimum reference for state capacity." | Less insider phrasing. |
| Indicator: public health % budget | "Health's political priority..." | "Shows the share of government spending allocated to health. The Abuja Declaration set a 15% target for African Union members." | More accurate. |
| Indicator: public health % GDP | "Combines fiscal priority and overall capacity..." | "Shows public health spending relative to the whole economy, combining the size of the public budget and the priority given to health." | Easier. |
| Indicator: external health spending | "Donor dependency of the health system." | "Shows how much current health expenditure is funded by external sources. High shares can create transition risk if aid declines." | Less loaded. |
| Indicator: debt service | "resources diverted to external creditors..." | "External debt service can crowd out public spending, including health. This measure excludes domestic debt service." | Clear and precise. |
| Indicator: PEFA execution | "'last mile' of fiscal space" | "Shows whether public funds can be released, controlled, and spent as planned." | More accessible. |
| Indicator: WGI effectiveness | "'governance multiplier' on health spend" | "Strong implementation capacity helps public health spending translate into services." | Less metaphorical. |
| Indicator: corruption | "Leakage risk..." | "Weak control of corruption increases the risk that public resources do not reach intended services." | Less accusatory and clearer. |

## Financial Protection

| Location | Current text | Suggested revision | Rationale |
| --- | --- | --- | --- |
| Header question | "Are people being impoverished by health costs?" | "Are health costs creating financial hardship?" | Broader than impoverishment. |
| KPI label | "Out-of-pocket share" | "Household out-of-pocket share" | More self-explanatory. |
| Tooltip title | "OOP share of CHE" | "Household out-of-pocket share of health spending" | Avoid acronym in title. |
| Tooltip interpretation | "Above 20% households face material..." | "When OOP exceeds about 20% of current health expenditure, countries often face higher risk of catastrophic health spending. Above 40% indicates serious reliance on household payments." | More cautious and grammatical. |
| Status banner | "CRITICAL / AT RISK / PROTECTED" | "Very high OOP / Elevated OOP / Lower OOP" | Avoids false reassurance from "<20% protected". |
| Hero tooltip | "Fill color turns red..." | "The dashed line marks a commonly used 20% OOP watch point." | Avoid UI instruction in analytical tooltip. |
| Donor tooltip | "programs can collapse" | "services may become difficult to sustain if aid declines before domestic financing increases." | Less alarmist. |
| Pooling tooltip | "financial-protection red flag" | "a warning sign that households are carrying too much direct payment risk." | Clearer. |
| Gini tooltip | "toxic combination" | "especially concerning for equity and financial protection." | Professional tone. |

## Primary Health Care

| Location | Current text | Suggested revision | Rationale |
| --- | --- | --- | --- |
| Header question | "Is money reaching the front lines?" | "Is financing supporting front-line service delivery?" | More precise. |
| KPI label | "PHC Expenditure Per Capita (USD)" | "PHC spending per person (US$)" | Plain language. |
| Tooltip | "WHO Operational Framework... USD 86..." | "The US$86 figure is a commonly cited minimum-cost reference for an essential PHC package; it should be treated as an order-of-magnitude benchmark." | Nuanced. |
| Workforce tooltip | "medical doctors and pharmacists" | "medical doctors and pharmacists per 10,000 population. Nurses and midwives are shown separately where only headcounts are available." | Aligns with displayed data. |
| Chart subtitle | "Red dashed line = WHO minimum" | "Reference line: US$86 per person" | Avoids color-only cue and overclaim. |
| Maternal care tooltip | "WHO currently recommends a minimum of 8 antenatal contacts." | "ANC4 remains useful for trends, although WHO now recommends eight antenatal contacts." | Explains why ANC4 is still shown. |
| Hospital beds interpretation | "access erosion" | "may signal pressure on inpatient access unless balanced by stronger outpatient and PHC capacity." | More balanced. |

## Immunization

| Location | Current text | Suggested revision | Rationale |
| --- | --- | --- | --- |
| Header question | "Are countries financing their own immunization programs?" | "Is immunization financing becoming domestically sustainable?" | More precise. |
| KPI label | "Government Share of Vaccine Expenditure (%)" | "Government share of routine vaccine spending" | More readable. |
| Tooltip | "as opposed to external donors or GAVI co-financing" | "as opposed to external partners, including Gavi co-financing." | More inclusive and correct capitalization. |
| KPI label | "Total Vaccine Expenditure (USD)" | "Routine vaccine spending (US$)" | Shorter. |
| DPT3 tooltip | "WHO target is >=90%" | "The global coverage target is at least 90% nationally, with high and equitable subnational coverage also needed." | Adds equity nuance. |
| MCV1 tooltip | "Achieving >=95% MCV1 and MCV2..." | "Measles control requires very high coverage, usually at least 95% with both doses, because measles is highly transmissible." | Clearer. |
| Chart subtitle | "Stacked: Government + External / Donor..." | "Government and external financing shown as components of total routine vaccine spending." | Cleaner. |
| Gavi note | "GAVI transition status" | "Gavi transition status" | Correct capitalization. |
| Coverage tooltip | "Click any antigen button..." | "DTP3, MCV1, and MCV2 are shown by default; antigen buttons add or remove series." | Less instructional, still useful. |

## Outcomes

| Location | Current text | Suggested revision | Rationale |
| --- | --- | --- | --- |
| Header question | "What are we getting for the money spent?" | "How do health outcomes compare with spending levels?" | More analytic. |
| KPI tooltip | "health outcome indicator measuring population-level results..." | "Shows the selected population health outcome. Use it with spending per person to compare outcomes achieved at similar spending levels." | Specific to view. |
| UHC RMNCH tooltip | "score of 100 represents full coverage" | "A higher score means broader tracer-service coverage; 100 represents the top of the index scale, not necessarily perfect real-world access." | Nuance. |
| Scatter tooltip | "Countries achieving better outcomes..." | "Countries with better outcomes at similar spending levels may have stronger service delivery, allocation, prevention, or broader social determinants." | Avoids attributing only system efficiency. |
| Benchmark label | "SDG 3.8 target" | "WHO high-coverage reference (80)" | Corrects target language. |

## Disease-Specific Views

| Location | Current text | Suggested revision | Rationale |
| --- | --- | --- | --- |
| Header question | "Are disease-specific investments matching the burden?" | "Do disease financing and service coverage match the burden?" | Better matches available indicators. |
| HIV PLHIV interpretation | "programme success rather than failure" | "can reflect treatment success, because more people are surviving on ART; interpret alongside incidence and deaths." | More balanced. |
| ART tooltip | "95% of PLHIV on treatment" | "The second UNAIDS 95 target is 95% of people diagnosed with HIV on treatment; programmatic ART coverage is not exactly the same denominator." | Important technical nuance. |
| AIDS deaths tooltip | "treatment-programme effectiveness" | "reflects treatment access, retention, quality, and broader epidemic dynamics." | Less monocausal. |
| HIV trend tooltip | "healthy epidemic curve" | "A favorable pattern is falling incidence, rising ART coverage, and declining deaths." | More professional. |
| 95-95-95 tooltip | "Meeting all three would end AIDS..." | "Meeting all three would sharply reduce morbidity, mortality, and transmission, supporting the goal of ending AIDS as a public health threat." | More precise. |
| HIV financing tooltip | "UNAIDS recommends..." | "A rising domestic public share can reduce transition risk, especially where international financing is concentrated." | Less prescriptive. |
| TB incidence interpretation | "Declines <2% per year are off-track." | "Slow declines suggest the country is off the pace needed for End TB milestones." | Less rigid without context. |
| Malaria ITN tooltip | "universal access" | "The target is universal access for at-risk populations; coverage gaps point to prevention shortfalls." | Clearer. |
| External financing card | "donor-funded share" | "external-source share" | Neutral and broader than donor. |

## PFM Views

| Location | Current text | Suggested revision | Rationale |
| --- | --- | --- | --- |
| PFM landing headline | "Does how governments manage money affect whether children survive?" | "Does public budget management shape child survival?" | Cleaner and stronger. |
| Intro | "matters more than most economists assumed" | "is strongly associated with health system performance in recent evidence." | Less rhetorical. |
| Stat label | "PCBE pillar x U5MR" | "Budget execution x child mortality" | More accessible. |
| Threshold heading | "PFM matters most where governments foot the bill" | "PFM matters most where public financing dominates" | More professional. |
| Threshold body | "resources flow around the public system" | "public budget systems influence a smaller share of total health spending." | More precise. |
| Threshold body | "correlation strengthens dramatically" | "the association is stronger" | Avoids overclaiming. |
| Last-mile heading | "Does the budget actually reach the clinic?" | "Do public funds reach service-delivery units?" | Aligns with PEFA language. |
| Last-mile body | "Budget allocations often evaporate..." | "Weak execution can reduce the funds that reach facilities and health workers." | Less figurative. |
| PFM country header | "PEFA score trajectory..." | "Shows PEFA budget-management scores alongside health outcomes and the public share of health spending." | More reader-friendly. |
| Scorecard label | "WGI Gov. Eff." | "Government effectiveness" | Avoid abbreviation. |
| Chain heading | "The budget -> health chain" | "From public budgets to health outcomes" | More polished. |
| Chain intro | "doesn't directly save lives" | "affects outcomes through service-delivery pathways" | Less stark. |
| Chain node | "Budget quality" | "Budget execution quality" | More specific. |
| Chain methodological note | "not a causal estimate" | Keep, but place near correlation labels where possible | Important caveat. |
| Last-mile page | "PI-23: Resources reaching service-delivery units" | "Do resources reach service-delivery units? (PEFA PI-23)" | Plain-language front, technical code after. |

## Compare View

| Current label | Suggested revision |
| --- | --- |
| "Govt health spending (% of gov't budget)" | "Government health spending (% of government spending)" |
| "Out-of-pocket (% of CHE)" | "Out-of-pocket share of health spending" |
| "External health spending (% of CHE)" | "External share of health spending" |
| "SDG 3.8 target" | "WHO high-coverage reference (80)" |
| "DPT3 immunization (%)" | "DTP3 immunization coverage (%)" |
| "Measles MCV1 (%)" | "Measles first-dose coverage (MCV1)" |
| "ART coverage (%)" | "HIV treatment coverage (ART)" |

## Highest-Priority Fixes

1. Replace visible acronyms in KPI labels where possible: CHE, GGE, GGHE-D, PCBE, CFA, OOP.
2. Correct UHC 80 wording from "SDG 3.8 target" to "WHO high-coverage reference".
3. Correct government revenue tooltip so 15% is tied to tax revenue, not total revenue excluding grants.
4. Replace binary status labels such as "PROTECTED" and "CRITICAL" with graded, less deterministic wording.
5. Add "relative to income-group peers" near every fiscal-space score and verdict.
6. Standardize tooltip language around thresholds as "targets" only when they are formal targets, otherwise "reference points" or "watch lines".
