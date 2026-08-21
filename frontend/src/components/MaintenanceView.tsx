import type { MaintenanceStatus, ProcedureSummary } from "../types";
import { MaintenancePanel } from "./MaintenancePanel";
import { Icon } from "./Icon";

interface Props {
  statuses: MaintenanceStatus[];
  procedures: ProcedureSummary[];
  operator: string;
  onComplete: (taskId: string, doneAt: string) => Promise<void>;
  onOpenProcedure: (procedureId: string) => void;
}

export function MaintenanceView({
  statuses,
  procedures,
  operator,
  onComplete,
  onOpenProcedure,
}: Props) {
  const guides = procedures.filter((p) => p.category === "vedligehold");

  return (
    <article className="maintenance">
      <header className="page-head">
        <h1>Vedligehold</h1>
        <p className="lead">
          Hvornår noget skal gøres, og hvornår det sidst blev gjort.
          Fremgangsmåden står i guiderne nedenfor.
        </p>
      </header>

      <MaintenancePanel
        statuses={statuses}
        operator={operator}
        onComplete={onComplete}
        onOpenProcedure={onOpenProcedure}
      />

      {guides.length > 0 && (
        <section className="panel">
          <header className="panel__head">
            <h2>Fremgangsmåder</h2>
            <p className="panel__sub">
              De guides, der hører til vedligeholdelsen.
            </p>
          </header>
          <ul className="guides guides--inset">
            {guides.map((guide) => (
              <li key={guide.id}>
                <button type="button" onClick={() => onOpenProcedure(guide.id)}>
                  <span className="guides__icon">
                    <Icon name={guide.icon} size={20} />
                  </span>
                  <span className="guides__text">
                    <span className="guides__title">{guide.title}</span>
                    {guide.lead && (
                      <span className="guides__lead">{guide.lead}</span>
                    )}
                  </span>
                  <Icon name="chevron-right" size={18} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
