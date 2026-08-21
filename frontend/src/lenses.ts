/**
 * Spektrale linser.
 *
 * Båndbillederne kommer som gråtone-PNG, ét pr. bølgelængde. Farvelægningen
 * sker her i browseren frem for på serveren: så skifter man linse uden at
 * hente billedet igen, og backenden slipper for et billedbibliotek.
 *
 * Navnene følger VideometerLabs egne view modes, så det, en analytiker ser
 * her, hedder det samme som i instrumentets software.
 */

export type LensId = "graa" | "jet" | "hot" | "kold" | "invers";

export interface Lens {
  id: LensId;
  name: string;
  /** Gråværdi 0-255 ind, [r, g, b] ud. */
  map: (v: number) => [number, number, number];
}

const clamp = (x: number) => (x < 0 ? 0 : x > 255 ? 255 : Math.round(x));

/** Blå, cyan, gul, rød. Fremhæver gradienter, VideometerLabs "Jet". */
function jet(v: number): [number, number, number] {
  const t = v / 255;
  const r = t < 0.35 ? 0 : t < 0.66 ? (t - 0.35) / 0.31 : t < 0.89 ? 1 : 1 - (t - 0.89) / 0.11 / 2;
  const g = t < 0.125 ? 0 : t < 0.375 ? (t - 0.125) / 0.25 : t < 0.64 ? 1 : t < 0.91 ? 1 - (t - 0.64) / 0.27 : 0;
  const b = t < 0.11 ? 0.5 + t / 0.11 / 2 : t < 0.34 ? 1 : t < 0.65 ? 1 - (t - 0.34) / 0.31 : 0;
  return [clamp(r * 255), clamp(g * 255), clamp(b * 255)];
}

/** Sort, rød, gul, hvid. Lader høje værdier springe frem. */
function hot(v: number): [number, number, number] {
  const t = v / 255;
  return [
    clamp((t / 0.4) * 255),
    clamp(((t - 0.4) / 0.4) * 255),
    clamp(((t - 0.8) / 0.2) * 255),
  ];
}

/** Kølig skala. Giver kontrast i de mørke områder. */
function kold(v: number): [number, number, number] {
  const t = v / 255;
  return [clamp(t * 90), clamp(t * 190), clamp(60 + t * 195)];
}

export const LENSES: Lens[] = [
  { id: "graa", name: "Gråtone", map: (v) => [v, v, v] },
  { id: "jet", name: "Jet", map: jet },
  { id: "hot", name: "Hot", map: hot },
  { id: "kold", name: "Kold", map: kold },
  { id: "invers", name: "Inverteret", map: (v) => [255 - v, 255 - v, 255 - v] },
];

export function applyLens(
  canvas: HTMLCanvasElement,
  image: HTMLImageElement,
  lens: Lens,
): void {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return;

  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  ctx.drawImage(image, 0, 0);

  if (lens.id === "graa") return;

  const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = frame.data;

  // Båndene er gråtone, så én kanal er nok til at kende værdien.
  const lut = new Uint8ClampedArray(256 * 3);
  for (let v = 0; v < 256; v += 1) {
    const [r, g, b] = lens.map(v);
    lut[v * 3] = r;
    lut[v * 3 + 1] = g;
    lut[v * 3 + 2] = b;
  }

  for (let i = 0; i < px.length; i += 4) {
    const v = px[i] * 3;
    px[i] = lut[v];
    px[i + 1] = lut[v + 1];
    px[i + 2] = lut[v + 2];
  }

  ctx.putImageData(frame, 0, 0);
}
