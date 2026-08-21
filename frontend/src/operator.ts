import { todayKey } from "./format";

const KEY = "ubs.operator";

interface Stored {
  initials: string;
  date: string;
}

/**
 * Hvem sidder ved maskinen lige nu.
 *
 * Dette er ikke autentificering, der er intet at logge ind på, og initialerne
 * beskytter ingenting. Formålet er, at en registreret vedligeholdelse kan
 * spores til en person.
 *
 * Valget gemmes kun for den aktuelle dag. Analyse-PC'en deles af fire, og hvis
 * den huskede i ugevis, ville den anden analytikers rensning blive registreret
 * på den første. En log, der peger på den forkerte, er værre end ingen log.
 */
export function loadOperator(): string {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed?.initials !== "string") return "";
    if (parsed.date !== todayKey()) return "";
    return parsed.initials;
  } catch {
    // Ugyldigt eller gammelt format, bed om initialer igen.
    return "";
  }
}

export function saveOperator(initials: string): void {
  try {
    const value: Stored = { initials, date: todayKey() };
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* privat browsertilstand, valget gælder stadig i denne session */
  }
}

export function clearOperator(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignoreres bevidst */
  }
}
