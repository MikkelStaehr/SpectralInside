/**
 * Ordrebogen. Ordrekontorets side.
 *
 * Der er tre slags mennesker i applikationen nu, og de har ikke brug for
 * hinandens sider. Operatøren ude ved linjen sætter lots i gang og læser
 * resultater; analytikeren arbejder med instrumentet; ordrekontoret bestemmer,
 * hvad der overhovedet skal køres. Ordrer hørte aldrig hjemme på Lots-siden,
 * hvor de stod indtil nu — det er analytikerens side.
 *
 * Siden er bygget om ordrens liv og ikke om en tabel: en ordre lægges ind, den
 * ligger i kø, den bliver sat i gang, og til sidst er den kørt. Er den trukket
 * tilbage, nåede den aldrig ud af køen. Rækkefølgen på skærmen er den
 * rækkefølge, og hver blok siger, hvad der kan gøres ved den.
 *
 * Kontoret retter og trækker tilbage, så længe ordren ligger i kø. Derefter er
 * den kørslens, og rettelsen skal ske dér: kørslen har kopieret ordrens felter,
 * og to forskellige svar på det samme spørgsmål er værre end en tastefejl, der
 * står.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { Line, LotMeta, Order } from "../types";
import { Icon } from "./Icon";
import { OrderSheet } from "./OrderSheet";

const when = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

interface Props {
  operator: string;
}

/** Hvor i sit liv ordren er. Udledt, så der ikke er en status at vedligeholde. */
type Stage = "queued" | "running" | "done" | "cancelled";

function stageOf(order: Order): Stage {
  if (order.cancelled_at) return "cancelled";
  if (!order.started_lot) return "queued";
  return order.started_stamp || order.started_ended_at ? "done" : "running";
}

const BLOCKS: { stage: Stage; title: string; lead: string }[] = [
  {
    stage: "queued",
    title: "I kø",
    lead: "Lagt ind, ikke sat i gang. Kan stadig rettes og trækkes tilbage.",
  },
  {
    stage: "running",
    title: "Kører",
    lead: "Sat i gang på linjen. Rettelser sker på kørslen.",
  },
  { stage: "done", title: "Kørt", lead: "Partiet er igennem." },
  {
    stage: "cancelled",
    title: "Trukket tilbage",
    lead: "Nåede aldrig ud af køen. Bliver stående, så den kan slås op.",
  },
];

export function OrdersView({ operator }: Props) {
  const [lines, setLines] = useState<Line[]>([]);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);

  const reload = useCallback(async () => {
    try {
      // Hele bogen og ikke kun de ledige. Kontoret skal kunne se, hvad der
      // blev af den ordre, de lagde ind i går.
      setOrders(await api.orders(false));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente ordrerne");
    }
  }, []);

  useEffect(() => {
    void api
      .lotMeta()
      .then((meta: LotMeta) => setLines(meta.lines))
      .catch(() => setLines([]));
    void reload();
  }, [reload]);

  const byStage = useMemo(() => {
    const out = new Map<Stage, Order[]>();
    for (const order of orders ?? []) {
      const stage = stageOf(order);
      out.set(stage, [...(out.get(stage) ?? []), order]);
    }
    return out;
  }, [orders]);

  const lineLabel = (id: string | null) =>
    lines.find((l) => l.id === id)?.label ?? id ?? "uden anlæg";

  const cancel = async (order: Order) => {
    setBusy(order.order_no);
    setError(null);
    try {
      await api.cancelOrder(order.order_no);
      await reload();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Kunne ikke trække ordren tilbage",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="orders">
      <header className="page__head">
        <h1>Ordrer</h1>
        <p>
          Hvad der skal køres, på hvilket anlæg, og i hvilken rækkefølge. En
          ordre lægger sig i kø på anlægget, og operatøren sætter den i gang
          derfra.
        </p>
      </header>

      {error && (
        <div className="alert alert--warning" role="alert">
          <p className="alert__label">
            <Icon name="triangle-alert" size={14} strokeWidth={2.2} />
            Der er noget galt
          </p>
          <p>{error}</p>
        </div>
      )}

      <div className="orders__bar">
        <button type="button" className="btn" onClick={() => setCreating(true)}>
          <Icon name="plus" size={16} strokeWidth={2.2} />
          Ny ordre
        </button>
      </div>

      {orders === null ? (
        <p className="empty">Henter…</p>
      ) : orders.length === 0 ? (
        <p className="empty">
          Der er ikke lagt nogen ordrer ind endnu. Den første lægger sig i kø på
          det anlæg, du vælger.
        </p>
      ) : (
        BLOCKS.map((block) => {
          const rows = byStage.get(block.stage) ?? [];
          if (rows.length === 0) return null;
          return (
            <section className="orders__block" key={block.stage}>
              <h2>
                <span>{block.title}</span>
                <em>{rows.length}</em>
              </h2>
              <p className="orders__lead">{block.lead}</p>

              <ul className="orders__list">
                {rows.map((order) => (
                  <li key={order.order_no} className={`order order--${block.stage}`}>
                    <div className="order__id">
                      <p className="order__no">{order.order_no}</p>
                      <p className="order__line">{lineLabel(order.line)}</p>
                    </div>

                    <div className="order__what">
                      <p className="order__lot">{order.lot_no}</p>
                      <p className="order__meta">
                        {[
                          order.variety,
                          order.item_no,
                          order.planned_kg !== null
                            ? `${order.planned_kg.toLocaleString("da-DK")} kg planlagt`
                            : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "ingen yderligere oplysninger"}
                      </p>
                      {order.note && <p className="order__note">{order.note}</p>}
                    </div>

                    {/* Hvad der blev af ordren. Kontoret skal kunne se det
                        uden at forlade siden, så der linkes ikke videre til
                        produktionsskærmen — den har hverken menu eller vej
                        tilbage. */}
                    <div className="order__state">
                      {block.stage === "queued" && (
                        <p>
                          {order.planned_start
                            ? `Planlagt ${when.format(new Date(order.planned_start))}`
                            : "Ingen planlagt start"}
                        </p>
                      )}
                      {block.stage !== "queued" && order.started_lot && (
                        <p>
                          Sat i gang{" "}
                          {order.started_at &&
                            when.format(new Date(order.started_at))}
                        </p>
                      )}
                      {order.started_stamp === "approved" && (
                        <p className="order__stamp order__stamp--ok">Godkendt</p>
                      )}
                      {order.started_stamp === "rejected" && (
                        <p className="order__stamp order__stamp--no">Afvist</p>
                      )}
                      {block.stage === "cancelled" && order.cancelled_at && (
                        <p>{when.format(new Date(order.cancelled_at))}</p>
                      )}
                    </div>

                    <div className="order__actions">
                      {block.stage === "queued" ? (
                        <>
                          <button
                            type="button"
                            className="btn btn--ghost btn--small"
                            onClick={() => setEditing(order)}
                          >
                            <Icon name="square-pen" size={15} strokeWidth={2.2} />
                            Ret
                          </button>
                          <button
                            type="button"
                            className="btn btn--ghost btn--small"
                            disabled={busy === order.order_no}
                            onClick={() => void cancel(order)}
                          >
                            <Icon name="circle-x" size={15} strokeWidth={2.2} />
                            Træk tilbage
                          </button>
                        </>
                      ) : (
                        <p className="order__locked">
                          {block.stage === "cancelled"
                            ? "Trukket tilbage"
                            : `Kører som ${order.started_lot}`}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}

      {(creating || editing) && (
        <OrderSheet
          createdBy={operator}
          order={editing ?? undefined}
          lines={lines}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={() => void reload()}
        />
      )}
    </div>
  );
}
