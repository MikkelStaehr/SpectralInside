/**
 * Stamdata på et lot: oprettelse og rettelse i ét.
 *
 * Lottet bliver til, fordi et menneske opretter det med ordreoplysningerne, og
 * får sine målinger bagefter. Før var det omvendt — et lot opstod, fordi
 * Videometeret scannede noget — og så var der ingen at spørge om, hvad partiet
 * egentlig var.
 *
 * Felterne kommer fra serveren og står i driftsrapportens egen rækkefølge
 * under "Ordre". Operatøren udfylder i dag det samme skema i hånden, og en
 * anden rækkefølge på skærmen ville gøre to opgaver ud af én. Filen her kender
 * derfor ingen af feltnavnene.
 *
 * Kun lotnummeret spærrer. De øvrige påkrævede felter er påkrævede for det
 * *fuldstændige* lot, ikke for oprettelsen: den, der skal have partiet i gang,
 * kender ikke kg ind endnu, og en formular, der spærrer, bliver udfyldt med
 * gætterier. Hvad der mangler, står bagefter på lottet.
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { LotField, LotSummary } from "../types";
import { Icon } from "./Icon";

interface Props {
  fields: LotField[];
  /** Lottet, der rettes. Udeladt betyder, at et nyt skal oprettes. */
  lot?: LotSummary;
  /** Initialerne på den, der sidder ved skærmen. Forudfylder feltet. */
  operator?: string;
  onClose: () => void;
  onSaved: (lot: LotSummary) => void;
}

/**
 * Fra ISO til det, `datetime-local` vil have, og tilbage.
 *
 * Feltet arbejder i lokal tid uden zone, mens API'et taler ISO med zone. Uden
 * de to her ryger tidspunktet en tidszone ved hver tur gennem formularen.
 */
const toLocal = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
};

const fromLocal = (value: string) =>
  value ? new Date(value).toISOString() : null;

export function LotSheet({ fields, lot, operator, onClose, onSaved }: Props) {
  const creating = lot === undefined;

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => {
        const raw = lot ? (lot as unknown as Record<string, unknown>)[f.id] : undefined;
        if (f.type === "datetime") return [f.id, toLocal(raw as string | null)];
        if (raw === null || raw === undefined) {
          // Den, der står ved skærmen, er næsten altid også den, der starter
          // partiet. Er hun det ikke, retter hun det ene felt.
          return [f.id, creating && f.id === "started_by" ? (operator ?? "") : ""];
        }
        return [f.id, String(raw)];
      }),
    ),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lotnummeret er nøglen og kan ikke rettes bagefter. Ved oprettelsen er det
  // omvendt det ene felt, der skal udfyldes.
  const editable = fields.filter((f) => !f.readonly || (creating && f.id === "lot_no"));
  const shown = creating ? editable : fields.filter((f) => f.id !== "started_at" || lot);

  const outstanding = useMemo(
    () =>
      fields.filter((f) => f.required && (values[f.id] ?? "").trim() === ""),
    [fields, values],
  );

  const set = (id: string, value: string) =>
    setValues((current) => ({ ...current, [id]: value }));

  const payload = () => {
    const out: Record<string, unknown> = {};
    for (const f of editable) {
      if (f.id === "lot_no") continue;
      const raw = (values[f.id] ?? "").trim();
      if (f.type === "datetime") out[f.id] = fromLocal(raw);
      else if (f.type === "number") out[f.id] = raw === "" ? null : Number(raw);
      else out[f.id] = raw === "" ? null : raw;
    }
    return out;
  };

  const save = async () => {
    const lotNo = (values.lot_no ?? "").trim();
    if (creating && lotNo === "") {
      setError("Lottet skal have et nummer.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const saved = creating
        ? await api.createLot({ lot_no: lotNo, ...payload() })
        : await api.updateLot(lot!.lot_no, payload());
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke gemme");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="sheet__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={creating ? "Nyt lot" : `Stamdata for lot ${lot!.lot_no}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <header className="sheet__head">
          <div>
            <p className="sheet__eyebrow">
              {creating ? "Driftsrapport · Ordre" : `Lot ${lot!.lot_no}`}
            </p>
            <h2>{creating ? "Nyt lot" : "Stamdata"}</h2>
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
            {creating
              ? "Kun lotnummeret skal udfyldes for at komme i gang. Resten kan skrives ind, mens partiet kører."
              : "Ret det, der har ændret sig. Felter, du lader stå tomme, bliver ryddet."}
          </p>

          <div className="stamdata">
            {shown.map((field) => (
              <label
                key={field.id}
                className={`stamdata__field${
                  field.type === "text" && field.id === "note"
                    ? " stamdata__field--wide"
                    : ""
                }`}
              >
                <span className="stamdata__label">
                  {field.label}
                  {field.required && (
                    <em title="Skal udfyldes, før lottet er fuldstændigt">
                      påkrævet
                    </em>
                  )}
                </span>
                <span className="stamdata__input">
                  <input
                    type={
                      field.type === "number"
                        ? "number"
                        : field.type === "datetime"
                          ? "datetime-local"
                          : "text"
                    }
                    step={field.type === "number" ? "any" : undefined}
                    value={values[field.id] ?? ""}
                    disabled={field.readonly && !(creating && field.id === "lot_no")}
                    onChange={(event) => set(field.id, event.target.value)}
                  />
                  {field.unit && <em>{field.unit}</em>}
                </span>
                {field.hint && <span className="stamdata__hint">{field.hint}</span>}
              </label>
            ))}
          </div>

          {/* Den samme kontrol som i driftsrapporten, hvor der står "Mangler
              Ordre Nr" i stedet for "Alt OK". En huskeliste, ikke en spærring. */}
          {outstanding.length > 0 && (
            <p className="stamdata__missing">
              <Icon name="info" size={15} strokeWidth={2.2} />
              Mangler stadig: {outstanding.map((f) => f.label).join(", ")}. Lottet
              kan godt køre imens.
            </p>
          )}
        </div>

        <footer className="sheet__foot sheet__foot--end">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Annullér
          </button>
          <button type="button" className="btn" disabled={busy} onClick={save}>
            <Icon name="check" size={17} strokeWidth={2.2} />
            {creating ? "Opret lot" : "Gem stamdata"}
          </button>
        </footer>
      </div>
    </div>
  );
}
