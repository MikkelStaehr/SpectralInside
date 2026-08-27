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
 * Hvor lottet er i sit liv. To nullable felter, tre tilstande, ingen status at
 * vedligeholde.
 *
 * `ended_at` er operatørens "færdig på linjen". Det er ikke det samme som
 * færdig: partiet er ude af renselinjen, men laboratoriet har ikke sagt sit
 * endnu. `stamp` er den dom, og først dér er lottet forbi.
 */
type Stage = "line" | "analysis" | "done";

function stageOf(lot: LotSummary): Stage {
  if (lot.stamp !== null) return "done";
  return lot.ended_at !== null ? "analysis" : "line";
}

interface Props {
  lines: Line[];
  lots: LotSummary[];
  orders: Order[];
  onOpen: (lotNo: string) => void;
  onStart: (order: Order) => void;
}

export function Board({ lines, lots, orders, onOpen, onStart }: Props) {
  const [showDone, setShowDone] = useState(false);

  const running = lots.filter((lot) => stageOf(lot) === "line");
  const done = lots.filter((lot) => stageOf(lot) === "done");

  /**
   * Laboratoriets kø: lots, operatøren har meldt færdige på linjen.
   *
   * Ældste først. Køen læses forfra, og det, der har ventet længst, er det
   * næste, der skal analyseres — den samme regel som ordrekøen.
   *
   * Uanset hvilken renselinje de kom fra. Der er ét laboratorium, og et lot
   * skifter ikke `line`, når det bliver overleveret: linjen er en oplysning om,
   * hvor partiet kom fra, og den skal ikke gå tabt.
   */
  const waiting = useMemo(
    () =>
      lots
        .filter((lot) => stageOf(lot) === "analysis")
        .sort((a, b) => (a.ended_at ?? "").localeCompare(b.ended_at ?? "")),
    [lots],
  );

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

    // Laboratoriet har ingen ordrer og ingen linje at høre til. Det samler
    // dem, operatøren er færdig med, og køen er lots og ikke ordrer.
    const named = lines.map((line) =>
      line.kind === "analysis"
        ? { line, running: [] as LotSummary[], queue: [], waiting, busy: false }
        : (() => {
            const onLine = running.filter((lot) => belongs(lot.line, line.id));
            return {
              line,
              running: onLine,
              queue: orders.filter((order) => belongs(order.line, line.id)),
              waiting: [] as LotSummary[],
              // Ét parti ad gangen. Er der et i gang, er anlægget optaget.
              busy: onLine.length > 0,
            };
          })(),
    );

    const stray = {
      line: { id: "", label: "Uden anlæg", kind: "cleaning", lead: null } as Line,
      running: running.filter((lot) => !lot.line || !known.has(lot.line)),
      queue: orders.filter((order) => !order.line || !known.has(order.line)),
      waiting: [] as LotSummary[],
      busy: false,
    };

    return stray.running.length + stray.queue.length > 0
      ? [...named, stray]
      : named;
  }, [lines, running, orders, waiting]);

  /** Anlæggets navn. Serveren sender id'er, og "2" er ikke noget at læse. */
  const lineLabel = (id: string | null) =>
    lines.find((l) => l.id === id)?.label ?? id ?? "uden anlæg";

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

              {track.line.kind === "analysis" ? (
                <>
                  {/* Laboratoriets kø. Ikke ordrer, men lots, operatøren har
                      meldt færdige på linjen. De ligger her, til Post Cleaning
                      er lavet og lottet er stemplet. */}
                  <p className="track__label">
                    Afventer analyse
                    {track.waiting.length > 0 && <em>{track.waiting.length}</em>}
                  </p>

                  {track.waiting.length === 0 ? (
                    <p className="track__idle">
                      Ingen lots venter. Et lot lander her, når operatøren melder
                      det færdigt på linjen.
                    </p>
                  ) : (
                    <ol className="track__queue">
                      {track.waiting.map((lot, index) => (
                        <li key={lot.lot_no}>
                          <button
                            type="button"
                            onClick={() => onOpen(lot.lot_no)}
                          >
                            <span className="track__pos">{index + 1}</span>
                            <span className="track__name">
                              {lot.unacknowledged_count > 0 && (
                                <span className="dot" aria-label="Nyt resultat" />
                              )}
                              {lot.lot_no}
                            </span>
                            <span className="track__meta">
                              {lot.variety ? `${lot.variety} · ` : ""}
                              {/* Hvor partiet kom fra. Lottet skifter ikke
                                  linje ved overleveringen, og laboratoriet
                                  skal kunne se, hvilket anlæg der kørte det. */}
                              {lineLabel(lot.line)}
                              {lot.ended_at &&
                                ` · færdig ${when.format(new Date(lot.ended_at))}`}
                            </span>
                            <span className="track__count">
                              {lot.sample_count}
                              <span>prøver</span>
                            </span>
                            <Icon name="chevron-right" size={24} />
                          </button>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              ) : (
                <>
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

                {/* Ét parti ad gangen gennem anlægget. Er der et i gang, kan
                    det næste ikke sættes i gang, og så skal køen sige hvorfor
                    frem for at tilbyde et tryk, serveren afviser. Rækkerne
                    bliver stående og kan stadig åbnes: køen er en plan, og den
                    skal kunne læses, også mens den venter. */}
                {track.busy && track.queue.length > 0 && (
                  <p className="track__blocked">
                    <Icon name="info" size={15} strokeWidth={2.2} />
                    {track.running[0].lot_no} kører. Meld det færdigt på linjen,
                    før det næste sættes i gang.
                  </p>
                )}

                {track.queue.length === 0 ? (
                  <p className="track__idle">
                    Ingen ordrer i kø. Kommer der en fra ordrekontoret, dukker den
                    op her af sig selv.
                  </p>
                ) : (
                  <ol className={`track__queue${track.busy ? " is-blocked" : ""}`}>
                    {track.queue.map((order, index) => (
                      <li key={order.order_no}>
                        <button
                          type="button"
                          disabled={track.busy}
                          onClick={() => onStart(order)}
                        >
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
                            {index === 0 && !track.busy && "Start"}
                            <Icon name="chevron-right" size={18} />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                </>
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
