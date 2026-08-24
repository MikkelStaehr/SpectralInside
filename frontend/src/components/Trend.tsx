/**
 * Udviklingen gennem trinnet, én lille kurve pr. klasse.
 *
 * Small multiples, som moodboardets lotanalysis. Tabellen ovenfor svarer på
 * "hvor stor er hver klasse", og den bruger en fælles akse, fordi det er et
 * spørgsmål om størrelser. Den her svarer på "hvilken vej går den", og det er
 * et spørgsmål pr. klasse.
 *
 * Derfor har hvert felt sin egen y-skala. En fælles skala ville flade de små
 * klasser helt ud: Foreign ligger omkring 0,85, Burresnerre omkring 0,05, og
 * på Foreigns skala ville Burresnerres kurve være en vandret streg. Til
 * gengæld må man ikke sammenligne felternes højder med hinanden, og det er
 * netop derfor størrelserne står i tabellen ovenfor med fælles akse.
 *
 * Emphasis: den prøve, man ser på, er markeret. Resten af kurven er kontekst i
 * gråt. Ingen akser, ingen gitterlinjer, ingen tal på de øvrige punkter.
 *
 * d3-scale og d3-shape regner, de tegner ikke. Sammenlagt omkring 11 kB, og
 * udseendet forbliver vores.
 */

import { useState } from "react";
import { scaleLinear } from "d3-scale";
import { area, curveMonotoneX, line } from "d3-shape";
import type { LotSample, Metric } from "../types";
import { formatMetric } from "../lots";

interface Props {
  metrics: Metric[];
  /** Alle prøver i trinnet, sorteret efter prøvenummer. */
  scope: LotSample[];
  /** Den prøve, man ser på. Markeres i hver kurve. */
  current: LotSample;
}

const W = 190;
const H = 62;
const PAD = 9;

export function Trend({ metrics, scope, current }: Props) {
  // Under tre prøver er der ingen udvikling at se, kun en streg mellem to
  // punkter, og det siger delta-tallet allerede.
  if (scope.length < 3) return null;

  const here = Math.max(
    0,
    scope.findIndex((s) => s.id === current.id),
  );

  return (
    <div className="trend">
      {metrics.map((metric) => (
        <Panel key={metric.id} metric={metric} scope={scope} here={here} />
      ))}
    </div>
  );
}

function Panel({
  metric,
  scope,
  here,
}: {
  metric: Metric;
  scope: LotSample[];
  /** Indeks på den prøve, man ser på. Markeret, og udgangspunkt for tastaturet. */
  here: number;
}) {
  // Hvilket punkt pegepinden er nærmest. null betyder ingen berøring, og så
  // vises den prøve, man ser på.
  const [at, setAt] = useState<number | null>(null);

  const points = scope.map((s) => s.metrics[metric.id]);
  if (points.some((v) => v === undefined)) return null;
  const values = points as number[];

  const x = scaleLinear()
    .domain([0, values.length - 1])
    .range([PAD, W - PAD]);

  const low = Math.min(...values);
  const high = Math.max(...values);
  // En helt flad række ville dividere med nul. Den tegnes gennem midten.
  const y =
    high === low
      ? () => H / 2
      : scaleLinear().domain([low, high]).range([H - PAD, PAD]);

  const path = line<number>()
    .x((_, i) => x(i))
    .y((v) => y(v))
    .curve(curveMonotoneX)(values);

  const under = area<number>()
    .x((_, i) => x(i))
    .y0(H)
    .y1((v) => y(v))
    .curve(curveMonotoneX)(values);

  const shown = at ?? here;
  const band = W / values.length;

  const move = (step: number) =>
    setAt((now) => {
      const next = (now ?? here) + step;
      return next < 0 || next >= values.length ? (now ?? here) : next;
    });

  return (
    <figure className="trend__panel">
      <figcaption>
        <span className="trend__label">{metric.label}</span>
        <span className="trend__value">
          {formatMetric(values[here], metric.unit)}
        </span>
      </figcaption>

      <div
        className="trend__plot"
        // Feltet er det, man tabber til, ikke hvert enkelt punkt. Ti felter
        // med op til ti punkter ville ellers give hundrede tabstop.
        tabIndex={0}
        role="group"
        aria-label={`${metric.label} gennem ${values.length} prøver. Piletaster bladrer mellem prøverne.`}
        // Samme oplysninger ved tastaturfokus som ved pegepind. Fokus viser
        // den prøve, man ser på, og piletasterne bladrer derfra.
        onFocus={() => setAt(here)}
        onBlur={() => setAt(null)}
        onPointerLeave={() => setAt(null)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            event.preventDefault();
            move(-1);
          }
          if (event.key === "ArrowRight") {
            event.preventDefault();
            move(1);
          }
          if (event.key === "Escape") setAt(null);
        }}
      >
        <svg viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {under && <path className="trend__area" d={under} />}
          {path && <path className="trend__line" d={path} />}

          {/* Krydshåret finder x'et. Man sigter efter en prøve, aldrig efter
              en prik på fire pixels. */}
          {at !== null && (
            <line
              className="trend__cross"
              x1={x(shown)}
              x2={x(shown)}
              y1={0}
              y2={H}
              vectorEffect="non-scaling-stroke"
            />
          )}

          {values.map((v, i) => (
            <circle
              key={i}
              className={
                i === here ? "trend__here" : i === shown ? "trend__on" : "trend__dot"
              }
              cx={x(i)}
              cy={y(v)}
              r={i === here || i === shown ? 4 : 2}
            />
          ))}

          {/* Trykfelterne. Ét bånd pr. prøve i fuld højde, så pegepinden kun
              skal være nærmest og ikke ramme prikken. Ved tre prøver er hvert
              bånd omkring 65 px bredt på skærmen, altså langt over de 24 px,
              en prik aldrig kan leve op til. */}
          {values.map((_, i) => (
            <rect
              key={i}
              className="trend__hit"
              x={i * band}
              y={0}
              width={band}
              height={H}
              onPointerEnter={() => setAt(i)}
              onPointerDown={() => setAt(i)}
            />
          ))}
        </svg>

        {/* Værdien først, etiketten efter: læseren har allerede klassen og
            vil have tallet. */}
        {at !== null && (
          <p className="trend__tip" role="status">
            <strong>{formatMetric(values[shown], metric.unit)}</strong>
            <span>
              Prøve #{scope[shown].seq}
              {shown === here && " · denne"}
            </span>
          </p>
        )}
      </div>
    </figure>
  );
}
