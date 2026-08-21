import { useEffect, useState } from "react";
import type { Procedure } from "../types";
import { Markdown } from "./Markdown";
import { Icon } from "./Icon";
import { todayKey } from "../format";

interface Props {
  procedure: Procedure;
  onBack: () => void;
}

/**
 * Afkrydsningen gemmes lokalt pr. procedure pr. dag. Den nulstilles altså af
 * sig selv i morgen, hvilket er det rigtige for en arbejdsgang, der køres
 * forfra hver dag. Det er en hjælp til at holde stedet i rækkefølgen, ikke en
 * registrering af, at arbejdet er udført.
 */
function useProgress(procedureId: string) {
  const storageKey = `ubs.progress.${procedureId}.${todayKey()}`;

  const [done, setDone] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(done));
    } catch {
      /* privat browsertilstand e.l. afkrydsningen er stadig brugbar i denne session */
    }
  }, [storageKey, done]);

  const toggle = (index: number) =>
    setDone((current) =>
      current.includes(index)
        ? current.filter((i) => i !== index)
        : [...current, index],
    );

  return { done, toggle, reset: () => setDone([]) };
}

export function ProcedureView({ procedure, onBack }: Props) {
  const { done, toggle, reset } = useProgress(procedure.id);
  const total = procedure.steps.length;
  const completed = done.filter((i) => i >= 1 && i <= total).length;
  const percent = total === 0 ? 0 : Math.round((completed / total) * 100);

  return (
    <article className="procedure-view">
      <button type="button" className="btn btn--ghost back" onClick={onBack}>
        <Icon name="arrow-left" size={16} />
        Tilbage
      </button>

      <header className="procedure-view__head">
        <div className="procedure-view__title">
          <span className="procedure-view__icon">
            <Icon name={procedure.icon} size={24} />
          </span>
          <div>
            <h1>{procedure.title}</h1>
            {procedure.lead && <p className="lead">{procedure.lead}</p>}
          </div>
        </div>

        <dl className="facts">
          {procedure.trigger && (
            <div>
              <dt>
                <Icon name="calendar-clock" size={13} strokeWidth={2.2} />
                Hvornår
              </dt>
              <dd>{procedure.trigger}</dd>
            </div>
          )}
          {procedure.duration && (
            <div>
              <dt>
                <Icon name="clock" size={13} strokeWidth={2.2} />
                Tidsforbrug
              </dt>
              <dd>{procedure.duration}</dd>
            </div>
          )}
          <div>
            <dt>
              <Icon name="check" size={13} strokeWidth={2.2} />
              Omfang
            </dt>
            <dd>{total} trin</dd>
          </div>
        </dl>
      </header>

      {procedure.intro && (
        <div className="procedure-view__intro">
          <Markdown content={procedure.intro} />
        </div>
      )}

      {total > 0 && (
        <div className="progress" role="status">
          <div className="progress__bar">
            <div className="progress__fill" style={{ width: `${percent}%` }} />
          </div>
          <span className="progress__text">
            {completed} af {total} trin
          </span>
          {completed > 0 && (
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={reset}
            >
              <Icon name="rotate-ccw" size={15} />
              Nulstil
            </button>
          )}
        </div>
      )}

      <ol className="steps">
        {procedure.steps.map((step) => {
          const isDone = done.includes(step.index);
          return (
            <li
              key={step.index}
              className={`step ${isDone ? "step--done" : ""}`}
            >
              <div className="step__head">
                <button
                  type="button"
                  className="step__check"
                  aria-pressed={isDone}
                  aria-label={
                    isDone
                      ? `Fjern markering af trin ${step.index}`
                      : `Marker trin ${step.index} som udført`
                  }
                  onClick={() => toggle(step.index)}
                >
                  {isDone ? <Icon name="check" size={18} strokeWidth={2.6} /> : step.index}
                </button>
                <h2 className="step__title">{step.title}</h2>
              </div>
              <div className="step__body">
                <Markdown content={step.body} />
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="procedure-view__foot">
        <button type="button" className="btn btn--ghost" onClick={onBack}>
          <Icon name="arrow-left" size={16} />
          Tilbage til arbejdsbordet
        </button>
      </footer>
    </article>
  );
}
