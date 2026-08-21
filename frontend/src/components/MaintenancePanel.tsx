import { useState } from "react";
import type { MaintenanceState, MaintenanceStatus } from "../types";
import { describeDue, formatWhen, todayKey } from "../format";
import { Icon } from "./Icon";

const STATE_LABEL: Record<MaintenanceState, string> = {
  overdue: "Over tid",
  never: "Aldrig udført",
  due_soon: "Snart",
  ok: "I orden",
  event_driven: "Ved behov",
};

const STATE_ICON: Record<MaintenanceState, string> = {
  overdue: "circle-alert",
  never: "calendar-clock",
  due_soon: "clock",
  ok: "circle-check",
  event_driven: "wrench",
};

/** Opgaver der kræver et svar nu. Resten ligger stille, indtil de nærmer sig. */
const NEEDS_ATTENTION: MaintenanceState[] = ["overdue", "never", "due_soon"];

interface Props {
  statuses: MaintenanceStatus[];
  operator: string;
  onComplete: (taskId: string, doneAt: string) => Promise<void>;
  onOpenProcedure: (procedureId: string) => void;
}

interface RowProps {
  status: MaintenanceStatus;
  expanded: boolean;
  busy: boolean;
  operator: string;
  onToggle: () => void;
  onComplete: (doneAt: string) => void;
  onOpenProcedure: (procedureId: string) => void;
}

function TaskRow({
  status,
  expanded,
  busy,
  operator,
  onToggle,
  onComplete,
  onOpenProcedure,
}: RowProps) {
  const { task } = status;
  const today = todayKey();
  const [doneAt, setDoneAt] = useState(today);

  return (
    <li className={`task task--${status.state}`} data-task-id={task.id}>
      <button
        type="button"
        className="task__head"
        aria-expanded={expanded}
        onClick={onToggle}
      >
        <span className={`pill pill--${status.state}`}>
          <Icon name={STATE_ICON[status.state]} size={13} strokeWidth={2.2} />
          {STATE_LABEL[status.state]}
        </span>
        <span className="task__title">{task.title}</span>
        <span className="task__due">
          {status.state === "event_driven"
            ? "ingen fast frekvens"
            : status.state === "never"
              ? "ikke registreret"
              : describeDue(status.days_until_due)}
        </span>
      </button>

      {expanded && (
        <div className="task__detail">
          {task.why && <p className="task__why">{task.why}</p>}

          {task.also_when.length > 0 && (
            <>
              <p className="task__label">Skal også gøres når:</p>
              <ul className="task__list">
                {task.also_when.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </>
          )}

          {task.note && <p className="task__note">{task.note}</p>}

          {status.last_done_at && (
            <p className="task__last">
              Sidst udført {formatWhen(status.last_done_at)}
              {status.last_done_by ? ` af ${status.last_done_by}` : ""}
            </p>
          )}

          <div className="task__register">
            <label htmlFor={`done-${task.id}`}>Udført den</label>
            <input
              id={`done-${task.id}`}
              type="date"
              value={doneAt}
              max={today}
              onChange={(event) => setDoneAt(event.target.value)}
            />
            <button
              type="button"
              className="btn"
              disabled={!operator || !doneAt || busy}
              onClick={() => onComplete(doneAt)}
            >
              <Icon name="check" size={16} />
              {busy ? "Registrerer…" : "Registrer"}
            </button>
          </div>

          {doneAt !== today && (
            <p className="task__backdated">
              Næste forfald tælles fra den valgte dato, ikke fra i dag.
            </p>
          )}

          {task.procedure && (
            <div className="task__actions">
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => onOpenProcedure(task.procedure!)}
              >
                Åbn proceduren
                <Icon name="chevron-right" size={15} />
              </button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function MaintenancePanel({
  statuses,
  operator,
  onComplete,
  onOpenProcedure,
}: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showSettled, setShowSettled] = useState(false);

  const attention = statuses.filter((s) => NEEDS_ATTENTION.includes(s.state));
  const settled = statuses.filter((s) => !NEEDS_ATTENTION.includes(s.state));

  const handleComplete = async (taskId: string, doneAt: string) => {
    setBusy(taskId);
    try {
      await onComplete(taskId, doneAt);
      setExpanded(null);
    } finally {
      setBusy(null);
    }
  };

  const row = (status: MaintenanceStatus) => (
    <TaskRow
      key={status.task.id}
      status={status}
      expanded={expanded === status.task.id}
      busy={busy === status.task.id}
      operator={operator}
      onToggle={() =>
        setExpanded(expanded === status.task.id ? null : status.task.id)
      }
      onComplete={(doneAt) => handleComplete(status.task.id, doneAt)}
      onOpenProcedure={onOpenProcedure}
    />
  );

  return (
    <section className="panel" aria-label="Vedligeholdelse">
      <header className="panel__head">
        <h2>Hvor er vi</h2>
      </header>

      <div
        className={`tally ${attention.length === 0 ? "tally--clear" : "tally--attention"}`}
      >
        <span className="tally__number">{attention.length}</span>
        <span className="tally__unit">
          {attention.length === 0
            ? "der skal gøres noget ved lige nu"
            : attention.length === 1
              ? "opgave kræver handling"
              : "opgaver kræver handling"}
        </span>
      </div>

      {attention.length > 0 && <ul className="tasks">{attention.map(row)}</ul>}

      {settled.length > 0 && (
        <div className="settled">
          <button
            type="button"
            className="settled__toggle"
            aria-expanded={showSettled}
            onClick={() => setShowSettled(!showSettled)}
          >
            <Icon
              name={showSettled ? "rotate-ccw" : "chevron-right"}
              size={15}
            />
            {showSettled
              ? "Skjul de øvrige"
              : `Vis de øvrige ${settled.length}`}
          </button>
          {showSettled && <ul className="tasks">{settled.map(row)}</ul>}
        </div>
      )}
    </section>
  );
}
