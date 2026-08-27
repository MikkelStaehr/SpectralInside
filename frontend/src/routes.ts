/**
 * Adresserne. Delt mellem de to applikationer.
 *
 * Der er to. Produktionsskærmen ude ved linjen og kontorapplikationen inde på
 * gangen. De deler domæne, typer og API-klient, men de deler ikke skærm,
 * publikum eller vilkår: den ene hænger på en touchskærm uden indlogning og
 * står tændt i døgndrift, den anden er en almindelig side med en menu.
 *
 * De er derfor to bundter, se App.tsx. Ruterne står her, fordi det ene sted,
 * de stadig skal være enige, er hvad en adresse betyder. En hash, der bliver
 * læst forskelligt af de to, ville sende folk et andet sted hen, end linket
 * lovede.
 */

export type View =
  | { name: "home" }
  | { name: "wiki" }
  | { name: "maintenance" }
  | { name: "procedure"; id: string }
  | { name: "messages" }
  | { name: "scans" }
  | { name: "scan"; id: string }
  | { name: "analysis" }
  | { name: "lots" }
  | { name: "orders" }
  | { name: "display" }
  | { name: "startRun" }
  | { name: "lotMonitor"; lotNo: string }
  | { name: "lotSample"; sampleId: number }
  | { name: "displaySample"; id: string };

/** Om adressen hører til produktionsskærmen. Afgør hvilket bundt der hentes. */
export function isProduction(view: View): boolean {
  return (
    view.name === "display" ||
    view.name === "startRun" ||
    view.name === "lotMonitor" ||
    view.name === "lotSample" ||
    view.name === "displaySample"
  );
}

export function parseHash(hash: string): View {
  const path = hash.replace(/^#\/?/, "");
  // Billedrækken ligger under lottet i adressen, men er sin egen visning.
  // Den skal derfor testes før den løsere lot-regel nedenunder.
  if (path.startsWith("visning/scanning/"))
    return {
      name: "displaySample",
      id: decodeURIComponent(path.slice("visning/scanning/".length)),
    };
  if (path.startsWith("visning/proeve/"))
    return {
      name: "lotSample",
      sampleId: Number(path.slice("visning/proeve/".length)),
    };
  // Ordrevalget lå også under visning, og "start" er derfor et lotnummer, der
  // er optaget. Den skal testes før den løsere regel nedenunder.
  if (path === "visning/start") return { name: "startRun" };
  if (path.startsWith("visning/"))
    return {
      name: "lotMonitor",
      lotNo: decodeURIComponent(path.slice("visning/".length)),
    };
  if (path === "visning") return { name: "display" };
  if (path.startsWith("procedure/"))
    return { name: "procedure", id: path.slice("procedure/".length) };
  if (path.startsWith("scanning/"))
    return { name: "scan", id: decodeURIComponent(path.slice("scanning/".length)) };
  if (path === "scanninger") return { name: "scans" };
  if (path === "lots") return { name: "lots" };
  if (path === "ordrer") return { name: "orders" };
  if (path === "wiki") return { name: "wiki" };
  if (path === "vedligehold") return { name: "maintenance" };
  if (path === "analyse") return { name: "analysis" };
  if (path === "beskeder") return { name: "messages" };
  return { name: "home" };
}

export function toHash(view: View): string {
  switch (view.name) {
    case "displaySample":
      return `#/visning/scanning/${encodeURIComponent(view.id)}`;
    case "lotMonitor":
      return `#/visning/${encodeURIComponent(view.lotNo)}`;
    case "lotSample":
      return `#/visning/proeve/${view.sampleId}`;
    case "display":
      return "#/visning";
    case "startRun":
      return "#/visning/start";
    case "procedure":
      return `#/procedure/${view.id}`;
    case "scan":
      return `#/scanning/${encodeURIComponent(view.id)}`;
    case "scans":
      return "#/scanninger";
    case "lots":
      return "#/lots";
    case "orders":
      return "#/ordrer";
    case "wiki":
      return "#/wiki";
    case "maintenance":
      return "#/vedligehold";
    case "analysis":
      return "#/analyse";
    case "messages":
      return "#/beskeder";
    default:
      return "#/";
  }
}

/**
 * Gå til en adresse.
 *
 * Ikke en hook. Den sætter hashen, og begge applikationer lytter i forvejen
 * efter hashchange, så der er ingen tilstand at holde styr på.
 */
export function navigate(next: View): void {
  const target = toHash(next);
  if (window.location.hash === target) return;
  window.location.hash = target;
}

/** Den nuværende adresse, som React kan abonnere på. */
export function currentHash(): string {
  return window.location.hash || "#/";
}
