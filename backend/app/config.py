"""Konfiguration.

Alt kan overstyres med miljøvariabler, så den samme kode kan køre lokalt på en
analyse-PC nu og på en fælles server senere uden ændringer.
"""

from __future__ import annotations

import os
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BACKEND_DIR.parent


def _path_from_env(name: str, default: Path) -> Path:
    raw = os.environ.get(name)
    return Path(raw).expanduser().resolve() if raw else default


CONTENT_DIR = _path_from_env("UBS_CONTENT_DIR", REPO_ROOT / "content")
PROCEDURES_DIR = CONTENT_DIR / "procedures"
MAINTENANCE_FILE = CONTENT_DIR / "maintenance.yaml"
OPERATORS_FILE = CONTENT_DIR / "operators.yaml"
MACHINE_SETUP_FILE = CONTENT_DIR / "machine-setup.yaml"
LINES_FILE = CONTENT_DIR / "lines.yaml"
OPERATIONS_FILE = CONTENT_DIR / "operations.yaml"

DB_PATH = _path_from_env("UBS_DB_PATH", BACKEND_DIR / "data" / "ubs.db")

# Postgres hos Supabase. Beskeder, vedligeholdelseslog og daglige procedurer
# ligger her, så de fire analytikere deler tilstand i stedet for hver sin
# lokale fil.
#
# Strengen hentes i dashboardet under Connect -> Transaction pooler og hører
# hjemme i .env.local, som er i .gitignore. Den indeholder database-password'et
# og må aldrig i git.
#
# Er den ikke sat, starter appen alligevel: procedurer og wiki læses fra disk
# og virker uden database. Det, der kræver databasen, svarer 503 med en
# forklaring i stedet for at rive hele applikationen ned.
DATABASE_URL = os.environ.get("SUPABASE_DB_URL", "").strip() or None

# Pooleren i transaction mode genbruger serverside-forbindelser på tværs af
# klienter, så en stor pool her giver ingen gevinst. Fire analytikere og en
# håndfuld kald pr. sideskift har rigeligt i det her.
DB_POOL_MIN = int(os.environ.get("UBS_DB_POOL_MIN", "1"))
DB_POOL_MAX = int(os.environ.get("UBS_DB_POOL_MAX", "4"))

# Hvor længe et kald venter på en ledig forbindelse, før det giver op. Kort
# med vilje: en operatør, der klikker "Registrér", skal have et svar, ikke en
# browserfane der hænger.
DB_TIMEOUT = float(os.environ.get("UBS_DB_TIMEOUT", "10"))

# VideometerLabs egne mapper. Læses aldrig andet end skrivebeskyttet.
# Standardstierne følger VideometerLabs brugermappe, men på instrument-PC'en
# hedder Windows-brugeren typisk noget andet, så de skal kunne overstyres.
_VM_USER_DIR = Path.home() / "Documents" / "Videometer" / "VideometerLab"

BLOBDB_DIR = _path_from_env("UBS_BLOBDB_DIR", _VM_USER_DIR / "Blobs" / "BlobCollections")
CLASSIFIERS_DIR = _path_from_env(
    "UBS_CLASSIFIERS_DIR", _VM_USER_DIR / "Classification" / "Classifiers"
)

# --- Connectoren ------------------------------------------------------------
#
# Den samme applikation kører begge steder. På maskinen med VideometerLabs
# filer slås synkroniseringen til, og så læser den blob-samlingerne og skubber
# dem til Supabase. Alle andre steder er den slået fra, og appen læser kun.
#
# Flaget er med vilje eksplicit og ikke "slå til, hvis mappen findes". Peger
# UBS_BLOBDB_DIR ved et uheld på en forkert mappe, skal det ikke føre til, at
# der bliver skubbet noget op i databasen.
SYNC_ENABLED = os.environ.get("UBS_SYNC", "").strip().lower() in {"1", "true", "ja"}

# Hvor ofte mappen gennemgås. Et lot tager 10-20 minutter at køre, så der er
# ingen grund til at kigge oftere end det her.
SYNC_INTERVAL = int(os.environ.get("UBS_SYNC_INTERVAL", "300"))

# Hvilken maskine en scanning kom fra. Står i databasen, så det kan ses, hvor
# data stammer fra, hvis der en dag kører mere end én connector.
MACHINE_NAME = os.environ.get("UBS_MACHINE", os.environ.get("COMPUTERNAME", "ukendt"))

# Billederne. Miniaturen følger med for hvert frø, så scanningsbrowseren virker
# fra begge maskiner. De 19 bånd følger kun med for fokusklassen, altså de frø,
# produktionen faktisk skal se. Bånd for alle frø ville fylde omkring 23 gange
# så meget og blive set på af ingen.
SYNC_THUMBNAILS = os.environ.get("UBS_SYNC_THUMBNAILS", "1").strip() != "0"
SYNC_BANDS = os.environ.get("UBS_SYNC_BANDS", "1").strip() != "0"

# Loft over hvor mange frø pr. scanning der får deres båndrække med. Et lot med
# usædvanligt mange i fokusklassen skal ikke kunne fylde databasen på én gang.
# Rammes loftet, siges det i loggen frem for at blive skjult.
SYNC_BAND_LIMIT = int(os.environ.get("UBS_SYNC_BAND_LIMIT", "200"))


# Den klasse, operatørvisningen handler om.
#
# Målet er antallet af skadede frø, men den model findes ikke endnu. Indtil den
# gør, peger visningen på en klasse, der findes i purity-modellen, så hele
# kæden kan afprøves. Når skade-klassen er trænet, er det her den skiftes, og
# intet andet skal ændres.
FOCUS_CLASS = os.environ.get("UBS_FOCUS_CLASS", "Foreign")
FOCUS_LABEL = os.environ.get("UBS_FOCUS_LABEL", "Fremmede frø")

# Skemaversioner af .blobdb, som læseren er afprøvet mod. Ser den en anden,
# stopper den med en tydelig fejl frem for at gætte på indholdet.
SUPPORTED_BLOBDB_VERSIONS = {
    int(v)
    for v in os.environ.get("UBS_BLOBDB_VERSIONS", "7").split(",")
    if v.strip().isdigit()
}

# Sættes der en frontend-build her, serverer backenden den selv, så hele
# applikationen kan køre som én proces. Findes mappen ikke, springes det over.
FRONTEND_DIST = _path_from_env("UBS_FRONTEND_DIST", REPO_ROOT / "frontend" / "dist")

CORS_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "UBS_CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173",
    ).split(",")
    if origin.strip()
]

# Hvor mange dage før forfald en opgave markeres som "snart".
DUE_SOON_DAYS = int(os.environ.get("UBS_DUE_SOON_DAYS", "1"))

# --- Operatørskærmen --------------------------------------------------------
#
# Skærmen i produktionen holdes frisk med server-sent events fra os selv, ikke
# med Supabase realtime i browseren. Browseren har ingen nøgle til Supabase, og
# tabellerne har RLS uden policies, så den vej er lukket med vilje.
#
# Intervallet er, hvor ofte serveren kigger efter, om der er sket noget. Et par
# sekunder er rigeligt: en prøve tager minutter at tage, og forskellen mellem
# 2 og 10 sekunder mærkes ikke af nogen, der står ved en maskine.
LOT_STREAM_INTERVAL = float(os.environ.get("UBS_LOT_STREAM_INTERVAL", "3"))

# Hjerteslag på strømmen. Uden det kan skærmen ikke skelne "der er ingen nye
# prøver" fra "forbindelsen døde", og proxyer lukker stille en forbindelse,
# der ikke siger noget.
LOT_STREAM_HEARTBEAT = float(os.environ.get("UBS_LOT_STREAM_HEARTBEAT", "15"))
