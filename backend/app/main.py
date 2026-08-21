"""UBS Spectral Inside. API.

Læser procedurer fra disk, holder styr på hvornår vedligeholdelse sidst blev
udført, og bærer udviklerens beskeder ud til analytikerne.

Rører aldrig VideometerLab. Måledata kommer ind ad en anden vej.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, time, timedelta, timezone

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, blobdb, classifiers, config, content, db, sync
from .schemas import (
    Band,
    BandSet,
    BlobRow,
    ClassCount,
    ClassifierVersion,
    ConfusionCell,
    ConfusionMatrix,
    DailyCompletion,
    Dashboard,
    MaintenanceReminder,
    RecentScan,
    ScanCounts,
    DisplayDetail,
    DisplaySample,
    DailyStatus,
    Health,
    ScanSummary,
    MaintenanceCompletion,
    MaintenanceLogEntry,
    MaintenanceStatus,
    Message,
    NewMessage,
    Operator,
    Procedure,
    ProcedureSummary,
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Fejler ikke, selv om databasen ikke kan nås. Procedurer og wiki læses fra
    # disk og skal virke uanset, de er det, operatøren har brug for ved
    # instrumentet.
    db.init()
    # Kun aktiv på maskinen med VideometerLabs filer. Alle andre steder
    # returnerer den med det samme.
    sync.start()
    yield
    sync.stop()
    db.close()


app = FastAPI(
    title="UBS Spectral Inside",
    description="Arbejdsbord for analytikere på VideometerLab med Autofeeder.",
    version=__version__,
    lifespan=lifespan,
)


@app.exception_handler(db.DatabaseUnavailable)
async def database_unavailable(request: Request, exc: db.DatabaseUnavailable):
    """503, ikke 500.

    Forskellen er ikke kosmetisk: 500 betyder "applikationen er i stykker" og
    sender operatøren til udvikleren, 503 betyder "prøv igen om lidt". Det er
    det rigtige svar, når det eneste, der er galt, er, at nettet er nede.
    """
    return JSONResponse(status_code=503, content={"detail": str(exc)})

app.add_middleware(
    CORSMiddleware,
    allow_origins=config.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Health -----------------------------------------------------------------


@app.get("/api/health", response_model=Health, tags=["system"])
def health() -> Health:
    problems = content.check()
    try:
        found = len(content.load_procedures())
    except content.ContentError:
        found = 0

    return Health(
        status="degraded" if problems else "ok",
        version=__version__,
        content_dir=str(config.CONTENT_DIR),
        procedures_found=found,
        problems=problems,
    )


# --- Operatører -------------------------------------------------------------
# Ikke autentificering. Formålet er at vide, hvem der registrerer hvad, så
# vedligeholdelsesloggen kan bruges bagefter. Der er intet at logge ind på.


@app.get("/api/operators", response_model=list[Operator], tags=["operatører"])
def list_operators() -> list[Operator]:
    try:
        return content.load_operators()
    except content.ContentError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


# --- Procedurer -------------------------------------------------------------


@app.get("/api/procedures", response_model=list[ProcedureSummary], tags=["procedurer"])
def list_procedures() -> list[ProcedureSummary]:
    try:
        return content.list_procedure_summaries()
    except content.ContentError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/api/procedures/{procedure_id}", response_model=Procedure, tags=["procedurer"])
def get_procedure(procedure_id: str) -> Procedure:
    try:
        procedure = content.load_procedure(procedure_id)
    except content.ContentError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if procedure is None:
        raise HTTPException(status_code=404, detail=f"Ukendt procedure: {procedure_id}")
    return procedure


# --- Arbejdsbord ------------------------------------------------------------


@app.get("/api/dashboard", response_model=Dashboard, tags=["arbejdsbord"])
def dashboard(recent: int = 12) -> Dashboard:
    """Alt forsiden skal bruge, i ét kald.

    Tællingerne bygger på datoen i filnavnet, ikke på hvornår filen blev
    skrevet. Det er analytikerens egen angivelse af, hvornår prøven blev
    kørt, og det er den, de genkender.
    """
    statuses = _maintenance_statuses()
    reminder = MaintenanceReminder(
        overdue=sum(1 for s in statuses if s.state == "overdue"),
        due_soon=sum(1 for s in statuses if s.state == "due_soon"),
        never=sum(1 for s in statuses if s.state == "never"),
        titles=[
            s.task.title
            for s in statuses
            if s.state in ("overdue", "due_soon", "never")
        ],
    )

    today = db.now().date()
    yesterday = today - timedelta(days=1)
    week_ago = today - timedelta(days=7)

    summaries: list[blobdb.ScanSummary] = []
    for path in blobdb.list_files():
        try:
            summaries.append(blobdb.summarise(path))
        except blobdb.BlobDbError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    dated = [s for s in summaries if s.scanned_on]
    counts = ScanCounts(
        yesterday=sum(1 for s in dated if s.scanned_on == yesterday),
        today=sum(1 for s in dated if s.scanned_on == today),
        last_7_days=sum(1 for s in dated if s.scanned_on and s.scanned_on > week_ago),
    )

    # Nyeste først. Filer uden dato i navnet ryger bagerst frem for at forsvinde.
    summaries.sort(key=lambda s: (s.scanned_on is not None, s.scanned_on), reverse=True)

    row = db.latest_message()
    return Dashboard(
        message=_to_message(row) if row else None,
        reminder=reminder,
        scans=counts,
        recent=[
            RecentScan(
                id=s.id,
                recipe=s.recipe,
                sample=s.sample,
                operator=s.operator,
                scanned_on=s.scanned_on,
                blob_count=s.blob_count,
            )
            for s in summaries[: min(recent, 50)]
        ],
    )


# --- Daglige procedurer -----------------------------------------------------
# Procedurer markeret med `daily: true` i frontmatter skal køres én gang om
# dagen. Registreringen hænger på dagen, ikke på personen: når instrumentet
# først er varmt, er det varmt for alle fire.


@app.get("/api/daily", response_model=list[DailyStatus], tags=["dagligt"])
def daily_status() -> list[DailyStatus]:
    try:
        procedures = [p for p in content.list_procedure_summaries() if p.daily]
    except content.ContentError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    day = db.today()
    done = db.daily_done(day)

    return [
        DailyStatus(
            procedure_id=procedure.id,
            title=procedure.title,
            day=day,
            done=procedure.id in done,
            done_by=done[procedure.id]["done_by"] if procedure.id in done else None,
            done_at=(
                db.parse_ts(done[procedure.id]["done_at"])
                if procedure.id in done
                else None
            ),
        )
        for procedure in procedures
    ]


@app.post(
    "/api/daily/{procedure_id}/complete",
    response_model=DailyStatus,
    status_code=201,
    tags=["dagligt"],
)
def complete_daily(procedure_id: str, completion: DailyCompletion) -> DailyStatus:
    try:
        procedures = {p.id: p for p in content.list_procedure_summaries() if p.daily}
    except content.ContentError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    procedure = procedures.get(procedure_id)
    if procedure is None:
        raise HTTPException(
            status_code=404, detail=f"Ukendt daglig procedure: {procedure_id}"
        )

    day = db.today()
    row = db.mark_daily_done(day, procedure_id, completion.done_by)
    return DailyStatus(
        procedure_id=procedure_id,
        title=procedure.title,
        day=day,
        done=True,
        done_by=row["done_by"],
        done_at=db.parse_ts(row["done_at"]),
    )


# --- Vedligeholdelse --------------------------------------------------------


def _maintenance_statuses() -> list[MaintenanceStatus]:
    try:
        tasks = content.load_maintenance_tasks()
    except content.ContentError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    completions = db.last_completions()
    now = db.now()
    statuses: list[MaintenanceStatus] = []

    for task in tasks:
        row = completions.get(task.id)
        last_done_at = db.parse_ts(row["done_at"]) if row else None
        last_done_by = row["done_by"] if row else None

        if task.interval_days is None:
            statuses.append(
                MaintenanceStatus(
                    task=task,
                    state="event_driven",
                    last_done_at=last_done_at,
                    last_done_by=last_done_by,
                )
            )
            continue

        if last_done_at is None:
            statuses.append(
                MaintenanceStatus(
                    task=task,
                    state="never",
                    last_done_at=None,
                    last_done_by=None,
                )
            )
            continue

        due_at = last_done_at + timedelta(days=task.interval_days)

        # Regnes i kalenderdage, ikke i forløbet tid. En operatør tænker
        # "båndet skal renses på torsdag", ikke "om 2,17 døgn", og med
        # forløbet tid ville en opgave, der er 2 dage og 4 timer fra forfald,
        # blive vist som 3 dage og dermed varsle en dag for sent.
        days_until_due = (due_at.date() - now.date()).days

        # Varslet kan sættes pr. opgave. En kvartalsopgave, der først melder
        # sig dagen før, giver ingen mulighed for at nå at planlægge den.
        warn_days = task.warn_days if task.warn_days is not None else config.DUE_SOON_DAYS

        if days_until_due < 0:
            state = "overdue"
        elif days_until_due <= warn_days:
            state = "due_soon"
        else:
            state = "ok"

        statuses.append(
            MaintenanceStatus(
                task=task,
                state=state,
                last_done_at=last_done_at,
                last_done_by=last_done_by,
                due_at=due_at,
                days_until_due=days_until_due,
            )
        )

    # Det mest presserende først, så forsiden viser det, der faktisk haster.
    priority = {"overdue": 0, "never": 1, "due_soon": 2, "ok": 3, "event_driven": 4}
    statuses.sort(key=lambda s: (priority[s.state], s.task.title))
    return statuses


@app.get("/api/maintenance", response_model=list[MaintenanceStatus], tags=["vedligehold"])
def maintenance_status() -> list[MaintenanceStatus]:
    return _maintenance_statuses()


@app.post(
    "/api/maintenance/{task_id}/complete",
    response_model=MaintenanceLogEntry,
    status_code=201,
    tags=["vedligehold"],
)
def complete_maintenance(task_id: str, completion: MaintenanceCompletion) -> MaintenanceLogEntry:
    try:
        known = {task.id for task in content.load_maintenance_tasks()}
    except content.ContentError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if task_id not in known:
        raise HTTPException(status_code=404, detail=f"Ukendt vedligeholdelsesopgave: {task_id}")

    done_at: datetime | None = None
    if completion.done_at is not None:
        # Datoen lægges midt på dagen i UTC. Middag ligger inden for samme
        # kalenderdag i alle tidszoner, så en dato valgt lokalt ikke ender
        # med at blive gemt som dagen før eller efter.
        done_at = datetime.combine(
            completion.done_at, time(12, 0), tzinfo=timezone.utc
        )
        if completion.done_at > (db.now().date() + timedelta(days=1)):
            raise HTTPException(
                status_code=422,
                detail="Datoen ligger i fremtiden. En opgave kan kun registreres som udført.",
            )

    row = db.log_maintenance(task_id, completion.done_by, completion.note, done_at)
    return MaintenanceLogEntry(
        id=row["id"],
        task_id=row["task_id"],
        done_at=db.parse_ts(row["done_at"]),
        done_by=row["done_by"],
        note=row["note"],
    )


@app.get(
    "/api/maintenance/{task_id}/log",
    response_model=list[MaintenanceLogEntry],
    tags=["vedligehold"],
)
def maintenance_history(task_id: str, limit: int = 25) -> list[MaintenanceLogEntry]:
    return [
        MaintenanceLogEntry(
            id=row["id"],
            task_id=row["task_id"],
            done_at=db.parse_ts(row["done_at"]),
            done_by=row["done_by"],
            note=row["note"],
        )
        for row in db.maintenance_log(task_id, limit=limit)
    ]


# --- Beskeder ---------------------------------------------------------------


def _to_message(row) -> Message:
    return Message(
        id=row["id"],
        body=row["body"],
        author=row["author"],
        created_at=db.parse_ts(row["created_at"]),
    )


@app.get("/api/message", response_model=Message | None, tags=["beskeder"])
def current_message() -> Message | None:
    row = db.latest_message()
    return _to_message(row) if row else None


@app.get("/api/messages", response_model=list[Message], tags=["beskeder"])
def message_history(limit: int = 50) -> list[Message]:
    return [_to_message(row) for row in db.list_messages(limit=limit)]


@app.post("/api/messages", response_model=Message, status_code=201, tags=["beskeder"])
def post_message(message: NewMessage) -> Message:
    return _to_message(db.add_message(message.body, message.author))


@app.delete("/api/messages/{message_id}", status_code=204, tags=["beskeder"])
def retract_message(message_id: int) -> None:
    if not db.retract_message(message_id):
        raise HTTPException(status_code=404, detail="Beskeden findes ikke eller er allerede trukket tilbage")


# --- Scanninger -------------------------------------------------------------
# Læser VideometerLabs blob-samlinger direkte fra disken, udelukkende
# skrivebeskyttet. Instrumentet og dets filer ændres aldrig herfra.


def _to_summary(summary: blobdb.ScanSummary) -> ScanSummary:
    return ScanSummary(
        **{
            **summary.__dict__,
            "classes": [
                ClassCount(name=c.name, count=c.count) for c in summary.classes
            ],
        }
    )


def _resolve_scan(scan_id: str):
    try:
        return blobdb.resolve(scan_id)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"Ukendt scanning: {scan_id}")


@app.get("/api/scans", response_model=list[ScanSummary], tags=["scanninger"])
def list_scans() -> list[ScanSummary]:
    results: list[ScanSummary] = []
    for path in blobdb.list_files():
        try:
            results.append(_to_summary(blobdb.summarise(path)))
        except blobdb.BlobDbError as exc:
            # En enkelt ulæselig fil må ikke skjule resten.
            raise HTTPException(status_code=500, detail=str(exc)) from exc
    return results


@app.get("/api/scans/{scan_id}", response_model=ScanSummary, tags=["scanninger"])
def get_scan(scan_id: str) -> ScanSummary:
    try:
        return _to_summary(blobdb.summarise(_resolve_scan(scan_id)))
    except blobdb.BlobDbError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get(
    "/api/scans/{scan_id}/blobs", response_model=list[BlobRow], tags=["scanninger"]
)
def get_scan_blobs(
    scan_id: str,
    limit: int = 120,
    offset: int = 0,
    predicted: str | None = None,
    only_corrected: bool = False,
) -> list[BlobRow]:
    path = _resolve_scan(scan_id)
    try:
        rows = blobdb.blobs(
            path,
            limit=min(limit, 500),
            offset=offset,
            predicted=predicted,
            only_corrected=only_corrected,
        )
    except blobdb.BlobDbError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return [BlobRow(**row.__dict__) for row in rows]


@app.get(
    "/api/scans/{scan_id}/blobs/{blob_id}/bands",
    response_model=BandSet,
    tags=["scanninger"],
)
def get_bands(scan_id: str, blob_id: str) -> BandSet:
    """Hvilke bånd frøet er optaget i.

    Bølgelængderne udledes af båndrækkefølgen og VideometerLab 4's LED-tabel.
    De står ikke som tal i filen, så har instrumentet en anden opsætning, eller
    er der valgt færre bånd i Light Setup, passer de ikke.
    """
    path = _resolve_scan(scan_id)
    try:
        count = blobdb.band_count(path, blob_id)
    except blobdb.BlobDbError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if count == 0:
        raise HTTPException(status_code=404, detail="Ingen båndbilleder for denne blob")

    known = len(blobdb.BAND_WAVELENGTHS)
    matches = count == known
    bands = []
    for i in range(count):
        nm = blobdb.BAND_WAVELENGTHS[i] if matches else None
        bands.append(
            Band(
                index=i,
                wavelength=nm,
                label=f"{nm} nm" if nm else f"Bånd {i + 1}",
            )
        )

    return BandSet(
        blob_id=blob_id,
        count=count,
        bands=bands,
        note=(
            ""
            if matches
            else f"{count} bånd, men tabellen kender {known}. Bølgelængderne vises derfor ikke."
        ),
    )


@app.get("/api/scans/{scan_id}/blobs/{blob_id}/band/{index}", tags=["scanninger"])
def get_band(scan_id: str, blob_id: str, index: int) -> Response:
    path = _resolve_scan(scan_id)
    try:
        data = blobdb.band(path, blob_id, index)
    except blobdb.BlobDbError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if data is None:
        raise HTTPException(status_code=404, detail=f"Bånd {index} findes ikke")

    return Response(
        content=data,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400, immutable"},
    )


@app.get("/api/scans/{scan_id}/blobs/{blob_id}/thumbnail", tags=["scanninger"])
def get_thumbnail(scan_id: str, blob_id: str) -> Response:
    path = _resolve_scan(scan_id)
    try:
        data = blobdb.thumbnail(path, blob_id)
    except blobdb.BlobDbError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    if data is None:
        raise HTTPException(status_code=404, detail="Ingen miniature for denne blob")

    # Blobbene ændrer sig ikke, når samlingen først er gemt.
    return Response(
        content=data,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400, immutable"},
    )


# --- Operatørvisning --------------------------------------------------------
# Den skærm, operatøren i produktionen ser. Den kræver ingen indlogning: at
# skulle taste initialer for at læse et tal er friktion uden formål, og
# initialerne beskytter alligevel ingenting.
#
# Visningen kender ikke klassenavnet. Den spørger serveren, så skiftet fra
# purity til skade sker ét sted i konfigurationen.


def _display_of(summary: blobdb.ScanSummary) -> DisplaySample:
    focus = next(
        (c.count for c in summary.classes if c.name == config.FOCUS_CLASS), 0
    )
    return DisplaySample(
        id=summary.id,
        sample=summary.sample,
        analyst=summary.operator,
        scanned_on=summary.scanned_on,
        total_seeds=summary.blob_count,
        focus_count=focus,
        focus_share=(focus / summary.labelled_count) if summary.labelled_count else 0.0,
        unplaced_count=summary.unknown_count,
    )


@app.get("/api/display/samples", response_model=list[DisplaySample], tags=["visning"])
def display_samples(limit: int = 24) -> list[DisplaySample]:
    samples: list[DisplaySample] = []
    for path in blobdb.list_files()[: min(limit, 100)]:
        try:
            samples.append(_display_of(blobdb.summarise(path)))
        except blobdb.BlobDbError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc
    return samples


@app.get(
    "/api/display/samples/{scan_id}", response_model=DisplayDetail, tags=["visning"]
)
def display_sample(scan_id: str) -> DisplayDetail:
    path = _resolve_scan(scan_id)
    try:
        summary = blobdb.summarise(path)
        rows = blobdb.blobs(path, limit=500, predicted=config.FOCUS_CLASS)
    except blobdb.BlobDbError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return DisplayDetail(
        **_display_of(summary).model_dump(),
        focus_class=config.FOCUS_CLASS,
        focus_label=config.FOCUS_LABEL,
        blobs=[BlobRow(**row.__dict__) for row in rows],
    )


# --- Analyse ----------------------------------------------------------------


@app.get(
    "/api/analysis/classifiers",
    response_model=list[ClassifierVersion],
    tags=["analyse"],
)
def list_classifier_versions() -> list[ClassifierVersion]:
    return classifiers.list_classifiers()


@app.get(
    "/api/analysis/confusion", response_model=ConfusionMatrix, tags=["analyse"]
)
def confusion_matrix(scan_id: str | None = None) -> ConfusionMatrix:
    """Modellens gæt holdt op mod operatørernes rettelser.

    Bemærk at det ikke er den confusion matrix, CDT viser efter træning. Denne
    er målt på produktionsdata og kun på de blobs, nogen har sat en
    referenceklasse på. Blobs, ingen har rørt, tæller ikke med, og derfor er
    tallene skæve mod det, operatørerne valgte at kigge nærmere på.
    """
    paths = [_resolve_scan(scan_id)] if scan_id else blobdb.list_files()

    totals: dict[tuple[str, str], int] = {}
    included = 0
    for path in paths:
        try:
            for reference, predicted, count in blobdb.confusion(path):
                key = (reference, predicted)
                totals[key] = totals.get(key, 0) + count
            included += 1
        except blobdb.BlobDbError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    labels = sorted({name for pair in totals for name in pair})
    cells = [
        ConfusionCell(reference=ref, predicted=pred, count=n)
        for (ref, pred), n in sorted(totals.items(), key=lambda kv: -kv[1])
    ]
    total = sum(totals.values())
    correct = sum(n for (ref, pred), n in totals.items() if ref == pred)

    return ConfusionMatrix(
        labels=labels,
        cells=cells,
        total=total,
        correct=correct,
        scans_included=included,
        note=(
            "Dette er IKKE modellens træfsikkerhed. Kun blobs, hvor nogen har "
            "sat en referenceklasse, tæller med, og operatørerne retter "
            "fortrinsvis det, modellen tog fejl af. Tallene viser altså hvor "
            "rettelserne falder, ikke hvor ofte modellen rammer rigtigt."
        ),
    )


# --- Frontend ---------------------------------------------------------------
# Er der bygget en frontend, serveres den herfra, så alt kan køre som én proces.
# Under udvikling kører Vite sin egen server, og denne blok springes over.

if config.FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="frontend")
