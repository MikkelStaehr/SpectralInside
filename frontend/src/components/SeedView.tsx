import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { BandSet, BlobRow } from "../types";
import { Icon } from "./Icon";
import { LENSES, type Lens, applyLens } from "../lenses";

interface Props {
  scanId: string;
  blob: BlobRow;
  onClose: () => void;
  onStep: (delta: number) => void;
}

const SRGB = -1;

/**
 * Ét frø, studeret bånd for bånd.
 *
 * Hvert bånd ligger som et selvstændigt gråtone-PNG i blob-samlingen, så det
 * kan hentes direkte. Linsen lægges på i browseren, hvilket gør skiftet
 * øjeblikkeligt og sparer et billedbibliotek på serveren.
 */
export function SeedView({ scanId, blob, onClose, onStep }: Props) {
  const [set, setSet] = useState<BandSet | null>(null);
  const [band, setBand] = useState<number>(SRGB);
  const [lens, setLens] = useState<Lens>(LENSES[0]);
  const [error, setError] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSet(null);
    setBand(SRGB);
    setError(null);
    void api
      .bands(scanId, blob.blob_id)
      .then((data) => {
        if (!cancelled) setSet(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Kunne ikke hente båndene");
      });
    return () => {
      cancelled = true;
    };
  }, [scanId, blob.blob_id]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (canvas && image?.complete && image.naturalWidth > 0) {
      applyLens(canvas, image, band === SRGB ? LENSES[0] : lens);
    }
  }, [band, lens]);

  useEffect(() => {
    const url =
      band === SRGB
        ? api.thumbnailUrl(scanId, blob.blob_id)
        : api.bandUrl(scanId, blob.blob_id, band);

    const image = new Image();
    image.onload = () => {
      imageRef.current = image;
      draw();
    };
    image.src = url;
    return () => {
      image.onload = null;
    };
  }, [scanId, blob.blob_id, band, draw]);

  useEffect(() => {
    draw();
  }, [lens, draw]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") onStep(1);
      if (event.key === "ArrowLeft") onStep(-1);
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const total = set?.count ?? 0;
        if (!total) return;
        const step = event.key === "ArrowUp" ? -1 : 1;
        setBand((current) => {
          if (current === SRGB) return step > 0 ? 0 : total - 1;
          const next = current + step;
          return next < 0 ? SRGB : next >= total ? SRGB : next;
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep, set]);

  const shown = band === SRGB ? "sRGB" : (set?.bands[band]?.label ?? `Bånd ${band + 1}`);

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Frø">
      <div className="modal__card seed">
        <header className="modal__head">
          <div className="modal__title">
            <div>
              <h2>{blob.corrected ? blob.reference : (blob.predicted ?? "Ukendt")}</h2>
              <p className="modal__sub">
                {blob.corrected && `Modellen gættede ${blob.predicted ?? "?"} · `}
                {blob.confidence !== null && !blob.corrected
                  ? `${Math.round(blob.confidence * 100)} % sikkerhed · `
                  : ""}
                {shown}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Luk"
          >
            ✕
          </button>
        </header>

        <div className="seed__body">
          <div className="seed__stage">
            <button
              type="button"
              className="seed__nav"
              onClick={() => onStep(-1)}
              aria-label="Forrige frø"
            >
              <Icon name="arrow-left" size={20} />
            </button>

            {error ? (
              <p className="empty">{error}</p>
            ) : (
              <canvas ref={canvasRef} className="seed__canvas" />
            )}

            <button
              type="button"
              className="seed__nav"
              onClick={() => onStep(1)}
              aria-label="Næste frø"
            >
              <Icon name="arrow-right" size={20} />
            </button>
          </div>

          <div className="seed__controls">
            <p className="seed__label">Bølgelængde</p>
            <div className="seed__bands">
              <button
                type="button"
                className={`chip chip--button ${band === SRGB ? "chip--on" : ""}`}
                onClick={() => setBand(SRGB)}
              >
                sRGB
              </button>
              {set?.bands.map((b) => (
                <button
                  key={b.index}
                  type="button"
                  className={`chip chip--button ${band === b.index ? "chip--on" : ""}`}
                  onClick={() => setBand(b.index)}
                >
                  {b.label}
                </button>
              ))}
            </div>

            {set?.note && <p className="seed__note">{set.note}</p>}

            <p className="seed__label">Linse</p>
            <div className="seed__bands">
              {LENSES.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`chip chip--button ${lens.id === l.id && band !== SRGB ? "chip--on" : ""}`}
                  disabled={band === SRGB}
                  onClick={() => setLens(l)}
                >
                  {l.name}
                </button>
              ))}
            </div>
            {band === SRGB && (
              <p className="seed__note">
                Linserne virker på de enkelte bånd. sRGB er instrumentets egen
                farvegengivelse.
              </p>
            )}
          </div>
        </div>

        <footer className="modal__foot">
          <span className="seed__hint">
            Piletaster: venstre og højre skifter frø, op og ned skifter bånd
          </span>
        </footer>
      </div>
    </div>
  );
}
