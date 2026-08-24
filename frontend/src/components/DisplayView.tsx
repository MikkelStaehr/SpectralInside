import { useEffect, useState } from "react";
import { api } from "../api";
import type { DisplayDetail, LotSummary } from "../types";
import { Icon } from "./Icon";
import { formatDate } from "../format";

/**
 * Skærmen i produktionen.
 *
 * Ingen indlogning: at skulle taste initialer for at læse et tal er friktion
 * uden formål, og initialerne beskytter alligevel ingenting.
 *
 * Forsiden er listen over lots. Herfra går man ind i ét lot ad gangen, og
 * derinde kan man skifte lot uden at komme tilbage hertil. Begge veje findes,
 * fordi de bruges til hver sit: listen når man kommer til skærmen, strippen
 * når man allerede står ved den.
 */

const startedOn = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

interface ListProps {
  lots: LotSummary[];
  onOpen: (lotNo: string) => void;
}

export function DisplayList({ lots, onOpen }: ListProps) {
  return (
    <div className="display">
      <header className="display__head">
        <img className="logo logo--light" src="/ubs-logo.png" alt="UBS" />
        <img
          className="logo logo--dark"
          src="/ubs-logo-white.png"
          alt=""
          aria-hidden="true"
        />
        <h1>Lots</h1>
        <p>Vælg det lot, du kører.</p>
      </header>

      {lots.length === 0 ? (
        <p className="empty">Der er ikke startet noget lot endnu.</p>
      ) : (
        <ul className="display__samples">
          {lots.map((lot) => (
            <li key={lot.lot_no}>
              <button
                type="button"
                className={lot.unacknowledged_count > 0 ? "is-alerting" : undefined}
                onClick={() => onOpen(lot.lot_no)}
              >
                <span className="display__sample-name">
                  {/* Markeringen står også her. Et resultat, ingen har
                      kvitteret for, skal kunne ses uden at gå ind i lottet. */}
                  {lot.unacknowledged_count > 0 && (
                    <span className="dot" aria-label="Nyt resultat" />
                  )}
                  {lot.lot_no}
                </span>
                <span className="display__sample-meta">
                  {lot.variety ? `${lot.variety} · ` : ""}
                  {lot.item_no ? `${lot.item_no} · ` : ""}
                  {/* Hvornår der sidst skete noget, ikke hvornår lottet blev
                      startet. Listen er sorteret efter det, og så skal den
                      også vise det, ellers ser rækkefølgen tilfældig ud. */}
                  senest{" "}
                  {startedOn.format(
                    new Date(lot.last_activity ?? lot.started_at),
                  )}
                  {lot.stamp === "approved" && " · godkendt"}
                  {lot.stamp === "rejected" && " · afvist"}
                </span>
                <span className="display__sample-count">
                  {lot.sample_count}
                  <span>prøver</span>
                </span>
                <Icon name="chevron-right" size={26} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

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
