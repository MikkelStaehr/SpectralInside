/**
 * Start en kørsel.
 *
 * To trin: vælg ordren, udfyld det operatøren ved. Så er man på kørslen.
 *
 * Ordren kommer fra ordrekontoret, og operatøren vælger den frem for at taste
 * et ordrenummer. Et tastet nummer kan staves på tre måder, og så kan
 * ingenting afstemmes med kontoret bagefter. Det er den ene ting, denne skærm
 * findes for.
 *
 * Listen ser ud som lot-listen ved siden af. Det er de samme hænder på den
 * samme skærm, og to lister, der gør det samme, skal ikke se forskellige ud.
 */

import { useEffect, useState } from "react";
import { api } from "../api";
import type { LotField, LotSummary, Order } from "../types";
import { Icon } from "./Icon";
import { LotSheet } from "./LotSheet";

const created = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

interface Props {
  fields: LotField[];
  onBack: () => void;
  /** Kørslen er startet. Herfra går skærmen videre til den. */
  onStarted: (lot: LotSummary) => void;
}

export function StartRun({ fields, onBack, onStarted }: Props) {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [picked, setPicked] = useState<Order | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api
      .orders()
      .then((rows) => {
        if (!cancelled) setOrders(rows);
      })
      .catch((err) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : "Kunne ikke hente ordrerne",
          );
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="display">
      <button type="button" className="btn btn--ghost back" onClick={onBack}>
        <Icon name="arrow-left" size={16} />
        Alle lots
      </button>

      <header className="display__head">
        <h1>Start et lot</h1>
        <p>Vælg den ordre, du skal køre.</p>
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

      {orders === null ? (
        <p className="empty">Henter…</p>
      ) : orders.length === 0 ? (
        // Ingen ordrer er ikke en fejl. Det er en besked om, at bolden ligger
        // hos kontoret, og den skal siges, så ingen står og leder efter en
        // knap, der ikke findes.
        <p className="empty">
          Der er ingen ledige ordrer lige nu. Kommer der en fra ordrekontoret,
          dukker den op her af sig selv.
        </p>
      ) : (
        <ul className="display__samples">
          {orders.map((order) => (
            <li key={order.order_no}>
              <button type="button" onClick={() => setPicked(order)}>
                <span className="display__sample-name">{order.order_no}</span>
                <span className="display__sample-meta">
                  {/* Lotnummeret først. Det er det, operatøren har på
                      papiret og på sækken, og ordrenummeret er kontorets. */}
                  Lot {order.lot_no}
                  {order.variety ? ` · ${order.variety}` : ""}
                  {order.item_no ? ` · ${order.item_no}` : ""}
                  {order.line ? ` · ${order.line}` : ""}
                  {" · lagt ind "}
                  {created.format(new Date(order.created_at))}
                </span>
                {order.planned_kg !== null && (
                  <span className="display__sample-count">
                    {order.planned_kg.toLocaleString("da-DK")}
                    <span>kg planlagt</span>
                  </span>
                )}
                <Icon name="chevron-right" size={26} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {picked && (
        <LotSheet
          fields={fields}
          order={picked}
          onClose={() => setPicked(null)}
          onSaved={onStarted}
        />
      )}
    </div>
  );
}
