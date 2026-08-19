/** Indicators available in the Compare view, grouped by theme. */
export interface CompareIndicator {
  code: string;
  label: string;
  unit: string;
  /** Plotly hover format, e.g. "%{y:.1f}%" */
  hoverValue: string;
  /** Optional benchmark line */
  benchmark?: { value: number; label: string };
}

export interface CompareIndicatorGroup {
  label: string;
  items: CompareIndicator[];
}

export const COMPARE_INDICATOR_GROUPS: CompareIndicatorGroup[] = [
  {
    label: "Financing",
    items: [
      {
        code: "GHED_CHEGDP_SHA2011",
        label: "Health spending (% of GDP)",
        unit: "%",
        hoverValue: "%{y:.2f}%",
      },
      {
        code: "GHED_CHE_pc_US_SHA2011",
        label: "Health spending per capita (USD)",
        unit: " USD",
        hoverValue: "$%{y:,.0f}",
      },
      {
        code: "GHED_GGHE-DGGE_SHA2011",
        label: "Government health spending (% of government spending)",
        unit: "%",
        hoverValue: "%{y:.1f}%",
        benchmark: { value: 15, label: "Abuja 15%" },
      },
      {
        code: "GHED_OOPSCHE_SHA2011",
        label: "Out-of-pocket share of health spending",
        unit: "%",
        hoverValue: "%{y:.1f}%",
        benchmark: { value: 20, label: "WHO < 20% threshold" },
      },
      {
        code: "GHED_EXTCHE_SHA2011",
        label: "External share of health spending",
        unit: "%",
        hoverValue: "%{y:.1f}%",
      },
    ],
  },
  {
    label: "Outcomes",
    items: [
      {
        code: "WHOSIS_000001",
        label: "Life expectancy at birth (years)",
        unit: " yrs",
        hoverValue: "%{y:.1f} yrs",
      },
      {
        code: "UHC_INDEX_REPORTED",
        label: "UHC Service Coverage Index",
        unit: "",
        hoverValue: "%{y:.0f}",
        benchmark: { value: 80, label: "WHO high-coverage reference (80)" },
      },
      {
        code: "MDG_0000000001",
        label: "Under-5 mortality (per 1,000 live births)",
        unit: "",
        hoverValue: "%{y:.1f} / 1k",
      },
      {
        code: "SH.STA.MMRT",
        label: "Maternal mortality ratio (per 100k live births)",
        unit: "",
        hoverValue: "%{y:.0f} / 100k",
      },
    ],
  },
  {
    label: "Coverage",
    items: [
      {
        code: "WUENIC_DTP3",
        label: "DTP3 immunization coverage (%)",
        unit: "%",
        hoverValue: "%{y:.0f}%",
        benchmark: { value: 90, label: "WHO 90% target" },
      },
      {
        code: "WUENIC_MCV1",
        label: "Measles first-dose coverage (MCV1)",
        unit: "%",
        hoverValue: "%{y:.0f}%",
        benchmark: { value: 95, label: "Measles elimination (95%)" },
      },
      {
        code: "SH.HIV.ARTC.ZS",
        label: "HIV treatment coverage (ART)",
        unit: "%",
        hoverValue: "%{y:.0f}%",
      },
    ],
  },
];

export function findCompareIndicator(code: string): CompareIndicator | null {
  for (const g of COMPARE_INDICATOR_GROUPS) {
    for (const i of g.items) if (i.code === code) return i;
  }
  return null;
}
