"""Postgres-lag (Supabase) for beskeder, vedligeholdelseslog og daglige procedurer.

Tre tabeller, alt sammen skrevet af mennesker gennem grænsefladen. Måledata
hører ikke til her, de kommer ind ad en anden vej.

Forbindelsen går gennem Supabases **transaction pooler**, ikke direkte til
databasen. Det er ikke en præference: `db.<ref>.supabase.co` findes ikke
længere i DNS for IPv4, så den direkte vej er ikke en mulighed. Det har to
konsekvenser, som koden nedenfor tager højde for:

  * Prepared statements slås fra (`prepare_threshold=None`). I transaction mode
    kan to på hinanden følgende kald ramme hver sin serverside-forbindelse, og
    et prepared statement fra det ene findes så ikke i det andet.
  * Forbindelser er en delt ressource. Poolen holdes lille, se config.

Applikationen skal kunne starte uden databasen. Procedurer og wiki læses fra
disk, og de skal virke, også når nettet er nede eller Supabase har en dårlig
dag. Derfor åbnes poolen uden at vente, og alt herinde kaster
`DatabaseUnavailable` i stedet for at lade psycopg-fejl slå igennem.
"""

from __future__ import annotations

import logging
import threading
from contextlib import contextmanager
from datetime import date, datetime, timezone
from typing import Any, Callable, Iterator, TypeVar

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool, PoolTimeout

from . import config

log = logging.getLogger(__name__)

Row = dict[str, Any]
T = TypeVar("T")


class DatabaseUnavailable(RuntimeError):
    """Databasen kunne ikke nås.

    Fanges i main.py og bliver til 503. Adskilt fra alle andre fejl, fordi det
    er den ene slags fejl, hvor svaret til operatøren er "prøv igen om lidt" og
    ikke "der er noget galt med applikationen".

    Teksten havner på skærmen hos en analytiker. Den skal derfor sige, hvad hun
    kan gøre, og ikke nævne miljøvariabler eller værtsnavne. Den tekniske grund
    hører til i loggen, hvor udvikleren kigger.
    """


# Det, analytikeren ser. Årsagen står i loggen.
_UNAVAILABLE = (
    "Databasen kan ikke nås lige nu. Procedurer og wiki virker, "
    "men beskeder, vedligeholdelseslog og daglig opstart kommer først "
    "tilbage, når forbindelsen er der igen."
)


# --- Skema ------------------------------------------------------------------

_SCHEMA = """
CREATE TABLE IF NOT EXISTS messages (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    body         TEXT NOT NULL,
    author       TEXT NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL,
    retracted_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS maintenance_log (
    id      BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    task_id TEXT NOT NULL,
    done_at TIMESTAMPTZ NOT NULL,
    done_by TEXT NOT NULL,
    note    TEXT
);

CREATE INDEX IF NOT EXISTS idx_maintenance_task
    ON maintenance_log (task_id, done_at DESC);

-- Daglige procedurer registreres pr. dag, ikke pr. person. Instrumentet er
-- varmt for alle, når først en har startet det op, så den næste analytiker
-- skal ikke spørges igen samme dag.
CREATE TABLE IF NOT EXISTS daily_log (
    id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    day          DATE NOT NULL,
    procedure_id TEXT NOT NULL,
    done_by      TEXT NOT NULL,
    done_at      TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_once
    ON daily_log (day, procedure_id);

-- --- Scanninger ------------------------------------------------------------
--
-- Skrevet af connectoren, laest af alle. Kilden er stadig .blobdb-filerne pa
-- instrument-PC'en, det her er en kopi, sa den anden maskine kan se dem.
--
-- id er filnavnets stem, praecis som scan_id har vaeret hele vejen igennem
-- applikationen. Filnavnet baerer al metadata, sa det er ogsa den eneste
-- stabile identitet der findes.
CREATE TABLE IF NOT EXISTS scans (
    id             TEXT PRIMARY KEY,
    filename       TEXT NOT NULL,
    recipe         TEXT,
    lot            TEXT,
    operator       TEXT,
    scanned_on     DATE,
    blob_count     INTEGER NOT NULL DEFAULT 0,
    labelled_count INTEGER NOT NULL DEFAULT 0,
    unknown_count  INTEGER NOT NULL DEFAULT 0,
    classifier     TEXT,
    size_bytes     BIGINT NOT NULL DEFAULT 0,
    -- Filens stoerrelse og tidsstempel afgoer, om den skal laeses igen.
    -- Retter en analytiker referenceklasser i VideometerLab, aendrer filen sig,
    -- og sa skal den med op igen.
    file_mtime     TIMESTAMPTZ,
    source_machine TEXT,
    synced_at      TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scans_dato ON scans (scanned_on DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS scan_classes (
    scan_id TEXT NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
    name    TEXT NOT NULL,
    count   INTEGER NOT NULL,
    PRIMARY KEY (scan_id, name)
);

CREATE TABLE IF NOT EXISTS scan_blobs (
    scan_id    TEXT NOT NULL REFERENCES scans (id) ON DELETE CASCADE,
    blob_id    TEXT NOT NULL,
    predicted  TEXT,
    reference  TEXT,
    confidence DOUBLE PRECISION,
    thumbnail  BYTEA,
    PRIMARY KEY (scan_id, blob_id)
);

CREATE INDEX IF NOT EXISTS idx_scan_blobs_predicted
    ON scan_blobs (scan_id, predicted);

-- De 19 baand, kun for fokusklassen. Se config.SYNC_BANDS.
CREATE TABLE IF NOT EXISTS scan_blob_bands (
    scan_id  TEXT NOT NULL,
    blob_id  TEXT NOT NULL,
    band_ix  SMALLINT NOT NULL,
    png      BYTEA NOT NULL,
    PRIMARY KEY (scan_id, blob_id, band_ix),
    FOREIGN KEY (scan_id, blob_id)
        REFERENCES scan_blobs (scan_id, blob_id) ON DELETE CASCADE
);

-- Row Level Security uden en eneste policy lukker tabellerne for Supabases
-- REST-API. Vi forbinder som ejer gennem pooleren og rammes ikke af det, men
-- en publicerbar nogle kan sa ikke lase en vedligeholdelseslog ud af
-- browseren. Uden det her ligger de tre tabeller abne for enhver, der kender
-- projektets URL og har en gyldig publicerbar nogle.
ALTER TABLE messages        ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE scans           ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_classes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_blobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE scan_blob_bands ENABLE ROW LEVEL SECURITY;
"""


# --- Tid --------------------------------------------------------------------


def now() -> datetime:
    return datetime.now(timezone.utc)


def parse_ts(raw: datetime | str) -> datetime:
    """Tidsstempler kommer ud af Postgres som rigtige datetime'er.

    Strengvarianten holdes ved lige, fordi den er den, SQLite gav, og fordi
    kaldere i main.py ikke skal vide, hvilken database der ligger under.
    """
    parsed = raw if isinstance(raw, datetime) else datetime.fromisoformat(raw)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def today() -> str:
    """Dagen som YYYY-MM-DD. Laboratoriet arbejder i dagtimerne, så serverens
    UTC-dato og den lokale dato er den samme, når nogen faktisk er på arbejde."""
    return now().date().isoformat()


def _as_day(day: date | str) -> date:
    return day if isinstance(day, date) else date.fromisoformat(day)


# --- Pool -------------------------------------------------------------------

_pool: ConnectionPool | None = None
_pool_lock = threading.Lock()
_schema_ready = False


def _get_pool() -> ConnectionPool:
    global _pool

    if config.DATABASE_URL is None:
        log.error("SUPABASE_DB_URL er ikke sat, der er ingen database at forbinde til")
        raise DatabaseUnavailable(_UNAVAILABLE)

    with _pool_lock:
        if _pool is None:
            _pool = ConnectionPool(
                conninfo=config.DATABASE_URL,
                min_size=config.DB_POOL_MIN,
                max_size=config.DB_POOL_MAX,
                timeout=config.DB_TIMEOUT,
                kwargs={
                    "row_factory": dict_row,
                    # Se modulets docstring: transaction mode og prepared
                    # statements kan ikke være i stue sammen.
                    "prepare_threshold": None,
                    "sslmode": "require",
                    "connect_timeout": int(config.DB_TIMEOUT),
                    "application_name": "ubs-spectral-inside",
                },
                # Vent ikke pa forbindelsen ved opstart. Er Supabase nede, skal
                # serveren stadig komme op og servere procedurerne.
                open=False,
            )
            _pool.open(wait=False)
    return _pool


@contextmanager
def connect() -> Iterator[psycopg.Connection]:
    """Én forbindelse fra poolen, committet ved ren afslutning."""
    pool = _get_pool()
    try:
        with pool.connection() as conn:
            yield conn
    except (PoolTimeout, psycopg.OperationalError) as exc:
        log.warning("Databasen kunne ikke nås: %s", exc)
        raise DatabaseUnavailable(_UNAVAILABLE) from exc


def _ensure_schema(conn: psycopg.Connection) -> None:
    conn.execute(_SCHEMA)


def _run(work: Callable[[psycopg.Connection], T]) -> T:
    """Kør `work` mod en forbindelse, og sørg for at skemaet findes.

    Skemaet sikres én gang pr. proces, ikke ved hver forespørgsel. Mod SQLite
    var det gratis at gøre hver gang; over en pooler er det en netværkstur, og
    så er det ikke.

    Til gengæld beholdes selvhelbredelsen: forsvinder en tabel under en kørende
    server, lægges skemaet på plads igen, og kaldet prøves forfra. Alternativet
    er en 500-fejl, der kun kan rettes ved genstart.
    """
    global _schema_ready

    with connect() as conn:
        if not _schema_ready:
            _ensure_schema(conn)
            _schema_ready = True
        try:
            return work(conn)
        except psycopg.errors.UndefinedTable:
            _schema_ready = False

    with connect() as conn:
        _ensure_schema(conn)
        _schema_ready = True
        return work(conn)


def init() -> None:
    """Kaldes ved opstart.

    Fejler aldrig. Kan databasen ikke nås, siges det tydeligt i loggen, og
    serveren kommer op alligevel, så procedurer og wiki virker. Skemaet lægges
    så på plads ved første kald, der får fat i en forbindelse.
    """
    if config.DATABASE_URL is None:
        log.warning(
            "SUPABASE_DB_URL er ikke sat. Procedurer og wiki virker, men "
            "beskeder, vedligeholdelseslog og daglig opstart svarer 503."
        )
        return

    try:
        _run(lambda conn: None)
        log.info("Forbundet til Supabase, skema er på plads")
    except DatabaseUnavailable as exc:
        log.warning("Databasen kunne ikke nås ved opstart: %s", exc)


def close() -> None:
    """Lukkes ved nedlukning, så pooleren får sine forbindelser tilbage."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            _pool.close()
            _pool = None


# --- Beskeder ---------------------------------------------------------------


def add_message(body: str, author: str) -> Row:
    return _run(
        lambda conn: conn.execute(
            "INSERT INTO messages (body, author, created_at) "
            "VALUES (%s, %s, %s) RETURNING *",
            (body.strip(), author.strip(), now()),
        ).fetchone()
    )


def latest_message() -> Row | None:
    return _run(
        lambda conn: conn.execute(
            "SELECT * FROM messages WHERE retracted_at IS NULL "
            "ORDER BY created_at DESC, id DESC LIMIT 1"
        ).fetchone()
    )


def list_messages(limit: int = 50) -> list[Row]:
    return _run(
        lambda conn: conn.execute(
            "SELECT * FROM messages WHERE retracted_at IS NULL "
            "ORDER BY created_at DESC, id DESC LIMIT %s",
            (limit,),
        ).fetchall()
    )


def retract_message(message_id: int) -> bool:
    return _run(
        lambda conn: conn.execute(
            "UPDATE messages SET retracted_at = %s "
            "WHERE id = %s AND retracted_at IS NULL",
            (now(), message_id),
        ).rowcount
        > 0
    )


# --- Vedligeholdelse --------------------------------------------------------


def log_maintenance(
    task_id: str,
    done_by: str,
    note: str | None,
    done_at: datetime | None = None,
) -> Row:
    """Registrér en udførelse. done_at kan ligge i fortiden, hvis opgaven blev
    udført tidligere end den blev registreret, næste forfald tælles derfra."""
    return _run(
        lambda conn: conn.execute(
            "INSERT INTO maintenance_log (task_id, done_at, done_by, note) "
            "VALUES (%s, %s, %s, %s) RETURNING *",
            (
                task_id,
                done_at or now(),
                done_by.strip(),
                (note or "").strip() or None,
            ),
        ).fetchone()
    )


def last_completions() -> dict[str, Row]:
    """Seneste udførelse pr. opgave-id.

    DISTINCT ON frem for et JOIN mod MAX(done_at): registreres to udførelser
    med præcis samme tidsstempel, afgør ORDER BY hvilken der vinder, i stedet
    for at det beror på rækkefølgen af rækkerne.
    """
    rows = _run(
        lambda conn: conn.execute(
            "SELECT DISTINCT ON (task_id) * FROM maintenance_log "
            "ORDER BY task_id, done_at DESC, id DESC"
        ).fetchall()
    )
    return {row["task_id"]: row for row in rows}


def maintenance_log(task_id: str, limit: int = 25) -> list[Row]:
    return _run(
        lambda conn: conn.execute(
            "SELECT * FROM maintenance_log WHERE task_id = %s "
            "ORDER BY done_at DESC, id DESC LIMIT %s",
            (task_id, limit),
        ).fetchall()
    )


# --- Daglige procedurer -----------------------------------------------------


def daily_done(day: date | str) -> dict[str, Row]:
    """Dagens registrerede procedurer, opslået på procedure-id."""
    rows = _run(
        lambda conn: conn.execute(
            "SELECT * FROM daily_log WHERE day = %s", (_as_day(day),)
        ).fetchall()
    )
    return {row["procedure_id"]: row for row in rows}


def mark_daily_done(day: date | str, procedure_id: str, done_by: str) -> Row:
    def work(conn: psycopg.Connection) -> Row:
        # Har en anden allerede kørt den i dag, står den første registrering
        # ved magt. Det er den, der rent faktisk startede instrumentet.
        conn.execute(
            "INSERT INTO daily_log (day, procedure_id, done_by, done_at) "
            "VALUES (%s, %s, %s, %s) ON CONFLICT (day, procedure_id) DO NOTHING",
            (_as_day(day), procedure_id, done_by.strip(), now()),
        )
        return conn.execute(
            "SELECT * FROM daily_log WHERE day = %s AND procedure_id = %s",
            (_as_day(day), procedure_id),
        ).fetchone()

    return _run(work)


# --- Scanninger, skrevet af connectoren -------------------------------------


def known_scans() -> dict[str, Row]:
    """Hvad databasen allerede kender, opslået på scan-id.

    Connectoren bruger størrelse og tidsstempel herfra til at afgøre, hvad der
    skal læses igen. Retter en analytiker referenceklasser i VideometerLab,
    ændrer filen sig, og så skal den med op på ny.
    """
    rows = _run(
        lambda conn: conn.execute(
            "SELECT id, size_bytes, file_mtime FROM scans"
        ).fetchall()
    )
    return {row["id"]: row for row in rows}


def upsert_scan(
    scan: dict[str, Any],
    classes: list[tuple[str, int]],
    blobs: list[dict[str, Any]],
    bands: list[tuple[str, int, bytes]],
) -> None:
    """Læg én scanning op, hele vejen igennem, i én transaktion.

    Enten er scanningen der helt, eller også er den der ikke. En halvt skrevet
    scanning ville vise et forkert antal skadede frø, og det er værre end at
    scanningen mangler: en operatør, der kan se tallet, går ud fra at det passer.
    """

    def work(conn: psycopg.Connection) -> None:
        conn.execute(
            """
            INSERT INTO scans (
                id, filename, recipe, lot, operator, scanned_on,
                blob_count, labelled_count, unknown_count, classifier,
                size_bytes, file_mtime, source_machine, synced_at
            )
            VALUES (
                %(id)s, %(filename)s, %(recipe)s, %(lot)s, %(operator)s,
                %(scanned_on)s, %(blob_count)s, %(labelled_count)s,
                %(unknown_count)s, %(classifier)s, %(size_bytes)s,
                %(file_mtime)s, %(source_machine)s, %(synced_at)s
            )
            ON CONFLICT (id) DO UPDATE SET
                filename       = EXCLUDED.filename,
                recipe         = EXCLUDED.recipe,
                lot            = EXCLUDED.lot,
                operator       = EXCLUDED.operator,
                scanned_on     = EXCLUDED.scanned_on,
                blob_count     = EXCLUDED.blob_count,
                labelled_count = EXCLUDED.labelled_count,
                unknown_count  = EXCLUDED.unknown_count,
                classifier     = EXCLUDED.classifier,
                size_bytes     = EXCLUDED.size_bytes,
                file_mtime     = EXCLUDED.file_mtime,
                source_machine = EXCLUDED.source_machine,
                synced_at      = EXCLUDED.synced_at
            """,
            scan,
        )

        scan_id = scan["id"]

        # Klasser og blobs erstattes frem for at blive flettet. Forsvinder en
        # klasse, fordi modellen er kørt igen, skal den også forsvinde her.
        # Bånd og miniaturer ryger med via ON DELETE CASCADE.
        conn.execute("DELETE FROM scan_classes WHERE scan_id = %s", (scan_id,))
        if classes:
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO scan_classes (scan_id, name, count) "
                    "VALUES (%s, %s, %s)",
                    [(scan_id, name, count) for name, count in classes],
                )

        conn.execute("DELETE FROM scan_blobs WHERE scan_id = %s", (scan_id,))
        if blobs:
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO scan_blobs "
                    "(scan_id, blob_id, predicted, reference, confidence, thumbnail) "
                    "VALUES (%s, %s, %s, %s, %s, %s)",
                    [
                        (
                            scan_id,
                            b["blob_id"],
                            b.get("predicted"),
                            b.get("reference"),
                            b.get("confidence"),
                            b.get("thumbnail"),
                        )
                        for b in blobs
                    ],
                )

        if bands:
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO scan_blob_bands (scan_id, blob_id, band_ix, png) "
                    "VALUES (%s, %s, %s, %s)",
                    [(scan_id, blob_id, ix, png) for blob_id, ix, png in bands],
                )

    _run(work)


def forget_scan(scan_id: str) -> None:
    """Fjern en scanning igen. Klasser, blobs og bånd følger med."""
    _run(lambda conn: conn.execute("DELETE FROM scans WHERE id = %s", (scan_id,)))


# --- Scanninger, læst af applikationen --------------------------------------


def list_scans(limit: int = 200) -> list[Row]:
    return _run(
        lambda conn: conn.execute(
            "SELECT * FROM scans "
            "ORDER BY scanned_on DESC NULLS LAST, synced_at DESC LIMIT %s",
            (limit,),
        ).fetchall()
    )


def get_scan(scan_id: str) -> Row | None:
    return _run(
        lambda conn: conn.execute(
            "SELECT * FROM scans WHERE id = %s", (scan_id,)
        ).fetchone()
    )


def scan_classes(scan_id: str) -> list[Row]:
    return _run(
        lambda conn: conn.execute(
            "SELECT name, count FROM scan_classes WHERE scan_id = %s "
            "ORDER BY count DESC, name",
            (scan_id,),
        ).fetchall()
    )


def scan_blob_rows(
    scan_id: str,
    limit: int = 200,
    offset: int = 0,
    predicted: str | None = None,
    only_corrected: bool = False,
) -> list[Row]:
    """Samme filtre som blobdb.blobs, så visningen opfører sig ens."""
    where = ["scan_id = %s"]
    params: list[Any] = [scan_id]
    if predicted:
        where.append("predicted = %s")
        params.append(predicted)
    if only_corrected:
        where.append("reference IS NOT NULL AND reference <> predicted")
    params.extend([limit, offset])

    clause = " AND ".join(where)
    return _run(
        lambda conn: conn.execute(
            f"SELECT blob_id, predicted, reference, confidence "
            f"FROM scan_blobs WHERE {clause} "
            f"ORDER BY blob_id LIMIT %s OFFSET %s",
            params,
        ).fetchall()
    )


def blob_thumbnail(scan_id: str, blob_id: str) -> bytes | None:
    row = _run(
        lambda conn: conn.execute(
            "SELECT thumbnail FROM scan_blobs WHERE scan_id = %s AND blob_id = %s",
            (scan_id, blob_id),
        ).fetchone()
    )
    return bytes(row["thumbnail"]) if row and row["thumbnail"] else None


def blob_band_count(scan_id: str, blob_id: str) -> int:
    row = _run(
        lambda conn: conn.execute(
            "SELECT COUNT(*) AS n FROM scan_blob_bands "
            "WHERE scan_id = %s AND blob_id = %s",
            (scan_id, blob_id),
        ).fetchone()
    )
    return int(row["n"]) if row else 0


def blob_band(scan_id: str, blob_id: str, index: int) -> bytes | None:
    row = _run(
        lambda conn: conn.execute(
            "SELECT png FROM scan_blob_bands "
            "WHERE scan_id = %s AND blob_id = %s AND band_ix = %s",
            (scan_id, blob_id, index),
        ).fetchone()
    )
    return bytes(row["png"]) if row and row["png"] else None


def confusion(scan_id: str | None = None) -> list[tuple[str, str, int]]:
    """Modellens gæt holdt op mod operatørens rettelse, som (ref, gæt, antal).

    Som i blobdb.confusion tæller kun blobs, hvor nogen faktisk har sat en
    referenceklasse. Resten ved vi ikke sandheden om.
    """
    sql = (
        "SELECT reference, predicted, COUNT(*) AS n FROM scan_blobs "
        "WHERE reference IS NOT NULL AND predicted IS NOT NULL "
    )
    params: tuple[Any, ...] = ()
    if scan_id:
        sql += "AND scan_id = %s "
        params = (scan_id,)
    sql += "GROUP BY reference, predicted"

    rows = _run(lambda conn: conn.execute(sql, params).fetchall())
    return [(r["reference"], r["predicted"], r["n"]) for r in rows]
