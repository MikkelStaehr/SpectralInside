"""Connectoren. Læser VideometerLabs blob-samlinger og skubber dem til Supabase.

Kører kun på den maskine, hvor filerne ligger, og kun når `UBS_SYNC` er sat.
Alle andre steder er den ikke aktiv, og applikationen læser blot det, der er
kommet op.

Det bærende princip fra README'en gælder her mere end noget andet sted i
koden:

    Applikationen må aldrig kunne påvirke måleprocessen.

Derfor: filerne åbnes udelukkende skrivebeskyttet, gennem den samme
`blobdb`-læser som resten af applikationen bruger, og der skrives aldrig noget
tilbage til VideometerLabs mapper. Connectoren er en læser, der kopierer.

Hvad der kommer med, og hvorfor ikke det hele:

  * **Stamdata og klassefordeling** for hver scanning. Nærmest gratis at flytte.
  * **En miniature pr. frø**, så scanningsbrowseren virker fra begge maskiner.
  * **De 19 bånd, kun for fokusklassen.** Det er de frø, produktionen skal se.
    Bånd for alle frø ville fylde omkring 23 gange så meget og blive set på af
    ingen.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timezone
from pathlib import Path

from . import blobdb, config, db

log = logging.getLogger(__name__)


class SyncResult:
    """Hvad en gennemgang nåede. Bruges til logning og til /api/health."""

    def __init__(self) -> None:
        self.checked = 0
        self.pushed = 0
        self.skipped = 0
        self.failed: list[str] = []
        self.capped: list[str] = []

    def __str__(self) -> str:
        text = (
            f"{self.checked} filer set, {self.pushed} lagt op, "
            f"{self.skipped} uændrede"
        )
        if self.failed:
            text += f", {len(self.failed)} fejlede"
        return text


def _unchanged(path: Path, known: dict) -> bool:
    """Er filen den samme, som den vi allerede har lagt op?

    Størrelse og tidsstempel er nok. Et indhold, der ændrer sig uden at nogen
    af delene gør, ville kræve, at VideometerLab skrev præcis lige så mange
    bytes tilbage i samme sekund, og det er ikke en fejlmåde, det er værd at
    betale for at udelukke.
    """
    row = known.get(path.stem)
    if row is None:
        return False

    stat = path.stat()
    if row["size_bytes"] != stat.st_size:
        return False

    stored = row["file_mtime"]
    if stored is None:
        return False

    mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
    # Postgres gemmer mikrosekunder, filsystemet er finere. Et sekunds slør
    # frem for en eksakt sammenligning, ellers ville hver eneste fil se ændret
    # ud ved hver gennemgang.
    return abs((stored - mtime).total_seconds()) < 1.0


def _bands_for(path: Path, blob_id: str) -> list[tuple[str, int, bytes]]:
    """De 19 bånd for ét frø, som (blob_id, indeks, PNG)."""
    return [
        (blob_id, index, png)
        for index, png in enumerate(blobdb.bands(path, blob_id))
        if png
    ]


def push_one(path: Path) -> None:
    """Læs én blob-samling og læg den op. Kaster, hvis filen ikke kan læses."""
    summary = blobdb.summarise(path)

    # Alle frø. Grænsen er sat højt med vilje: en scanning med mange tusinde
    # frø skal med hel, ellers passer tællingerne på arbejdsbordet ikke med
    # dem, VideometerLab viser.
    rows = blobdb.blobs(path, limit=100_000)

    blobs: list[dict[str, object]] = []
    bands: list[tuple[str, int, bytes]] = []
    focus_seen = 0

    for row in rows:
        entry: dict[str, object] = {
            "blob_id": row.blob_id,
            "predicted": row.predicted,
            "reference": row.reference,
            "confidence": row.confidence,
            "thumbnail": None,
        }
        if config.SYNC_THUMBNAILS:
            entry["thumbnail"] = blobdb.thumbnail(path, row.blob_id)
        blobs.append(entry)

        if config.SYNC_BANDS and row.predicted == config.FOCUS_CLASS:
            if focus_seen < config.SYNC_BAND_LIMIT:
                bands.extend(_bands_for(path, row.blob_id))
            focus_seen += 1

    if focus_seen > config.SYNC_BAND_LIMIT:
        log.warning(
            "%s har %d frø i fokusklassen, kun de første %d fik deres "
            "båndrække med. Hæv UBS_SYNC_BAND_LIMIT, hvis de skal med alle.",
            path.name,
            focus_seen,
            config.SYNC_BAND_LIMIT,
        )

    stat = path.stat()
    db.upsert_scan(
        scan={
            "id": summary.id,
            "filename": summary.filename,
            "recipe": summary.recipe,
            "lot": summary.sample,
            "operator": summary.operator,
            "scanned_on": summary.scanned_on,
            "blob_count": summary.blob_count,
            "labelled_count": summary.labelled_count,
            "unknown_count": summary.unknown_count,
            "classifier": summary.classifier,
            "size_bytes": stat.st_size,
            "file_mtime": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
            "source_machine": config.MACHINE_NAME,
            "synced_at": db.now(),
        },
        classes=[(c.name, c.count) for c in summary.classes],
        blobs=blobs,
        bands=bands,
    )


def run_once() -> SyncResult:
    """Gennemgå mappen én gang.

    En fil, der ikke kan læses, stopper ikke de andre. Den mest sandsynlige
    grund til, at én fil fejler, er, at VideometerLab står og skriver den lige
    nu, og så er den med ved næste gennemgang.
    """
    result = SyncResult()
    if not config.SYNC_ENABLED:
        return result

    try:
        known = db.known_scans()
    except db.DatabaseUnavailable:
        log.warning("Kunne ikke nå databasen, springer denne gennemgang over")
        return result

    for path in blobdb.list_files():
        result.checked += 1
        try:
            if _unchanged(path, known):
                result.skipped += 1
                continue
            push_one(path)
            result.pushed += 1
            log.info("Lagt op: %s", path.name)
        except blobdb.BlobDbError as exc:
            # Ukendt skemaversion hører til her. Læseren nægter med vilje at
            # gætte, og så skal connectoren heller ikke lægge tal op, som
            # ingen kan stå inde for.
            result.failed.append(path.name)
            log.warning("Sprang %s over: %s", path.name, exc)
        except db.DatabaseUnavailable:
            log.warning("Mistede databasen undervejs, resten venter til næste gang")
            break
        except OSError as exc:
            result.failed.append(path.name)
            log.warning("Kunne ikke læse %s: %s", path.name, exc)

    return result


# --- Baggrundstråden --------------------------------------------------------

_stop = threading.Event()
_thread: threading.Thread | None = None
_last: SyncResult | None = None


def last_result() -> SyncResult | None:
    return _last


def _loop() -> None:
    global _last
    while not _stop.is_set():
        try:
            _last = run_once()
            log.info("Synkronisering: %s", _last)
        except Exception:
            # En baggrundstråd, der dør, dør stille. Det må den ikke: så holder
            # scanningerne op med at komme frem, og ingen opdager hvorfor.
            log.exception("Synkroniseringen fejlede uventet, prøver igen")
        _stop.wait(config.SYNC_INTERVAL)


def start() -> None:
    """Start baggrundstråden, hvis connectoren er slået til på denne maskine."""
    global _thread

    if not config.SYNC_ENABLED:
        log.info("Connectoren er ikke slået til her (UBS_SYNC er ikke sat)")
        return

    if not config.BLOBDB_DIR.is_dir():
        log.error(
            "UBS_SYNC er sat, men %s findes ikke. Der er ingenting at læse, "
            "og der bliver ikke lagt noget op.",
            config.BLOBDB_DIR,
        )
        return

    log.info(
        "Connectoren kører her. Læser %s hvert %d. sekund som %s",
        config.BLOBDB_DIR,
        config.SYNC_INTERVAL,
        config.MACHINE_NAME,
    )
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="ubs-sync", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
    if _thread is not None:
        _thread.join(timeout=5)
