/**
 * Alle prøver i ét (proces, testtype).
 *
 * Det er den her tabel, skærmen findes for. Proceskortene ovenfor siger, hvor
 * man står nu. Tabellen siger, om det er ved at blive bedre, og hvad der blev
 * gjort undervejs, og det spørgsmål skal kunne besvares med ét blik.
 *
 * Derfor står justeringen på samme række som det resultat, den frembragte, og
 * ikke i en kolonne for sig i den anden ende. Rækken læses som en sætning:
 * "vi skruede slibetrykket ned, og så faldt skaderne med 1,2".
 */

import type { LotSample, TestType } from "../types";
import {
  deltaClass,
  deltaFor,
  formatDelta,
  formatMetric,
  type Thresholds,
} from "../lots";
import { Icon } from "./Icon";

const time = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

interface Props {
  testType: TestType | undefined;
  processLabel: string;
  /** Prøverne i netop dette (proces, testtype), sorteret efter prøvenummer. */
  scope: LotSample[];
  thresholds: Thresholds;
  onOpenSample: (sampleId: number) => void;
}

export function SampleHistory({
  testType,
  processLabel,
  scope,
  thresholds,
  onOpenSample,
}: Props) {
  if (!testType) return null;

  return (
    <section className="history">
      <header className="history__head">
        <h2>
          {processLabel} · {testType.label}
        </h2>
        <p>
          {scope.length === 0
            ? "Ingen prøver endnu"
            : scope.length === 1
              ? "1 prøve"
              : `${scope.length} prøver`}
        </p>
      </header>

      {scope.length === 0 ? (
        <p className="empty">
          Der er ikke taget prøver af {testType.label} på dette trin endnu.
        </p>
      ) : (
        <div className="history__scroll">
          <table className="history__table">
            <thead>
              <tr>
                <th scope="col">Prøve</th>
                <th scope="col">Tidspunkt</th>
                {testType.metrics.map((metric) => (
                  <th key={metric.id} scope="col" className="num">
                    {metric.label}
                  </th>
                ))}
                <th scope="col">Justering</th>
                <th scope="col">Kvitteret</th>
              </tr>
            </thead>
            <tbody>
              {/* Nyeste øverst. Den er den, nogen står og kigger efter, og
                  den skal ikke findes i bunden af en voksende tabel. */}
              {[...scope].reverse().map((sample, index) => {
                const position = scope.length - 1 - index;
                const previous = position > 0 ? scope[position - 1] : undefined;
                const newest = position === scope.length - 1;

                return (
                  // Hele rækken åbner prøven. Det er sidste led i hierarkiet,
                  // og det er dér billederne og alle oplysningerne ligger.
                  <tr
                    key={sample.id}
                    className={`history__row${newest ? " history__row--latest" : ""}${
                      sample.acknowledged_at === null ? " history__row--new" : ""
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpenSample(sample.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onOpenSample(sample.id);
                      }
                    }}
                  >
                    <th scope="row">
                      #{sample.seq}
                      <Icon
                        name="chevron-right"
                        size={15}
                        strokeWidth={2.2}
                        className="history__go"
                      />
                    </th>
                    <td>{time.format(new Date(sample.taken_at))}</td>

                    {testType.metrics.map((metric) => {
                      const delta = deltaFor(
                        metric,
                        sample,
                        previous,
                        thresholds,
                      );
                      return (
                        <td key={metric.id} className="num">
                          <span className="history__value">
                            {formatMetric(sample.metrics[metric.id], metric.unit)}
                          </span>
                          {delta && (
                            <span className={deltaClass(delta)}>
                              <Icon
                                name={
                                  delta.direction === "flat"
                                    ? "minus"
                                    : delta.direction === "up"
                                      ? "arrow-up"
                                      : "arrow-down"
                                }
                                size={13}
                                strokeWidth={2.6}
                              />
                              {formatDelta(delta)}
                            </span>
                          )}
                        </td>
                      );
                    })}

                    <td className="history__adjustment">
                      {sample.adjustment ?? (
                        <span className="muted">ingen ændring</span>
                      )}
                    </td>

                    <td>
                      {sample.acknowledged_at ? (
                        <span className="history__acked">
                          <Icon name="check" size={14} strokeWidth={2.6} />
                          {sample.acknowledged_by}
                        </span>
                      ) : (
                        <span className="history__pending">Ikke kvitteret</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
