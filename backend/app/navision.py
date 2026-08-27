"""Navision. Produktionsordren, oversat til vores.

Ordrekontoret skriver et ordrenummer, trykker hent, og resten udfyldes. Det er
hele formålet, og det, der gør det muligt, er at koblingen står ét sted: den
her fil. Navisions feltnavne breder sig ikke længere ind i applikationen, og
den dag et felt skifter nummer, er det én linje.

**Transporten er ikke besluttet.** Vi ved ikke endnu, om ordrerne kommer ad en
OData-tjeneste, en SQL-visning, en fildrop eller noget fjerde. Derfor er der en
kilde med ét kald, ``fetch(order_no)``, og indtil den rigtige findes, læser
standardkilden fra en fil. Det er ikke en attrap: en Navision-eksport lagt i
``content/navision-orders.json`` virker fra i dag, og når snittet er på plads,
skiftes kilden ud uden at andet røres.

Felterne er skrevet af fra en åbnet produktionsordre. Tallet i parentes er
Navisions eget feltnummer, så de kan slås op igen.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

from . import config


class NavisionError(RuntimeError):
    """Ordren kunne ikke hentes.

    Teksten havner hos ordrekontoret. Den skal sige, hvad de kan gøre, og ikke
    nævne filstier eller feltnumre — det hører til i loggen.
    """


@dataclass
class NavisionOrder:
    """En produktionsordre, som vi bruger den.

    Kun det, der betyder noget her. Navision har over hundrede felter på en
    ordre, og de fleste er ikke vores: posteringsgrupper, nummerserier og
    varesegmenter siger intet om, hvad der skal køres på en renselinje.
    """

    #: No. (2). Ordrenummeret. Det, kontoret slår op på.
    order_no: str
    #: Status (1). "Released", "Firm Planned", "Finished". Kun en frigivet
    #: ordre skal kunne sættes i gang på linjen.
    status: str | None = None
    #: Source No. (10). Varenummeret. Vores item_no.
    item_no: str | None = None
    #: Variant Code (50300).
    variant: str | None = None
    #: Description (3). Ser ud til at bære varekode og lot, adskilt af "/".
    description: str | None = None
    #: Routing No. (11). CLEAN2 og lignende. Oversættes til vores anlæg.
    routing_no: str | None = None
    #: Quantity (40). Sammen med Weight Type (50524), som siger brutto eller
    #: netto. Et tal uden den oplysning er ikke et vægttal, det er et tal.
    quantity: float | None = None
    weight_type: str | None = None
    #: Starting/Ending Date-Time (98/99).
    starting_at: datetime | None = None
    ending_at: datetime | None = None
    #: Due Date (24).
    due_date: datetime | None = None
    #: Location Code (32).
    location: str | None = None
    #: User ID (50309). Den, der oprettede ordren i Navision.
    created_by: str | None = None
    #: Last Date Modified (7). Grundlaget for "er der kommet en rettelse".
    #: Uden den skal vi sammenligne felt for felt for at vide, om noget
    #: har ændret sig, og så opdager vi det først, når nogen kigger.
    modified_at: datetime | None = None
    #: Alt det, vi ikke bruger. Gemmes, så en ordre kan slås op igen uden at
    #: hente den forfra, og så et felt kan tages i brug uden en ny hentning.
    raw: dict[str, Any] = field(default_factory=dict)


#: Navisions feltnavne til vores. Nøglen er, hvad kilden kalder feltet.
#:
#: Flere stavemåder pr. felt med vilje: en OData-tjeneste giver "No", en
#: SQL-visning giver "No_", og en CSV-eksport giver "No.". Vi ved ikke hvilken
#: endnu, så alle tre genkendes frem for at kilden skal normalisere først.
_FIELDS: dict[str, tuple[str, ...]] = {
    "order_no": ("No.", "No", "No_", "order_no", "ProductionOrderNo"),
    "status": ("Status", "status"),
    "item_no": ("Source No.", "Source No_", "SourceNo", "source_no", "item_no"),
    "variant": ("Variant Code", "Variant_Code", "VariantCode", "variant"),
    "description": ("Description", "description", "Search Description"),
    "routing_no": ("Routing No.", "Routing No_", "RoutingNo", "routing_no"),
    "quantity": ("Quantity", "quantity"),
    "weight_type": ("Weight Type", "Weight_Type", "WeightType", "weight_type"),
    "starting_at": ("Starting Date-Time", "Starting_Date_Time", "StartingDateTime"),
    "ending_at": ("Ending Date-Time", "Ending_Date_Time", "EndingDateTime"),
    "due_date": ("Due Date", "Due_Date", "DueDate"),
    "location": ("Location Code", "Location_Code", "LocationCode", "location"),
    "created_by": ("User ID", "User_ID", "UserId", "created_by"),
    "modified_at": ("Last Date Modified", "Last_Date_Modified", "LastDateModified"),
}

#: Datoformater, en eksport kan komme i. Navisions egen visning er dansk,
#: en OData-tjeneste er ISO, og en CSV kan være hvad som helst.
_DATE_FORMATS = (
    "%d-%m-%Y %H:%M",
    "%d-%m-%Y %H:%M:%S",
    "%d-%m-%Y",
    "%Y-%m-%d %H:%M",
    "%Y-%m-%d",
)


def _pick(record: dict[str, Any], names: tuple[str, ...]) -> Any:
    for name in names:
        if name in record and record[name] not in (None, ""):
            return record[name]
    return None


def _as_datetime(value: Any) -> datetime | None:
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return value
    text = str(value).strip()
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        pass
    for fmt in _DATE_FORMATS:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    # En dato, vi ikke kan læse, er ikke en fejl, der skal stoppe hentningen.
    # Resten af ordren er stadig brugbar, og feltet står tomt.
    return None


def _as_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    # Dansk tastede tal. Se parseDecimal i frontenden for den samme sag.
    text = str(value).strip().replace(" ", "").replace(".", "").replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return None


def parse(record: dict[str, Any]) -> NavisionOrder:
    """Én Navision-post til en ordre, vi kan bruge."""
    get = lambda key: _pick(record, _FIELDS[key])  # noqa: E731

    order_no = str(get("order_no") or "").strip()
    if not order_no:
        raise NavisionError("Posten fra Navision har intet ordrenummer.")

    return NavisionOrder(
        order_no=order_no,
        status=(str(get("status")).strip() if get("status") else None),
        item_no=(str(get("item_no")).strip() if get("item_no") else None),
        variant=(str(get("variant")).strip() if get("variant") else None),
        description=(str(get("description")).strip() if get("description") else None),
        routing_no=(str(get("routing_no")).strip() if get("routing_no") else None),
        quantity=_as_float(get("quantity")),
        weight_type=(str(get("weight_type")).strip() if get("weight_type") else None),
        starting_at=_as_datetime(get("starting_at")),
        ending_at=_as_datetime(get("ending_at")),
        due_date=_as_datetime(get("due_date")),
        location=(str(get("location")).strip() if get("location") else None),
        created_by=(str(get("created_by")).strip() if get("created_by") else None),
        modified_at=_as_datetime(get("modified_at")),
        raw=dict(record),
    )


class Source(Protocol):
    """Hvor ordrerne kommer fra. Ét kald, så den kan skiftes ud."""

    def fetch(self, order_no: str) -> NavisionOrder | None: ...


class FileSource:
    """Ordrer fra en fil på disk.

    Ikke en attrap. Navision kan eksportere, og en eksport lagt i
    ``content/navision-orders.json`` virker fra i dag: en liste af poster med
    Navisions egne feltnavne, præcis som de står på ordren.

    Filen læses ved hvert opslag. Lægger nogen en ny eksport, slår den
    igennem uden genstart — den samme regel som procedurer og wiki.
    """

    def fetch(self, order_no: str) -> NavisionOrder | None:
        path = config.NAVISION_FILE
        if not path.is_file():
            raise NavisionError(
                "Der er ingen forbindelse til Navision endnu. Læg en eksport i "
                "content/navision-orders.json, eller udfyld ordren i hånden."
            )

        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise NavisionError(
                "Navision-eksporten kunne ikke læses. Er filen hel?"
            ) from exc

        records = raw.get("orders", raw) if isinstance(raw, dict) else raw
        if not isinstance(records, list):
            raise NavisionError(
                "Navision-eksporten skal være en liste af ordrer."
            )

        wanted = order_no.strip().casefold()
        for record in records:
            if not isinstance(record, dict):
                continue
            found = _pick(record, _FIELDS["order_no"])
            if found and str(found).strip().casefold() == wanted:
                return parse(record)
        return None


#: Den kilde, applikationen bruger. Skiftes ud, når snittet til Navision er
#: besluttet — det er det ene sted, der skal røres.
source: Source = FileSource()


def fetch(order_no: str) -> NavisionOrder | None:
    return source.fetch(order_no)
