import type { ScanSummary } from "../types";
import { Icon } from "./Icon";
import { formatDate } from "../format";

interface Props {
  scans: ScanSummary[];
  onOpen: (id: string) => void;
}

export function ScansView({ scans, onOpen }: Props) {
  return (
    <article className="scans">
      <header className="page-head">
        <h1>Scanninger</h1>
        <p className="lead">
          Resultaterne af de lots, der er kørt. Læses direkte fra VideometerLabs
          blob-samlinger, skrivebeskyttet.
        </p>
      </header>

      {scans.length === 0 ? (
        <p className="empty">
          Ingen blob-samlinger fundet. Tjek stien i <code>UBS_BLOBDB_DIR</code>.
        </p>
      ) : (
        <ul className="scan-list">
          {scans.map((scan) => (
            <li key={scan.id}>
              <button
                type="button"
                className="scan"
                onClick={() => onOpen(scan.id)}
              >
                <span className="scan__main">
                  <span className="scan__title">
                    {scan.sample ?? scan.filename}
                  </span>
                  <span className="scan__meta">
                    {scan.operator ? `${scan.operator} · ` : ""}
                    {scan.scanned_on ? formatDate(scan.scanned_on) : "ukendt dato"}
                    {` · ${scan.blob_count} frø`}
                  </span>
                </span>

                <span className="scan__classes">
                  {scan.classes.slice(0, 4).map((c) => (
                    <span key={c.name} className="chip">
                      {c.name} {c.count}
                    </span>
                  ))}
                </span>

                <span
                  className={`scan__unknown ${scan.unknown_share > 0.5 ? "scan__unknown--high" : ""}`}
                  title="Andel som modellen ikke kunne placere"
                >
                  {Math.round(scan.unknown_share * 100)}%
                  <span className="scan__unknown-label">ukendt</span>
                </span>

                <Icon name="chevron-right" size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
