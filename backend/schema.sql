-- UBS Spectral Inside - skema til Supabase
--
-- GENERERET fra backend/app/db.py (_SCHEMA). Ret ikke i denne fil, ret i
-- db.py og lav den her igen, ellers driver de to fra hinanden.
--
-- Koeres i Supabase-dashboardet under SQL Editor. Alt er IF NOT EXISTS, saa
-- den kan koeres igen uden at oedelaegge noget.
--
-- Applikationen koerer den samme SQL selv ved foerste forbindelse. Den her er
-- til at komme i gang uden at vente paa det.

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
