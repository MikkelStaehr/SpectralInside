/**
 * Opsætningen af linjen, som operatøren registrerer pr. lot.
 *
 * To trin med vilje. Listen over indstillinger er lang, fordi linjen har
 * mange, men et lot bruger sjældent dem alle sammen. Skulle man rulle gennem
 * hele listen for at udfylde fem felter, ville de fem felter drukne, og en
 * formular, man skal lede i, bliver udfyldt sjusket.
 *
 * Derfor: sæt flueben ved det, du har skruet på, og udfyld kun det på næste
 * side.
 *
 * Hvilke indstillinger der findes, kommer fra serveren og dermed fra
 * content/machine-setup.yaml. Den her fil kender ingen af dem.
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { SetupOptions, SetupSetting, SetupValue } from "../types";
import { Icon } from "./Icon";

interface Props {
  lotNo: string;
  setBy: string;
  onClose: () => void;
  onSaved: () => void;
}

export function SetupDialog({ lotNo, setBy, onClose, onSaved }: Props) {
  const [options, setOptions] = useState<SetupOptions | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Det, der allerede er sat, kommer med ind. Dialogen er en rettelse af
  // opsætningen og ikke en ny hver gang, ellers ville man skulle taste de
  // samme fire værdier igen for at ændre den femte.
  useEffect(() => {
    void Promise.all([api.setupOptions(), api.lotSetup(lotNo)])
      .then(([opts, current]) => {
        setOptions(opts);
        setPicked(new Set(current.values.map((v) => v.setting_id)));
        setValues(
          Object.fromEntries(current.values.map((v) => [v.setting_id, v.value])),
        );
      })
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : "Kunne ikke hente opsætningen",
        ),
      );
  }, [lotNo]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const chosen = useMemo(() => {
    if (!options) return [];
    return options.groups
      .map((group) => ({
        ...group,
        settings: group.settings.filter((s) => picked.has(s.id)),
      }))
      .filter((group) => group.settings.length > 0);
  }, [options, picked]);

  const toggle = (id: string) =>
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload: SetupValue[] = [...picked]
        .map((id) => ({ setting_id: id, value: (values[id] ?? "").trim() }))
        .filter((v) => v.value !== "");
      await api.saveLotSetup(lotNo, setBy, payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Kunne ikke gemme");
    } finally {
      setBusy(false);
    }
  };

  const filled = [...picked].filter((id) => (values[id] ?? "").trim() !== "").length;

  return (
    <div
      className="sheet__backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Opsætning for lot ${lotNo}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="sheet">
        <header className="sheet__head">
          <div>
            <p className="sheet__eyebrow">Lot {lotNo}</p>
            <h2>Opsætning</h2>
          </div>
          <button
            type="button"
            className="sheet__close"
            onClick={onClose}
            aria-label="Luk"
          >
            <Icon name="x" size={22} strokeWidth={2.2} />
          </button>
        </header>

        <ol className="sheet__steps">
          <li className={step === 1 ? "is-current" : "is-done"}>
            1. Vælg indstillinger
          </li>
          <li className={step === 2 ? "is-current" : undefined}>
            2. Indtast værdier
          </li>
        </ol>

        {error && (
          <p className="lots__error">
            <Icon name="triangle-alert" size={15} strokeWidth={2.2} />
            {error}
          </p>
        )}

        <div className="sheet__body">
          {!options ? (
            <p className="empty">Henter…</p>
          ) : options.groups.length === 0 ? (
            <p className="empty">
              Der er ikke defineret nogen indstillinger endnu. De skrives i
              <code> content/machine-setup.yaml</code>.
            </p>
          ) : step === 1 ? (
            <>
              <p className="sheet__lead">
                Sæt flueben ved det, du har skruet på til dette lot. Kun det,
                du vælger, skal udfyldes bagefter.
              </p>
              {options.groups.map((group) => (
                <fieldset className="setup__group" key={group.id}>
                  <legend>
                    {group.title}
                    {group.lead && <span>{group.lead}</span>}
                  </legend>
                  <div className="setup__ticks">
                    {group.settings.map((setting) => (
                      <label
                        key={setting.id}
                        className={picked.has(setting.id) ? "is-picked" : undefined}
                      >
                        <input
                          type="checkbox"
                          checked={picked.has(setting.id)}
                          onChange={() => toggle(setting.id)}
                        />
                        <span>
                          {setting.label}
                          {setting.unit && <em> ({setting.unit})</em>}
                        </span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              ))}
            </>
          ) : chosen.length === 0 ? (
            <p className="empty">
              Du har ikke valgt nogen indstillinger. Gå tilbage og sæt flueben,
              eller gem for at rydde opsætningen på lottet.
            </p>
          ) : (
            <>
              <p className="sheet__lead">
                Værdierne gemmes på lottet, så det bagefter kan ses, hvilke
                indstillinger der gav hvilke tal.
              </p>
              {chosen.map((group) => (
                <div className="setup__group" key={group.id}>
                  <p className="setup__group-title">{group.title}</p>
                  <div className="setup__fields">
                    {group.settings.map((setting) => (
                      <Field
                        key={setting.id}
                        setting={setting}
                        value={values[setting.id] ?? ""}
                        onChange={(value) =>
                          setValues((current) => ({
                            ...current,
                            [setting.id]: value,
                          }))
                        }
                      />
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}
        </div>

        <footer className="sheet__foot">
          <p className="sheet__count">
            {step === 1
              ? `${picked.size} valgt`
              : `${filled} af ${picked.size} udfyldt`}
          </p>

          {step === 2 && (
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => setStep(1)}
            >
              <Icon name="arrow-left" size={16} strokeWidth={2.2} />
              Tilbage
            </button>
          )}

          {step === 1 ? (
            <button type="button" className="btn" onClick={() => setStep(2)}>
              Videre
              <Icon name="arrow-right" size={16} strokeWidth={2.2} />
            </button>
          ) : (
            <button type="button" className="btn" disabled={busy} onClick={save}>
              <Icon name="check" size={17} strokeWidth={2.2} />
              Gem opsætning
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

function Field({
  setting,
  value,
  onChange,
}: {
  setting: SetupSetting;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      <span>
        {setting.label}
        {setting.unit && <em> ({setting.unit})</em>}
        {setting.hint && <em> · {setting.hint}</em>}
      </span>
      {setting.type === "choice" ? (
        <select value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Ikke valgt</option>
          {setting.options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          inputMode={setting.type === "number" ? "decimal" : "text"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
