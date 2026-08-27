/**
 * To applikationer, ét domæne.
 *
 * Produktionsskærmen ude ved linjen og kontorapplikationen inde på gangen har
 * vokset sig fra hinanden: den ene hænger på en touchskærm uden indlogning og
 * står tændt i døgndrift, den anden er en almindelig side med en menu, en
 * bruger og syv skærmbilleder. De deler domæne, typer og API-klient, men de
 * deler ikke publikum, layout eller vilkår.
 *
 * Filen her er hele det, de har tilfælles på skærmen: hvilken adresse er det,
 * og hvem af de to skal svare. Resten hentes hver for sig.
 *
 * `lazy` er ikke pynt. Uden den henter en fabriks-pc, der kun skal vise
 * brættet, også wikien, forvirringsmatricen og scanningsbrowseren, og en
 * skærm, ingen står ved, betaler for kode, den aldrig kører. Delingen er
 * samtidig den, der gør, at en fejl i analysedelen ikke kan slukke
 * produktionsskærmen: den er ikke i bundtet.
 */

import { Suspense, lazy, useEffect, useState } from "react";
import { currentHash, isProduction, parseHash } from "./routes";

const ProductionApp = lazy(() => import("./ProductionApp"));
const OfficeApp = lazy(() => import("./OfficeApp"));

export default function App() {
  const [hash, setHash] = useState(currentHash);

  useEffect(() => {
    const onHashChange = () => setHash(currentHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const view = parseHash(hash);

  // Ingen spinner. Bundterne ligger på den samme maskine som API'et, så det
  // her varer et øjeblik, og et glimt af en henter-tekst er mere uro end
  // hjælp. Er der ingenting endnu, står siden bare tom et øjeblik.
  return (
    <Suspense fallback={null}>
      {isProduction(view) ? <ProductionApp view={view} /> : <OfficeApp />}
    </Suspense>
  );
}
