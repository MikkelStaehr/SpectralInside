/**
 * Ét led i proceskæden.
 *
 * De to første processer er "juster og prøv igen": operatøren får et dårligt
 * resultat, skruer på noget, og tager en ny prøve. Kortet er bygget om det.
 * Justeringsteksten står derfor lige under det tal, den frembragte, og ikke i
 * en note et andet sted, for det er sammenhængen mellem de to, der er
 * arbejdet.
 *
 * Post Cleaning er ikke det. Den er et kvalitetsstempel, og der er ikke noget
 * at skrue på. Samme data, anden indramning, se StampArea nederst.
 */

import type {
  LotDetail,
  LotSample,
  Metric,
  Process,
  StampId,
  TestType,
  TestTypeId,
} from "../types";
import {
  deltaClass,
  deltaFor,
  formatDelta,
  formatMetric,
  latestIn,
  samplesIn,
  seriesOf,
  type Thresholds,
} from "../lots";
import { Icon } from "./Icon";
import { Sparkline } from "./Sparkline";
import { Stack } from "./Stack";

const time = new Intl.DateTimeFormat("da-DK", {
  hour: "2-digit",
  minute: "2-digit",
});

const dateTime = new Intl.DateTimeFormat("da-DK", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

interface Props {
  lot: LotDetail;
  process: Process;
  testTypes: Record<string, TestType>;
  selected: TestTypeId;
  /** Om det er dette kort, prøvehistorikken nedenunder viser. */
  active: boolean;
  thresholds: Thresholds;
  onSelect: (testType: TestTypeId) => void;
  onAcknowledge: (sampleIds: number[]) => void;
  onStamp: (stamp: StampId) => void;
  busy: boolean;
}

/** Ukvitterede prøver i ét (proces, testtype). */
function unacknowledged(
  samples: LotSample[],
  process: string,
  testType: TestTypeId,
): LotSample[] {
  return samplesIn(samples, process as Process["id"], testType).filter(
    (s) => s.acknowledged_at === null,
  );
}

export function ProcessCard({
  lot,
  process,
  testTypes,
  selected,
  active,
  thresholds,
  onSelect,
  onAcknowledge,
  onStamp,
  busy,
}: Props) {
  // Kortet alarmerer, hvis noget som helst under det er ukvitteret, også når
  // det ligger på den fane, der ikke er valgt. Ellers kunne et nyt resultat
  // ligge og blinke bag en fane, ingen kigger på.
  const alerting = process.test_types.some(
    (t) => unacknowledged(lot.samples, process.id, t).length > 0,
  );

  const testType = testTypes[selected];
  const scope = samplesIn(lot.samples, process.id, selected);
  const latest = latestIn(lot.samples, process.id, selected);
  const previous = scope.length > 1 ? scope[scope.length - 2] : undefined;
  const pending = unacknowledged(lot.samples, process.id, selected);

  const primary = testType?.metrics.find((m) => m.primary);

  // De ordnede fordelinger står som stablet søjle under hovedtallet, ikke som
  // rækker. Uden den opdeling blandede kortet FV1, FV2 og FV3 ind mellem
  // klasserne, som var de det samme slags tal.
  const ordinalIds = new Set(
    (testType?.groups ?? [])
      .filter((g) => g.scale === "ordinal")
      .flatMap((g) =>
        (testType?.metrics ?? [])
          .filter((m) => m.group === g.id)
          .map((m) => m.id),
      ),
  );
  const rest =
    testType?.metrics.filter((m) => !m.primary && !ordinalIds.has(m.id)) ?? [];

  // Kvaliteten hænger ikke på fanen. FV fortæller, hvor gode de frø er, der
  // kører netop nu, og det er den beslutning, operatøren står med uanset om
  // hun kigger på renhed eller på skader. Derfor står søjlen fast øverst og
  // hentes fra sin egen prøve, ikke fra den valgte fane.
  //
  // Hvilken testtype der bærer den, udledes af skalaen. Kortet skal ikke vide,
  // at gruppen hedder "fv", eller at testtypen hedder "ct".
  const qualityId = process.test_types.find((id) =>
    testTypes[id]?.groups.some((g) => g.scale === "ordinal"),
  );
  const qualityType = qualityId ? testTypes[qualityId] : undefined;
  const qualityGroup = qualityType?.groups.find((g) => g.scale === "ordinal");
  const qualityScope = qualityId
    ? samplesIn(lot.samples, process.id, qualityId)
    : [];
  const qualitySample = qualityScope[qualityScope.length - 1];

  // To nøgletal, aldrig tre. Det venstre følger fanen, det højre står fast, og
  // begge har deres pil: andelen af monogerm skal kunne følges, uden at man
  // først skal klikke sig ind på CT-fanen.
  //
  // Står CT-fanen selv for det venstre tal, er de to det samme, og så vises
  // det kun én gang. To ens tal ved siden af hinanden er ikke to nøgletal.
  const keys: {
    type: TestType;
    metric: Metric;
    sample: LotSample;
    previous?: LotSample;
  }[] = [];

  if (latest && primary && testType && selected !== qualityId) {
    keys.push({ type: testType, metric: primary, sample: latest, previous });
  }

  const qualityPrimary = qualityType?.metrics.find((m) => m.primary);
  if (qualitySample && qualityPrimary && qualityType) {
    keys.push({
      type: qualityType,
      metric: qualityPrimary,
      sample: qualitySample,
      previous:
        qualityScope.length > 1
          ? qualityScope[qualityScope.length - 2]
          : undefined,
    });
  }

  return (
    <article
      className={`process${alerting ? " process--alert" : ""}${
        process.stamp ? " process--stamp" : ""
      }${active ? " process--active" : ""}`}
    >
      {/* Hele kortet er knappen, ikke kun hovedet. Skærmen hænger på en stor
          touchskærm, og dér er et ramme-stort trykfelt forskellen på at ramme
          og at prøve igen. Knappen ligger under indholdet og over baggrunden,
          så de rigtige knapper i kortet stadig kan trykkes hver for sig. */}
      <button
        type="button"
        className="process__hit"
        aria-pressed={active}
        aria-label={`Vis prøver fra ${process.label}`}
        onClick={() => onSelect(selected)}
      />

      <header className="process__head">
        <span className="process__step">{process.step}</span>
        <span className="process__name">
          {process.label}
          {alerting && <span className="dot" aria-label="Nyt resultat" />}
        </span>
      </header>

      {/* Øverst står det, operatøren beslutter ud fra: hvad prøven viser, og
          hvor gode frøene er. Fanerne ligger nedenunder, fordi de er en vej
          ned i detaljen og ikke en forudsætning for at læse kortet. */}
      <div className="process__lead">
        {keys.length > 0 && (
          <div className="process__keys">
            {keys.map((k) => (
              <div className="process__key" key={k.type.id}>
                {/* Hvert tal nævner sin egen prøve. De to kommer fra hver sin
                    scanning, og uden kilden ville de læses som ét resultat.

                    Testtypen nævnes kun, når den ikke er den valgte fane.
                    Står den fremhævet nedenunder, er "Cleaning Damage #3" tre
                    ord for meget, og de skubbede metriknavnet ud i "S...". */}
                <p className="process__key-head">
                  <span>{k.metric.label}</span>
                  <span>
                    {k.type.id !== selected && `${k.type.label} `}#
                    {k.sample.seq} · {time.format(new Date(k.sample.taken_at))}
                  </span>
                </p>
                <p className="process__key-value">
                  <span className="process__value">
                    {formatMetric(k.sample.metrics[k.metric.id], k.metric.unit)}
                  </span>
                  <DeltaTag
                    delta={deltaFor(k.metric, k.sample, k.previous, thresholds)}
                    silent
                  />
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Kilden står allerede på kvalitetstallet lige ovenfor, så søjlen
            gentager den ikke. Den siger kun, hvilken vej skalaen vender. */}
        {qualityGroup && qualitySample && (
          <div className="process__quality">
            <Stack
              metrics={qualityType!.metrics.filter(
                (m) => m.group === qualityGroup.id,
              )}
              sample={qualitySample}
              note={`${qualityGroup.label} · bedst til venstre`}
            />
          </div>
        )}
      </div>

      {/* Faner vises kun, hvor der er noget at vælge imellem, altså kun på
          Post Cleaning. En fanerække med én fane er støj.

          De to andre kort viser i stedet testtypen som en stille etiket i det
          samme bånd. Båndet skal alligevel være der, ellers ligger alt under
          fanerne på Post Cleaning lavere end på de to andre, og så står de tre
          tabeller i trappe. Et tomt bånd læses som en fejl, et bånd med navnet
          i læses som en overskrift. */}
      {process.test_types.length === 1 && (
        <div className="process__tabs">
          <span className="tab tab--static">
            {testType?.label ?? selected}
          </span>
        </div>
      )}

      {process.test_types.length > 1 && (
        <div
          className="process__tabs above-hit"
          role="tablist"
          aria-label={process.label}
        >
          {process.test_types.map((id) => {
            const dot = unacknowledged(lot.samples, process.id, id).length > 0;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === selected}
                className={`tab${id === selected ? " tab--active" : ""}`}
                onClick={() => onSelect(id)}
              >
                {testTypes[id]?.label ?? id}
                {dot && <span className="dot" aria-label="Nyt resultat" />}
              </button>
            );
          })}
        </div>
      )}

      {!latest ? (
        <p className="process__empty">
          Ingen {testType?.label ?? selected}-prøve på dette trin endnu.
        </p>
      ) : (
        <>
          {rest.length > 0 && (
            <ul className="process__metrics">
              {rest.map((metric) => (
                <li key={metric.id}>
                  <span className="process__metric-label">{metric.label}</span>
                  <span className="process__metric-value">
                    {formatMetric(latest.metrics[metric.id], metric.unit)}
                  </span>
                  <DeltaTag
                    delta={deltaFor(metric, latest, previous, thresholds)}
                  />
                  <Sparkline
                    values={seriesOf(scope, metric.id)}
                    label={metric.label}
                  />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/* Foden ligger i kortets sidste bånd og er bundstillet, så knappen
          havner i nederste højre hjørne og ikke midt i kortet, hvor den ser
          tilfældig ud. Handling og stempel deler bånd, fordi de er det samme:
          det, man gør ved dette trin, når man har set tallene.

          Ingen "Alle prøver"-knap. Kortet er selv knappen, og to affordanser
          til det samme lærer ingen noget. */}
      <div className="process__foot above-hit">
        {pending.length > 0 && (
          <div className="process__actions">
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => onAcknowledge(pending.map((s) => s.id))}
            >
              <Icon name="check" size={17} strokeWidth={2.2} />
              {pending.length === 1
                ? "Kvittér for resultat"
                : `Kvittér for ${pending.length} resultater`}
            </button>
          </div>
        )}

        {process.stamp && (
          <StampArea
            lot={lot}
            process={process}
            testTypes={testTypes}
            onStamp={onStamp}
            busy={busy}
          />
        )}
      </div>
    </article>
  );
}

function DeltaTag({
  delta,
  silent = false,
}: {
  delta: ReturnType<typeof deltaFor>;
  /**
   * Sig ingenting, når der ikke er noget at sammenligne med. Bruges dér, hvor
   * prøvenummeret allerede står ved siden af: "#1" og "første prøve" er det
   * samme udsagn, og den lange af de to er også den, der brækker linjen.
   */
  silent?: boolean;
}) {
  // Første prøve i et trin har intet at blive sammenlignet med. En nul-værdi
  // ville påstå, at den var uændret, og det er ikke det samme.
  if (!delta) {
    if (silent) return null;
    return <span className="delta delta--none">første prøve</span>;
  }

  const icon =
    delta.direction === "flat"
      ? "minus"
      : delta.direction === "up"
        ? "arrow-up"
        : "arrow-down";

  return (
    <span className={deltaClass(delta)}>
      <Icon name={icon} size={14} strokeWidth={2.6} />
      {formatDelta(delta)}
    </span>
  );
}

/**
 * Stemplet under Post Cleaning.
 *
 * Kan først sættes, når begge testtyper har en prøve. Et stempel uden det
 * bagvedliggende er værre end intet stempel, for nogen tror på det. Er der
 * noget i vejen, står grunden på skærmen frem for at knappen bare er grå.
 */
function StampArea({
  lot,
  process,
  testTypes,
  onStamp,
  busy,
}: {
  lot: LotDetail;
  process: Process;
  testTypes: Record<string, TestType>;
  onStamp: (stamp: StampId) => void;
  busy: boolean;
}) {
  if (lot.stamp) {
    const approved = lot.stamp === "approved";
    return (
      <div className={`stamp stamp--${approved ? "approved" : "rejected"}`}>
        <Icon name={approved ? "badge-check" : "circle-x"} size={22} strokeWidth={2} />
        <div>
          <p className="stamp__verdict">{approved ? "Godkendt" : "Afvist"}</p>
          <p className="stamp__by">
            {lot.stamped_by}
            {lot.stamped_at && ` · ${dateTime.format(new Date(lot.stamped_at))}`}
          </p>
          {lot.stamp_note && <p className="stamp__note">{lot.stamp_note}</p>}
        </div>
      </div>
    );
  }

  // Hvilke testtyper der kræves, kommer fra processen og ikke fra en liste
  // her. Kommer der en tredje til, skal denne fil ikke røres.
  const missing = process.test_types.filter(
    (t) => samplesIn(lot.samples, process.id, t).length === 0,
  );

  if (missing.length > 0) {
    const names = missing.map((t) => testTypes[t]?.label ?? t).join(" og ");
    return (
      <div className="stamp stamp--blocked">
        <Icon name="info" size={18} strokeWidth={2.2} />
        <p>
          Lottet kan ikke stemples endnu. Post Cleaning mangler stadig en prøve
          af {names}.
        </p>
      </div>
    );
  }

  return (
    <div className="stamp stamp--open">
      <p className="stamp__prompt">Lottet er kørt færdigt.</p>
      <div className="stamp__buttons">
        <button
          type="button"
          className="btn"
          disabled={busy}
          onClick={() => onStamp("approved")}
        >
          <Icon name="badge-check" size={17} strokeWidth={2.2} />
          Godkend lot
        </button>
        <button
          type="button"
          className="btn btn--ghost"
          disabled={busy}
          onClick={() => onStamp("rejected")}
        >
          Afvis
        </button>
      </div>
    </div>
  );
}
