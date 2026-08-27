"""API-kontrakter."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

from .lots import LotField, Process, ProcessId, StampId, TestType, TestTypeId

MaintenanceState = Literal["ok", "due_soon", "overdue", "never", "event_driven"]


class Step(BaseModel):
    index: int
    title: str
    body: str = Field(description="Markdown. Renderes i frontenden.")
    wait_seconds: int | None = Field(
        default=None,
        description=(
            "Ventetid i sekunder. Skrives som {wait=60} i trinnets overskrift. "
            "I guiden vises en nedtælling, og man kan først gå videre bagefter."
        ),
    )


class ProcedureSummary(BaseModel):
    id: str
    title: str
    lead: str = ""
    order: int = 999
    trigger: str | None = None
    duration: str | None = None
    icon: str | None = Field(
        default=None,
        description="Lucide-ikonnavn i kebab-case, fx 'scan-line'. Frontenden falder tilbage til et standardikon.",
    )
    category: Literal["wiki", "vedligehold"] = Field(
        default="wiki",
        description=(
            "Hvor guiden hører hjemme. Wikien fortæller hvordan man gør. "
            "Vedligehold fortæller hvornår noget skal gøres, og linker til "
            "wikien for fremgangsmåden."
        ),
    )
    daily: bool = Field(
        default=False,
        description=(
            "Skal køres én gang om dagen. Vises som guide ved dagens første "
            "login, indtil den er registreret udført."
        ),
    )
    step_count: int
    updated_at: datetime


class Procedure(ProcedureSummary):
    intro: str = ""
    steps: list[Step] = []


class MaintenanceTask(BaseModel):
    id: str
    title: str
    interval_days: int | None = None
    warn_days: int | None = Field(
        default=None,
        description=(
            "Hvor mange dage før forfald opgaven begynder at melde sig. "
            "Udeladt betyder standardværdien. En kvartalsopgave, der først "
            "varsler dagen før, er ubrugelig."
        ),
    )
    procedure: str | None = None
    why: str = ""
    note: str | None = None
    also_when: list[str] = []


class MaintenanceStatus(BaseModel):
    task: MaintenanceTask
    state: MaintenanceState
    last_done_at: datetime | None = None
    last_done_by: str | None = None
    due_at: datetime | None = None
    days_until_due: int | None = None


class MaintenanceCompletion(BaseModel):
    done_by: str = Field(min_length=1, max_length=80)
    note: str | None = Field(default=None, max_length=500)
    done_at: date | None = Field(
        default=None,
        description=(
            "Datoen opgaven faktisk blev udført. Udeladt betyder nu. "
            "Næste forfald tælles fra denne dato."
        ),
    )


class MaintenanceLogEntry(BaseModel):
    id: int
    task_id: str
    done_at: datetime
    done_by: str
    note: str | None = None


class Message(BaseModel):
    id: int
    body: str
    author: str
    created_at: datetime


class NewMessage(BaseModel):
    body: str = Field(min_length=1, max_length=4000)
    author: str = Field(min_length=1, max_length=80)


class DailyStatus(BaseModel):
    procedure_id: str
    title: str
    day: str = Field(description="Dagen der spørges til, som YYYY-MM-DD.")
    done: bool
    done_by: str | None = None
    done_at: datetime | None = None


class DailyCompletion(BaseModel):
    done_by: str = Field(min_length=1, max_length=80)


class Operator(BaseModel):
    initials: str
    name: str | None = None
    role: Literal["analytiker", "udvikler"] = Field(
        default="analytiker",
        description=(
            "Styrer om analysedelen vises. Det er oprydning, ikke adgangs"
            "kontrol: der er ingen indlogning, og intet er beskyttet."
        ),
    )


# --- Scanninger -------------------------------------------------------------


class ClassCount(BaseModel):
    name: str
    count: int


class ScanSummary(BaseModel):
    id: str
    filename: str
    recipe: str | None = Field(
        default=None,
        description="Opskriften, læst af filnavnets første led. Står ikke i selve blob-samlingen.",
    )
    sample: str | None = None
    operator: str | None = None
    scanned_on: date | None = None
    blob_count: int
    labelled_count: int
    unknown_count: int
    unknown_share: float
    classes: list[ClassCount] = []
    classifier: str | None = None
    size_bytes: int = 0
    modified_at: datetime | None = None


class BlobRow(BaseModel):
    blob_id: str
    predicted: str | None = None
    reference: str | None = None
    confidence: float | None = None
    corrected: bool = False


# --- Arbejdsbord ------------------------------------------------------------


class ScanCounts(BaseModel):
    yesterday: int
    today: int
    last_7_days: int


class RecentScan(BaseModel):
    id: str
    recipe: str | None = None
    sample: str | None = None
    operator: str | None = None
    scanned_on: date | None = None
    blob_count: int


class MaintenanceReminder(BaseModel):
    overdue: int = 0
    due_soon: int = 0
    never: int = 0
    titles: list[str] = Field(
        default_factory=list,
        description="Navnene på det, der kræver handling, så påmindelsen kan være konkret.",
    )

    @property
    def total(self) -> int:
        return self.overdue + self.due_soon + self.never


class Dashboard(BaseModel):
    message: "Message | None" = None
    reminder: MaintenanceReminder
    scans: ScanCounts
    recent: list[RecentScan] = []


# --- Operatørvisning --------------------------------------------------------


class DisplaySample(BaseModel):
    id: str
    sample: str | None = None
    analyst: str | None = None
    scanned_on: date | None = None
    total_seeds: int
    focus_count: int
    focus_share: float
    unplaced_count: int = Field(
        description=(
            "Frø modellen ikke kunne placere. Vises, fordi et lavt fokustal "
            "ikke betyder noget, hvis halvdelen af prøven er uafklaret."
        )
    )


class DisplayDetail(DisplaySample):
    focus_class: str
    focus_label: str
    blobs: list["BlobRow"] = []


class ConfusionCell(BaseModel):
    reference: str
    predicted: str
    count: int


class ConfusionMatrix(BaseModel):
    labels: list[str] = Field(description="Klasser i både rækker og kolonner.")
    cells: list[ConfusionCell] = []
    total: int = 0
    correct: int = 0
    scans_included: int = 0
    note: str = Field(
        default="",
        description="Hvad tallene dækker, så de ikke bliver læst som noget andet.",
    )


class Band(BaseModel):
    index: int
    wavelength: int | None = Field(
        default=None,
        description="Centerbølgelængde i nm. Udledt af båndrækkefølgen, ikke læst af filen.",
    )
    label: str


class BandSet(BaseModel):
    blob_id: str
    count: int
    bands: list[Band] = []
    note: str = ""


class ClassifierVersion(BaseModel):
    name: str
    version: str | None = None
    filename: str
    classes: list[str] = []
    size_bytes: int
    modified_at: datetime


# --- Lots og prøver ---------------------------------------------------------
#
# Operatørskærmen i produktionen. Domænet, altså hvilke processer der findes,
# hvilke testtyper der hører til hver af dem, og hvilke metrikker en testtype
# har, står i lots.py og kommer ud gennem LotMeta. Frontenden gentager det
# ikke.


class LotMeta(BaseModel):
    processes: list[Process] = []
    test_types: list[TestType] = []
    lines: list[Line] = Field(
        default_factory=list,
        description=(
            "Anlæggene, i den rækkefølge de står på forsiden. Fra "
            "content/lines.yaml."
        ),
    )
    lot_fields: list[LotField] = Field(
        default_factory=list,
        description=(
            "Stamdatafelterne i driftsrapportens rækkefølge. Frontenden tegner "
            "formularen ud fra dem og kender derfor hverken feltnavne eller "
            "hvilke der er påkrævede."
        ),
    )
    flat_threshold: float = Field(
        description=(
            "Absolut grænse for hvornår en ændring vises som uændret. Gælder "
            "kun sammen med relative_threshold: begge skal være underskredet."
        )
    )
    relative_threshold: float = Field(
        description=(
            "Relativ grænse, som andel af den foregående værdi. Uden den "
            "rammer en fælles absolut grænse skævt, når metrikkerne ligger i "
            "vidt forskellige størrelsesordener: 0,25 -> 0,20 er kun 0,05, "
            "men en femtedel af værdien, og det er en rigtig ændring."
        )
    )


class LotSample(BaseModel):
    id: int
    lot_no: str
    process: ProcessId
    test_type: TestTypeId
    seq: int = Field(
        description=(
            "Operatørens prøvenummer, løbende inden for (lot, proces, "
            "testtype). Ikke VideometerLabs id, det står i scan_id."
        )
    )
    taken_at: datetime
    taken_by: str | None = None
    adjustment: str | None = Field(
        default=None,
        description=(
            "Hvad der blev skruet på, før prøven blev taget. Uden den er en "
            "forbedring bare et tal, der ændrede sig af sig selv."
        ),
    )
    scan_id: str | None = Field(
        default=None,
        description="VideometerLabs egen reference. Åbner billedrækken, hvis den findes.",
    )
    acknowledged_at: datetime | None = None
    acknowledged_by: str | None = None
    metrics: dict[str, float] = {}


class Line(BaseModel):
    """Ét anlæg.

    Forsiden i produktionen har ét spor per anlæg. Listen kommer fra
    content/lines.yaml, så anlæggene er en erklæret liste og ikke fritekst:
    var de fritekst, kunne det samme anlæg staves "Linje 2", "linje 2" og "L2",
    og så stod der tre spor på skærmen for det samme anlæg.
    """

    id: str
    label: str
    lead: str | None = None


class Order(BaseModel):
    """En ordre fra ordrekontoret.

    Kontoret bestemmer, hvad der skal køres. Operatøren vælger ordren og taster
    ikke et ordrenummer: et tastet nummer kan staves på tre måder, og så kan
    ingenting afstemmes med kontoret bagefter.
    """

    order_no: str
    lot_no: str = Field(description="Partiet, der skal køres. Bliver kørslens lot_no.")
    item_no: str | None = None
    variety: str | None = None
    line: str | None = None
    planned_kg: float | None = Field(
        default=None,
        description=(
            "Kontorets tal. Det, der faktisk blev vejet ind, står på kørslen, "
            "og de to er ikke det samme."
        ),
    )
    planned_start: datetime | None = Field(
        default=None,
        description=(
            "Hvornår ordren er planlagt til at køre. Køen sorteres efter den. "
            "Uden den falder rækkefølgen tilbage på, hvornår ordren blev lagt "
            "ind, og det er stadig en rækkefølge, bare ikke en plan."
        ),
    )
    note: str | None = None
    created_at: datetime
    created_by: str | None = None
    cancelled_at: datetime | None = None
    started_lot: str | None = Field(
        default=None,
        description=(
            "Kørslen på ordren, hvis den er startet. Udledt og ikke gemt: en "
            "status, der skal vedligeholdes to steder, kommer til at lyve."
        ),
    )
    started_at: datetime | None = None


class NewOrder(BaseModel):
    """Ordrekontorets ende af snittet.

    Indtil integrationen findes, oprettes ordrer gennem det samme kald, som
    kontoret vil bruge. Så er der ingen bagdør at rydde op i bagefter.
    """

    order_no: str = Field(min_length=1, max_length=60)
    lot_no: str = Field(min_length=1, max_length=60)
    item_no: str | None = Field(default=None, max_length=60)
    variety: str | None = Field(default=None, max_length=120)
    line: str | None = Field(
        default=None,
        max_length=60,
        description=(
            "Anlægget, ordren skal køre på. Skal være et id fra "
            "content/lines.yaml, ellers havner ordren uden for sporene på "
            "forsiden."
        ),
    )
    planned_kg: float | None = Field(default=None, ge=0)
    planned_start: datetime | None = None
    note: str | None = Field(default=None, max_length=500)
    created_by: str | None = Field(default=None, max_length=80)


class LotSummary(BaseModel):
    lot_no: str
    variety: str | None = None
    item_no: str | None = None
    line: str | None = None
    started_at: datetime
    started_by: str | None = None
    # Stamdata fra driftsrapportens "Ordre"-blok.
    order_no: str | None = None
    report_no: str | None = None
    input_kg: float | None = None
    ended_at: datetime | None = None
    note: str | None = None
    missing: list[str] = Field(
        default_factory=list,
        description=(
            "Påkrævede stamdatafelter, der endnu ikke er udfyldt. Driftsrapporten "
            "har den samme kontrol og skriver 'Mangler Ordre Nr' i stedet for "
            "'Alt OK'. Det er en huskeliste, ikke en spærring: kg ind kendes "
            "først, når partiet er kørt igennem."
        ),
    )
    stamp: StampId | None = None
    stamped_at: datetime | None = None
    stamped_by: str | None = None
    stamp_note: str | None = None
    sample_count: int = 0
    unacknowledged_count: int = Field(
        default=0,
        description=(
            "Resultater ingen har kvitteret for. Driver alarmen, også på de "
            "lots der ikke er valgt, så et nyt resultat på et andet lot kan "
            "ses fra strippen i bunden."
        ),
    )
    last_sample_at: datetime | None = None
    last_activity: datetime | None = Field(
        default=None,
        description=(
            "Sidste gang der skete noget på lottet: en prøve, et stempel, en "
            "opsætning, eller starten selv. Listen sorteres efter den, fordi "
            "det lot, der lige har fået et resultat, er det nogen venter på."
        ),
    )


class LotDetail(LotSummary):
    samples: list[LotSample] = []


class NewLot(BaseModel):
    """Start en kørsel på en ordre.

    Ordren bestemmer partiet, varen og varieteten, så de felter står ikke her:
    de kopieres fra ordren på serveren. Kunne klienten sende dem med, kunne den
    også sende noget andet end det, kontoret har bestemt, og så står der to
    forskellige svar på det samme spørgsmål.

    Resten er operatørens, og kun ordrenummeret spærrer. Rapport nr. og kg ind
    er markeret som påkrævede i ``LotField``, men det gælder for den
    *fuldstændige* kørsel: den, der skal have partiet i gang, kender ikke kg
    ind endnu, og en formular, der spærrer, bliver udfyldt med gætterier. Hvad
    der mangler, står på kørslen bagefter.
    """

    order_no: str = Field(min_length=1, max_length=60)
    report_no: str | None = Field(default=None, max_length=60)
    input_kg: float | None = Field(default=None, ge=0)
    started_by: str | None = Field(default=None, max_length=80)
    ended_at: datetime | None = None
    note: str | None = Field(default=None, max_length=500)


class LotUpdate(BaseModel):
    """Rettelse af det, operatøren har ansvar for.

    Alt er valgfrit, og kun det, kaldet nævner, bliver rørt. En kørsel får sine
    oplysninger lidt ad gangen, så en formular, der sendte hele objektet, ville
    rydde det, den ikke kendte.

    Ordrens felter står ikke her. Retter man varieteten på kørslen, men ikke på
    ordren, står der to forskellige svar på det samme spørgsmål, og så er det
    ordrekontoret, der skal rette ordren.
    """

    report_no: str | None = Field(default=None, max_length=60)
    input_kg: float | None = Field(default=None, ge=0)
    started_by: str | None = Field(default=None, max_length=80)
    ended_at: datetime | None = None
    note: str | None = Field(default=None, max_length=500)


class NewSample(BaseModel):
    process: ProcessId
    test_type: TestTypeId
    metrics: dict[str, float] = Field(
        description=(
            "Metrik-id fra LotMeta til værdi. Ukendte navne afvises frem for "
            "at blive gemt og aldrig vist."
        )
    )
    taken_by: str | None = Field(default=None, max_length=80)
    adjustment: str | None = Field(default=None, max_length=500)
    scan_id: str | None = Field(default=None, max_length=200)
    taken_at: datetime | None = Field(
        default=None,
        description="Tidspunktet prøven faktisk blev taget. Udeladt betyder nu.",
    )


# --- Opsætning af linjen ----------------------------------------------------
#
# Maskinerne fortæller ikke selv, hvordan de er sat op, så operatøren
# registrerer det pr. lot. Hvilke indstillinger der findes, står i
# content/machine-setup.yaml og kan rettes uden kodeændringer.


class SetupSetting(BaseModel):
    id: str
    label: str
    type: Literal["number", "text", "choice"] = "number"
    unit: str | None = None
    options: list[str] = []
    hint: str | None = None


class SetupGroup(BaseModel):
    id: str
    title: str
    lead: str = ""
    settings: list[SetupSetting] = []


class SetupOptions(BaseModel):
    groups: list[SetupGroup] = []


class SetupValue(BaseModel):
    setting_id: str
    value: str


class LotSetup(BaseModel):
    lot_no: str
    values: list[SetupValue] = []
    set_at: datetime | None = None
    set_by: str | None = None


class SetupUpdate(BaseModel):
    set_by: str = Field(min_length=1, max_length=80)
    values: list[SetupValue] = Field(
        description=(
            "De indstillinger, operatøren har sat flueben ved, med deres "
            "værdier. Erstatter hele opsætningen: fjerner man fluebenet, "
            "forsvinder værdien, i stedet for at blive stående usynligt."
        )
    )


class Acknowledgement(BaseModel):
    acknowledged_by: str = Field(min_length=1, max_length=80)


class LotStamp(BaseModel):
    stamp: StampId
    stamped_by: str = Field(min_length=1, max_length=80)
    note: str | None = Field(default=None, max_length=500)


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    content_dir: str
    procedures_found: int
    problems: list[str] = []
