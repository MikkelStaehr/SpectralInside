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
  const ordinal = testType?.groups.filter((g) => g.scale === "ordinal") ?? [];
  const ordinalIds = new Set(
    ordinal.flatMap((g) =>
      (testType?.metrics ?? []).filter((m) => m.group === g.id).map((m) => m.id),
    ),
  );
  const rest =
    testType?.metrics.filter((m) => !m.primary && !ordinalIds.has(m.id)) ?? [];

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
          {/* Testtypen står i båndet ovenfor og ikke også her. Linjen handler
              om prøven, ikke om hvilken slags prøve det er. */}
          <p className="process__which">
            Prøve #{latest.seq} af {scope.length}
            <span>{time.format(new Date(latest.taken_at))}</span>
          </p>

          {/* Hovedtal og kvalitet i ét element. Kortet arver kædens rækker, så
              antallet af børn skal være det samme på alle tre kort: lægger man
              et ekstra ind, skubbes foden op oven i tabellen. */}
          <div className="process__lead">
            {primary && (
              <div className="process__primary">
                <span className="process__value">
                  {formatMetric(latest.metrics[primary.id], primary.unit)}
                </span>
                <span className="process__metric-name">{primary.label}</span>
                <DeltaTag
                  delta={deltaFor(primary, latest, previous, thresholds)}
                />
              </div>
            )}

            {/* Kvaliteten lige under hovedtallet. FV er kvaliteten af netop de
                frø, Monogerm tæller, så de to hører sammen. */}
            {ordinal.map((group) => (
              <div className="process__quality" key={group.id}>
                <Stack
                  metrics={testType!.metrics.filter((m) => m.group === group.id)}
                  sample={latest}
                  legend={false}
                />
                <p className="process__quality-key">
                  {group.label} · bedst til venstre
                </p>
              </div>
            ))}
          </div>

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

function DeltaTag({ delta }: { delta: ReturnType<typeof deltaFor> }) {
  // Første prøve i et trin har intet at blive sammenlignet med. En nul-værdi
  // ville påstå, at den var uændret, og det er ikke det samme.
  if (!delta) return <span className="delta delta--none">første prøve</span>;

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
