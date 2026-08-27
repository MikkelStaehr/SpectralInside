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

-- --- Lots og proever -------------------------------------------------------
--
-- Produktionslinjen, ikke instrumentet. Et lot kommer ind som en ordre, koeres
-- gennem tre processer, og undervejs tages der proever. Analytikeren
-- registrerer resultatet, og operatoerskaermen i produktionen laeser det.
--
-- Hierarkiet er stramt: lot -> proces -> testtype -> proevenummer -> metrikker.
-- Definitionen af processer, testtyper og metrikker staar i lots.py og
-- eksponeres gennem API'et, saa frontenden ikke gentager den.
-- --- Ordrer ----------------------------------------------------------------
--
-- Det, ordrekontoret bestemmer: hvilket parti der skal koeres, hvad det er, og
-- paa hvilken linje. Operatoeren vaelger en ordre og taster ikke et
-- ordrenummer, for et tastet nummer kan staves paa tre maader, og saa kan
-- ingenting afstemmes med kontoret bagefter.
--
-- Tabellen er ordrekontorets ende af snittet. Indtil integrationen findes,
-- oprettes ordrer gennem det samme API, som kontoret vil kalde.
CREATE TABLE IF NOT EXISTS orders (
    order_no   TEXT PRIMARY KEY,
    -- Partiet, der skal koeres. Bliver til koerslens lot_no.
    lot_no     TEXT NOT NULL,
    item_no    TEXT,
    variety    TEXT,
    line       TEXT,
    -- Kontorets tal. Det, der faktisk blev vejet ind, staar paa koerslen, og
    -- de to er ikke det samme: forskellen er selve pointen.
    planned_kg NUMERIC,
    note       TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    created_by TEXT,
    -- Naar ordren er planlagt til at koere. Det er den, koeen sorteres efter.
    -- Uden den ville koeen staa i den raekkefoelge, kontoret tilfaeldigvis
    -- trykkede paa knappen, og det er ikke en plan.
    planned_start TIMESTAMPTZ,
    -- Trukket tilbage af kontoret. Slettes ikke: en ordre, der har koert, skal
    -- kunne slaas op bagefter.
    cancelled_at TIMESTAMPTZ
);

ALTER TABLE orders ADD COLUMN IF NOT EXISTS planned_start TIMESTAMPTZ;

-- Koeen laeses forfra, ikke bagfra: den aeldste ordre er den naeste, der skal
-- koere. Derfor stigende og ikke faldende. Den gamle sortering paa created_at
-- alene er afloest.
DROP INDEX IF EXISTS idx_orders_open;

CREATE INDEX IF NOT EXISTS idx_orders_queue
    ON orders (line, (COALESCE(planned_start, created_at)))
    WHERE cancelled_at IS NULL;

CREATE TABLE IF NOT EXISTS lots (
    lot_no     TEXT PRIMARY KEY,
    variety    TEXT,
    -- Varenummeret paa sorten. Adskilt fra variety, fordi det er den noegle,
    -- der bruges udenfor laboratoriet, og et navn kan skrives paa flere maader.
    item_no    TEXT,
    line       TEXT,
    started_at TIMESTAMPTZ NOT NULL,
    started_by TEXT,
    -- Kvalitetsstemplet fra Post Cleaning. Saettes én gang, af et menneske.
    stamp      TEXT CHECK (stamp IN ('approved', 'rejected')),
    stamped_at TIMESTAMPTZ,
    stamped_by TEXT,
    stamp_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_lots_start ON lots (started_at DESC);

-- CREATE TABLE IF NOT EXISTS tilfoejer ikke kolonner til en tabel, der findes
-- i forvejen. Nye felter skal derfor staa som en ALTER her, saa en database,
-- der blev lagt op foer feltet fandtes, ogsaa faar det.
ALTER TABLE lots ADD COLUMN IF NOT EXISTS item_no TEXT;

-- Stamdata fra driftsrapportens "Ordre"-blok. Lottet oprettes af et menneske
-- med de her felter og faar sine maalinger bagefter. Foer var det omvendt: et
-- lot opstod, fordi Videometeret scannede noget, og saa var der ingen at
-- spoerge om hvad partiet egentlig var.
ALTER TABLE lots ADD COLUMN IF NOT EXISTS order_no  TEXT;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS report_no TEXT;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS input_kg  NUMERIC;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS ended_at  TIMESTAMPTZ;
ALTER TABLE lots ADD COLUMN IF NOT EXISTS note      TEXT;

-- Hvornaar stamdata sidst blev rettet. Uden den kan SSE-stroemmen ikke se, at
-- en operatoer har udfyldt kg ind, og de andre skaerme staar med det gamle
-- billede, til der tilfaeldigvis kommer en proeve.
ALTER TABLE lots ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Ordrenummeret er ikke noeglen, men det er det, papiret slaas op paa, og
-- rapportfilen hedder "{rapport}.{ordre}.pdf". Uden indeks bliver et opslag
-- en fuld scanning, saa snart der er en sæson bag os.
CREATE INDEX IF NOT EXISTS idx_lots_order ON lots (order_no);

CREATE TABLE IF NOT EXISTS lot_samples (
    id       BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    lot_no   TEXT NOT NULL REFERENCES lots (lot_no) ON DELETE CASCADE,
    process  TEXT NOT NULL,
    test_type TEXT NOT NULL,
    -- Loebenummer inden for (lot, proces, testtype). Det er det tal,
    -- operatoeren ser: "Purity, proeve 3". VideometerLabs egen id er en
    -- reference, ikke et proevenummer, og staar i scan_id.
    seq      INTEGER NOT NULL,
    taken_at TIMESTAMPTZ NOT NULL,
    taken_by TEXT,
    -- Hvad der blev skruet paa, foer proeven blev taget. Uden den er en
    -- forbedring bare et tal, der aendrede sig af sig selv.
    adjustment TEXT,
    -- VideometerLabs egen reference, altsaa filnavnets stem. Bruges til at
    -- finde billedraekken. Er aldrig operatoerens proevenummer.
    scan_id  TEXT,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by TEXT,
    -- Hvilke testtyper der hoerer til hvilken proces er en domaeneregel, ikke
    -- en praeference. Den staar ogsaa i lots.py, hvor den giver et brugbart
    -- svar til den der taster forkert. Her staar den, fordi den skal gaelde
    -- ogsaa for den der skriver udenom API'et.
    CONSTRAINT lot_samples_scope CHECK (
        (process = 'pre_cleaning'   AND test_type IN ('purity', 'ct'))
        OR (process = 'cleaning'      AND test_type IN ('cleaning_damage', 'ct'))
        OR (process = 'post_cleaning' AND test_type IN ('purity', 'cleaning_damage', 'ct'))
    )
);

-- Constrainten skal opdateres paa databaser, der blev lagt op foer CT fandtes.
-- CREATE TABLE IF NOT EXISTS roerer ikke en tabel, der allerede er der, saa
-- reglen ovenfor gaelder kun nye. Drop foerst, tilfoej saa: parret kan koeres
-- igen og igen, hvor et bart ADD CONSTRAINT ville fejle anden gang.
ALTER TABLE lot_samples DROP CONSTRAINT IF EXISTS lot_samples_scope;
ALTER TABLE lot_samples ADD CONSTRAINT lot_samples_scope CHECK (
    (process = 'pre_cleaning'   AND test_type IN ('purity', 'ct'))
    OR (process = 'cleaning'      AND test_type IN ('cleaning_damage', 'ct'))
    OR (process = 'post_cleaning' AND test_type IN ('purity', 'cleaning_damage', 'ct'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_lot_samples_seq
    ON lot_samples (lot_no, process, test_type, seq);

CREATE INDEX IF NOT EXISTS idx_lot_samples_scope
    ON lot_samples (lot_no, process, test_type, seq DESC);

CREATE TABLE IF NOT EXISTS lot_sample_metrics (
    sample_id BIGINT NOT NULL REFERENCES lot_samples (id) ON DELETE CASCADE,
    metric    TEXT NOT NULL,
    value     DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (sample_id, metric)
);

-- Opsaetningen af linjen, som operatoeren registrerer pr. lot. Maskinerne
-- fortaeller ikke selv, hvordan de er sat op, saa uden det her kan man ikke
-- bagefter se, hvilke indstillinger der gav hvilke tal.
--
-- En raekke betyder "operatoeren satte flueben ved denne indstilling". Fjernes
-- fluebenet, slettes raekken, saa en vaerdi ikke kan blive staaende usynligt
-- og dukke op igen senere.
--
-- Vaerdien er TEXT, ogsaa for tal. Hvilke indstillinger der findes, staar i
-- content/machine-setup.yaml og kan aendres uden en migrering, og en kolonne
-- med en type ville binde databasen til en fil, nogen retter i en fredag.
CREATE TABLE IF NOT EXISTS lot_setup (
    lot_no     TEXT NOT NULL REFERENCES lots (lot_no) ON DELETE CASCADE,
    setting_id TEXT NOT NULL,
    value      TEXT NOT NULL,
    set_at     TIMESTAMPTZ NOT NULL,
    set_by     TEXT NOT NULL,
    PRIMARY KEY (lot_no, setting_id)
);

-- Spec-graenser. Ubrugt i denne version: der er ingen OK/ikke-OK-domme paa
-- skaermen endnu. Tabellen findes, saa den dag de kommer, er det en
-- visningsaendring og ikke en migrering midt i en hoestsaeson.
CREATE TABLE IF NOT EXISTS spec_limits (
    test_type   TEXT NOT NULL,
    metric      TEXT NOT NULL,
    lower_limit DOUBLE PRECISION,
    upper_limit DOUBLE PRECISION,
    PRIMARY KEY (test_type, metric)
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
ALTER TABLE orders             ENABLE ROW LEVEL SECURITY;
ALTER TABLE lots               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_samples        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_sample_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE spec_limits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_setup          ENABLE ROW LEVEL SECURITY;
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


# --- Lots og prøver ---------------------------------------------------------
#
# Skrevet af analytikeren, læst af operatørskærmen i produktionen.


def list_lots(limit: int = 40) -> list[Row]:
    """Alle lots med det, forsiden skal bruge.

    Antal prøver og antallet af ukvitterede tælles med i samme forespørgsel.
    Alternativet er ét kald pr. lot, og forsiden viser dem alle sammen.

    **Sorteret efter hvornår der sidst skete noget**, ikke efter hvornår lottet
    blev startet. Det lot, der lige har fået en prøve, er det, nogen står og
    venter på, og det skal ligge øverst. Et lot startet i går, som stadig
    kører, må ikke ligge over et, der fik et resultat for to minutter siden.

    Kvitteringer tæller ikke med. De er nogens svar på et resultat og ikke en
    ændring af det, og listen skal ikke hoppe rundt, hver gang en operatør
    trykker "kvittér".
    """
    return _run(
        lambda conn: conn.execute(
            """
            SELECT l.*,
                   COALESCE(s.samples, 0) AS sample_count,
                   COALESCE(s.unacked, 0) AS unacknowledged_count,
                   s.last_sample_at,
                   GREATEST(
                       l.started_at,
                       COALESCE(s.last_sample_at, l.started_at),
                       COALESCE(l.stamped_at,     l.started_at),
                       COALESCE(u.last_setup_at,  l.started_at)
                   ) AS last_activity
            FROM lots l
            LEFT JOIN (
                SELECT lot_no,
                       COUNT(*)                                        AS samples,
                       COUNT(*) FILTER (WHERE acknowledged_at IS NULL) AS unacked,
                       MAX(taken_at)                                   AS last_sample_at
                FROM lot_samples
                GROUP BY lot_no
            ) s ON s.lot_no = l.lot_no
            LEFT JOIN (
                SELECT lot_no, MAX(set_at) AS last_setup_at
                FROM lot_setup
                GROUP BY lot_no
            ) u ON u.lot_no = l.lot_no
            ORDER BY last_activity DESC
            LIMIT %s
            """,
            (limit,),
        ).fetchall()
    )


# --- Ordrer -----------------------------------------------------------------


def list_orders(open_only: bool = True, limit: int = 100) -> list[Row]:
    """Ordrerne, en operatør kan vælge imellem.

    ``started_lot`` er det, der afgør, om ordren stadig er ledig. Den er ikke
    en kolonne, fordi en kørsel kan slettes eller aldrig blive til noget, og en
    status, der skal vedligeholdes to steder, kommer før eller siden til at
    lyve. Her udledes den af, om der findes en kørsel på ordren.

    Sorteret **stigende**: køen læses forfra, og den ældste ordre er den næste,
    der skal køre. Rækkefølgen er den planlagte, og falder kontoret tilbage på
    ingen plan, er det den rækkefølge, ordrerne blev lagt ind i. Ikke den
    rækkefølge, nogen tilfældigvis trykkede på knappen i sidst.
    """
    where = "WHERE o.cancelled_at IS NULL" if open_only else ""
    if open_only:
        where += " AND l.lot_no IS NULL"
    return _run(
        lambda conn: conn.execute(
            f"""
            SELECT o.*,
                   l.lot_no     AS started_lot,
                   l.started_at AS started_at,
                   l.stamp      AS started_stamp,
                   l.ended_at   AS started_ended_at
            FROM orders o
            LEFT JOIN lots l ON l.order_no = o.order_no
            {where}
            ORDER BY COALESCE(o.planned_start, o.created_at) ASC
            LIMIT %s
            """,
            (limit,),
        ).fetchall()
    )


def get_order(order_no: str) -> Row | None:
    return _run(
        lambda conn: conn.execute(
            """
            SELECT o.*,
                   l.lot_no     AS started_lot,
                   l.started_at AS started_at,
                   l.stamp      AS started_stamp,
                   l.ended_at   AS started_ended_at
            FROM orders o
            LEFT JOIN lots l ON l.order_no = o.order_no
            WHERE o.order_no = %s
            """,
            (order_no,),
        ).fetchone()
    )


def add_order(
    order_no: str,
    lot_no: str,
    item_no: str | None,
    variety: str | None,
    line: str | None,
    planned_kg: float | None,
    planned_start: datetime | None,
    note: str | None,
    created_by: str | None,
) -> Row:
    return _run(
        lambda conn: conn.execute(
            """
            INSERT INTO orders
                (order_no, lot_no, item_no, variety, line, planned_kg,
                 planned_start, note, created_at, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                order_no.strip(),
                lot_no.strip(),
                (item_no or "").strip() or None,
                (variety or "").strip() or None,
                (line or "").strip() or None,
                planned_kg,
                planned_start,
                (note or "").strip() or None,
                now(),
                (created_by or "").strip() or None,
            ),
        ).fetchone()
    )


#: Ordrefelter, der er tekst. Tom streng bliver til NULL, se _clean.
_ORDER_TEXT = ("lot_no", "item_no", "variety", "line", "note")


def update_order(order_no: str, fields: dict[str, Any]) -> Row | None:
    """Ret en ordre, der endnu ikke er sat i gang.

    ``NOT EXISTS`` i WHERE er det, der gør det. En ordre, partiet allerede
    kører på, må ikke kunne ændres: kørslen har kopieret ordrens felter, og to
    forskellige svar på det samme spørgsmål er værre end en tastefejl, der
    står. Er den kørt, skal kontoret rette kørslen, ikke ordren.
    """
    if not fields:
        return get_order(order_no)

    sets = ", ".join(f"{name} = %s" for name in fields)
    values = [
        (value.strip() or None)
        if name in _ORDER_TEXT and isinstance(value, str)
        else value
        for name, value in fields.items()
    ]
    values.extend([order_no, order_no])
    return _run(
        lambda conn: conn.execute(
            f"""
            UPDATE orders SET {sets}
            WHERE order_no = %s
              AND cancelled_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM lots WHERE order_no = %s)
            RETURNING *
            """,
            tuple(values),
        ).fetchone()
    )


def cancel_order(order_no: str) -> Row | None:
    """Træk ordren tilbage. Kun hvis den ikke er kørt.

    ``NOT EXISTS`` i WHERE er det, der gør det. Uden den kunne kontoret trække
    en ordre tilbage, mens partiet stod og kørte på linjen.
    """
    return _run(
        lambda conn: conn.execute(
            """
            UPDATE orders SET cancelled_at = %s
            WHERE order_no = %s
              AND cancelled_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM lots WHERE order_no = %s)
            RETURNING *
            """,
            (now(), order_no, order_no),
        ).fetchone()
    )


# --- Lots ---------------------------------------------------------------------


def get_lot(lot_no: str) -> Row | None:
    return _run(
        lambda conn: conn.execute(
            "SELECT * FROM lots WHERE lot_no = %s", (lot_no,)
        ).fetchone()
    )


#: Stamdatafelter, der er tekst. Samlet ét sted, saa add_lot og update_lot
#: behandler dem ens: tom streng bliver til NULL og ikke til "".
_LOT_TEXT = ("variety", "item_no", "line", "started_by", "order_no", "report_no", "note")


def _clean(field: str, value: Any) -> Any:
    """Tom streng er ikke en vaerdi.

    Et felt, operatoeren har ryddet, skal blive NULL. Bliver det "" i stedet,
    ser lottet udfyldt ud i en COALESCE og tomt paa skaermen, og saa er
    "mangler ordrenummer" pludselig noget, ingen kan finde ud af.
    """
    if field in _LOT_TEXT and isinstance(value, str):
        return value.strip() or None
    return value


def add_lot(
    lot_no: str,
    started_at: datetime | None = None,
    **fields: Any,
) -> Row:
    """Opret lottet.

    Stamdata kommer ind som frie felter, fordi listen staar i ``lots.py`` og
    ikke her. Kun kendte kolonner faar lov: main.py filtrerer mod
    ``EDITABLE_LOT_FIELDS``, saa et ukendt navn aldrig naar hertil.
    """
    columns = ["lot_no", "started_at"]
    values: list[Any] = [lot_no.strip(), started_at or now()]
    for name, value in fields.items():
        columns.append(name)
        values.append(_clean(name, value))

    holes = ", ".join(["%s"] * len(columns))
    return _run(
        lambda conn: conn.execute(
            f"INSERT INTO lots ({', '.join(columns)}) VALUES ({holes}) RETURNING *",
            tuple(values),
        ).fetchone()
    )


def update_lot(lot_no: str, fields: dict[str, Any]) -> Row | None:
    """Ret stamdata paa et lot, der koerer.

    Kun de felter, der er med i kaldet, roeres. Et lot faar sine oplysninger
    lidt ad gangen — kg ind kendes foerst, naar partiet er igennem — og en
    formular, der sender hele objektet, ville nulstille det, den ikke kender.
    """
    if not fields:
        return get_lot(lot_no)

    sets = ", ".join(f"{name} = %s" for name in fields) + ", updated_at = %s"
    values = [_clean(name, value) for name, value in fields.items()]
    values.append(now())
    values.append(lot_no)
    return _run(
        lambda conn: conn.execute(
            f"UPDATE lots SET {sets} WHERE lot_no = %s RETURNING *", tuple(values)
        ).fetchone()
    )


def stamp_lot(lot_no: str, stamp: str, stamped_by: str, note: str | None) -> Row | None:
    """Sæt kvalitetsstemplet. Kun én gang.

    ``stamp IS NULL`` i WHERE er det, der gør det. Uden den kunne to
    operatører, der trykker samtidig, ende med at den ene overskriver den
    andens afvisning med en godkendelse.
    """
    return _run(
        lambda conn: conn.execute(
            "UPDATE lots SET stamp = %s, stamped_at = %s, stamped_by = %s, "
            "stamp_note = %s WHERE lot_no = %s AND stamp IS NULL RETURNING *",
            (stamp, now(), stamped_by.strip(), (note or "").strip() or None, lot_no),
        ).fetchone()
    )


def lot_samples(lot_no: str) -> list[Row]:
    """Alle prøver på ét lot, med metrikkerne samlet i én kolonne.

    Metrikkerne kommer med som JSON frem for som en række pr. metrik. Skærmen
    skal bruge dem alle sammen alligevel, og et lot med 20 prøver ville ellers
    give 120 rækker, der skulle syes sammen igen i Python.
    """
    return _run(
        lambda conn: conn.execute(
            """
            SELECT s.*,
                   COALESCE(
                       (SELECT jsonb_object_agg(m.metric, m.value)
                        FROM lot_sample_metrics m
                        WHERE m.sample_id = s.id),
                       '{}'::jsonb
                   ) AS metrics
            FROM lot_samples s
            WHERE s.lot_no = %s
            ORDER BY s.process, s.test_type, s.seq
            """,
            (lot_no,),
        ).fetchall()
    )


def get_sample(sample_id: int) -> Row | None:
    """Én prøve med sine metrikker, i samme form som lot_samples giver dem."""
    return _run(
        lambda conn: conn.execute(
            """
            SELECT s.*,
                   COALESCE(
                       (SELECT jsonb_object_agg(m.metric, m.value)
                        FROM lot_sample_metrics m
                        WHERE m.sample_id = s.id),
                       '{}'::jsonb
                   ) AS metrics
            FROM lot_samples s
            WHERE s.id = %s
            """,
            (sample_id,),
        ).fetchone()
    )


def add_sample(
    lot_no: str,
    process: str,
    test_type: str,
    metrics: dict[str, float],
    taken_by: str | None,
    adjustment: str | None,
    scan_id: str | None,
    taken_at: datetime | None = None,
) -> Row:
    """Registrér én prøve med sine metrikker, i én transaktion.

    Løbenummeret tildeles her og ikke af den, der taster. To analytikere, der
    registrerer på det samme lot samtidig, ville ellers kunne give den samme
    prøve nummer 3 begge to. ``FOR UPDATE`` på lottet serialiserer dem, og det
    unikke indeks på (lot, proces, testtype, seq) fanger resten.
    """

    def work(conn: psycopg.Connection) -> Row:
        conn.execute("SELECT 1 FROM lots WHERE lot_no = %s FOR UPDATE", (lot_no,))
        row = conn.execute(
            "SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM lot_samples "
            "WHERE lot_no = %s AND process = %s AND test_type = %s",
            (lot_no, process, test_type),
        ).fetchone()
        seq = row["seq"]

        sample = conn.execute(
            """
            INSERT INTO lot_samples
                (lot_no, process, test_type, seq, taken_at, taken_by,
                 adjustment, scan_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
            """,
            (
                lot_no,
                process,
                test_type,
                seq,
                taken_at or now(),
                (taken_by or "").strip() or None,
                (adjustment or "").strip() or None,
                (scan_id or "").strip() or None,
            ),
        ).fetchone()

        if metrics:
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO lot_sample_metrics (sample_id, metric, value) "
                    "VALUES (%s, %s, %s)",
                    [(sample["id"], name, value) for name, value in metrics.items()],
                )

        return sample

    return _run(work)


def acknowledge_sample(sample_id: int, acknowledged_by: str) -> Row | None:
    """Kvittér for et resultat.

    ``acknowledged_at IS NULL`` i WHERE gør den idempotent: den, der kvitterede
    først, står som den, der så resultatet. Et andet klik flytter ikke navnet.
    """
    return _run(
        lambda conn: conn.execute(
            "UPDATE lot_samples SET acknowledged_at = %s, acknowledged_by = %s "
            "WHERE id = %s AND acknowledged_at IS NULL RETURNING *",
            (now(), acknowledged_by.strip(), sample_id),
        ).fetchone()
    )


def lot_setup(lot_no: str) -> list[Row]:
    return _run(
        lambda conn: conn.execute(
            "SELECT * FROM lot_setup WHERE lot_no = %s ORDER BY setting_id",
            (lot_no,),
        ).fetchall()
    )


def save_lot_setup(
    lot_no: str, values: list[tuple[str, str]], set_by: str
) -> list[Row]:
    """Erstat hele opsætningen for ét lot, i én transaktion.

    Erstatning og ikke fletning. Fjerner operatøren et flueben, skal værdien
    forsvinde, ikke blive stående usynligt og dukke op igen næste gang nogen
    åbner dialogen.
    """

    def work(conn: psycopg.Connection) -> list[Row]:
        conn.execute("DELETE FROM lot_setup WHERE lot_no = %s", (lot_no,))
        if values:
            stamp = now()
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO lot_setup (lot_no, setting_id, value, set_at, set_by) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    [
                        (lot_no, setting_id, value, stamp, set_by.strip())
                        for setting_id, value in values
                    ],
                )
        return conn.execute(
            "SELECT * FROM lot_setup WHERE lot_no = %s ORDER BY setting_id",
            (lot_no,),
        ).fetchall()

    return _run(work)


def spec_limits() -> list[Row]:
    """Spec-grænserne. Ubrugt i denne version, se skemaet."""
    return _run(lambda conn: conn.execute("SELECT * FROM spec_limits").fetchall())


def lots_change_token() -> str:
    """Et tal, der ændrer sig, præcis når skærmen har noget nyt at vise.

    Grundlaget under SSE-strømmen. Billigere end at hente alle lots og
    sammenligne dem, og det er den forespørgsel, der køres hvert par sekunder,
    så længe der står en skærm tændt i produktionen.
    """
    row = _run(
        lambda conn: conn.execute(
            """
            SELECT
                (SELECT COUNT(*) FROM lot_samples) AS samples,
                (SELECT MAX(GREATEST(taken_at, COALESCE(acknowledged_at, taken_at)))
                 FROM lot_samples) AS touched,
                (SELECT COUNT(*) FROM lots) AS lots,
                (SELECT MAX(GREATEST(started_at,
                                     COALESCE(stamped_at, started_at),
                                     COALESCE(updated_at, started_at)))
                 FROM lots) AS lots_touched,
                (SELECT COUNT(*) FROM lot_setup) AS setup,
                (SELECT MAX(set_at) FROM lot_setup) AS setup_touched,
                -- Ordrer taeller med, saa en ny ordre fra kontoret dukker op
                -- paa skaermen uden at nogen skal hente siden igen.
                (SELECT COUNT(*) FROM orders) AS orders,
                (SELECT MAX(GREATEST(created_at, COALESCE(cancelled_at, created_at)))
                 FROM orders) AS orders_touched
            """
        ).fetchone()
    )
    return "|".join(
        str(row[key])
        for key in (
            "samples",
            "touched",
            "lots",
            "lots_touched",
            "setup",
            "setup_touched",
            "orders",
            "orders_touched",
        )
    )
