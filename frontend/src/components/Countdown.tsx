import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";

interface Props {
  seconds: number;
  done: boolean;
  onDone: () => void;
}

const SIZE = 168;
const STROKE = 9;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function format(remaining: number): string {
  if (remaining >= 60) {
    const minutes = Math.floor(remaining / 60);
    const rest = remaining % 60;
    return `${minutes}:${`${rest}`.padStart(2, "0")}`;
  }
  return `${remaining}`;
}

/**
 * Nedtælling på de trin, hvor det at skynde sig ødelægger målingen.
 *
 * Den tæller fra en tidsstempel frem for at lægge sammen tik for tik, så den
 * ikke sakker bagud, hvis fanen er i baggrunden eller maskinen er travl.
 */
export function Countdown({ seconds, done, onDone }: Props) {
  const [remaining, setRemaining] = useState(done ? 0 : seconds);
  const [running, setRunning] = useState(!done);
  const endsAt = useRef<number>(Date.now() + seconds * 1000);

  useEffect(() => {
    if (done || !running) return;

    const tick = () => {
      const left = Math.max(0, endsAt.current - Date.now());
      setRemaining(Math.ceil(left / 1000));
      if (left <= 0) {
        setRunning(false);
        onDone();
      }
    };

    const timer = window.setInterval(tick, 100);
    tick();
    return () => window.clearInterval(timer);
  }, [done, running, onDone]);

  const finished = done || remaining <= 0;
  const progress = finished ? 1 : 1 - remaining / seconds;

  return (
    <div className={`countdown ${finished ? "countdown--done" : ""}`}>
      <div className="countdown__ring">
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
          <circle
            className="countdown__track"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            strokeWidth={STROKE}
            fill="none"
          />
          <circle
            className="countdown__value"
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            strokeWidth={STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
            transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          />
        </svg>

        <div className="countdown__center">
          {finished ? (
            <Icon name="check" size={44} strokeWidth={2.4} />
          ) : (
            <>
              <span className="countdown__number">{format(remaining)}</span>
              <span className="countdown__unit">
                {remaining >= 60 ? "min" : "sekunder"}
              </span>
            </>
          )}
        </div>
      </div>

      <p className="countdown__label">
        {finished
          ? "Ventetiden er gået. Du kan gå videre."
          : "Vent her. Knappen låser op, når nedtællingen er færdig."}
      </p>
    </div>
  );
}
