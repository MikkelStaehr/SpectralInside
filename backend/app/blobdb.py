"""Læser VideometerLabs blob-samlinger.

En .blobdb er en SQLite-database. Det står ikke i Videometers manualer, men
filerne begynder med "SQLite format 3", og skemaet er læsbart. Vi læser den
udelukkende skrivebeskyttet og skriver aldrig til den.

Fordi strukturen er udokumenteret, kan den ændre sig ved en opdatering af
VideometerLab. Derfor tjekkes metadata_t.version, og læseren stopper med en
tydelig fejl ved en ukendt version. Alternativet er at vise forkerte tal, og
det er værre end at vise ingen.

Skema pr. version 7:

    blobs_t          id, blob_id, blob_data (HIPS), uri
    thumbnails_t     fk_blob_id, mapping, image_data (PNG)
    labels_t         id, name, number, colorint, weight_density, pose_factor
    blob_labels_map  fk_blob_id, fk_label_id, type, confidence, fk_classifier_id
    classifiers_t    id, classifier_id, name
    metadata_t       key, value
    features_t       navn og parametre for beregnede features
    calc_features_t  featureværdier pr. blob
"""

from __future__ import annotations

import re
import sqlite3
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from pathlib import Path

from . import config

UNKNOWN_CLASS = "Unknown"

# Filnavnet er den eneste kilde til, hvad en scanning er. Blob-samlingen selv
# gemmer hverken opskrift, lot eller hvem der kørte den: classifiers_t.name er
# altid "Unknown", og metadata_t indeholder kun skemaversionen.
#
#   <opskrift>_<lot>_<initialer>_<DDMMYYYY>
#   Purity_200_Koriander_HE_06082026
#
# Lotdelen kan selv indeholde underscores og artsnavne, så der læses bagfra:
# dato, initialer, og opskriften som første led.
_NAME = re.compile(
    r"^(?P<recipe>[^_]+)_(?P<lot>.+)_(?P<operator>[A-Za-zÆØÅæøå]{2,4})_(?P<date>\d{8})$"
)


class BlobDbError(RuntimeError):
    """Filen kunne ikke læses, eller skemaet er ukendt."""


@dataclass
class ClassCount:
    name: str
    count: int


@dataclass
class ScanSummary:
    id: str
    filename: str
    recipe: str | None
    sample: str | None
    operator: str | None
    scanned_on: date | None
    blob_count: int
    labelled_count: int
    unknown_count: int
    unknown_share: float
    classes: list[ClassCount] = field(default_factory=list)
    classifier: str | None = None
    size_bytes: int = 0
    modified_at: datetime | None = None


@dataclass
class BlobRow:
    blob_id: str
    predicted: str | None
    reference: str | None
    confidence: float | None
    corrected: bool


def _connect(path: Path) -> sqlite3.Connection:
    """Skrivebeskyttet forbindelse.

    Prøver almindelig read-only først. Ligger filen på et drev, hvor SQLite
    ikke må oprette sine hjælpefiler, falder vi tilbage til immutable, som
    slet ikke rører disken.
    """
    for uri in (f"file:{path}?mode=ro", f"file:{path}?mode=ro&immutable=1"):
        try:
            conn = sqlite3.connect(uri, uri=True, timeout=5)
            conn.row_factory = sqlite3.Row
            conn.execute("SELECT 1 FROM sqlite_master LIMIT 1")
            return conn
        except sqlite3.Error:
            continue
    raise BlobDbError(f"Kunne ikke åbne {path.name} skrivebeskyttet")


def _check_version(conn: sqlite3.Connection, filename: str) -> int:
    try:
        row = conn.execute(
            "SELECT value FROM metadata_t WHERE key = 'version'"
        ).fetchone()
    except sqlite3.Error as exc:
        raise BlobDbError(
            f"{filename} ligner ikke en blob-samling: {exc}"
        ) from exc

    version = int(row["value"]) if row and str(row["value"]).isdigit() else -1
    if version not in config.SUPPORTED_BLOBDB_VERSIONS:
        known = ", ".join(str(v) for v in sorted(config.SUPPORTED_BLOBDB_VERSIONS))
        raise BlobDbError(
            f"{filename} har skemaversion {version}. Læseren kender kun {known}. "
            "VideometerLab kan have ændret formatet, så tallene er ikke til at "
            "stole på, før læseren er gennemgået."
        )
    return version


@dataclass
class ParsedName:
    recipe: str | None = None
    lot: str | None = None
    operator: str | None = None
    scanned_on: date | None = None


def parse_name(stem: str) -> ParsedName:
    """Trækker opskrift, lot, initialer og dato ud af filnavnet."""
    match = _NAME.match(stem)
    if not match:
        return ParsedName()

    raw = match.group("date")
    try:
        scanned = datetime.strptime(raw, "%d%m%Y").date()
    except ValueError:
        scanned = None

    return ParsedName(
        recipe=match.group("recipe") or None,
        lot=match.group("lot") or None,
        operator=match.group("operator"),
        scanned_on=scanned,
    )


def _scan_id(path: Path) -> str:
    return path.stem


def list_files() -> list[Path]:
    if not config.BLOBDB_DIR.is_dir():
        return []
    return sorted(
        config.BLOBDB_DIR.glob("*.blobdb"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )


def resolve(scan_id: str) -> Path:
    """Slår et scan-id op i den konfigurerede mappe.

    Navnet bruges aldrig direkte som sti, så en forespørgsel ikke kan pege
    uden for mappen.
    """
    for path in list_files():
        if _scan_id(path) == scan_id:
            return path
    raise FileNotFoundError(scan_id)


def summarise(path: Path) -> ScanSummary:
    stat = path.stat()
    parsed = parse_name(path.stem)

    conn = _connect(path)
    try:
        _check_version(conn, path.name)

        blob_count = conn.execute("SELECT COUNT(*) FROM blobs_t").fetchone()[0]
        rows = conn.execute(
            """
            SELECT l.name AS name, COUNT(*) AS n
            FROM blob_labels_map m
            JOIN labels_t l ON l.id = m.fk_label_id
            WHERE m.type = 'prediction'
            GROUP BY l.name
            ORDER BY n DESC
            """
        ).fetchall()
        classes = [ClassCount(name=r["name"], count=r["n"]) for r in rows]

        labelled = sum(c.count for c in classes)
        unknown = sum(c.count for c in classes if c.name == UNKNOWN_CLASS)

        classifier_row = conn.execute(
            "SELECT name FROM classifiers_t ORDER BY id LIMIT 1"
        ).fetchone()
        classifier = classifier_row["name"] if classifier_row else None
    finally:
        conn.close()

    return ScanSummary(
        id=_scan_id(path),
        filename=path.name,
        recipe=parsed.recipe,
        sample=parsed.lot,
        operator=parsed.operator,
        scanned_on=parsed.scanned_on,
        blob_count=blob_count,
        labelled_count=labelled,
        unknown_count=unknown,
        unknown_share=(unknown / labelled) if labelled else 0.0,
        classes=classes,
        classifier=classifier,
        size_bytes=stat.st_size,
        modified_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
    )


def blobs(
    path: Path,
    limit: int = 200,
    offset: int = 0,
    predicted: str | None = None,
    only_corrected: bool = False,
) -> list[BlobRow]:
    """Blobs i samlingen med både modellens gæt og operatørens rettelse."""
    conn = _connect(path)
    try:
        _check_version(conn, path.name)

        where: list[str] = []
        params: list[object] = []
        if predicted:
            where.append("p.name = ?")
            params.append(predicted)
        if only_corrected:
            where.append("r.name IS NOT NULL AND r.name <> p.name")

        clause = f"WHERE {' AND '.join(where)}" if where else ""
        params.extend([limit, offset])

        rows = conn.execute(
            f"""
            SELECT b.blob_id                AS blob_id,
                   p.name                   AS predicted,
                   r.name                   AS reference,
                   pm.confidence            AS confidence
            FROM blobs_t b
            LEFT JOIN blob_labels_map pm
                   ON pm.fk_blob_id = b.id AND pm.type = 'prediction'
            LEFT JOIN labels_t p ON p.id = pm.fk_label_id
            LEFT JOIN blob_labels_map rm
                   ON rm.fk_blob_id = b.id AND rm.type = 'reference'
            LEFT JOIN labels_t r ON r.id = rm.fk_label_id
            {clause}
            ORDER BY b.id
            LIMIT ? OFFSET ?
            """,
            params,
        ).fetchall()
    finally:
        conn.close()

    return [
        BlobRow(
            blob_id=row["blob_id"],
            predicted=row["predicted"],
            reference=row["reference"],
            confidence=row["confidence"],
            corrected=bool(
                row["reference"] and row["reference"] != row["predicted"]
            ),
        )
        for row in rows
    ]


def confusion(path: Path) -> list[tuple[str, str, int]]:
    """Modellens gæt holdt op mod operatørens rettelse, som (ref, gæt, antal).

    Det er en rigtig confusion matrix, men målt på produktionsdata frem for på
    krydsvalidering under træningen. Kun blobs, hvor nogen faktisk har sat en
    referenceklasse, tæller med. Resten ved vi ikke sandheden om.
    """
    conn = _connect(path)
    try:
        _check_version(conn, path.name)
        rows = conn.execute(
            """
            SELECT r.name AS reference, p.name AS predicted, COUNT(*) AS n
            FROM blobs_t b
            JOIN blob_labels_map rm ON rm.fk_blob_id = b.id AND rm.type = 'reference'
            JOIN labels_t r ON r.id = rm.fk_label_id
            JOIN blob_labels_map pm ON pm.fk_blob_id = b.id AND pm.type = 'prediction'
            JOIN labels_t p ON p.id = pm.fk_label_id
            GROUP BY r.name, p.name
            """
        ).fetchall()
    finally:
        conn.close()

    return [(r["reference"], r["predicted"], r["n"]) for r in rows]


# Hvert bånd i en blob ligger som et selvstændigt PNG inde i HIPS-dataen.
# Det står ikke i Videometers dokumentation, men 94 % af en blobs bytes er
# PNG-billeder, ét pr. bånd, i båndrækkefølge. De kan derfor klippes ud og
# serveres direkte uden at afkode noget proprietært.
_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
_PNG_END = b"IEND\xaeB`\x82"

# Centerbølgelængder for VideometerLab 4, i båndrækkefølge.
# Kilde: VideometerLab Manual, appendiks 10.1.
BAND_WAVELENGTHS = [
    365, 405, 430, 450, 470, 490, 515, 540, 570, 590,
    630, 645, 660, 690, 780, 850, 880, 940, 970,
]


def _split_pngs(data: bytes) -> list[bytes]:
    images: list[bytes] = []
    offset = 0
    while (start := data.find(_PNG_MAGIC, offset)) != -1:
        end = data.find(_PNG_END, start)
        if end == -1:
            break
        end += len(_PNG_END)
        images.append(data[start:end])
        offset = end
    return images


def _blob_bytes(path: Path, blob_id: str) -> bytes | None:
    conn = _connect(path)
    try:
        _check_version(conn, path.name)
        row = conn.execute(
            "SELECT blob_data FROM blobs_t WHERE blob_id = ? LIMIT 1", (blob_id,)
        ).fetchone()
    finally:
        conn.close()
    return bytes(row[0]) if row and row[0] else None


def band_count(path: Path, blob_id: str) -> int:
    data = _blob_bytes(path, blob_id)
    return len(_split_pngs(data)) if data else 0


def band(path: Path, blob_id: str, index: int) -> bytes | None:
    """Ét bånd som PNG. Gråtone, samme opløsning som frøet blev beskåret i."""
    data = _blob_bytes(path, blob_id)
    if not data:
        return None
    images = _split_pngs(data)
    return images[index] if 0 <= index < len(images) else None


def bands(path: Path, blob_id: str) -> list[bytes]:
    """Alle bånd for ét frø, i båndrækkefølge, på én læsning.

    `band()` åbner filen forfra hver gang, hvilket er fint, når browseren beder
    om ét bånd ad gangen. Connectoren skal have dem alle 19, og så bliver det
    til tyve åbninger og tyve gange den samme blob læst op. Den her læser
    blobben én gang og klipper.
    """
    data = _blob_bytes(path, blob_id)
    return _split_pngs(data) if data else []


def thumbnail(path: Path, blob_id: str) -> bytes | None:
    """PNG-miniaturen for en blob. Ligger færdig i databasen."""
    conn = _connect(path)
    try:
        _check_version(conn, path.name)
        row = conn.execute(
            """
            SELECT t.image_data AS data
            FROM thumbnails_t t
            JOIN blobs_t b ON b.id = t.fk_blob_id
            WHERE b.blob_id = ?
            LIMIT 1
            """,
            (blob_id,),
        ).fetchone()
    finally:
        conn.close()

    return bytes(row["data"]) if row and row["data"] else None
