/**
 * Forbindelsen, der holder operatørskærmen frisk.
 *
 * Server-sent events fra vores egen backend, ikke Supabase realtime i
 * browseren. Prøvetabellerne har Row Level Security uden policies, netop for
 * at browseren ikke skal kunne tale med Supabase, og en skærm, der står tændt
 * i produktionen hele dagen, er ikke stedet at fravige det.
 *
 * Strømmen bærer ingen data. Den siger kun, at der er sket noget, og så henter
 * skærmen selv. En skærm, der har været væk i en time, skal ikke sy et hul
 * sammen af hændelser, den ikke fik.
 *
 * Tre tilstande, og forskellen på dem er hele pointen: operatøren skal kunne
 * se forskel på "der er ingen nye prøver" og "skærmen er død".
 */

import { useEffect, useRef, useState } from "react";
import { api } from "./api";

export type StreamState =
  | "connecting"
  | "live"
  | "polling"
  | "degraded"
  | "stale";

/** Hvor længe der må gå uden et livstegn, før strømmen regnes for død.
 *  Serveren slår hvert 15. sekund, så tre slag i træk skal mangle. */
const SILENCE_LIMIT_MS = 45_000;

/** Hvor ofte der hentes, når strømmen ikke er i live. */
const POLL_MS = 10_000;

interface Stream {
  state: StreamState;
  /** Hvornår der sidst var kontakt. Står på skærmen, når den ikke er live. */
  lastContact: Date | null;
}

export function useLotStream(onChange: () => void): Stream {
  const [state, setState] = useState<StreamState>("connecting");
  const [lastContact, setLastContact] = useState<Date | null>(null);

  // Callback'et holdes i en ref, så en ny funktionsreference fra forælderen
  // ikke river forbindelsen ned og op igen ved hver eneste gentegning.
  const changed = useRef(onChange);
  changed.current = onChange;

  const contactAt = useRef<number>(0);

  // Tilstanden findes to steder: i state, fordi skærmen skal tegnes om, og i
  // en ref, fordi de to ure herunder skal kunne læse den uden at være
  // afhængige af den. Ellers skulle forbindelsen rives ned og op igen, hver
  // gang tilstanden skiftede.
  const current = useRef<StreamState>("connecting");
  const settle = (next: StreamState) => {
    current.current = next;
    setState(next);
  };

  useEffect(() => {
    const source = new EventSource(api.lotStreamUrl());

    const touch = () => {
      contactAt.current = Date.now();
      setLastContact(new Date());
    };

    source.onopen = () => {
      touch();
      settle("live");
    };

    source.addEventListener("ready", () => {
      touch();
      settle("live");
    });

    source.addEventListener("beat", () => {
      touch();
      if (current.current !== "degraded") settle("live");
    });

    source.addEventListener("change", () => {
      touch();
      settle("live");
      changed.current();
    });

    // Databasen svarer ikke, men strømmen lever. Det er en anden fejl end en
    // død forbindelse, og den skal siges med sine egne ord.
    source.addEventListener("degraded", () => {
      touch();
      settle("degraded");
    });

    // EventSource genopretter selv. Vi henter med jævne mellemrum imens, så
    // skærmen ikke står stille, mens den prøver.
    source.onerror = () => {
      if (current.current !== "degraded") settle("polling");
    };

    // To ure. Det ene henter, når vi ikke er live. Det andet opdager tavshed:
    // en forbindelse, der er faldet fra, uden at browseren har opdaget det,
    // fejler ikke, den holder bare op med at sige noget.
    const poll = window.setInterval(() => {
      if (current.current !== "live") changed.current();
    }, POLL_MS);

    const watchdog = window.setInterval(() => {
      const silent = Date.now() - contactAt.current > SILENCE_LIMIT_MS;
      if (contactAt.current && silent && current.current === "live") {
        settle("stale");
      }
    }, 5_000);

    return () => {
      window.clearInterval(poll);
      window.clearInterval(watchdog);
      source.close();
    };
  }, []);

  return { state, lastContact };
}

export function describeStream(state: StreamState): {
  label: string;
  icon: string;
  tone: "ok" | "warn" | "danger";
} {
  switch (state) {
    case "live":
      return { label: "Live", icon: "wifi", tone: "ok" };
    case "connecting":
      return { label: "Forbinder", icon: "wifi", tone: "warn" };
    case "polling":
      return { label: "Henter hvert 10. sek.", icon: "rotate-ccw", tone: "warn" };
    case "degraded":
      return { label: "Databasen svarer ikke", icon: "triangle-alert", tone: "danger" };
    case "stale":
      return { label: "Ingen kontakt", icon: "wifi-off", tone: "danger" };
  }
}
