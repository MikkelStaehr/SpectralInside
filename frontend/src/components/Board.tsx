/**
 * Forsiden i produktionen: ét spor per anlæg.
 *
 * Skærmen skal svare på to ting, uden at nogen trykker på noget: hvad kører
 * lige nu på hvert anlæg, og hvad ligger klar bagefter. Det er de to
 * spørgsmål, en operatør har, når hun går forbi.
 *
 * Derfor er der ikke længere en "Start et lot"-knap, der fører til en liste af
 * ordrer. Køen *er* forsiden. At starte et lot er at trykke på den øverste i
 * køen, og så er der ét skridt frem for tre.
 *
 * Ordrekontoret har allerede bestemt, hvilket anlæg en ordre skal køre på, så
 * skærmen skal ikke spørge. Den viser bare det, kontoret har besluttet.
 *
 * Ingen indlogning: at skulle taste initialer for at læse et tal er friktion
 * uden formål, og initialerne beskytter alligevel ingenting.
 */

import { useMemo, useState } from "react";
import type { Line, LotSummary, Order } from "../types";
import { Icon } from "./Icon";

const when = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const clock = new Intl.DateTimeFormat("da-DK", {
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Om kørslen er forbi.
 *
 * Enten er den stemplet, eller også har nogen sat et sluttidspunkt. De to er
 * hver sin måde at være færdig på: stemplet er kvalitetens ja eller nej,
 * sluttidspunktet er linjens. Et parti kan være kørt uden at være bedømt.
 */
const isDone = (lot: LotSummary) => lot.stamp !== null || lot.ended_at !== null;

interface Props {
  lines: Line[];
  lots: LotSummary[];
  orders: Order[];
  onOpen: (lotNo: string) => void;
  onStart: (order: Order) => void;
}

export function Board({ lines, lots, orders, onOpen, onStart }: Props) {
  const [showDone, setShowDone] = useState(false);

  const running = lots.filter((lot) => !isDone(lot));
  const done = lots.filter(isDone);

  /**
   * Sporene, i den rækkefølge anlæggene står i lines.yaml.
   *
   * Til sidst et spor for det, der ikke passer på et anlæg. Det skal være der:
   * et lot, hvis linje er tom eller peger på et anlæg, der er blevet
   * omdøbt, ville ellers forsvinde fra skærmen uden at nogen opdagede det, og
   * et lot, der kører uden at kunne ses, er værre end intet lot.
   */
  const tracks = useMemo(() => {
    const known = new Set(lines.map((l) => l.id));
    const belongs = (value: string | null, id: string) => value === id;

    const named = lines.map((line) => ({
      line,
      running: running.filter((lot) => belongs(lot.line, line.id)),
      queue: orders.filter((order) => belongs(order.line, line.id)),
    }));

    const stray = {
      line: { id: "", label: "Uden anlæg", lead: null } as Line,
      running: running.filter((lot) => !lot.line || !known.has(lot.line)),
      queue: orders.filter((order) => !order.line || !known.has(order.line)),
    };

    return stray.running.length + stray.queue.length > 0
      ? [...named, stray]
      : named;
  }, [lines, running, orders]);

  return (
    <div className="board">
      <header className="board__head">
        <img className="logo logo--light" src="/ubs-logo.png" alt="UBS" />
        <img
          className="logo logo--dark"
          src="/ubs-logo-white.png"
          alt=""
          aria-hidden="true"
        />
        <h1>Produktion</h1>
        <p>Hvad der kører nu, og hvad der ligger klar.</p>
      </header>

      {tracks.length === 0 ? (
        <p className="empty">
          Der er ikke defineret nogen anlæg endnu. De skrives i
          <code> content/lines.yaml</code>.
        </p>
      ) : (
        <div className="board__tracks">
          {tracks.map((track) => (
            <section className="track" key={track.line.id || "stray"}>
              <header className="track__head">
                <h2>{track.line.label}</h2>
                {track.line.lead && <p>{track.line.lead}</p>}
              </header>

              <p className="track__label">
                Kører nu
                {track.running.length > 1 && <em>{track.running.length}</em>}
              </p>

              {track.running.length === 0 ? (
                <p className="track__idle">Intet kører på dette anlæg.</p>
              ) : (
                <ul className="track__list">
                  {track.running.map((lot) => (
                    <li key={lot.lot_no}>
                      <button
                        type="button"
                        className={`track__active${
                          lot.unacknowledged_count > 0 ? " is-alerting" : ""
                        }`}
                        onClick={() => onOpen(lot.lot_no)}
                      >
                        <span className="track__name">
                          {/* Markeringen står også her. Et resultat, ingen har
                              kvitteret for, skal kunne ses uden at gå ind. */}
                          {lot.unacknowledged_count > 0 && (
                            <span className="dot" aria-label="Nyt resultat" />
                          )}
                          {lot.lot_no}
                        </span>
                        <span className="track__meta">
                          {lot.variety ? `${lot.variety} · ` : ""}
                          {lot.order_no ? `${lot.order_no} · ` : ""}
                          senest{" "}
                          {clock.format(
                            new Date(lot.last_activity ?? lot.started_at),
                          )}
                        </span>
                        <span className="track__count">
                          {lot.sample_count}
                          <span>prøver</span>
                        </span>
                        <Icon name="chevron-right" size={24} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <p className="track__label">
                I kø
                {track.queue.length > 0 && <em>{track.queue.length}</em>}
              </p>

              {track.queue.length === 0 ? (
                <p className="track__idle">
                  Ingen ordrer i kø. Kommer der en fra ordrekontoret, dukker den
                  op her af sig selv.
                </p>
              ) : (
                <ol className="track__queue">
                  {track.queue.map((order, index) => (
                    <li key={order.order_no}>
                      <button type="button" onClick={() => onStart(order)}>
                        {/* Nummeret er køens og ikke ordrens. Det siger, hvad
                            der kører som det næste, og det er det, der
                            spørges om. */}
                        <span className="track__pos">{index + 1}</span>
                        <span className="track__name">{order.lot_no}</span>
                        {/* Planlagt kg står i linjen og ikke som stort tal.
                            Det store tal på kørslerne ovenfor er prøver, der
                            faktisk er taget; et planlagt tal er kontorets
                            forventning, og de to må ikke veje ens. */}
                        <span className="track__meta">
                          {order.variety ? `${order.variety} · ` : ""}
                          {order.order_no}
                          {order.planned_kg !== null &&
                            ` · ${order.planned_kg.toLocaleString("da-DK")} kg`}
                          {order.planned_start
                            ? ` · planlagt ${when.format(new Date(order.planned_start))}`
                            : ""}
                        </span>
                        {/* Kun den første i køen får ordet. De andre kan
                            startes, men de skal ikke se ud som om, de skal:
                            "Start nu" på nummer to er en opfordring til at
                            køre uden om planen. */}
                        <span className="track__go">
                          {index === 0 && "Start"}
                          <Icon name="chevron-right" size={18} />
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          ))}
        </div>
      )}

      {/* Kørte lots ligger sammenfoldet. De skal kunne findes — et stempel
          sættes efter, partiet er kørt — men de er ikke det, skærmen handler
          om, og udfoldet ville de skubbe køen ned under kanten. */}
      {done.length > 0 && (
        <section className="board__done">
          <button
            type="button"
            className="board__done-toggle"
            aria-expanded={showDone}
            onClick={() => setShowDone((v) => !v)}
          >
            <Icon
              name={showDone ? "chevron-down" : "chevron-right"}
              size={18}
              strokeWidth={2.2}
            />
            Kørte lots
            <em>{done.length}</em>
          </button>

          {showDone && (
            <ul className="track__list">
              {done.map((lot) => (
                <li key={lot.lot_no}>
                  <button
                    type="button"
                    className="track__active track__active--done"
                    onClick={() => onOpen(lot.lot_no)}
                  >
                    <span className="track__name">{lot.lot_no}</span>
                    <span className="track__meta">
                      {lot.variety ? `${lot.variety} · ` : ""}
                      {when.format(new Date(lot.last_activity ?? lot.started_at))}
                      {lot.stamp === "approved" && " · godkendt"}
                      {lot.stamp === "rejected" && " · afvist"}
                      {lot.stamp === null && " · afsluttet"}
                    </span>
                    <span className="track__count">
                      {lot.sample_count}
                      <span>prøver</span>
                    </span>
                    <Icon name="chevron-right" size={24} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
