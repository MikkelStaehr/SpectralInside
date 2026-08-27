import { useEffect, useState } from "react";
import { api } from "../api";
import type { DisplayDetail } from "../types";
import { Icon } from "./Icon";
import { formatDate } from "../format";

/**
 * Billedrækken bag én scanning, som den ses på skærmen i produktionen.
 *
 * Forsiden ligger i Board.tsx. Den her fil er enden af vejen: et lot, en
 * prøve, og til sidst de frø, modellen fandt.
 */

interface DetailProps {
  scanId: string;
  onBack: () => void;
}

export function DisplaySampleView({ scanId, onBack }: DetailProps) {
  const [data, setData] = useState<DisplayDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    void api
      .displaySample(scanId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Kunne ikke hente prøven");
      });
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  if (error) {
    return (
      <div className="display">
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

  if (!data) return <div className="display"><p className="empty">Henter…</p></div>;

  return (
    <div className="display">
      <button type="button" className="btn btn--ghost back" onClick={onBack}>
        <Icon name="arrow-left" size={16} />
        Alle prøver
      </button>

      <header className="display__sample-head">
        <h1>{data.sample ?? data.id}</h1>
        <dl className="display__facts">
          <div>
            <dt>Analytiker</dt>
            <dd>{data.analyst ?? "ukendt"}</dd>
          </div>
          <div>
            <dt>Scannet</dt>
            <dd>{data.scanned_on ? formatDate(data.scanned_on) : "ukendt"}</dd>
          </div>
          <div>
            <dt>Frø i alt</dt>
            <dd>{data.total_seeds.toLocaleString("da-DK")}</dd>
          </div>
        </dl>
      </header>

      <div className="display__result">
        <span className="display__number">{data.focus_count}</span>
        <span className="display__label">{data.focus_label}</span>
        {data.total_seeds > 0 && (
          <span className="display__share">
            {(data.focus_share * 100).toFixed(1)} % af de klassificerede
          </span>
        )}
      </div>

      {data.unplaced_count > 0 && (
        <p className="display__caveat">
          <Icon name="info" size={16} strokeWidth={2.2} />
          {data.unplaced_count.toLocaleString("da-DK")} frø kunne modellen ikke
          placere. Tallet ovenfor dækker kun det, den kunne afgøre.
        </p>
      )}

      {data.blobs.length > 0 ? (
        <>
          <h2 className="display__grid-title">{data.focus_label}</h2>
          <div className="display__grid">
            {data.blobs.map((blob) => (
              <img
                key={blob.blob_id}
                src={api.thumbnailUrl(data.id, blob.blob_id)}
                alt=""
                loading="lazy"
                width={120}
                height={120}
              />
            ))}
          </div>
        </>
      ) : (
        <p className="empty">
          Ingen frø i klassen {data.focus_class} i denne prøve.
        </p>
      )}
    </div>
  );
}
