/**
 * Ét led i proceskæden.
 *
 * Operatørens trin er "juster og prøv igen": hun får et dårligt resultat,
 * skruer på noget, og tager en ny prøve. Kortet er bygget om det.
 * Justeringsteksten står derfor lige under det tal, den frembragte, og ikke i
 * en note et andet sted, for det er sammenhængen mellem de to, der er
 * arbejdet. Finalizing er hendes sidste.
 *
 * Post Cleaning er ikke det. Den er rent analytisk — laboratoriets dom over
 * færdigvaren — og der står ingen ved linjen, som kan gøre noget ved tallet.
 * Kortet siger det, frem for at invitere til en justering, der ikke findes.
 * Samme data, anden indramning, se StampArea nederst.
 */

import { useMemo } from "react";
import type {
  LotDetail,
  LotSample,
  Operation,
  Process,
  ProcessId,
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
  previousOnLot,
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
  /** Alle trin. Bruges til at sige, hvilket trin en ændring er målt imod. */
  processes: Process[];
  testTypes: Record<string, TestType>;
  /** Standardprocedurerne. Afgør hvornår et lot må stemples. */
  operations: Operation[];
  selected: TestTypeId;
  /**
   * Det valgte sted på trinnet. `null` betyder prøver uden sted, og
   * `undefined` betyder et trin, der kun har ét.
   */
  position: string | null | undefined;
  /** Om det er dette kort, prøvehistorikken nedenunder viser. */
  active: boolean;
  thresholds: Thresholds;
  onSelect: (testType: TestTypeId) => void;
  onSelectPosition: (position: string | null) => void;
  onAcknowledge: (sampleIds: number[]) => void;
  onStamp: (stamp: StampId) => void;
  /** Meld partiet færdigt på linjen. Flytter det over i laboratoriets kø. */
  onHandover: () => void;
  /**
   * Det sidste trin, operatøren ejer. Udledt af processerne og sendt ind, så
   * kortet ikke skal kende rækkefølgen for at vide, om det er det sidste.
   */
  lastOperatorStep: ProcessId | null;
  busy: boolean;
}

/** Ukvitterede prøver i ét (proces, testtype), eventuelt på ét sted. */
function unacknowledged(
  samples: LotSample[],
  process: string,
  testType: TestTypeId,
  position?: string | null,
): LotSample[] {
  return samplesIn(
    samples,
    process as Process["id"],
    testType,
    position,
  ).filter((s) => s.acknowledged_at === null);
}

export function ProcessCard({
  lot,
  process,
  processes,
  testTypes,
  operations,
  selected,
  position,
  active,
  thresholds,
  onSelect,
  onSelectPosition,
  onAcknowledge,
  onStamp,
  onHandover,
  lastOperatorStep,
  busy,
}: Props) {
  // Kortet alarmerer, hvis noget som helst under det er ukvitteret, også når
  // det ligger på den fane, der ikke er valgt. Ellers kunne et nyt resultat
  // ligge og blinke bag en fane, ingen kigger på.
  const alerting = process.test_types.some(
    (t) => unacknowledged(lot.samples, process.id, t).length > 0,
  );

  /**
   * Stederne på trinnet, som fanerne skal vise.
   *
   * Til sidst et sted for prøver uden sted, hvis der er nogen. Det skal være
   * der: prøver taget før stederne fandtes, ville ellers forsvinde bag
   * fanerne, uden at nogen opdagede det. Båndet forsvinder af sig selv, når
   * alle prøver bærer deres sted.
   */
  const places = useMemo(() => {
    const declared = process.positions.map((p) => ({
      id: p.id as string | null,
      label: p.label,
    }));
    if (declared.length === 0) return declared;

    const orphans = process.test_types.some((t) =>
      samplesIn(lot.samples, process.id, t, null).length > 0,
    );
    return orphans
      ? [...declared, { id: null, label: "Uden sted" }]
      : declared;
  }, [process, lot.samples]);

  const placeLabel =
    places.find((p) => p.id === position)?.label ?? process.label;

  const testType = testTypes[selected];
  const scope = samplesIn(lot.samples, process.id, selected, position);
  const latest = latestIn(lot.samples, process.id, selected, position);
  const pending = unacknowledged(lot.samples, process.id, selected, position);

  // Ændringen måles mod den forrige prøve af samme slags **på lottet**, ikke
  // inden for trinnet.
  //
  // Det var forkert før. Et trin har typisk én CT-prøve, og så stod der
  // "første prøve" på tre af fire kort, selv om monogerm-andelen gik 78,4 ->
  // 82,1 -> 84,6 -> 86,9 hen over kæden. Pilen skal svare på, om partiet er
  // blevet bedre, og det spørgsmål stopper ikke ved trinnets kant.
  //
  // Kortene står i trinrækkefølge med pile imellem, så "mod den forrige" læses
  // naturligt som "mod kortet til venstre". Hvilken prøve det præcist er,
  // står i delta-mærkatets title.
  const order = processes.map((p) => p.id);
  const previous = latest
    ? previousOnLot(lot.samples, latest, order)
    : undefined;

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
    ? samplesIn(lot.samples, process.id, qualityId, position)
    : [];
  const qualitySample = qualityScope[qualityScope.length - 1];

  // To nøgletal, aldrig tre, og de skifter ikke, når fanen gør. Toppen af
  // kortet er trinnets tilstand, ikke fanens: skal operatøren først klikke for
  // at se, om monogerm-andelen stiger, er tallet lige så godt gemt væk.
  //
  // Fanen bestemmer kun tabellen nedenunder. Hvad de to nøgletal er, følger af
  // processen: den første testtype på trinnet, og kvaliteten.
  const keyOf = (id: TestTypeId | undefined) => {
    const type = id ? testTypes[id] : undefined;
    const metric = type?.metrics.find((m) => m.primary);
    const sample = id ? latestIn(lot.samples, process.id, id, position) : null;
    if (!type || !metric || !sample) return null;
    return {
      type,
      metric,
      sample,
      previous: previousOnLot(lot.samples, sample, order),
    };
  };

  /** "Målt mod Cleaning S · CT #1 · 06.03". Står som title på pilen. */
  const against = (from: LotSample | undefined) => {
    if (!from) return undefined;
    const step = processes.find((p) => p.id === from.process);
    const type = testTypes[from.test_type];
    // Stedet med, hvor trinnet har flere. Uden det kan man ikke se, om et
    // tal er målt mod S eller N, og på Cleaning er det to forskellige svar.
    const place = step?.positions.find((x) => x.id === from.position);
    return `Målt mod ${step?.label ?? from.process}${
      place ? ` ${place.label}` : ""
    } · ${type?.label ?? from.test_type} #${from.seq} · ${dateTime.format(
      new Date(from.taken_at),
    )}`;
  };

  const keys = [
    keyOf(process.test_types.find((id) => id !== qualityId)),
    keyOf(qualityId),
  ].filter((k): k is NonNullable<typeof k> => k !== null);

  // Overleveringen hører til det sidste trin, operatøren ejer. Hvilket det er,
  // følger af processerne og ikke af et navn her: kommer der et femte trin,
  // skal denne fil ikke røres. Et stemplet lot er forbi og kan ikke meldes
  // færdigt igen.
  const handover = lastOperatorStep === process.id && lot.stamp === null;

  return (
    <article
      // Laboratoriets kort skiller sig ud paa etiketten i hovedet og ikke paa
      // fladen. En klasse uden regel er doed markup, og en flade, der sagde det
      // samme som etiketten, ville sige det to gange.
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
        {/* Hvem trinnet hører til. Kun sagt, hvor det ikke er operatøren:
            de tre første er hendes, og at skrive det på dem alle ville gøre
            etiketten til baggrundsstøj i stedet for en oplysning. */}
        {process.owner === "analyst" && (
          <span className="process__owner">Laboratoriet</span>
        )}
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

                    Kilden står på sin egen linje. Ved siden af metriknavnet
                    fyldte "Cleaning Damage #3 · 12.56" mere end cellen, og så
                    blev "Skader i alt" klippet til "S...". */}
                <p className="process__key-head">{k.metric.label}</p>
                <p className="process__key-source">
                  {k.type.label} #{k.sample.seq} ·{" "}
                  {time.format(new Date(k.sample.taken_at))}
                </p>
                <p className="process__key-value">
                  <span className="process__value">
                    {formatMetric(k.sample.metrics[k.metric.id], k.metric.unit)}
                  </span>
                  <DeltaTag
                    delta={deltaFor(k.metric, k.sample, k.previous, thresholds)}
                    against={against(k.previous)}
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

      {/* Fanerne er **stederne** og ikke testtyperne.

          De to kontakter vejer ikke det samme. Stedet skifter hele
          prøvestrømmen — S og N er to steder, materialet kan se forskelligt ud
          — mens testtypen kun vælger, hvilken tabel der står nedenunder.
          Nøgletallene øverst dækker begge testtyper i forvejen.

          Båndet er der altid, også hvor der kun er ét sted. Uden det ligger
          alt under fanerne på Cleaning lavere end på de andre kort, og så står
          tabellerne i trappe. Et tomt bånd læses som en fejl, et bånd med
          trinnets eget navn i læses som en overskrift. */}
      {places.length > 1 ? (
        <div
          className="process__tabs above-hit"
          role="tablist"
          aria-label={`Sted på ${process.label}`}
        >
          {places.map((place) => {
            const dot = process.test_types.some(
              (t) =>
                unacknowledged(lot.samples, process.id, t, place.id).length > 0,
            );
            return (
              <button
                key={place.id ?? "ingen"}
                type="button"
                role="tab"
                aria-selected={place.id === position}
                className={`tab${place.id === position ? " tab--active" : ""}`}
                onClick={() => onSelectPosition(place.id)}
              >
                {place.label}
                {dot && <span className="dot" aria-label="Nyt resultat" />}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="process__tabs">
          <span className="tab tab--static">{process.label}</span>
        </div>
      )}

      {!latest ? (
        <p className="process__empty">
          Ingen {testType?.label ?? selected}-prøve
          {places.length > 1 ? ` på ${placeLabel}` : " på dette trin"} endnu.
        </p>
      ) : (
        <>
          {/* Testtypen vælger kun tabellen nedenunder, så den er en stille
              kontakt og ikke en fanerække. Er der kun én, står den som en
              etiket: der er ikke noget at vælge imellem. */}
          {process.test_types.length > 1 ? (
            <div className="process__which above-hit" role="tablist">
              {process.test_types.map((id) => {
                const dot =
                  unacknowledged(lot.samples, process.id, id, position).length >
                  0;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={id === selected}
                    className={`which${id === selected ? " which--active" : ""}`}
                    onClick={() => onSelect(id)}
                  >
                    {testTypes[id]?.label ?? id}
                    {dot && <span className="dot" aria-label="Nyt resultat" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="process__which process__which--one">
              {testType?.label ?? selected}
            </p>
          )}

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
                    against={against(previous)}
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

        {/* Operatørens sidste handling. Herfra er partiet laboratoriets, og
            det flytter over i analysekøen på forsiden.

            Kun på det sidste trin, hun ejer, og kun mens lottet stadig kører.
            Er det først overleveret, er der ikke noget at trykke på: knappen
            forsvinder frem for at blive grå, for en grå knap ser ud som noget,
            der er i vejen. */}
        {handover && (
          <div className="process__handover">
            {lot.ended_at ? (
              <p className="process__handover-done">
                <Icon name="circle-check" size={16} strokeWidth={2.2} />
                Meldt færdig på linjen{" "}
                {dateTime.format(new Date(lot.ended_at))}
              </p>
            ) : (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={onHandover}
              >
                <Icon name="arrow-right" size={17} strokeWidth={2.2} />
                Færdig på linjen
              </button>
            )}
          </div>
        )}

        {process.stamp && (
          <StampArea
            lot={lot}
            process={process}
            testTypes={testTypes}
            operations={operations}
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
  against,
  silent = false,
}: {
  delta: ReturnType<typeof deltaFor>;
  /**
   * Hvad ændringen er målt imod. Kortene står i trinrækkefølge med pile
   * imellem, så "mod den forrige" læses naturligt som "mod kortet til
   * venstre" — men står sammenligningen på et andet trin, skal man kunne
   * få det at vide uden at gætte.
   */
  against?: string;
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
    <span className={deltaClass(delta)} title={against}>
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
  operations,
  onStamp,
  busy,
}: {
  lot: LotDetail;
  process: Process;
  testTypes: Record<string, TestType>;
  operations: Operation[];
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

  // Hvad der kræves, kommer fra operationslisten og ikke fra en liste her.
  //
  // Et operationsnummer er en standardprocedure — operation 48 er en analyse
  // af 200 frø og renheden af partiet — så kravet er ikke "der er taget en
  // prøve", men "den her analyse er lavet efter forskriften". Operationen
  // tæller uanset hvilket trin prøven blev taget på: den er en analyse af
  // partiet, ikke af et trin.
  const required = operations.filter((op) =>
    op.required_for.includes(process.id),
  );

  if (required.length > 0) {
    const done = new Set(
      lot.samples.map((s) => s.operation).filter(Boolean) as string[],
    );
    const outstanding = required.filter((op) => !done.has(op.id));

    if (outstanding.length > 0) {
      return (
        <div className="stamp stamp--blocked">
          <Icon name="info" size={18} strokeWidth={2.2} />
          <div>
            <p>Lottet kan ikke stemples endnu.</p>
            {/* Hele listen og ikke kun det manglende. Den, der står med
                lottet, skal kunne se, hvor langt der er igen, og ikke bare
                hvad der mangler lige nu. */}
            <ul className="stamp__ops">
              {required.map((op) => (
                <li key={op.id} className={done.has(op.id) ? "is-done" : undefined}>
                  <Icon
                    name={done.has(op.id) ? "circle-check" : "circle-alert"}
                    size={15}
                    strokeWidth={2.2}
                  />
                  <span>
                    Op. {op.id} · {op.label}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      );
    }
  } else {
    // Ingen operationsliste endnu. Den svagere regel: mindst én prøve af hver
    // testtype på trinnet. Rimelig at starte i, men ikke den rigtige regel.
    const missing = process.test_types.filter(
      (t) => samplesIn(lot.samples, process.id, t).length === 0,
    );
    if (missing.length > 0) {
      const names = missing.map((t) => testTypes[t]?.label ?? t).join(" og ");
      return (
        <div className="stamp stamp--blocked">
          <Icon name="info" size={18} strokeWidth={2.2} />
          <p>
            Lottet kan ikke stemples endnu. {process.label} mangler stadig en
            prøve af {names}.
          </p>
        </div>
      );
    }
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
