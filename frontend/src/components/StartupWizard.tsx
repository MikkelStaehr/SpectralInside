import { useCallback, useEffect, useState } from "react";
import type { Procedure } from "../types";
import { Markdown } from "./Markdown";
import { Icon } from "./Icon";
import { Countdown } from "./Countdown";

interface Props {
  procedure: Procedure;
  busy: boolean;
  onFinish: () => void;
  onDismiss: () => void;
}

/**
 * Daglig opstart vist som guide ét trin ad gangen, i stedet for som en side
 * man selv skal huske at åbne.
 *
 * Den kan lukkes, nogle gange er instrumentet allerede varmt, fordi en
 * kollega startede det. Men den bliver ikke registreret som udført af at blive
 * lukket, så den dukker op igen ved næste indlæsning, indtil nogen faktisk
 * har kørt den.
 */
export function StartupWizard({ procedure, busy, onFinish, onDismiss }: Props) {
  const [index, setIndex] = useState(0);

  // Trin med ventetid holder knappen låst, indtil nedtællingen er kørt.
  // Gemmes pr. trin, så man ikke skal vente forfra ved at gå tilbage.
  const [waited, setWaited] = useState<number[]>([]);

  const total = procedure.steps.length;
  const step = procedure.steps[index];
  const isLast = index === total - 1;

  const stepWaited = step ? waited.includes(step.index) : true;
  const blocked = Boolean(step?.wait_seconds) && !stepWaited;

  const markWaited = useCallback(() => {
    if (!step) return;
    setWaited((current) =>
      current.includes(step.index) ? current : [...current, step.index],
    );
  }, [step]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={procedure.title}>
      <div className="modal__card">
        <header className="modal__head">
          <div className="modal__title">
            <span className="modal__icon">
              <Icon name={procedure.icon} size={20} />
            </span>
            <div>
              <h2>{procedure.title}</h2>
              <p className="modal__sub">
                Dagens første. {procedure.duration ?? ""}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onDismiss}
            aria-label="Luk"
          >
            ✕
          </button>
        </header>

        <div className="modal__progress" aria-hidden="true">
          {procedure.steps.map((s, i) => (
            <span
              key={s.index}
              className={`dot ${i < index ? "dot--past" : ""} ${i === index ? "dot--now" : ""}`}
            />
          ))}
        </div>

        {step && (
          <div className="modal__body">
            <p className="modal__count">
              Trin {index + 1} af {total}
            </p>
            <h3 className="modal__step">{step.title}</h3>
            <Markdown content={step.body} />

            {step.wait_seconds ? (
              <Countdown
                key={step.index}
                seconds={step.wait_seconds}
                done={stepWaited}
                onDone={markWaited}
              />
            ) : null}
          </div>
        )}

        <footer className="modal__foot">
          <button
            type="button"
            className="btn btn--ghost"
            disabled={index === 0}
            onClick={() => setIndex(index - 1)}
          >
            <Icon name="arrow-left" size={16} />
            Forrige
          </button>

          <span className="modal__spacer" />

          <button type="button" className="btn btn--ghost" onClick={onDismiss}>
            Ikke nu
          </button>

          {isLast ? (
            <button
              type="button"
              className="btn"
              disabled={busy || blocked}
              onClick={onFinish}
            >
              <Icon name="check" size={16} />
              {busy ? "Registrerer…" : "Instrumentet er klar"}
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={blocked}
              onClick={() => setIndex(index + 1)}
            >
              Næste
              <Icon name="arrow-right" size={16} />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
