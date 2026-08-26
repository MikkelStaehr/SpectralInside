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
 *
 * Tallet står i sit eget felt. Et trin på 5 % kan ikke rumme "FV3 5,2 %", og
 * det er ikke et layoutproblem, det er selve målet: den dårlige ende *skal*
 * være smal. Derfor måles hvert felt, og de trin, der ikke kan bære deres egen
 * label, samles på en linje under søjlen.
 *
 * Labelen skrumper ikke til et nøgent tal. "FV1 25,3 %" ved siden af "12,1 %"
 * i samme søjle tvinger læseren til at tælle sig frem til hvad det andet tal
 * hører til. Enten står navn og værdi sammen, eller også står trinnet under
 * søjlen — så siger hvert tal selv hvad det er, og hvert trin står ét sted.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LotSample, Metric } from "../types";
import { formatMetric } from "../lots";

interface Props {
  /** Metrikkerne i gruppen, i skalaens rækkefølge. */
  metrics: Metric[];
  sample: LotSample;
  /**
   * Signaturen under søjlen. Den deler linje med de trin, der ikke kunne være
   * i søjlen, så der er én linje under søjlen og ikke to.
   */
  note?: string;
}

/** Skriften i feltet. Skal matche `.stack__inline` i styles.css. */
const INLINE_FONT = '600 13px "Inter Variable", Inter, system-ui, sans-serif';

/** Luft i hver side af teksten, så den ikke klistrer til fugen. */
const INLINE_PAD = 16;

/**
 * Feltets bredde måles, den gættes ikke. Et gæt på tegnbredder rammer ved
 * siden af på præcis de smalle felter, hvor det betyder noget.
 */
const textWidth = (() => {
  let ctx: CanvasRenderingContext2D | null | undefined;
  return (text: string) => {
    if (ctx === undefined) ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return text.length * 7.6;
    ctx.font = INLINE_FONT;
    return ctx.measureText(text).width;
  };
})();

export function Stack({ metrics, sample, note }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  // Bredden afhænger af kortet, ikke af data. Kortene er smalle, prøvevisningen
  // er bred, og det samme lot skal se rigtigt ud begge steder.
  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    setWidth(el.getBoundingClientRect().width);
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Skriften er pakket med og hentes ikke fra nettet, men den er stadig ikke
  // nødvendigvis klar ved første maling. Måler vi før, bliver felterne målt med
  // reserveskriften, og et grænsetilfælde lander forkert.
  const [fontReady, setFontReady] = useState(() => !document.fonts);
  useEffect(() => {
    let live = true;
    document.fonts?.ready.then(() => live && setFontReady(true));
    return () => {
      live = false;
    };
  }, []);

  const parts = metrics
    .map((metric) => ({ metric, value: sample.metrics[metric.id] }))
    .filter((p): p is { metric: Metric; value: number } => p.value !== undefined);

  const total = parts.reduce((sum, p) => sum + p.value, 0);
  if (total <= 0) return null;

  const measurable = width > 0 && fontReady;
  const last = Math.max(1, parts.length - 1);
  const laid = parts.map((p, i) => {
    const share = p.value / total;
    const box = share * width;
    const value = formatMetric(p.value, p.metric.unit);
    const full = `${p.metric.label} ${value}`;
    const inline = measurable && box >= textWidth(full) + INLINE_PAD;

    return {
      ...p,
      share,
      value,
      inline: inline ? full : null,
      // Trin for trin fra lys til moerk. Det foerste trin er den gode ende,
      // saa det er ogsaa det lyseste.
      opacity: 0.22 + (i / last) * 0.78,
    };
  });

  // Foer der er maalt, staar soejlen uden tal. Det er ét billede mindre end at
  // vise alle fire trin under soejlen og saa se dem hoppe op i den.
  const rest = measurable ? laid.filter((p) => !p.inline) : [];

  return (
    <div className="stack">
      <div className="stack__bar" ref={bar}>
        {laid.map((p) => (
          <span
            key={p.metric.id}
            className="stack__part"
            style={{ width: `${p.share * 100}%` }}
            title={`${p.metric.label}: ${p.value}`}
          >
            {/* Fyldet ligger for sig, saa gennemsigtigheden ikke ogsaa
                blegner tallet ovenpaa. */}
            <span
              className="stack__fill"
              style={{ opacity: p.opacity }}
              aria-hidden="true"
            />
            {/* Lys skrift paa de moerke trin, moerk paa de lyse. Graensen
                ligger, hvor fyldet holder op med at baere moerk tekst. */}
            {p.inline && (
              <span
                className={`stack__inline${p.opacity >= 0.55 ? " stack__inline--light" : ""}`}
              >
                {p.inline}
              </span>
            )}
          </span>
        ))}
      </div>

      {(note || rest.length > 0) && (
        <div className="stack__foot">
          {note && <p className="stack__note">{note}</p>}
          {rest.length > 0 && (
            <ul className="stack__rest">
              {rest.map((p) => (
                <li key={p.metric.id}>
                  <span
                    className="stack__swatch"
                    style={{ opacity: p.opacity }}
                    aria-hidden="true"
                  />
                  <span className="stack__name">{p.metric.label}</span>
                  <strong>{p.value}</strong>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
