/**
 * Regnestykkerne bag operatørskærmen.
 *
 * Ligger for sig, fordi de bruges tre steder: i proceskortet, i historikken og
 * i sparklines. Stod de i komponenterne, ville "er det blevet bedre" kunne
 * blive besvaret på tre lidt forskellige måder på den samme skærm.
 *
 * Bemærk at ingen af dem kender metrikkernes navne. Retningen kommer fra
 * `metric.better`, som kommer fra serveren.
 */

import type { LotSample, Metric, ProcessId, TestTypeId } from "./types";

export interface Delta {
  value: number;
  /** Ændringen som andel af den foregående værdi. null når den var nul. */
  share: number | null;
  /** Fortegnet. Siger intet om, hvorvidt det er gået den rigtige vej. */
  direction: "up" | "down" | "flat";
  /** null når ændringen er under tærsklen, altså når der reelt ikke skete noget. */
  improved: boolean | null;
}

/** De to grænser for hvornår en ændring er for lille til at vise. Fra serveren. */
export interface Thresholds {
  flat: number;
  relative: number;
}

/** Prøverne i ét (proces, testtype), i den rækkefølge de blev taget. */
export function samplesIn(
  samples: LotSample[],
  process: ProcessId,
  testType: TestTypeId,
): LotSample[] {
  return samples
    .filter((s) => s.process === process && s.test_type === testType)
    .sort((a, b) => a.seq - b.seq);
}

export function latestIn(
  samples: LotSample[],
  process: ProcessId,
  testType: TestTypeId,
): LotSample | null {
  const scope = samplesIn(samples, process, testType);
  return scope.length ? scope[scope.length - 1] : null;
}

/**
 * Ændringen fra den foregående prøve i samme (lot, proces, testtype).
 *
 * Farven afhænger af metrikkens retning og ikke af fortegnet: Sugarbeet skal
 * op, alt andet skal ned.
 *
 * En ændring regnes for uændret, når den er lille **både** absolut og i
 * forhold til det, den måles på. Med ét absolut tal alene rammer tærsklen
 * skævt, når metrikkerne ligger i vidt forskellige størrelsesordener:
 * Sugarbeet ligger omkring 97, Pileurt omkring 0,08. 0,25 -> 0,20 er kun 0,05
 * absolut, men en femtedel af værdien, og det er en rigtig ændring. 97,60 ->
 * 97,62 er derimod begge dele små, og det er støj.
 */
export function deltaFor(
  metric: Metric,
  current: LotSample,
  previous: LotSample | undefined,
  thresholds: Thresholds,
): Delta | null {
  if (!previous) return null;

  const now = current.metrics[metric.id];
  const before = previous.metrics[metric.id];
  if (now === undefined || before === undefined) return null;

  const value = now - before;
  const share = before === 0 ? null : value / before;

  const smallAbsolute = Math.abs(value) < thresholds.flat;
  const smallRelative = share === null || Math.abs(share) < thresholds.relative;
  if (smallAbsolute && smallRelative) {
    return { value, share, direction: "flat", improved: null };
  }

  const rose = value > 0;
  return {
    value,
    share,
    direction: rose ? "up" : "down",
    improved: metric.better === "higher" ? rose : !rose,
  };
}

const percent = new Intl.NumberFormat("da-DK", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * Ændringen som procent af den foregående værdi.
 *
 * Det er en anden oplysning end tallet i tabellen. Der står, hvor meget den
 * flyttede sig, her står hvor meget det var i forhold til, hvor den lå. Et
 * fald fra 1,10 til 0,85 er 0,25 og samtidig 23 %.
 */
export function formatShare(delta: Delta | null): string | null {
  if (!delta || delta.share === null || delta.direction === "flat") return null;
  return `${delta.share > 0 ? "+" : "−"}${percent.format(Math.abs(delta.share) * 100)} %`;
}

/** Prøven før denne, i samme (proces, testtype). */
export function previousOf(
  samples: LotSample[],
  sample: LotSample,
): LotSample | undefined {
  const scope = samplesIn(samples, sample.process, sample.test_type);
  const index = scope.findIndex((s) => s.id === sample.id);
  return index > 0 ? scope[index - 1] : undefined;
}

/** Værdierne for én metrik gennem hele trinnet. Grundlaget under sparklinen. */
export function seriesOf(scope: LotSample[], metricId: string): number[] {
  return scope
    .map((s) => s.metrics[metricId])
    .filter((v): v is number => v !== undefined);
}

const number = new Intl.NumberFormat("da-DK", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

export function formatMetric(value: number | undefined, unit = ""): string {
  if (value === undefined) return "–";
  return unit ? `${number.format(value)} ${unit}` : number.format(value);
}

/** Størrelsen af en ændring, uden fortegn. Pilen bærer retningen. */
export function formatDelta(delta: Delta): string {
  if (delta.direction === "flat") return "uændret";
  return number.format(Math.abs(delta.value));
}

/**
 * Klassenavnet, en ændring skal have.
 *
 * Fremgang er grøn, tilbagegang er rød, uændret er neutral. At det hedder det
 * samme uanset hvilken metrik der er tale om, er hele pointen: operatøren skal
 * ikke skulle huske, hvilken vej Renhed går.
 */
export function deltaClass(delta: Delta | null): string {
  if (!delta || delta.improved === null) return "delta delta--flat";
  return delta.improved ? "delta delta--better" : "delta delta--worse";
}

export interface Scope {
  process: ProcessId;
  testType: TestTypeId;
}

/**
 * Det første (proces, testtype) på lottet, der overhovedet har en prøve.
 *
 * Bruges når man skifter lot: står historikken på Post Cleaning, og det nye
 * lot kun er nået til Pre Cleaning, ville tabellen ellers stå tom uden at
 * fortælle hvorfor.
 */
export function firstScopeWithSamples(
  samples: LotSample[],
  order: { id: ProcessId; test_types: TestTypeId[] }[],
): Scope | null {
  for (const process of order) {
    for (const testType of process.test_types) {
      if (samplesIn(samples, process.id, testType).length > 0) {
        return { process: process.id, testType };
      }
    }
  }
  return null;
}

export function hasSamples(
  samples: LotSample[],
  process: ProcessId,
  testType: TestTypeId,
): boolean {
  return samplesIn(samples, process, testType).length > 0;
}

/**
 * Et tal, som en dansk operatør skriver det.
 *
 * `<input type="number">` afviser komma, og en operatør, der taster "1980,5",
 * får et tomt felt uden at få at vide hvorfor. Feltet er derfor tekst, og
 * konverteringen sker her: komma og punktum betyder det samme, og mellemrum og
 * tusindtalsseparatorer kastes væk.
 *
 * Returnerer `null` for tomt og `NaN` for noget, der ikke er et tal. De to er
 * ikke det samme: det ene er "ikke udfyldt endnu", det andet er en tastefejl,
 * og de skal besvares hver for sig.
 */
export function parseDecimal(raw: string): number | null {
  const clean = raw.trim().replace(/\s/g, "").replace(/\.(?=\d{3}\b)/g, "");
  if (clean === "") return null;
  return Number(clean.replace(",", "."));
}
