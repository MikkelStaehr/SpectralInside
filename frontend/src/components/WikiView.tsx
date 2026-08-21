import type { ProcedureSummary } from "../types";
import { Icon } from "./Icon";

interface Props {
  procedures: ProcedureSummary[];
  onOpen: (id: string) => void;
}

/**
 * Wikien fortæller hvordan man gør. Vedligehold fortæller hvornår.
 * Procedurer med category: vedligehold hører til på den anden side.
 */
export function WikiView({ procedures, onOpen }: Props) {
  const guides = procedures.filter((p) => p.category === "wiki");

  return (
    <article className="wiki">
      <header className="page-head">
        <h1>Wiki</h1>
        <p className="lead">
          Sådan gør man. Følg dem trin for trin, så bliver målingerne ens.
        </p>
      </header>

      {guides.length === 0 ? (
        <p className="empty">Ingen guides endnu.</p>
      ) : (
        <ul className="guides">
          {guides.map((guide) => (
            <li key={guide.id}>
              <button type="button" onClick={() => onOpen(guide.id)}>
                <span className="guides__icon">
                  <Icon name={guide.icon} size={22} />
                </span>
                <span className="guides__text">
                  <span className="guides__title">{guide.title}</span>
                  {guide.lead && (
                    <span className="guides__lead">{guide.lead}</span>
                  )}
                  <span className="guides__meta">
                    {guide.step_count} trin
                    {guide.duration ? ` · ${guide.duration}` : ""}
                    {guide.trigger ? ` · ${guide.trigger}` : ""}
                  </span>
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
