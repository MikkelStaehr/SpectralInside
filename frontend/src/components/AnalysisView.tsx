import type {
  ClassifierVersion,
  ConfusionMatrix,
  ScanSummary,
} from "../types";
import { Icon } from "./Icon";
import { formatDate } from "../format";

interface Props {
  classifiers: ClassifierVersion[];
  confusion: ConfusionMatrix | null;
  scans: ScanSummary[];
  onOpenScan: (id: string) => void;
}

/** Samlinger, hvor modellen placerede mest i Unknown. Det er hullerne. */
function gaps(scans: ScanSummary[]) {
  return [...scans]
    .filter((s) => s.labelled_count > 0)
    .sort((a, b) => b.unknown_share - a.unknown_share)
    .slice(0, 8);
}

export function AnalysisView({
  classifiers,
  confusion,
  scans,
  onOpenScan,
}: Props) {
  const missing = gaps(scans);
  const totalUnknown = scans.reduce((sum, s) => sum + s.unknown_count, 0);
  const totalLabelled = scans.reduce((sum, s) => sum + s.labelled_count, 0);

  return (
    <article className="analysis">
      <header className="page-head">
        <h1>Analyse</h1>
        <p className="lead">
          Modellernes tilstand og hvor de mangler materiale. Læst direkte fra
          klassifikatorfilerne og blob-samlingerne.
        </p>
      </header>

      <section className="panel">
        <header className="panel__head">
          <h2>Træningsmateriale der mangler</h2>
          <p className="panel__sub">
            Andelen modellen ikke kunne placere. Høj andel betyder, at arten
            ikke er lært endnu.
          </p>
        </header>

        <div className="tally tally--attention">
          <span className="tally__number">
            {totalLabelled
              ? Math.round((totalUnknown / totalLabelled) * 100)
              : 0}
            %
          </span>
          <span className="tally__unit">
            af {totalLabelled.toLocaleString("da-DK")} klassificerede frø endte
            som Unknown
          </span>
        </div>

        <ul className="gaps">
          {missing.map((scan) => (
            <li key={scan.id}>
              <button
                type="button"
                className="gap"
                onClick={() => onOpenScan(scan.id)}
              >
                <span className="gap__bar" aria-hidden="true">
                  <span
                    className="gap__fill"
                    style={{ width: `${Math.round(scan.unknown_share * 100)}%` }}
                  />
                </span>
                <span className="gap__pct">
                  {Math.round(scan.unknown_share * 100)}%
                </span>
                <span className="gap__name">{scan.sample ?? scan.filename}</span>
                <span className="gap__count">
                  {scan.unknown_count} af {scan.labelled_count}
                </span>
                <Icon name="chevron-right" size={16} />
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="panel">
        <header className="panel__head">
          <h2>Hvor bliver modellen rettet</h2>
          <p className="panel__sub">
            Operatørens referenceklasse holdt op mod modellens gæt, på tværs af{" "}
            {confusion?.scans_included ?? 0} samlinger.
          </p>
        </header>

        {confusion && (
          <>
            <div className="alert alert--note" style={{ margin: "16px 22px" }}>
              <p className="alert__label">
                <Icon name="info" size={14} strokeWidth={2.2} />
                Dette er ikke træfsikkerhed
              </p>
              <p>{confusion.note}</p>
            </div>

            <table className="matrix">
              <thead>
                <tr>
                  <th>Operatøren sagde</th>
                  <th>Modellen gættede</th>
                  <th className="matrix__num">Antal</th>
                </tr>
              </thead>
              <tbody>
                {confusion.cells.slice(0, 12).map((cell) => (
                  <tr
                    key={`${cell.reference}-${cell.predicted}`}
                    className={
                      cell.reference === cell.predicted ? "matrix--hit" : ""
                    }
                  >
                    <td>{cell.reference}</td>
                    <td>{cell.predicted}</td>
                    <td className="matrix__num">
                      {cell.count.toLocaleString("da-DK")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="panel">
        <header className="panel__head">
          <h2>Klassifikatorer</h2>
          <p className="panel__sub">
            {classifiers.length} versioner gemt på maskinen.
          </p>
        </header>

        <ul className="versions">
          {classifiers.map((c, index) => (
            <li key={c.filename} className="version">
              <span className="version__tag">
                {c.version ? `v${c.version}` : "?"}
                {index === 0 && <span className="version__latest">nyeste</span>}
              </span>
              <span className="version__body">
                <span className="version__name">{c.name}</span>
                <span className="version__classes">
                  {c.classes.length > 0
                    ? c.classes.join(", ")
                    : "ingen klasser fundet"}
                </span>
              </span>
              <span className="version__when">
                {formatDate(c.modified_at)}
                <span className="version__size">
                  {Math.round(c.size_bytes / 1024)} kB
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}
