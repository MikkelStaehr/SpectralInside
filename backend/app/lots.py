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

ProcessId = Literal["pre_cleaning", "cleaning", "post_cleaning"]
TestTypeId = Literal["purity", "cleaning_damage"]
StampId = Literal["approved", "rejected"]


class Metric(BaseModel):
    id: str
    label: str
    unit: str = "%"
    primary: bool = Field(
        default=False,
        description="Tallet der sættes stort på skærmen. Præcis ét pr. testtype.",
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
    metrics: list[Metric]


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
}


# Rækkefølgen er den fysiske rækkefølge på linjen. Skærmen læses som en kæde,
# så listen her er også den, den tegnes i.
#
# Processerne har ikke en forklarende undertekst. Operatøren ved godt, hvad
# der sker i Cleaning, hun står ved maskinen, og en linje der forklarer det
# koster plads på hvert eneste kort hele dagen.
PROCESSES: list[Process] = [
    Process(id="pre_cleaning", step=1, label="Pre Cleaning", test_types=["purity"]),
    Process(id="cleaning", step=2, label="Cleaning", test_types=["cleaning_damage"]),
    Process(
        id="post_cleaning",
        step=3,
        label="Post Cleaning",
        test_types=["purity", "cleaning_damage"],
        stamp=True,
    ),
]

PROCESS_BY_ID = {process.id: process for process in PROCESSES}


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
    return next((m for m in metrics_for(test_type_id) if m.primary), None)
