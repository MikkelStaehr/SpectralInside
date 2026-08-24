/**
 * Klasserne i én prøve: navn, værdi, ændring og hvor stor klassen er.
 *
 * Søjlen koder **værdien**, ikke bevægelsen. Det er et bevidst skifte fra
 * første udgave, hvor sporet viste forrige prøve mod denne på en fælles akse.
 * Den akse virker ikke til bevægelser her: værdierne spænder fra 0,05 til
 * 0,85, ændringerne fra 0,02 til 0,25, og på den skala blev netop de rækker,
 * man vil undersøge, til få pixels. Samtidig stod hver ændring tre gange, som
 * absolut tal, som procent og som en streglængde.
 *
 * Til værdierne virker den fælles akse derimod. Foreign er reelt sytten gange
 * Burresnerre, og en søjle siger det på et halvt sekund, hvor ni tal med to
 * decimaler skal læses ét ad gangen.
 *
 * Bevægelsen bæres af tallet i ændringskolonnen, plus et hårfint mærke, hvor
 * den forrige prøve lå. Ét stille mærke i stedet for to punkter, en
 * forbindelsesstreg og en mærkat.
 *
 * Rækkefølgen er modellens egen og ikke sorteret efter størrelse. Den er den
 * samme fra prøve til prøve, og en tabel, hvor rækkerne bytter plads, hver
 * gang et tal ændrer sig, kan man ikke sammenligne to prøver i.
 */

import { scaleLinear } from "d3-scale";
import type { LotSample, Metric } from "../types";
import {
  deltaClass,
  deltaFor,
  formatDelta,
  formatMetric,
  formatShare,
  type Thresholds,
} from "../lots";
import { Icon } from "./Icon";

interface Props {
  metrics: Metric[];
  current: LotSample;
  /** De tidligere prøver i trinnet, ældst først. Vises som mærker på søjlen. */
  earlier: LotSample[];
  thresholds: Thresholds;
}

const tick = new Intl.NumberFormat("da-DK", { maximumFractionDigits: 2 });

export function MetricTable({ metrics, current, earlier, thresholds }: Props) {
  const previous = earlier.length ? earlier[earlier.length - 1] : undefined;

  const rows = metrics
    .map((metric) => ({
      metric,
      now: current.metrics[metric.id],
      marks: earlier
        .map((s) => ({ seq: s.seq, value: s.metrics[metric.id] }))
        .filter((m): m is { seq: number; value: number } => m.value !== undefined),
    }))
    .filter((r): r is { metric: Metric; now: number; marks: { seq: number; value: number }[] } =>
      r.now !== undefined,
    );

  if (rows.length === 0) return null;

  // Aksen skal ende på et tal, man kan læse. Før stod der "største værdi gange
  // 1,06", altså et vilkårligt tal som 1,17, der lignede data uden at være
  // det. nice() runder domænet af til et helt trin.
  const highest = Math.max(
    ...rows.flatMap((r) => [r.now, ...r.marks.map((m) => m.value)]),
  );
  const scale = scaleLinear()
    .domain([0, highest > 0 ? highest : 1])
    .nice(4);
  const max = scale.domain()[1];
  const pct = (v: number) => `${(v / max) * 100}%`;
  const unit = rows[0].metric.unit;

  // Aksemaerkerne. De ligger jaevnt fra nul, saa afstanden mellem to af dem er
  // den samme hele vejen, og gitterlinjerne i sporet kan tegnes som ét
  // gentaget moenster i stedet for ét element pr. linje pr. raekke.
  const ticks = scale.ticks(4);
  const step = ticks.length > 1 ? (ticks[1] / max) * 100 : 100;

  return (
    <div className="classes">
      {/* Staar foer tabellen og ikke efter. Man skal vide hvad soejlen maaler
          op imod, foer man laeser den, ikke bagefter. */}
      <p className="classes__how">
        Søjlen viser klassens størrelse på en skala fra 0 til{" "}
        <strong>
          {tick.format(max)} {unit}
        </strong>
        .
        {earlier.length > 0 && (
          <>
            {" "}
            Mærkerne er de tidligere prøver, med prøvens nummer over. Skalaen
            dækker også dem, så deres mærker kan stå på søjlen.
          </>
        )}
      </p>

      <table className="classes__table">
        <thead>
          <tr>
            <th scope="col">Klasse</th>
            <th scope="col" className="num">
              Værdi
            </th>
            <th scope="col" className="num">
              {previous ? `Mod prøve #${previous.seq}` : "Ændring"}
            </th>
            {/* Alle aksens maerker, ikke kun de to yderste. To tal i hver ende
                laeses som to maalinger, en raekke jaevnt fordelte tal laeses
                som en akse. */}
            <th scope="col" className="classes__bar-head">
              {ticks.map((t) => (
                <span key={t} style={{ left: `${(t / max) * 100}%` }}>
                  {tick.format(t)}
                </span>
              ))}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ metric, now, marks }) => {
            const delta = deltaFor(metric, current, previous, thresholds);
            const share = formatShare(delta);

            return (
              <tr key={metric.id}>
                <th scope="row">{metric.label}</th>

                <td className="num">
                  <span className="classes__value">
                    {formatMetric(now, metric.unit)}
                  </span>
                </td>

                {/* Absolut og relativ ændring i den samme celle. To kolonner
                    til det samme tal fik skærmen til at sige den samme ting
                    to gange. */}
                <td className="num">
                  {delta ? (
                    <span className={deltaClass(delta)}>
                      <Icon
                        name={
                          delta.direction === "flat"
                            ? "minus"
                            : delta.direction === "up"
                              ? "arrow-up"
                              : "arrow-down"
                        }
                        size={14}
                        strokeWidth={2.6}
                      />
                      {formatDelta(delta)}
                      {share && <em>{share}</em>}
                    </span>
                  ) : (
                    <span className="delta delta--none">første prøve</span>
                  )}
                </td>

                <td>
                  <span
                    className="classes__bar"
                    // Gitterlinjerne staar paa aksens maerker. Uden dem maales
                    // soejlen kun op mod kassens to kanter, og saa er den en
                    // dekoration frem for en maaling.
                    style={{ "--tick": `${step}%` } as React.CSSProperties}
                    title={[
                      `${metric.label}: ${formatMetric(now, unit)}`,
                      ...marks.map(
                        (m) => `#${m.seq}: ${formatMetric(m.value, unit)}`,
                      ),
                    ].join(", ")}
                  >
                    <span className="classes__fill" style={{ width: pct(now) }} />

                    {/* Ét mærke pr. tidligere prøve, med sit nummer over sig.
                        Uden nummeret kunne man se at klassen havde flyttet
                        sig, men ikke hvorfra, og med flere end én tidligere
                        prøve var mærkerne slet ikke til at skelne. Det seneste
                        står stærkest, de ældre træder tilbage. */}
                    {marks.map((m, i) => (
                      <span
                        key={m.seq}
                        className={`classes__was${
                          i === marks.length - 1 ? " classes__was--recent" : ""
                        }`}
                        style={{ left: pct(m.value) }}
                      >
                        <em>{m.seq}</em>
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

    </div>
  );
}
