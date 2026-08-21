import { useState } from "react";
import type { Operator } from "../types";
import { Icon } from "./Icon";

interface Props {
  operators: Operator[];
  onChoose: (initials: string) => void;
}

export function LoginView({ operators, onChoose }: Props) {
  const hasList = operators.length > 0;

  // Listen hentes asynkront, så visningen må udledes ved hver render frem for
  // at blive låst fast i en starttilstand. Ellers når komponenten at beslutte
  // "der er ingen liste", inden svaret er kommet, og listen dukker aldrig op.
  const [manual, setManual] = useState(false);
  const showList = hasList && !manual;
  const showForm = !hasList || manual;

  const [draft, setDraft] = useState("");

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = draft.trim();
    if (value) onChoose(value);
  };

  return (
    <div className="login">
      <div className="login__card">
        <img className="logo logo--light" src="/ubs-logo.png" alt="UBS" />
        <img
          className="logo logo--dark"
          src="/ubs-logo-white.png"
          alt=""
          aria-hidden="true"
        />

        <header className="login__head">
          <h1>Spectral Inside</h1>
          <p className="login__sub">Analyserum · VideometerLab</p>
        </header>

        <p className="login__question">Hvem arbejder?</p>

        {showList && (
          <>
            <ul className="login__people">
              {operators.map((operator) => (
                <li key={operator.initials}>
                  <button
                    type="button"
                    className="person"
                    onClick={() => onChoose(operator.initials)}
                  >
                    <span className="person__avatar">
                      {operator.initials.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="person__text">
                      <span className="person__initials">
                        {operator.initials}
                      </span>
                      {operator.name && (
                        <span className="person__name">{operator.name}</span>
                      )}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setManual(true)}
            >
              Jeg står ikke på listen
            </button>
          </>
        )}

        {showForm && (
          <form className="login__form" onSubmit={submit}>
            <label htmlFor="initials">Dine initialer</label>
            <input
              id="initials"
              value={draft}
              maxLength={10}
              autoFocus
              autoComplete="off"
              placeholder="fx MSM"
              onChange={(event) => setDraft(event.target.value)}
            />
            <button type="submit" className="btn" disabled={!draft.trim()}>
              Fortsæt
              <Icon name="arrow-right" size={16} />
            </button>
            {hasList && (
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => setManual(false)}
              >
                Tilbage til listen
              </button>
            )}
          </form>
        )}

        <p className="login__note">
          Initialerne beskytter ingenting, de bruges til at kunne se, hvem der
          har registreret hvad. Der bliver spurgt igen i morgen.
        </p>
      </div>
    </div>
  );
}
