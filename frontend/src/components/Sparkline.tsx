/**
 * Én metrik gennem hele trinnet, uden akser og uden tal.
 *
 * Formålet er ikke at aflæse værdier, det gør tabellen nedenunder. Formålet er
 * at kunne se på et halvt sekund, om kurven går den rigtige vej, mens man står
 * ved maskinen.
 *
 * Linjen er neutral med vilje. Om det er gået godt eller skidt siges af
 * delta-tallet ved siden af, og hvis kurven sagde det samme i farve, ville
 * skærmen svare på det samme spørgsmål to gange.
 */

interface Props {
  values: number[];
  width?: number;
  height?: number;
  label: string;
}

export function Sparkline({ values, width = 84, height = 26, label }: Props) {
  // Ét punkt er ingen udvikling, og en linje gennem ét punkt er en løgn.
  if (values.length < 2) return <span className="sparkline sparkline--empty" />;

  const pad = 3;
  const min = Math.min(...values);
  const max = Math.max(...values);
  // En flad række ville dividere med nul. Den tegnes gennem midten.
  const span = max - min || 1;

  const points = values.map((value, index) => {
    const x = pad + (index / (values.length - 1)) * (width - pad * 2);
    const y =
      max === min
        ? height / 2
        : height - pad - ((value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const path = points.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [firstX] = points[0];
  const [lastX, lastY] = points[points.length - 1];

  // Fladen under linjen. Den bærer ingen information ud over linjen selv, men
  // den giver kurven en retning, man kan opfatte på afstand, og skærmen skal
  // kunne læses på tre meter.
  const area = `${firstX},${height} ${path} ${lastX},${height}`;

  return (
    <svg
      className="sparkline"
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`${label}: ${values.length} prøver`}
    >
      <polygon className="sparkline__area" points={area} />
      <polyline className="sparkline__line" points={path} fill="none" />
      {/* Den seneste prøve markeres, med en ring i baggrundsfarven, så punktet
          bliver stående, også når linjen løber ind under det. */}
      <circle className="sparkline__end" cx={lastX} cy={lastY} r={3} />
    </svg>
  );
}
