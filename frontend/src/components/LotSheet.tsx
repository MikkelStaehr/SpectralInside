/**
 * Stamdata på en kørsel: start og rettelse i ét.
 *
 * En kørsel bliver til, fordi et menneske vælger en ordre og skriver det på,
 * som kun linjen ved. Før var det omvendt — et lot opstod, fordi Videometeret
 * scannede noget — og så var der ingen at spørge om, hvad partiet egentlig
 * var.
 *
 * Arket har to blokke, fordi der er to, der ved noget. Ordrekontoret ved, hvad
 * der skal køres: parti, vare, varietet, linje. Operatøren ved, hvad der
 * faktisk skete: rapportnummer, kg ind, hvem der kørte det. Ordrens felter er
 * låst — retter man varieteten her, men ikke på ordren, står der to
 * forskellige svar på det samme spørgsmål.
 *
 * Felterne og deres opdeling kommer fra serveren og står i driftsrapportens
 * egen rækkefølge. Filen her kender ingen af feltnavnene.
 *
 * Kun ordren spærrer. De påkrævede felter er påkrævede for den *fuldstændige*
 * kørsel, ikke for at komme i gang: den, der skal have partiet på linjen,
 * kender ikke kg ind endnu, og en formular, der spærrer, bliver udfyldt med
 * gætterier. Hvad der mangler, står bagefter på kørslen.
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { parseDecimal } from "../lots";
import type { LotField, LotSummary, Order } from "../types";
import { Icon } from "./Icon";

interface Props {
  fields: LotField[];
  /** Ordren, der skal køres. Sat når en ny kørsel startes. */
  order?: Order;
  /** Kørslen, der rettes. Sat når stamdata på et lot, der kører, ændres. */
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

/** Det, feltet allerede har: fra kørslen, eller fra ordren, hvis den starter. */
function initial(
  field: LotField,
  lot: LotSummary | undefined,
  order: Order | undefined,
): string {
  const from = (o: object | undefined) =>
    o ? (o as unknown as Record<string, unknown>)[field.id] : undefined;
  const raw = from(lot) ?? from(order);
  if (raw === null || raw === undefined) return "";
  if (field.type === "datetime") return toLocal(raw as string);
  return String(raw);
}

export function LotSheet({ fields, order, lot, operator, onClose, onSaved }: Props) {
  const starting = lot === undefined;

  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      fields.map((f) => {
        const have = initial(f, lot, order);
        // Den, der står ved skærmen, er næsten altid også den, der kører
        // partiet. Er hun det ikke, retter hun det ene felt.
        if (have === "" && starting && f.id === "started_by")
          return [f.id, operator ?? ""];
        return [f.id, have];
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

  const fromOrder = fields.filter((f) => f.source === "order");
  // Starttidspunktet er systemets og findes ikke endnu, når kørslen startes.
  const mine = fields.filter(
    (f) => f.source !== "order" && (!starting || f.source !== "system"),
  );
  const editable = mine.filter((f) => !f.readonly);

  // Kun det, operatøren selv kan gøre noget ved. Er et af ordrens felter tomt,
  // er det kontoret, der mangler at udfylde det, og så hjælper det ingen at
  // stille det på en huskeliste her.
  const outstanding = useMemo(
    () =>
      fields.filter(
        (f) => f.required && !f.readonly && (values[f.id] ?? "").trim() === "",
      ),
    [fields, values],
  );

  const set = (id: string, value: string) =>
    setValues((current) => ({ ...current, [id]: value }));

  /** Nyttelasten, eller navnet på det felt der ikke kan læses som et tal. */
  const payload = (): Record<string, unknown> | string => {
    const out: Record<string, unknown> = {};
    for (const f of editable) {
      const raw = (values[f.id] ?? "").trim();
      if (f.type === "datetime") {
        out[f.id] = fromLocal(raw);
      } else if (f.type === "number") {
        const value = parseDecimal(raw);
        if (value !== null && Number.isNaN(value)) return f.label;
        out[f.id] = value;
      } else {
        out[f.id] = raw === "" ? null : raw;
      }
    }
    return out;
  };

  const save = async () => {
    const body = payload();
    if (typeof body === "string") {
      setError(`${body} skal være et tal. Både komma og punktum går an.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const saved = starting
        ? await api.createLot({ order_no: order!.order_no, ...body })
        : await api.updateLot(lot!.lot_no, body);
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke gemme");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Et låst felt er ikke et felt. Det er en oplysning, der kommer et andet
   * sted fra, og den skrives som tekst uden ramme. En udgrået inputboks
   * inviterer til at klikke i den og ligner noget, der er gået i stykker;
   * fem af dem over hinanden ligner en formular, halvdelen er væk fra.
   */
  const fact = (f: LotField) => (
    <div key={f.id} className="stamdata__fact">
      <span className="stamdata__label">{f.label}</span>
      <span className="stamdata__value">
        {(values[f.id] ?? "").trim() || (
          <em className="stamdata__blank">ikke angivet</em>
        )}
      </span>
    </div>
  );

  const field = (f: LotField) =>
    f.readonly ? (
      fact(f)
    ) : (
      <label
        key={f.id}
        className={`stamdata__field${
          f.id === "note" ? " stamdata__field--wide" : ""
        }`}
      >
        <span className="stamdata__label">
          {f.label}
          {f.required && (
            <em title="Skal udfyldes, før kørslen er fuldstændig">påkrævet</em>
          )}
        </span>
        <span className="stamdata__input">
          {/* Tal er tekstfelter. `type="number"` afviser komma, og en
              operatør, der taster "1980,5", får et tomt felt uden at få at
              vide hvorfor. Se parseDecimal. */}
          <input
            type={f.type === "datetime" ? "datetime-local" : "text"}
            inputMode={f.type === "number" ? "decimal" : undefined}
            value={values[f.id] ?? ""}
            onChange={(event) => set(f.id, event.target.value)}
          />
          {f.unit && <em>{f.unit}</em>}
        </span>
        {f.hint && <span className="stamdata__hint">{f.hint}</span>}
      </label>
    );

  return (
    <div
      className="sheet__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={
        starting ? `Start ordre ${order!.order_no}` : `Stamdata for lot ${lot!.lot_no}`
      }
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <header className="sheet__head">
          <div>
            <p className="sheet__eyebrow">
              {starting ? `Ordre ${order!.order_no}` : `Lot ${lot!.lot_no}`}
            </p>
            <h2>{starting ? `Start lot ${order!.lot_no}` : "Stamdata"}</h2>
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
          {/* Ordrens felter står låst og øverst. Operatøren skal kunne se, at
              hun har fat i den rigtige ordre, før hun skriver noget. */}
          {fromOrder.length > 0 && (
            <section className="stamdata__block">
              <h3>
                <span>Fra ordren</span>
                <em>Kommer fra ordrekontoret</em>
              </h3>
              <div className="stamdata stamdata--facts">
                {fromOrder.map(fact)}
              </div>
            </section>
          )}

          <section className="stamdata__block">
            <h3>
              <span>Det du udfylder</span>
              <em>
                {starting
                  ? "Kan skrives ind, mens partiet kører"
                  : "Ret det, der har ændret sig"}
              </em>
            </h3>
            <div className="stamdata">{mine.map(field)}</div>
          </section>

          {/* Den samme kontrol som i driftsrapporten, hvor der står "Mangler
              Ordre Nr" i stedet for "Alt OK". En huskeliste, ikke en spærring. */}
          {outstanding.length > 0 && (
            <p className="stamdata__missing">
              <Icon name="info" size={15} strokeWidth={2.2} />
              Mangler stadig: {outstanding.map((f) => f.label).join(", ")}.
              {starting
                ? " Partiet kan godt sættes i gang alligevel."
                : " Lottet kan godt køre imens."}
            </p>
          )}
        </div>

        <footer className="sheet__foot sheet__foot--end">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Annullér
          </button>
          <button type="button" className="btn" disabled={busy} onClick={save}>
            <Icon name="check" size={17} strokeWidth={2.2} />
            {starting ? "Sæt i gang" : "Gem stamdata"}
          </button>
        </footer>
      </div>
    </div>
  );
}
