/**
 * Én prøve. Det sidste led i hierarkiet.
 *
 *     Lot -> proces -> testtype -> PRØVE -> metrikker og billeder
 *
 * Herfra kan man ikke komme dybere ned i tallene, kun ind i det enkelte frø.
 * Derfor står alt om prøven her: hvornår den blev taget, af hvem, hvem der
 * kvitterede, alle metrikker med deres ændring, og billedrækken fra
 * VideometerLab.
 *
 * Justeringsteksten står ikke her. Den hører til sammenligningen mellem
 * prøver, ikke til den enkelte prøve, og den har sin egen kolonne i
 * prøvehistorikken, hvor den kan læses ved siden af de tal, den frembragte.
 */

import { useEffect, useState } from "react";
import { api } from "../api";
import type {
  BlobRow,
  LotDetail,
  LotMeta,
  LotSample,
  MetricGroup,
  ScanSummary,
} from "../types";
import {
  deltaClass,
  deltaFor,
  formatDelta,
  formatMetric,
  previousOf,
  samplesIn,
  type Thresholds,
} from "../lots";
import { Icon } from "./Icon";
import { MetricTable } from "./MetricTable";
import { Stack } from "./Stack";
import { SeedView } from "./SeedView";
import { Trend } from "./Trend";

const when = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

const PAGE = 240;

interface Props {
  sampleId: number;
  onBack: () => void;
}

export function SampleView({ sampleId, onBack }: Props) {
  const [sample, setSample] = useState<LotSample | null>(null);
  const [lot, setLot] = useState<LotDetail | null>(null);
  const [meta, setMeta] = useState<LotMeta | null>(null);
  const [scan, setScan] = useState<ScanSummary | null>(null);
  const [blobs, setBlobs] = useState<BlobRow[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSample(null);
    setError(null);

    void (async () => {
      try {
        const [one, metaData] = await Promise.all([
          api.sample(sampleId),
          api.lotMeta(),
        ]);
        if (cancelled) return;
        setSample(one);
        setMeta(metaData);

        // Lottet hentes for at kunne regne ændringen mod den foregående prøve.
        // Den findes ikke i prøven selv, og et delta uden sammenligning er
        // ingenting værd.
        const detail = await api.lot(one.lot_no);
        if (!cancelled) setLot(detail);

        // Billederne er valgfri. Er der ingen scanning knyttet til prøven,
        // eller kan den ikke læses, står resten af siden stadig.
        if (one.scan_id) {
          try {
            const [summary, rows] = await Promise.all([
              api.scan(one.scan_id),
              api.scanBlobs(one.scan_id, { limit: PAGE }),
            ]);
            if (!cancelled) {
              setScan(summary);
              setBlobs(rows);
            }
          } catch {
            if (!cancelled) setBlobs([]);
          }
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Kunne ikke hente prøven");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sampleId]);

  if (error) {
    return (
      <div className="monitor">
        <div className="alert alert--warning" role="alert">
          <p className="alert__label">
            <Icon name="triangle-alert" size={14} strokeWidth={2.2} />
            Kunne ikke hente prøven
          </p>
          <p>{error}</p>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          <Icon name="arrow-left" size={16} />
          Tilbage
        </button>
      </div>
    );
  }

  if (!sample || !meta) {
    return (
      <div className="monitor">
        <p className="empty">Henter…</p>
      </div>
    );
  }

  const process = meta.processes.find((p) => p.id === sample.process);
  const testType = meta.test_types.find((t) => t.id === sample.test_type);
  const previous = lot ? previousOf(lot.samples, sample) : undefined;
  const primary = testType?.metrics.find((m) => m.primary);
  const thresholds: Thresholds = {
    flat: meta.flat_threshold,
    relative: meta.relative_threshold,
  };

  // Testtyper uden grupper har én fordeling. Den får en syntetisk gruppe, så
  // visningen nedenfor kun har ét tilfælde at forholde sig til.
  const groups: MetricGroup[] =
    testType && testType.groups.length > 0
      ? testType.groups
      : [
          {
            id: "",
            label: `Alt andet end ${primary?.label ?? "hovedtallet"}`,
            lead: "",
            scale: "nominal",
          },
        ];
  // De ordnede fordelinger vises under hovedtallet, de nominelle i paneler
  // nedenunder. De to slags data skal tegnes hver sin måde, se Stack.tsx.
  const ordinal = groups.filter((g) => g.scale === "ordinal");
  const nominal = groups.filter((g) => g.scale !== "ordinal");

  const primaryDelta = primary
    ? deltaFor(primary, sample, previous, thresholds)
    : null;

  // Alle prøver i det trin, prøven hører til. Grundlaget under udviklingen.
  const stepSamples = lot
    ? samplesIn(lot.samples, sample.process, sample.test_type)
    : [];
  const total = stepSamples.length || sample.seq;
  const earlier = stepSamples.filter((s) => s.seq < sample.seq);

  return (
    <div className="monitor sampleview">
      <header className="monitor__bar">
        <button type="button" className="monitor__back" onClick={onBack}>
          <Icon name="chevron-left" size={20} strokeWidth={2.2} />
          Tilbage til lottet
        </button>
      </header>

      {/* Stien ned gennem hierarkiet. Uden den kan man ikke se, hvilket af
          seks mulige trin på lottet man står i. */}
      <p className="sampleview__path">
        <span>{sample.lot_no}</span>
        <Icon name="chevron-right" size={15} strokeWidth={2.4} />
        <span>{process?.label ?? sample.process}</span>
        <Icon name="chevron-right" size={15} strokeWidth={2.4} />
        <span>{testType?.label ?? sample.test_type}</span>
      </p>

      <header className="sampleview__head">
        <div>
          <p className="lotbox__label">Prøve</p>
          <h1>
            #{sample.seq}
            <span> af {total}</span>
          </h1>
        </div>

        <dl className="lotbox__facts">
          <div>
            <dt>Taget</dt>
            <dd>{when.format(new Date(sample.taken_at))}</dd>
          </div>
          <div>
            <dt>Af</dt>
            <dd>{sample.taken_by ?? "ukendt"}</dd>
          </div>
          <div>
            <dt>Kvitteret</dt>
            <dd>
              {sample.acknowledged_at ? (
                sample.acknowledged_by
              ) : (
                <span className="history__pending">Ikke kvitteret</span>
              )}
            </dd>
          </div>
        </dl>
      </header>

      {/* Hovedtallet står for sig. Det er prøvens svar, og de øvrige klasser
          er, hvad det svar består af. Havde det stået som første række i
          tabellen nedenfor, ville Sugarbeet med sine 97 % desuden gøre alle de
          andres spor til en streg ved nul. */}
      {primary && (
        <section className="sampleview__lead">
          <p className="sampleview__hero">
            <span className="sampleview__hero-value">
              {formatMetric(sample.metrics[primary.id], primary.unit)}
            </span>
            <span className="sampleview__hero-label">{primary.label}</span>
            {primaryDelta ? (
              <span className={deltaClass(primaryDelta)}>
                <Icon
                  name={
                    primaryDelta.direction === "flat"
                      ? "minus"
                      : primaryDelta.direction === "up"
                        ? "arrow-up"
                        : "arrow-down"
                  }
                  size={17}
                  strokeWidth={2.6}
                />
                {formatDelta(primaryDelta)}
              </span>
            ) : (
              <span className="delta delta--none">første prøve i trinnet</span>
            )}
          </p>

          {/* De ordnede fordelinger står her, lige under hovedtallet, og ikke
              i et panel for sig. FV er kvaliteten af netop de frø, Monogerm
              tæller, så de to hører sammen og skal læses i ét blik. */}
          {testType &&
            ordinal.map((group) => (
              <div className="sampleview__quality" key={group.id}>
                <p className="sampleview__quality-head">
                  {group.label}
                  {group.lead && <span>{group.lead}</span>}
                </p>
                <Stack
                  metrics={testType.metrics.filter((m) => m.group === group.id)}
                  sample={sample}
                />
              </div>
            ))}
        </section>
      )}

      {/* De nominelle fordelinger. En CT-scanning giver to fordelinger af den
          samme måling, og de skal tegnes hver sin måde: de ordnede står under
          hovedtallet ovenfor, de nominelle som søjler på fælles akse her. */}
      {testType && nominal.map((group) => {
        // Metrikker uden gruppe hoerer til den syntetiske gruppe med tom id.
        const inGroup = testType.metrics.filter(
          (m) => (m.group ?? "") === group.id,
        );
        const groupPrimary = inGroup.find((m) => m.primary);

        return (
          <section className="panel" key={group.id ?? "alle"}>
            {/* .panel er en skal uden indvendig plads. Overskriften hører
                hjemme i .panel__head, ellers lander den på kanten. */}
            <header className="panel__head">
              <h2>{group.label}</h2>
              {group.lead && <p className="panel__sub">{group.lead}</p>}
            </header>

            <MetricTable
              metrics={inGroup.filter((m) => !m.primary)}
              current={sample}
              earlier={earlier}
              thresholds={thresholds}
            />

            {/* Hovedtallet for gruppen er allerede vist stort, hvis det er
                testtypens første. De øvrige grupper har deres eget. */}
            {groupPrimary && groupPrimary.id !== primary?.id && (
              <p className="sampleview__group-primary">
                {groupPrimary.label}{" "}
                <strong>
                  {formatMetric(sample.metrics[groupPrimary.id], groupPrimary.unit)}
                </strong>
              </p>
            )}
          </section>
        );
      })}

      {/* Tabellen ovenfor svarer på hvor stor hver klasse er, med fælles akse.
          Den her svarer på hvilken vej den går, og det er et spørgsmål pr.
          klasse, så hvert felt har sin egen skala. */}
      {testType && stepSamples.length >= 3 && (
        <section className="panel">
          <header className="panel__head">
            <h2>Udvikling gennem trinnet</h2>
            <p className="panel__sub">
              {stepSamples.length} prøver. Hvert felt har sin egen skala, så en
              lille klasse ikke bliver en vandret streg. Højderne kan derfor
              ikke sammenlignes felterne imellem, det gør tabellen ovenfor.
            </p>
          </header>
          <div className="sampleview__trend">
            <Trend
              metrics={testType.metrics}
              scope={stepSamples}
              current={sample}
            />
          </div>
        </section>
      )}

      {/* Kun for Videometer-prøver. scan_id peger på en blob-samling fra
          VideometerLab, og en CT-scanning har ingen. Billeder fra CT ville
          skulle hentes ad en anden vej og med sin egen visning. */}
      {sample.test_type !== "ct" && (
      <section className="panel">
        <header className="panel__head">
          <h2>Billeder fra VideometerLab</h2>
        </header>

        <div className="sampleview__images">
        {!sample.scan_id ? (
          <p className="empty">
            Der er ikke knyttet en scanning til denne prøve. Feltet sættes, når
            prøven registreres under Lots.
          </p>
        ) : blobs === null ? (
          <p className="empty">Henter billederne…</p>
        ) : blobs.length === 0 ? (
          <p className="empty">
            Scanningen <code>{sample.scan_id}</code> kunne ikke læses fra denne
            maskine. Blob-samlingen ligger på instrument-PC'en.
          </p>
        ) : (
          <>
            <p className="sampleview__scan">
              {scan?.sample ?? sample.scan_id}
              {scan && ` · ${scan.blob_count} frø · ${scan.classifier ?? "ukendt model"}`}
            </p>
            <div className="blob-grid">
              {blobs.map((blob, index) => (
                <figure
                  key={blob.blob_id}
                  className={`blob ${blob.corrected ? "blob--corrected" : ""}`}
                  onClick={() => setOpen(index)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setOpen(index);
                    }
                  }}
                >
                  <img
                    src={api.thumbnailUrl(sample.scan_id as string, blob.blob_id)}
                    alt=""
                    loading="lazy"
                    width={96}
                    height={96}
                  />
                  <figcaption>
                    <span className="blob__class">
                      {blob.corrected ? blob.reference : (blob.predicted ?? "?")}
                    </span>
                    {blob.confidence !== null && !blob.corrected && (
                      <span className="blob__conf">
                        {Math.round(blob.confidence * 100)}%
                      </span>
                    )}
                  </figcaption>
                </figure>
              ))}
            </div>
            {blobs.length === PAGE && (
              <p className="footnote">
                <span>Viser de første {PAGE} frø af scanningen.</span>
              </p>
            )}
          </>
        )}
        </div>
      </section>
      )}

      {blobs && open !== null && blobs[open] && sample.scan_id && (
        <SeedView
          key={blobs[open].blob_id}
          scanId={sample.scan_id}
          blob={blobs[open]}
          onClose={() => setOpen(null)}
          onStep={(delta) =>
            setOpen((current) => {
              if (current === null) return null;
              const next = current + delta;
              return next < 0 || next >= blobs.length ? current : next;
            })
          }
        />
      )}
    </div>
  );
}
