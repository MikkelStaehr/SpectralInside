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

-- --- Lots og proever -------------------------------------------------------
--
-- Produktionslinjen, ikke instrumentet. Et lot kommer ind som en ordre, koeres
-- gennem tre processer, og undervejs tages der proever. Analytikeren
-- registrerer resultatet, og operatoerskaermen i produktionen laeser det.
--
-- Hierarkiet er stramt: lot -> proces -> testtype -> proevenummer -> metrikker.
-- Definitionen af processer, testtyper og metrikker staar i lots.py og
-- eksponeres gennem API'et, saa frontenden ikke gentager den.
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
ALTER TABLE lots               ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_samples        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_sample_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE spec_limits        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lot_setup          ENABLE ROW LEVEL SECURITY;
