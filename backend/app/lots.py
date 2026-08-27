"""Lot, proces, testtype og metrikker.

Domænet bag operatørskærmen. Hierarkiet er stramt og fire niveauer dybt:

    Lotnummer -> proces -> testtype -> prøvenummer -> metrikker

Definitionen ligger i kode og ikke i ``content/``, fordi strukturen er bundet
til databaseskemaet. En ny metrik er en ny række i ``lot_sample_metrics``, ikke
en tekst nogen kan rette i en YAML-fil uden at der sker andet.

Til gengæld eksponeres hele definitionen gennem ``/api/lots/meta``. Frontenden
kender derfor hverken processernes rækkefølge, metrikkernes navne eller hvilken
vej der er den gode. Skal en metrik hedde noget andet, rettes den her, ét sted,
præcis som operatørvisningen i forvejen spørger serveren om fokusklassen.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ProcessId = Literal["pre_cleaning", "cleaning", "finalizing", "post_cleaning"]
TestTypeId = Literal["purity", "cleaning_damage", "ct"]
StampId = Literal["approved", "rejected"]


class MetricGroup(BaseModel):
    """En fordeling inden for en testtype.

    Findes, fordi en CT-scanning giver **to** fordelinger af én måling: de seks
    klasser og de fire FV-trin. Uden grupper skulle vi lave to prøver ud af én
    scanning, og det ville være en løgn om, hvad der faktisk skete.
    """

    id: str
    label: str
    lead: str = ""
    scale: Literal["nominal", "ordinal"] = Field(
        default="nominal",
        description=(
            "Nominal: klasserne har ingen indbyrdes rækkefølge, Koriander er "
            "ikke 'mere' end Katost. Ordinal: de er ordnede, FV1 er dårligere "
            "end FV0 og bedre end FV2. Det afgør, hvordan de tegnes: nominelle "
            "som søjler på fælles akse, ordinale som én stablet søjle i én "
            "kulør fra lys til mørk."
        ),
    )


class Metric(BaseModel):
    id: str
    label: str
    unit: str = "%"
    primary: bool = Field(
        default=False,
        description=(
            "Tallet der sættes stort på skærmen. Præcis ét pr. gruppe, så en "
            "testtype med to fordelinger har to hovedtal."
        ),
    )
    group: str | None = Field(
        default=None,
        description="Hvilken fordeling metrikken hører til. Null når testtypen kun har én.",
    )
    better: Literal["higher", "lower"] = Field(
        description=(
            "Hvilken vej der er fremgang. Fortegnet på en ændring siger det "
            "ikke selv: Sugarbeet skal op, alt andet skal ned."
        )
    )
    source_class: str | None = Field(
        default=None,
        description=(
            "Klassens navn i VideometerLabs egen model, stavet præcis som den "
            "står der. Metrik-id'et er en slug, fordi det skal kunne stå i en "
            "URL og en databasekolonne, men connectoren skal kunne finde "
            "klassen igen uden at gætte på stavemåden."
        ),
    )


class TestType(BaseModel):
    id: TestTypeId
    label: str
    lead: str = ""
    metrics: list[Metric]
    groups: list[MetricGroup] = []


class Process(BaseModel):
    id: ProcessId
    step: int
    label: str
    test_types: list[TestTypeId]
    stamp: bool = Field(
        default=False,
        description=(
            "Processen afsluttes med et kvalitetsstempel frem for med endnu en "
            "justering. Kun Post Cleaning. Skærmen bruger det til ikke at "
            "invitere til at prøve igen dér, hvor der ikke er noget at skrue på."
        ),
    )
    owner: Literal["operator", "analyst"] = Field(
        default="operator",
        description=(
            "Hvis trin det er. Operatøren står ved linjen og kan skrue på "
            "noget; analytikeren sidder i laboratoriet og kan ikke. Skærmen "
            "bruger det til at holde op med at invitere til en ny justering "
            "på et trin, hvor der ikke er nogen at gøre det."
        ),
    )


# Hvornår en ændring er så lille, at den vises som uændret.
#
# Der skal to betingelser til, og det er ikke overdrevet. Med ét absolut tal
# alene rammer tærsklen helt skævt, når metrikkerne ligger i vidt forskellige
# størrelsesordener: Sugarbeet ligger omkring 97 og flytter sig i hele procent,
# mens Pileurt ligger omkring 0,08. En fælles grænse på 0,05 fik Koriander,
# Katost, Agersnerle, Pileurt og Burresnerre til at stå som uændrede, selv om
# de faldt med en femtedel af deres egen værdi.
#
# En ændring regnes derfor kun for uændret, når den er lille **både** absolut
# og i forhold til det, den måles på. 0,25 -> 0,20 er 0,05 absolut, men en
# femtedel af værdien, og det er en rigtig ændring. 97,60 -> 97,62 er derimod
# begge dele små, og det er støj.
FLAT_THRESHOLD = 0.05
RELATIVE_THRESHOLD = 0.02


# Purity-modellens ti klasser, stavet som de står i VideometerLab.
#
# Det er ikke en opfundet liste over urenheder, det er modellens faktiske
# klasser, og derfor er det dem, en Purity-prøve giver tal for. Sugarbeet er
# selve renheden og skal op. Alt andet er iblanding og skal ned, Unknown
# indbefattet: den er ikke en urenhed, men de frø modellen ikke kunne afgøre,
# og udelader man den, summer tallene ikke til 100.
#
# Rækkefølgen er den, de vises i. Sugarbeet står først, fordi den er det
# store tal, og Foreign og Unknown derefter, fordi de er de to, der betyder
# noget, når renheden falder. Arterne følger efter.
_PURITY_CLASSES: list[tuple[str, str, bool]] = [
    ("sugarbeet", "Sugarbeet", True),
    ("foreign", "Foreign", False),
    ("unknown", "Unknown", False),
    ("natskygge", "Natskygge", False),
    ("koriander", "Koriander", False),
    ("katost", "Katost", False),
    ("haaret_knopskulpe", "Håret Knopskulpe", False),
    ("agersnerle", "Agersnerle", False),
    ("pileurt", "Pileurt", False),
    ("burresnerre", "Burresnerre", False),
]


TEST_TYPES: dict[str, TestType] = {
    "purity": TestType(
        id="purity",
        label="Purity",
        metrics=[
            Metric(
                id=metric_id,
                label=name,
                source_class=name,
                primary=primary,
                better="higher" if primary else "lower",
            )
            for metric_id, name, primary in _PURITY_CLASSES
        ],
    ),
    "cleaning_damage": TestType(
        id="cleaning_damage",
        label="Cleaning Damage",
        metrics=[
            Metric(id="damage_total", label="Skader i alt", primary=True, better="lower"),
            Metric(id="red_eyes", label="Red Eyes", better="lower"),
            Metric(id="white_eyes", label="White Eyes", better="lower"),
            Metric(id="naked_embryo", label="Naked Embryo", better="lower"),
            Metric(id="decapped", label="Decapped", better="lower"),
        ],
    ),
    # CT-scanningen. Videometer svarer "hvor meget af det her er roefrø, og har
    # vi ødelagt noget undervejs". CT svarer på noget andet: af det, der er
    # tilbage, hvor godt er det. Prøven tages de samme steder på linjen, det er
    # kun formålet, der er et andet.
    #
    # To fordelinger af én scanning, se MetricGroup:
    #
    #   klasser  hvad frøet er. Nominelle, ingen indbyrdes rækkefølge.
    #   fv       Free Volume pr. frø, FV0 til FV3. Ordnede, lavere er bedre.
    "ct": TestType(
        id="ct",
        label="CT",
        lead="Hvad der er tilbage, og hvor godt det er.",
        groups=[
            MetricGroup(
                id="classes",
                label="Hvad frøet er",
                scale="nominal",
            ),
            MetricGroup(
                id="fv",
                label="Free Volume",
                lead="Kvaliteten af det enkelte frø. Lavere er bedre.",
                scale="ordinal",
            ),
        ],
        metrics=[
            # Sukkerroer er forædlet til at være monogerme: ét frø skal give én
            # plante. Alt flerkimet kræver udtynding og er derfor ikke det, der
            # sælges.
            Metric(
                id="monogerm",
                label="Monogerm",
                group="classes",
                primary=True,
                better="higher",
            ),
            Metric(id="twin", label="Twin", group="classes", better="lower"),
            # BIGH har én embryo og én kim, så den spirer som en monogerm, selv
            # om strukturen er bigerm. Om den tæller som defekt eller som
            # acceptabel afhænger af, hvad kunden køber. Sat konservativt til
            # "lavere er bedre" indtil det er afklaret.
            Metric(
                id="bigh",
                label="BIGH",
                group="classes",
                better="lower",
                source_class="BIGH",
            ),
            Metric(
                id="bigf",
                label="BIGF",
                group="classes",
                better="lower",
                source_class="BIGF",
            ),
            # Det samme som Foreign hos Videometer, målt af et andet
            # instrument. To uafhængige tal for den samme ting, se README.
            Metric(id="nots", label="NOTS", group="classes", better="lower"),
            Metric(id="empty", label="Empty", group="classes", better="lower"),
            # FV er pr. frø, så en prøve giver en fordeling over de fire trin,
            # der summer til 100. FV0 er hovedtallet: andelen i bedste
            # kvalitetsklasse er et rigtigt tal med en nævner, hvor et vægtet
            # gennemsnit af 0, 1, 2 og 3 ville være et konstrueret tal på en
            # ordinalskala.
            Metric(id="fv0", label="FV0", group="fv", primary=True, better="higher"),
            Metric(id="fv1", label="FV1", group="fv", better="lower"),
            Metric(id="fv2", label="FV2", group="fv", better="lower"),
            Metric(id="fv3", label="FV3", group="fv", better="lower"),
        ],
    ),
}


# Rækkefølgen er den fysiske rækkefølge på linjen. Skærmen læses som en kæde,
# så listen her er også den, den tegnes i.
#
# Processerne har ikke en forklarende undertekst. Operatøren ved godt, hvad
# der sker i Cleaning, hun står ved maskinen, og en linje der forklarer det
# koster plads på hvert eneste kort hele dagen.
#
# CT tages de samme steder som Videometer-prøverne, så den ligger på alle tre
# trin. Det er kun formålet, der er et andet: Videometer siger hvad der er i
# lottet og om vi har ødelagt noget, CT siger hvor godt det er, der er tilbage.
PROCESSES: list[Process] = [
    Process(
        id="pre_cleaning", step=1, label="Pre Cleaning", test_types=["purity", "ct"]
    ),
    Process(
        id="cleaning", step=2, label="Cleaning", test_types=["cleaning_damage", "ct"]
    ),
    # Operatørens sidste trin. Herfra og frem er der ikke mere at skrue på.
    #
    # ADVARSEL: testtyperne herunder er et gæt. Finalizing er sat op som
    # Cleaning, fordi de to er det samme slags trin — operatøren justerer og
    # tager en ny prøve — og fordi det, der kan gå galt i en afsluttende
    # bearbejdning, er skader og hvad der er tilbage. Ret listen, hvis der også
    # tages renhedsprøver dér. Det er én linje.
    Process(
        id="finalizing",
        step=3,
        label="Finalizing",
        test_types=["cleaning_damage", "ct"],
    ),
    # Rent analytisk. Laboratoriets dom over færdigvaren, ikke et trin på
    # linjen: der står ingen operatør og kan gøre noget ved tallet. Derfor
    # owner="analyst", og derfor er det her, stemplet sidder.
    Process(
        id="post_cleaning",
        step=4,
        label="Post Cleaning",
        test_types=["purity", "cleaning_damage", "ct"],
        stamp=True,
        owner="analyst",
    ),
]

PROCESS_BY_ID = {process.id: process for process in PROCESSES}


# --- Stamdata ---------------------------------------------------------------


class LotField(BaseModel):
    """Ét felt i lottets stamdata.

    Felterne er rigtige kolonner i ``lots`` og ikke nøgle/værdi-par. De har
    hver deres type, de bliver søgt og sorteret på, og de står i sidehovedet.
    Listen her findes, så frontenden kan tegne formularen uden at kende
    feltnavnene, præcis som den i forvejen får metrikkerne fra serveren.
    """

    id: str
    label: str
    type: Literal["text", "number", "datetime"] = "text"
    unit: str | None = None
    hint: str | None = None
    required: bool = Field(
        default=False,
        description=(
            "Om feltet skal være udfyldt, før lottet regnes for fuldstændigt. "
            "Ikke det samme som at det skal udfyldes ved oprettelsen: kg ind "
            "kendes ofte først, når partiet er kørt igennem."
        ),
    )
    readonly: bool = Field(
        default=False,
        description="Sættes af systemet og kan ikke rettes. Vises stadig.",
    )
    source: Literal["order", "operator", "system"] = Field(
        default="operator",
        description=(
            "Hvem feltet kommer fra. Ordrekontoret ved, hvad der skal køres; "
            "operatøren ved, hvad der faktisk skete. Skærmen viser de to som "
            "hver sin blok, så ingen retter i det, ordren har bestemt."
        ),
    )


# Rækkefølgen er driftsrapportens egen under "Ordre". Operatøren udfylder i
# dag det samme skema i hånden, og en anden rækkefølge på skærmen ville gøre
# to opgaver ud af én.
#
# De fem påkrævede er dem, driftsrapporten selv holder øje med: uden ordre,
# rapport, kg ind, item og lot ind står der "Mangler ..." i arket i stedet for
# "Alt OK". Det er deres regel, ikke min, og den er skrevet af, som den er.
LOT_FIELDS: list[LotField] = [
    LotField(id="order_no", label="Ordre nr.", required=True, source="order",
             readonly=True),
    LotField(id="lot_no", label="Ind lot nr.", required=True, source="order",
             readonly=True,
             hint="Partiet, der køres. Følger med ordren og kan ikke ændres."),
    LotField(id="item_no", label="Ind item nr.", required=True, source="order",
             readonly=True),
    LotField(id="variety", label="Varietet", source="order", readonly=True),
    LotField(id="line", label="Linje", source="order", readonly=True,
             hint="Hvilken renselinje partiet kører på."),
    LotField(id="report_no", label="Rapport nr.", required=True),
    LotField(id="input_kg", label="Indgangs kg", type="number", unit="kg",
             required=True, hint="Det, der faktisk blev vejet ind."),
    LotField(id="started_by", label="Initialer"),
    LotField(id="started_at", label="Start", type="datetime", readonly=True,
             source="system"),
    LotField(id="ended_at", label="Slut", type="datetime"),
    LotField(id="note", label="Bemærkning"),
]

LOT_FIELD_BY_ID = {field.id: field for field in LOT_FIELDS}

#: Det, ordren bestemmer. Kopieres over på kørslen ved oprettelsen og rettes
#: ikke af operatøren: retter man varieteten på kørslen, men ikke på ordren,
#: står der to forskellige svar på det samme spørgsmål.
ORDER_OWNED_FIELDS = [f.id for f in LOT_FIELDS if f.source == "order"]

#: Felter, en operatør kan rette efter oprettelsen.
EDITABLE_LOT_FIELDS = [
    f.id for f in LOT_FIELDS if f.source == "operator" and not f.readonly
]


def test_types_for(process_id: str) -> list[str]:
    process = PROCESS_BY_ID.get(process_id)
    return list(process.test_types) if process else []


def is_valid_scope(process_id: str, test_type_id: str) -> bool:
    """Om kombinationen overhovedet findes.

    Databasen har den samme regel som en CHECK-constraint. Den står to steder,
    fordi den ene giver et brugbart svar til den, der taster forkert, og den
    anden er den, der stadig gælder, hvis nogen skriver udenom API'et.
    """
    return test_type_id in test_types_for(process_id)


def metrics_for(test_type_id: str) -> list[Metric]:
    test_type = TEST_TYPES.get(test_type_id)
    return list(test_type.metrics) if test_type else []


def metric_ids(test_type_id: str) -> set[str]:
    return {metric.id for metric in metrics_for(test_type_id)}


def primary_metric(test_type_id: str) -> Metric | None:
    """Testtypens første hovedtal.

    En testtype med to fordelinger har ét hovedtal pr. gruppe. Den her giver
    det første, altså det der står øverst, og det er stadig det rigtige svar
    for de testtyper, der kun har én fordeling.
    """
    return next((m for m in metrics_for(test_type_id) if m.primary), None)


def groups_for(test_type_id: str) -> list[MetricGroup]:
    test_type = TEST_TYPES.get(test_type_id)
    return list(test_type.groups) if test_type else []
