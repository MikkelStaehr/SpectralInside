/**
 * Læg en ordre ind.
 *
 * Det her er ordrekontorets opgave, og på sigt kommer ordrerne ad et snit og
 * ikke fra en formular. Indtil da skal nogen kunne lægge dem ind, ellers har
 * operatøren ingenting at vælge imellem.
 *
 * Formularen kalder præcis det samme endepunkt, kontoret vil kalde. En bagdør
 * ved siden af ville skulle rives ned igen bagefter, og indtil den blev det,
 * ville der være to måder at få en ordre ind på, som kunne opføre sig
 * forskelligt.
 *
 * Felterne står ikke i LotField-listen, fordi de ikke er kørslens. En ordre er
 * sit eget: den findes, før der er nogen kørsel, og den kan trækkes tilbage
 * uden at der nogensinde bliver en.
 */

import { useEffect, useState } from "react";
import { api } from "../api";
import { parseDecimal } from "../lots";
import type { Order } from "../types";
import { Icon } from "./Icon";

interface Props {
  /** Initialerne på den, der lægger ordren ind. */
  createdBy: string;
  onClose: () => void;
  onSaved: (order: Order) => void;
}

const FIELDS = [
  {
    id: "order_no",
    label: "Ordre nr.",
    required: true,
    hint: "Kontorets nummer på ordren.",
  },
  {
    id: "lot_no",
    label: "Ind lot nr.",
    required: true,
    hint: "Partiet, der skal køres. Bliver kørslens lotnummer.",
  },
  { id: "item_no", label: "Ind item nr." },
  { id: "variety", label: "Varietet" },
  { id: "line", label: "Linje" },
  {
    id: "planned_kg",
    label: "Planlagt kg",
    type: "number",
    unit: "kg",
    hint: "Kontorets tal. Det, der faktisk blev vejet ind, skriver operatøren.",
  },
  { id: "note", label: "Bemærkning", wide: true },
] as const;

export function OrderSheet({ createdBy, onClose, onSaved }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = (id: string, value: string) =>
    setValues((current) => ({ ...current, [id]: value }));

  const missing = FIELDS.filter(
    (f) => "required" in f && f.required && (values[f.id] ?? "").trim() === "",
  );

  const save = async () => {
    if (missing.length > 0) {
      setError(`Udfyld ${missing.map((f) => f.label).join(" og ")}.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { created_by: createdBy };
      for (const f of FIELDS) {
        const raw = (values[f.id] ?? "").trim();
        if ("type" in f && f.type === "number") {
          const value = parseDecimal(raw);
          if (value !== null && Number.isNaN(value)) {
            setError(`${f.label} skal være et tal. Både komma og punktum går an.`);
            return;
          }
          body[f.id] = value;
        } else {
          body[f.id] = raw === "" ? null : raw;
        }
      }
      const saved = await api.createOrder(body);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke gemme ordren");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="sheet__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Ny ordre"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <header className="sheet__head">
          <div>
            <p className="sheet__eyebrow">Ordrekontoret</p>
            <h2>Ny ordre</h2>
          </div>
          <button
            type="button"
            className="sheet__close"
            onClick={onClose}
            aria-label="Luk"
          >
            <Icon name="x" size={22} strokeWidth={2.2} />
          </button>
        </header>

        {error && (
          <p className="lots__error">
            <Icon name="triangle-alert" size={15} strokeWidth={2.2} />
            {error}
          </p>
        )}

        <div className="sheet__body">
          <p className="sheet__lead">
            Ordren dukker op på produktionsskærmen under "Start et lot". Den kan
            trækkes tilbage, så længe ingen har sat den i gang.
          </p>

          <div className="stamdata">
            {FIELDS.map((f) => (
              <label
                key={f.id}
                className={`stamdata__field${
                  "wide" in f && f.wide ? " stamdata__field--wide" : ""
                }`}
              >
                <span className="stamdata__label">
                  {f.label}
                  {"required" in f && f.required && <em>påkrævet</em>}
                </span>
                <span className="stamdata__input">
                  {/* Tekst og ikke `type="number"`: sidstnaevnte afviser
                      komma, og her tastes der komma. Se parseDecimal. */}
                  <input
                    type="text"
                    inputMode={
                      "type" in f && f.type === "number" ? "decimal" : undefined
                    }
                    value={values[f.id] ?? ""}
                    onChange={(event) => set(f.id, event.target.value)}
                  />
                  {"unit" in f && f.unit && <em>{f.unit}</em>}
                </span>
                {"hint" in f && f.hint && (
                  <span className="stamdata__hint">{f.hint}</span>
                )}
              </label>
            ))}
          </div>
        </div>

        <footer className="sheet__foot sheet__foot--end">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Annullér
          </button>
          <button type="button" className="btn" disabled={busy} onClick={save}>
            <Icon name="check" size={17} strokeWidth={2.2} />
            Læg ordren ind
          </button>
        </footer>
      </div>
    </div>
  );
}
