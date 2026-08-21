"""API-kontrakter."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

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


class Health(BaseModel):
    status: Literal["ok", "degraded"]
    version: str
    content_dir: str
    procedures_found: int
    problems: list[str] = []
