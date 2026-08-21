import { useEffect, useState } from "react";
import { api } from "../api";
import type { BlobRow, ScanSummary } from "../types";
import { Icon } from "./Icon";
import { SeedView } from "./SeedView";
import { formatDate } from "../format";

interface Props {
  scan: ScanSummary;
  onBack: () => void;
}

const PAGE = 240;

export function ScanView({ scan, onBack }: Props) {
  const [blobs, setBlobs] = useState<BlobRow[] | null>(null);
  const [filter, setFilter] = useState<string | null>(null);
  const [onlyCorrected, setOnlyCorrected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBlobs(null);
    setError(null);

    void api
      .scanBlobs(scan.id, {
        limit: PAGE,
        predicted: filter ?? undefined,
        onlyCorrected,
      })
      .then((rows) => {
        if (!cancelled) setBlobs(rows);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Kunne ikke hente frøene");
      });

    return () => {
      cancelled = true;
    };
  }, [scan.id, filter, onlyCorrected]);

  return (
    <article className="scan-view">
      <button type="button" className="btn btn--ghost back" onClick={onBack}>
        <Icon name="arrow-left" size={16} />
        Alle scanninger
      </button>

      <header className="page-head">
        <h1>{scan.sample ?? scan.filename}</h1>
        <p className="lead">
          {scan.operator ? `Kørt af ${scan.operator}` : "Ukendt operatør"}
          {scan.scanned_on ? ` den ${formatDate(scan.scanned_on)}` : ""}
          {` · ${scan.blob_count} frø`}
        </p>
      </header>

      <div className="filters">
        <button
          type="button"
          className={`chip chip--button ${filter === null && !onlyCorrected ? "chip--on" : ""}`}
          onClick={() => {
            setFilter(null);
            setOnlyCorrected(false);
          }}
        >
          Alle {scan.blob_count}
        </button>

        {scan.classes.map((c) => (
          <button
            key={c.name}
            type="button"
            className={`chip chip--button ${filter === c.name ? "chip--on" : ""}`}
            onClick={() => {
              setFilter(filter === c.name ? null : c.name);
              setOnlyCorrected(false);
            }}
          >
            {c.name} {c.count}
          </button>
        ))}

        <button
          type="button"
          className={`chip chip--button ${onlyCorrected ? "chip--on" : ""}`}
          onClick={() => {
            setOnlyCorrected(!onlyCorrected);
            setFilter(null);
          }}
        >
          Kun rettede
        </button>
      </div>

      {error && (
        <div className="alert alert--warning" role="alert">
          <p className="alert__label">
            <Icon name="triangle-alert" size={14} strokeWidth={2.2} />
            Kunne ikke læse samlingen
          </p>
          <p>{error}</p>
        </div>
      )}

      {!error && blobs === null && <p className="empty">Henter frøene…</p>}

      {blobs && blobs.length === 0 && (
        <p className="empty">Ingen frø matcher.</p>
      )}

      {blobs && blobs.length > 0 && (
        <>
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
                  src={api.thumbnailUrl(scan.id, blob.blob_id)}
                  alt=""
                  loading="lazy"
                  width={96}
                  height={96}
                />
                <figcaption>
                  <span className="blob__class">
                    {blob.corrected ? blob.reference : (blob.predicted ?? "?")}
                  </span>
                  {blob.corrected && (
                    <span className="blob__was">
                      gæt: {blob.predicted ?? "?"}
                    </span>
                  )}
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
              <span>
                Viser de første {PAGE}. Filtrér på en klasse for at se færre ad
                gangen.
              </span>
            </p>
          )}
        </>
      )}

      {blobs && open !== null && blobs[open] && (
        <SeedView
          key={blobs[open].blob_id}
          scanId={scan.id}
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
    </article>
  );
}
