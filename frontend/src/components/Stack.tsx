/**
 * En fordeling over en **ordnet** skala, tegnet som én stablet søjle.
 *
 * FV0 til FV3 er ikke kategorier, de er trin: FV1 er dårligere end FV0 og
 * bedre end FV2. Derfor må de ikke have hver sin farve. Fire farver på en
 * skala er den klassiske fejl, hvor farven holder op med at betyde noget, og
 * hvor øjet ikke kan se hvilken ende der er den gode.
 *
 * I stedet: én kulør fra lys til mørk, i skalaens egen rækkefølge. Så kan
 * lottet læses på et halvt sekund. Jo mere lyst, jo bedre er frøet, og jo mere
 * den mørke ende fylder, jo værre. Lægger man prøverne under hinanden gennem
 * trinnet, ser man den mørke ende skrumpe, mens der bliver renset.
 *
 * Segmenterne har en 2 px lys fuge imellem sig frem for en kant. En kant om
 * hvert felt ville lægge en streg oven i den skala, felterne selv udgør.
 */

import type { LotSample, Metric } from "../types";
import { formatMetric } from "../lots";

interface Props {
  /** Metrikkerne i gruppen, i skalaens rækkefølge. */
  metrics: Metric[];
  sample: LotSample;
  /** Vis navn og værdi under søjlen. Slås fra, hvor pladsen er trang. */
  legend?: boolean;
}

export function Stack({ metrics, sample, legend = true }: Props) {
  const parts = metrics
    .map((metric) => ({ metric, value: sample.metrics[metric.id] }))
    .filter((p): p is { metric: Metric; value: number } => p.value !== undefined);

  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return null;

  return (
    <div className="stack">
      <div className="stack__bar">
        {parts.map((p, i) => (
          <span
            key={p.metric.id}
            className="stack__part"
            // Trin for trin fra lys til moerk. Det foerste trin er den gode
            // ende, saa det er ogsaa det lyseste.
            style={{
              width: `${(p.value / total) * 100}%`,
              // Ikke fire farver, men fire trin af den samme.
              opacity: 0.22 + (i / Math.max(1, parts.length - 1)) * 0.78,
            }}
            title={`${p.metric.label}: ${formatMetric(p.value, p.metric.unit)}`}
          />
        ))}
      </div>

      {legend && (
        <ul className="stack__key">
          {parts.map((p, i) => (
            <li key={p.metric.id}>
              <span
                className="stack__swatch"
                style={{
                  opacity: 0.22 + (i / Math.max(1, parts.length - 1)) * 0.78,
                }}
                aria-hidden="true"
              />
              <span className="stack__name">{p.metric.label}</span>
              <strong>{formatMetric(p.value, p.metric.unit)}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
