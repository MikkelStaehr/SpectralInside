/**
 * Analytikerens side af lots.
 *
 * Her startes et lot, og her registreres prøverne. Det er skriveenden af den
 * skærm, produktionen læser, og indtil connectoren kan hente tallene direkte
 * ud af analysen, er det her, de kommer ind.
 *
 * Formularen kender ikke metrikkerne. Den bygger felterne ud fra
 * /api/lots/meta, så en ny metrik er en ændring i backenden og ikke to
 * ændringer, der skal holdes ens.
 *
 * Prøvenummeret kan man ikke taste. Det tildeles af databasen, fordi to
 * analytikere på det samme lot ellers kunne give hver sin prøve nummer 3.
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  LotDetail,
  LotMeta,
  LotSummary,
  ProcessId,
  ScanSummary,
  TestTypeId,
} from "../types";
import { formatMetric, samplesIn } from "../lots";
import { Icon } from "./Icon";
import { LotSheet } from "./LotSheet";

const when = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

interface Props {
  operator: string;
  onOpenMonitor: (lotNo: string) => void;
}

export function LotsView({ operator, onOpenMonitor }: Props) {
  const [meta, setMeta] = useState<LotMeta | null>(null);
  const [lots, setLots] = useState<LotSummary[]>([]);
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<LotDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    void Promise.all([api.lotMeta(), api.lots()])
      .then(([metaData, lotsData]) => {
        setMeta(metaData);
        setLots(lotsData);
        setSelected((current) => current ?? lotsData[0]?.lot_no ?? null);
      })
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Kunne ikke hente lots"),
      );

    // Bruges kun til at knytte en prøve til den scanning, den kom fra, så
    // billedrækken kan findes fra operatørskærmen. Fejler den, er feltet bare
    // tomt, og resten virker.
    void api.scans().then(setScans).catch(() => setScans([]));
  }, []);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    void api
      .lot(selected)
      .then(setDetail)
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Kunne ikke hente lottet"),
      );
  }, [selected]);

  const reload = async (lotNo: string) => {
    const [lotsData, lotData] = await Promise.all([api.lots(), api.lot(lotNo)]);
    setLots(lotsData);
    setDetail(lotData);
  };

  // Oprettelsen ligger i LotSheet og ikke her. Stamdata skal skrives ét sted,
  // og en formular med fire felter her og elleve i arket ville give to slags
  // lots: dem med ordrenummer og dem uden.
  const lotCreated = async (created: LotSummary) => {
    setSelected(created.lot_no);
    try {
      setLots(await api.lots());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke hente listen");
    }
  };

  return (
    <div className="lots">
      <header className="page__head">
        <h1>Lots</h1>
        <p>
          Start et lot, og registrér prøverne undervejs. Det, du skriver her, er
          det, skærmen i produktionen viser.
        </p>
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

      <div className="lots__bar">
        <label className="field field--inline">
          <span>Lot</span>
          <select
            value={selected ?? ""}
            onChange={(event) => setSelected(event.target.value || null)}
          >
            {lots.length === 0 && <option value="">Ingen lots endnu</option>}
            {lots.map((lot) => (
              <option key={lot.lot_no} value={lot.lot_no}>
                {lot.lot_no}
                {lot.variety ? ` · ${lot.variety}` : ""}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="btn btn--ghost"
          disabled={!meta}
          onClick={() => setShowNew(true)}
        >
          <Icon name="plus" size={16} strokeWidth={2.2} />
          Nyt lot
        </button>

        {selected && (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => onOpenMonitor(selected)}
          >
            Se operatørskærmen
            <Icon name="arrow-right" size={16} strokeWidth={2.2} />
          </button>
        )}
      </div>

      {showNew && meta && (
        <LotSheet
          fields={meta.lot_fields}
          operator={operator}
          onClose={() => setShowNew(false)}
          onSaved={lotCreated}
        />
      )}

      {meta && detail && (
        <>
          <SampleForm
            meta={meta}
            lot={detail}
            scans={scans}
            operator={operator}
            onSaved={() => reload(detail.lot_no)}
          />
          <RegisteredSamples meta={meta} lot={detail} />
        </>
      )}
    </div>
  );
}

/** Registrering af én prøve. Felterne bygges ud fra den valgte testtype. */
function SampleForm({
  meta,
  lot,
  scans,
  operator,
  onSaved,
}: {
  meta: LotMeta;
  lot: LotDetail;
  scans: ScanSummary[];
  operator: string;
  onSaved: () => void;
}) {
  const [process, setProcess] = useState<ProcessId>(meta.processes[0].id);
  const [values, setValues] = useState<Record<string, string>>({});
  const [adjustment, setAdjustment] = useState("");
  const [scanId, setScanId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const current = meta.processes.find((p) => p.id === process) ?? meta.processes[0];

  // Testtypen følger processen. Skifter man proces, kan den valgte testtype
  // være en, der ikke findes dér, og så skal den nulstilles frem for at give
  // en fejl ved indsendelse.
  const [testType, setTestType] = useState<TestTypeId>(current.test_types[0]);
  useEffect(() => {
    if (!current.test_types.includes(testType)) setTestType(current.test_types[0]);
  }, [current, testType]);

  const definition = useMemo(
    () => meta.test_types.find((t) => t.id === testType),
    [meta, testType],
  );

  const nextSeq = samplesIn(lot.samples, process, testType).length + 1;
  // Alle metrikker skal udfyldes. En tom værdi ville stå som en tom celle på
  // operatørskærmen, uden at nogen kunne se, om den var glemt eller målt til
  // nul. Backenden afviser den samme ting.
  const complete =
    definition?.metrics.every((m) => (values[m.id] ?? "").trim() !== "") ?? false;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!definition) return;

    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const metrics: Record<string, number> = {};
      for (const metric of definition.metrics) {
        const raw = (values[metric.id] ?? "").replace(",", ".");
        const parsed = Number(raw);
        if (!Number.isFinite(parsed)) {
          throw new Error(`${metric.label} er ikke et tal`);
        }
        metrics[metric.id] = parsed;
      }

      await api.createSample(lot.lot_no, {
        process,
        test_type: testType,
        metrics,
        taken_by: operator,
        adjustment: adjustment.trim() || null,
        scan_id: scanId || null,
      });

      setValues({});
      setAdjustment("");
      setScanId("");
      setDone(`Prøve #${nextSeq} registreret`);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke registrere prøven");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="panel lots__form" onSubmit={submit}>
      <h2>Registrér prøve</h2>

      <div className="lots__choices">
        <fieldset className="choice">
          <legend>Proces</legend>
          {meta.processes.map((p) => (
            <label key={p.id}>
              <input
                type="radio"
                name="process"
                checked={p.id === process}
                onChange={() => setProcess(p.id)}
              />
              <span>
                {p.step}. {p.label}
              </span>
            </label>
          ))}
        </fieldset>

        <fieldset className="choice">
          <legend>Testtype</legend>
          {/* Kun de testtyper, der hører til processen. Det er en domæneregel
              fra serveren, ikke en liste her. */}
          {current.test_types.map((id) => {
            const label = meta.test_types.find((t) => t.id === id)?.label ?? id;
            return (
              <label key={id}>
                <input
                  type="radio"
                  name="test_type"
                  checked={id === testType}
                  onChange={() => setTestType(id)}
                />
                <span>{label}</span>
              </label>
            );
          })}
        </fieldset>
      </div>

      <p className="lots__seq">
        Bliver prøve <strong>#{nextSeq}</strong> i {current.label} ·{" "}
        {definition?.label}
      </p>

      <div className="lots__metrics">
        {definition?.metrics.map((metric) => (
          <label className="field" key={metric.id}>
            <span>
              {metric.label}
              {metric.unit && <em> ({metric.unit})</em>}
            </span>
            <input
              type="text"
              inputMode="decimal"
              value={values[metric.id] ?? ""}
              onChange={(e) =>
                setValues({ ...values, [metric.id]: e.target.value })
              }
              required
            />
          </label>
        ))}
      </div>

      <label className="field">
        <span>
          Justering <em>hvad blev der skruet på, før prøven blev taget</em>
        </span>
        <input
          value={adjustment}
          onChange={(e) => setAdjustment(e.target.value)}
          maxLength={500}
          placeholder="Slibetryk 3,2 → 2,8 bar"
        />
      </label>

      <label className="field">
        <span>
          Scanning <em>så billedrækken kan åbnes fra operatørskærmen</em>
        </span>
        <select value={scanId} onChange={(e) => setScanId(e.target.value)}>
          <option value="">Ingen</option>
          {scans.slice(0, 60).map((scan) => (
            <option key={scan.id} value={scan.id}>
              {scan.sample ?? scan.id}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p className="lots__error">
          <Icon name="triangle-alert" size={15} strokeWidth={2.2} />
          {error}
        </p>
      )}
      {done && (
        <p className="lots__done">
          <Icon name="circle-check" size={15} strokeWidth={2.2} />
          {done}
        </p>
      )}

      <button type="submit" className="btn" disabled={busy || !complete}>
        Registrér prøve
      </button>
    </form>
  );
}

/** Det, der allerede er registreret på lottet. Kvittering for at det landede. */
function RegisteredSamples({ meta, lot }: { meta: LotMeta; lot: LotDetail }) {
  if (lot.samples.length === 0) {
    return <p className="empty">Der er ikke registreret prøver på {lot.lot_no} endnu.</p>;
  }

  return (
    <section className="panel">
      <h2>Registreret på {lot.lot_no}</h2>
      {meta.processes.map((process) =>
        process.test_types.map((testType) => {
          const scope = samplesIn(lot.samples, process.id, testType);
          if (scope.length === 0) return null;
          const definition = meta.test_types.find((t) => t.id === testType);
          const primary = definition?.metrics.find((m) => m.primary);

          return (
            <div className="lots__group" key={`${process.id}-${testType}`}>
              <h3>
                {process.label} · {definition?.label}
              </h3>
              <ul className="lots__list">
                {[...scope].reverse().map((sample) => (
                  <li key={sample.id}>
                    <span className="lots__list-seq">#{sample.seq}</span>
                    <span className="lots__list-value">
                      {primary &&
                        formatMetric(sample.metrics[primary.id], primary.unit)}
                    </span>
                    <span className="lots__list-when">
                      {when.format(new Date(sample.taken_at))}
                      {sample.taken_by && ` · ${sample.taken_by}`}
                    </span>
                    <span className="lots__list-ack">
                      {sample.acknowledged_at ? "kvitteret" : "afventer kvittering"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        }),
      )}
    </section>
  );
}
