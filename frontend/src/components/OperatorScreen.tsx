/**
 * Skærmen på produktionsgangen.
 *
 * Ét lot ad gangen, ingen menu og ingen indlogning. Den skal kunne læses på
 * tre meters afstand af en, der står ved en maskine og har hænderne fulde, og
 * den skal kunne besvare ét spørgsmål uden at nogen rører den: er det ved at
 * blive bedre.
 *
 * Alarmen er den anden halvdel. Et resultat, ingen har kvitteret for, bliver
 * ved med at melde sig. Intet forsvinder på en timer: et resultat, ingen har
 * set, er stadig et resultat, ingen har set.
 *
 * Der er ingen lot-vælger her. Vil man et andet lot, går man tilbage til
 * forsiden, hvor alle lots står, og hvor et ukvitteret resultat på et andet
 * lot er markeret. Skærmen viser ét lot, og kun ét.
 */

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import type { LotDetail, LotMeta, StampId, TestTypeId } from "../types";
import {
  firstScopeWithSamples,
  samplesIn,
  type Scope,
  type Thresholds,
} from "../lots";
import { describeStream, useLotStream } from "../lotStream";
import { Icon } from "./Icon";
import { ProcessCard } from "./ProcessCard";
import { SampleHistory } from "./SampleHistory";
import { SetupDialog } from "./SetupDialog";
import { LotSheet } from "./LotSheet";

const started = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

const clockFormat = new Intl.DateTimeFormat("da-DK", {
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Hvem der står som afsender på en kvittering.
 *
 * Skærmen har ingen indlogning, og det er med vilje: at skulle taste initialer
 * for at kvittere for et tal er friktion uden formål. Linjen er det nærmeste,
 * vi kommer på en identitet, og den siger i det mindste hvilken skærm det var.
 */
function acknowledgedBy(lot: LotDetail): string {
  return lot.line ? `Produktion ${lot.line}` : "Produktion";
}

interface Props {
  lotNo: string;
  onBack: () => void;
  onOpenSample: (sampleId: number) => void;
}

export function OperatorScreen({ lotNo, onBack, onOpenSample }: Props) {
  const [meta, setMeta] = useState<LotMeta | null>(null);
  const [lot, setLot] = useState<LotDetail | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  const [stamdataOpen, setStamdataOpen] = useState(false);

  // Feltnavne til de manglende felter. Serveren sender id'er, ikke etiketter,
  // og "input_kg" er ikke noget, nogen skal læse på en produktionsgang.
  const fieldLabels = useMemo(
    () => new Map((meta?.lot_fields ?? []).map((f) => [f.id, f.label])),
    [meta],
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Fane pr. proces og hvilket omfang historikken viser. Begge dele er
  // klienttilstand og ikke adresse: en skærm, der står tændt i et døgn, skal
  // ikke efterlade en browserhistorik med 400 poster.
  const [tabs, setTabs] = useState<Record<string, TestTypeId>>({});
  const [scope, setScope] = useState<Scope | null>(null);

  const lotRef = useRef(lotNo);
  lotRef.current = lotNo;

  useEffect(() => {
    void api
      .lotMeta()
      .then(setMeta)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Kunne ikke hente opsætningen"),
      );
  }, []);

  const refresh = useCallback(async () => {
    try {
      // Uden et lotnummer i adressen vises det senest startede. En skærm, der
      // bliver tændt om morgenen på en genvej uden nummer, skal vise noget.
      const target = lotRef.current || (await api.lots())[0]?.lot_no;
      if (!target) {
        setLot(null);
        return;
      }

      // Opsætningen hentes ikke her. Dialogen henter sin egen, og skærmen
      // viser den ikke, så det ville være et kald pr. genopfriskning til
      // ingen verdens nytte.
      setLot(await api.lot(target));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente lottet");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, lotNo]);

  const stream = useLotStream(refresh);

  // Historikken følger med over på et nyt lot, hvis den kan. Kan den ikke,
  // falder den tilbage til det første trin, der faktisk har prøver, frem for
  // at stå tom uden at sige hvorfor.
  useEffect(() => {
    if (!lot || !meta) return;

    const order = meta.processes.map((p) => ({
      id: p.id,
      test_types: p.test_types,
    }));

    setScope((current) => {
      if (
        current &&
        samplesIn(lot.samples, current.process, current.testType).length > 0
      ) {
        return current;
      }
      return firstScopeWithSamples(lot.samples, order);
    });
  }, [lot, meta]);

  const testTypes = useMemo(
    () => Object.fromEntries((meta?.test_types ?? []).map((t) => [t.id, t])),
    [meta],
  );

  // De to grænser for hvornår en ændring er for lille til at vise. Begge kommer
  // fra serveren, så de kun findes ét sted.
  const thresholds = useMemo<Thresholds>(
    () => ({
      flat: meta?.flat_threshold ?? 0,
      relative: meta?.relative_threshold ?? 0,
    }),
    [meta],
  );

  const acknowledge = async (sampleIds: number[]) => {
    if (!lot) return;
    setBusy(true);
    try {
      const who = acknowledgedBy(lot);
      for (const id of sampleIds) await api.acknowledgeSample(id, who);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke kvittere");
    } finally {
      setBusy(false);
    }
  };

  const stamp = async (verdict: StampId) => {
    if (!lot) return;
    setBusy(true);
    try {
      await api.stampLot(lot.lot_no, verdict, acknowledgedBy(lot));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke stemple lottet");
    } finally {
      setBusy(false);
    }
  };

  const connection = describeStream(stream.state);
  const alerting = (lot?.unacknowledged_count ?? 0) > 0;

  const scopeProcess = meta?.processes.find((p) => p.id === scope?.process);

  return (
    <div className="monitor">
      <header className="monitor__bar">
        <button type="button" className="monitor__back" onClick={onBack}>
          <Icon name="chevron-left" size={20} strokeWidth={2.2} />
          Alle lots
        </button>

        <span className="monitor__line">
          {lot?.line ? `Linje ${lot.line}` : "Produktion"}
        </span>

        <span className={`monitor__conn monitor__conn--${connection.tone}`}>
          <Icon name={connection.icon} size={16} strokeWidth={2.2} />
          {connection.label}
          {stream.state !== "live" && stream.lastContact && (
            <em>sidst kl. {clockFormat.format(stream.lastContact)}</em>
          )}
        </span>

        <Clock />
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

      {!lot || !meta ? (
        <p className="empty">{error ? "" : "Henter…"}</p>
      ) : (
        <>
          <section className={`lotbox${alerting ? " lotbox--alert" : ""}`}>
            <header className="lotbox__head">
              <div className="lotbox__id">
                <p className="lotbox__label">Lot</p>
                <h1>{lot.lot_no}</h1>
              </div>

              {/* Kun de fem, man har brug for at kende, mens partiet kører.
                  Resten af stamdata bor i sit eget ark, ellers bliver hovedet
                  et regneark, man skal læse i stedet for at kigge på. */}
              <dl className="lotbox__facts">
                <div>
                  <dt>Ordre nr.</dt>
                  <dd>{lot.order_no ?? "ikke angivet"}</dd>
                </div>
                <div>
                  <dt>Varietet</dt>
                  <dd>{lot.variety ?? "ikke angivet"}</dd>
                </div>
                <div>
                  <dt>Item no.</dt>
                  <dd>{lot.item_no ?? "ikke angivet"}</dd>
                </div>
                <div>
                  <dt>Startet</dt>
                  <dd>{started.format(new Date(lot.started_at))}</dd>
                </div>
                <div>
                  <dt>Prøver</dt>
                  <dd>{lot.sample_count}</dd>
                </div>
              </dl>

              <div className="lotbox__state">
                {alerting && (
                  <span className="badge badge--new">
                    <span className="dot" />
                    Nyt resultat
                  </span>
                )}
                <StatusPill lot={lot} />
                {/* Den samme kontrol som i driftsrapporten. Står der noget,
                    er det en huskeliste og ikke en fejl: lottet må gerne køre,
                    mens kg ind stadig er ukendt. */}
                {lot.missing.length > 0 && (
                  <button
                    type="button"
                    className="badge badge--todo"
                    onClick={() => setStamdataOpen(true)}
                    title={lot.missing
                      .map((id) => fieldLabels.get(id) ?? id)
                      .join(", ")}
                  >
                    <Icon name="info" size={14} strokeWidth={2.2} />
                    {lot.missing.length === 1
                      ? "1 felt mangler"
                      : `${lot.missing.length} felter mangler`}
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setStamdataOpen(true)}
                >
                  <Icon name="file-text" size={17} strokeWidth={2.2} />
                  Stamdata
                </button>
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => setSetupOpen(true)}
                >
                  <Icon name="sliders" size={17} strokeWidth={2.2} />
                  Opsætning
                </button>
              </div>
            </header>

            {/* Kortene og pilene er søskende i det samme gitter, ikke kort
                pakket ind i hver sin kasse. Det er det, der gør det muligt at
                lade kortene arve gitterets rækker, så overskrift, hovedtal og
                tabel står i vandret linje på tværs af trinnene.

                Spalterne sættes her og ikke i CSS. Antallet af trin er data —
                det kom fra serveren — og CSS kan ikke tælle: `repeat()` vil
                have et helt tal og ikke en beregning. Mønsteret er ét spor
                per kort med en pil imellem. */}
            <div
              className="chain"
              style={{
                gridTemplateColumns: meta.processes.map(() => "1fr").join(" auto "),
              }}
            >
              {meta.processes.map((process, index) => (
                <Fragment key={process.id}>
                  <ProcessCard
                    lot={lot}
                    process={process}
                    testTypes={testTypes}
                    selected={tabs[process.id] ?? process.test_types[0]}
                    active={scope?.process === process.id}
                    thresholds={thresholds}
                    busy={busy}
                    // Ét klik gør begge dele: vælger fanen på kortet og
                    // skifter prøvehistorikken nedenunder til den. De to
                    // kunne skilles ad, men så ville et klik på "Cleaning"
                    // ikke vise Cleaning-prøverne, og det er det, man mener.
                    onSelect={(testType) => {
                      setTabs((current) => ({ ...current, [process.id]: testType }));
                      setScope({ process: process.id, testType });
                    }}
                    onAcknowledge={acknowledge}
                    onStamp={stamp}
                  />
                  {index < meta.processes.length - 1 && (
                    <span className="chain__arrow" aria-hidden="true">
                      <Icon name="arrow-right" size={22} strokeWidth={2} />
                    </span>
                  )}
                </Fragment>
              ))}
            </div>
          </section>

          {scope && scopeProcess && (
            <SampleHistory
              testType={testTypes[scope.testType]}
              processLabel={scopeProcess.label}
              scope={samplesIn(lot.samples, scope.process, scope.testType)}
              thresholds={thresholds}
              onOpenSample={onOpenSample}
            />
          )}

          {!scope && (
            <p className="empty">
              Der er ikke registreret prøver på dette lot endnu.
            </p>
          )}
        </>
      )}

      {setupOpen && lot && (
        <SetupDialog
          lotNo={lot.lot_no}
          setBy={acknowledgedBy(lot)}
          onClose={() => setSetupOpen(false)}
          onSaved={refresh}
        />
      )}

      {stamdataOpen && lot && meta && (
        <LotSheet
          fields={meta.lot_fields}
          lot={lot}
          onClose={() => setStamdataOpen(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}

function StatusPill({ lot }: { lot: LotDetail }) {
  if (lot.stamp === "approved")
    return <span className="pill pill--ok">Godkendt</span>;
  if (lot.stamp === "rejected")
    return <span className="pill pill--overdue">Afvist</span>;
  return <span className="pill pill--running">Kører</span>;
}

/**
 * Uret ejer sin egen tilstand.
 *
 * Lå minuttallet i skærmens tilstand, ville hele siden blive tegnet om hvert
 * minut, og et lot med tredive prøver er ikke gratis at tegne.
 */
function Clock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  return <span className="monitor__clock">{clockFormat.format(now)}</span>;
}

