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
import type { Line, NavisionDraft, Order } from "../types";
import { Icon } from "./Icon";

interface Props {
  /** Initialerne på den, der lægger ordren ind. */
  createdBy: string;
  /**
   * Ordren, der rettes. Udeladt betyder, at en ny skal lægges ind.
   *
   * Kun ordrer, ingen har sat i gang, kan rettes. Er den kørt, har kørslen
   * kopieret ordrens felter, og to forskellige svar på det samme spørgsmål er
   * værre end en tastefejl, der står.
   */
  order?: Order;
  /**
   * Anlæggene. Ordren skal pege på ét af dem, ellers lander den uden for
   * sporene på forsiden, og en ordre, ingen kan se, er ikke en ordre.
   */
  lines: Line[];
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
  {
    id: "line",
    label: "Anlæg",
    type: "line",
    required: true,
    hint: "Afgør hvilket spor ordren står i på produktionsskærmen.",
  },
  {
    id: "planned_start",
    label: "Planlagt start",
    type: "datetime",
    hint: "Køen sorteres efter den. Uden den ligger ordren bagest.",
  },
  {
    id: "planned_kg",
    label: "Planlagt kg",
    type: "number",
    unit: "kg",
    hint: "Kontorets tal. Det, der faktisk blev vejet ind, skriver operatøren.",
  },
  { id: "note", label: "Bemærkning", wide: true },
] as const;

/** Lokal tid ud af feltet og ISO ind i API'et. Se samme par i LotSheet. */
const fromLocal = (value: string) =>
  value ? new Date(value).toISOString() : null;

const toLocal = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

export function OrderSheet({ createdBy, order, lines, onClose, onSaved }: Props) {
  const editing = order !== undefined;

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      FIELDS.map((f) => {
        const raw = order
          ? (order as unknown as Record<string, unknown>)[f.id]
          : undefined;
        if (raw === null || raw === undefined) return [f.id, ""];
        if ("type" in f && f.type === "datetime")
          return [f.id, toLocal(raw as string)];
        return [f.id, String(raw)];
      }),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Det, Navision svarede. Gemmes ved siden af felterne, fordi advarslerne
  // skal blive stående, mens kontoret retter: de siger, hvad Navision ikke
  // vidste, og det er stadig sandt, efter man har udfyldt det.
  const [draft, setDraft] = useState<NavisionDraft | null>(null);
  const [fetching, setFetching] = useState(false);

  /**
   * Hent ordren fra Navision og fyld felterne ud.
   *
   * Det, kontoret allerede har skrevet, bliver stående. Et opslag, der
   * overskrev en rettelse, ville gøre knappen farlig at trykke på, og så
   * bliver den ikke brugt.
   */
  const lookup = async () => {
    const no = (values.order_no ?? "").trim();
    if (!no) {
      setError("Skriv et ordrenummer først.");
      return;
    }

    setFetching(true);
    setError(null);
    try {
      const found = await api.navisionOrder(no);
      setDraft(found);
      setValues((current) => {
        const next = { ...current };
        const put = (id: string, value: unknown) => {
          if (value === null || value === undefined) return;
          if ((current[id] ?? "").trim() !== "") return;
          next[id] =
            id === "planned_start" ? toLocal(String(value)) : String(value);
        };
        put("item_no", found.item_no);
        put("variety", found.variety);
        put("line", found.line);
        put("lot_no", found.lot_no);
        put("planned_kg", found.planned_kg);
        put("planned_start", found.planned_start);
        return next;
      });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Kunne ikke hente fra Navision",
      );
    } finally {
      setFetching(false);
    }
  };

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
      const body: Record<string, unknown> = editing ? {} : { created_by: createdBy };
      for (const f of FIELDS) {
        // Ordrenummeret er nøglen. En ordre med et nyt nummer er en anden
        // ordre, så det sendes ikke med på en rettelse.
        if (editing && f.id === "order_no") continue;
        const raw = (values[f.id] ?? "").trim();
        const kind = "type" in f ? f.type : "text";
        if (kind === "number") {
          const value = parseDecimal(raw);
          if (value !== null && Number.isNaN(value)) {
            setError(`${f.label} skal være et tal. Både komma og punktum går an.`);
            return;
          }
          body[f.id] = value;
        } else if (kind === "datetime") {
          body[f.id] = fromLocal(raw);
        } else {
          body[f.id] = raw === "" ? null : raw;
        }
      }
      // Navisions egne felter følger med, når ordren er hentet. De gemmes
      // som de kom, så en senere opdatering kan se, hvad der har ændret sig.
      if (draft) {
        body.source_status = draft.source_status;
        body.source_routing = draft.source_routing;
        body.source_variant = draft.source_variant;
        body.source_location = draft.source_location;
        body.source_weight_type = draft.source_weight_type;
        body.planned_end = draft.planned_end;
        body.due_date = draft.due_date;
        body.source_modified_at = draft.source_modified_at;
      }

      const saved = editing
        ? await api.updateOrder(order.order_no, body)
        : await api.createOrder(body);
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
      aria-label={editing ? `Ret ordre ${order.order_no}` : "Ny ordre"}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <header className="sheet__head">
          <div>
            <p className="sheet__eyebrow">Ordrekontoret</p>
            <h2>{editing ? `Ordre ${order.order_no}` : "Ny ordre"}</h2>
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
          {/* Opslaget står øverst, hvor nummeret alligevel tastes. Det er
              hele forskellen på at udfylde ni felter og at skrive ét. */}
          <div className="navision">
            <button
              type="button"
              className="btn btn--ghost"
              disabled={fetching || busy}
              onClick={() => void lookup()}
            >
              <Icon name="rotate-ccw" size={16} strokeWidth={2.2} />
              {editing ? "Opdatér fra Navision" : "Hent information"}
            </button>
            <p>
              {draft
                ? `Hentet fra Navision${
                    draft.source_status ? ` · ${draft.source_status}` : ""
                  }${draft.description ? ` · ${draft.description}` : ""}`
                : "Skriv ordrenummeret, og hent resten."}
            </p>
          </div>

          {/* Det, Navision ikke vidste, sagt højt. En ordre, der lander med et
              tomt felt uden en forklaring, bliver gemt med hullet i. */}
          {draft && draft.warnings.length > 0 && (
            <ul className="navision__warnings">
              {draft.warnings.map((w) => (
                <li key={w}>
                  <Icon name="info" size={15} strokeWidth={2.2} />
                  {w}
                </li>
              ))}
            </ul>
          )}

          <p className="sheet__lead">
            {editing
              ? "Ordren er ikke sat i gang endnu, så den kan stadig rettes. Er den først kørt, skal rettelsen ske på kørslen."
              : "Ordren lægger sig i kø på det anlæg, du vælger, og operatøren starter den derfra. Den kan trækkes tilbage, så længe ingen har sat den i gang."}
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
                  {"type" in f && f.type === "line" ? (
                    /* Anlægget vælges og tastes ikke. Var det fritekst, kunne
                       det samme anlæg staves "Linje 2", "linje 2" og "L2", og
                       så stod der tre spor på skærmen for det samme anlæg. */
                    <select
                      value={values[f.id] ?? ""}
                      onChange={(event) => set(f.id, event.target.value)}
                    >
                      <option value="">Vælg anlæg</option>
                      {lines.map((line) => (
                        <option key={line.id} value={line.id}>
                          {line.label}
                        </option>
                      ))}
                    </select>
                  ) : (
                    /* Tekst og ikke `type="number"`: sidstnaevnte afviser
                       komma, og her tastes der komma. Se parseDecimal. */
                    <input
                      type={
                        "type" in f && f.type === "datetime"
                          ? "datetime-local"
                          : "text"
                      }
                      inputMode={
                        "type" in f && f.type === "number" ? "decimal" : undefined
                      }
                      value={values[f.id] ?? ""}
                      disabled={editing && f.id === "order_no"}
                      onChange={(event) => set(f.id, event.target.value)}
                    />
                  )}
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
            {editing ? "Gem ordren" : "Læg ordren ind"}
          </button>
        </footer>
      </div>
    </div>
  );
}
