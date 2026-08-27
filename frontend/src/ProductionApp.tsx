/**
 * Produktionsskærmen. Applikationen ude ved linjen.
 *
 * Den hænger på en touchskærm i produktionen, står tændt i døgndrift, og der
 * er ingen indlogning: at skulle taste initialer for at læse et tal er
 * friktion uden formål, og initialerne beskytter alligevel ingenting.
 *
 * Fire skærmbilleder, og de er ét spor ned i det samme: brættet med anlæggene,
 * ét lot, én prøve, og til sidst de frø, modellen fandt. Der er ingen menu,
 * fordi der ikke er noget at vælge imellem — man går ind og ud igen.
 *
 * Adskilt fra kontorapplikationen, fordi de to har hver sit publikum og hver
 * sine vilkår. Adskillelsen er ikke kun ryddelighed: den her skærm skal ikke
 * hente wikien, forvirringsmatricen og scanningsbrowseren for at vise et
 * bræt, og en fejl i analysedelen skal ikke kunne slukke en skærm, ingen står
 * ved.
 */

import { useEffect, useState } from "react";
import { api } from "./api";
import type { LotMeta, LotSummary, Order } from "./types";
import { navigate, type View } from "./routes";
import { Board } from "./components/Board";
import { LotSheet } from "./components/LotSheet";
import { OperatorScreen } from "./components/OperatorScreen";
import { SampleView } from "./components/SampleView";
import { DisplaySampleView } from "./components/DisplayView";

export default function ProductionApp({ view }: { view: View }) {
  if (view.name === "lotMonitor") {
    return (
      <OperatorScreen
        lotNo={view.lotNo}
        onBack={() => navigate({ name: "display" })}
        onOpenSample={(sampleId) => navigate({ name: "lotSample", sampleId })}
      />
    );
  }

  if (view.name === "lotSample") {
    return (
      <SampleView
        key={view.sampleId}
        sampleId={view.sampleId}
        // Tilbage til det lot, prøven hører til. Visningen kender lotnummeret
        // først når den har hentet prøven, så browserens egen historik er den
        // rigtige vej hjem.
        onBack={() => window.history.back()}
      />
    );
  }

  if (view.name === "displaySample") {
    return (
      <DisplaySampleView
        key={view.id}
        scanId={view.id}
        // Tilbage til det lot, man kom fra. Visningen kender ikke lotnummeret,
        // og den nås kun ved et klik derindefra, så browserens egen historik
        // er den rigtige vej hjem.
        onBack={() => window.history.back()}
      />
    );
  }

  // Forsiden. Ordrekøen er forsiden, så der er ikke længere en vej udenom til
  // et ordrevalg: #/visning/start fører hertil.
  return <BoardRoute />;
}

/**
 * Forsiden med ét spor per anlæg.
 *
 * Lots og ordrer hentes forfra med jævne mellemrum. Det er landingssiden på en
 * skærm, der står tændt hele dagen: et nyt resultat eller en ny ordre fra
 * kontoret skal kunne ses, uden at nogen genindlæser siden. Selve
 * operatørskærmen har sin egen strøm, se lotStream.ts.
 */
function BoardRoute() {
  const [meta, setMeta] = useState<LotMeta | null>(null);
  const [lots, setLots] = useState<LotSummary[] | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [starting, setStarting] = useState<Order | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.lotMeta().then((m) => {
      if (!cancelled) setMeta(m);
    });

    const load = () => {
      void api
        .lots()
        .then((rows) => !cancelled && setLots(rows))
        .catch(() => !cancelled && setLots([]));
      void api
        .orders()
        .then((rows) => !cancelled && setOrders(rows))
        .catch(() => !cancelled && setOrders([]));
    };

    load();
    const timer = window.setInterval(load, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  if (!meta || lots === null)
    return (
      <div className="board">
        <p className="empty">Henter…</p>
      </div>
    );

  return (
    <>
      <Board
        lines={meta.lines}
        lots={lots}
        orders={orders}
        onOpen={(lotNo) => navigate({ name: "lotMonitor", lotNo })}
        onStart={setStarting}
      />
      {starting && (
        <LotSheet
          fields={meta.lot_fields}
          order={starting}
          onClose={() => setStarting(null)}
          onSaved={(lot) => navigate({ name: "lotMonitor", lotNo: lot.lot_no })}
        />
      )}
    </>
  );
}
