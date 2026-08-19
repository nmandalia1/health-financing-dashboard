import type { IndicatorTimeSeries } from "./types";

interface SeriesPoint {
  year: number;
  value: number;
}

function firstLast(series?: IndicatorTimeSeries[]): {
  first: SeriesPoint;
  last: SeriesPoint;
} | null {
  if (!series || series.length < 2) return null;
  return { first: series[0], last: series[series.length - 1] };
}

function latest(series?: IndicatorTimeSeries[]): SeriesPoint | null {
  if (!series || series.length === 0) return null;
  return series[series.length - 1];
}

function pct(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

function directionVerb(delta: number): "rose" | "fell" | "stayed flat" {
  if (Math.abs(delta) < 1) return "stayed flat";
  return delta > 0 ? "rose" : "fell";
}

/**
 * Auto-generate 2–4 short sentences describing a country's financing
 * landscape. Each sentence is independent — we skip ones where data is
 * missing rather than emitting wobbly claims.
 */
export function generateFinancingInsight(args: {
  countryName: string;
  govt: IndicatorTimeSeries[];
  oop: IndicatorTimeSeries[];
  ext: IndicatorTimeSeries[];
  chePC: IndicatorTimeSeries[];
  govtGGE: IndicatorTimeSeries[];
}): string[] {
  const { countryName, govt, oop, ext, chePC, govtGGE } = args;
  const sentences: string[] = [];

  // Government share trend
  const govtFl = firstLast(govt);
  if (govtFl) {
    const delta = govtFl.last.value - govtFl.first.value;
    const verb = directionVerb(delta);
    if (verb === "stayed flat") {
      sentences.push(
        `${countryName}'s government share of health spending has held near ${pct(
          govtFl.last.value
        )} of CHE between ${govtFl.first.year} and ${govtFl.last.year}.`
      );
    } else {
      sentences.push(
        `${countryName}'s government share of health spending has ${verb} from ${pct(
          govtFl.first.value
        )} to ${pct(govtFl.last.value)} of CHE between ${
          govtFl.first.year
        } and ${govtFl.last.year}.`
      );
    }
  }

  // External dependency
  const extFl = firstLast(ext);
  if (extFl && Math.max(extFl.first.value, extFl.last.value) >= 5) {
    const delta = extFl.last.value - extFl.first.value;
    const verb = directionVerb(delta);
    if (verb === "fell") {
      sentences.push(
        `External financing's share of CHE has ${verb} from ${pct(
          extFl.first.value
        )} to ${pct(extFl.last.value)} over the same period — a sign of reduced donor reliance.`
      );
    } else if (verb === "rose") {
      sentences.push(
        `Donor financing's share of CHE has ${verb} from ${pct(
          extFl.first.value
        )} to ${pct(extFl.last.value)}, pointing to deepening aid dependency.`
      );
    }
  }

  // Out-of-pocket burden
  const oopLatest = latest(oop);
  if (oopLatest) {
    if (oopLatest.value >= 40) {
      sentences.push(
        `Out-of-pocket payments account for ${pct(
          oopLatest.value
        )} of health spending (${oopLatest.year}) — well above the WHO 20% threshold, indicating serious financial-protection gaps.`
      );
    } else if (oopLatest.value >= 20) {
      sentences.push(
        `Out-of-pocket payments stand at ${pct(
          oopLatest.value
        )} of CHE (${oopLatest.year}), above the WHO 20% benchmark for adequate protection.`
      );
    } else {
      sentences.push(
        `Out-of-pocket payments are ${pct(
          oopLatest.value
        )} of CHE (${oopLatest.year}) — below the WHO 20% threshold.`
      );
    }
  }

  // Fiscal priority (Abuja 15%)
  const ggeLatest = latest(govtGGE);
  if (ggeLatest) {
    if (ggeLatest.value >= 15) {
      sentences.push(
        `Health receives ${pct(
          ggeLatest.value,
          1
        )} of the government budget (${ggeLatest.year}), meeting the Abuja 15% target.`
      );
    } else if (ggeLatest.value >= 10) {
      sentences.push(
        `Health receives ${pct(
          ggeLatest.value,
          1
        )} of the government budget (${ggeLatest.year}), approaching but below the Abuja 15% target.`
      );
    } else {
      sentences.push(
        `Health receives just ${pct(
          ggeLatest.value,
          1
        )} of the government budget (${ggeLatest.year}), far below the Abuja 15% commitment.`
      );
    }
  }

  // Real spending growth
  const pcFl = firstLast(chePC);
  if (pcFl && pcFl.first.value > 0) {
    const growth = ((pcFl.last.value - pcFl.first.value) / pcFl.first.value) * 100;
    if (Math.abs(growth) >= 10) {
      const verb =
        growth > 0 ? "has grown" : "has fallen";
      sentences.push(
        `Per-capita health spending ${verb} by ${Math.abs(growth).toFixed(
          0
        )}% in nominal USD from ${pcFl.first.year} ($${pcFl.first.value.toFixed(
          0
        )}) to ${pcFl.last.year} ($${pcFl.last.value.toFixed(0)}).`
      );
    }
  }

  return sentences;
}
