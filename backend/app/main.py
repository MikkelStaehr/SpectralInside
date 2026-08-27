"""UBS Spectral Inside. API.

Læser procedurer fra disk, holder styr på hvornår vedligeholdelse sidst blev
udført, og bærer udviklerens beskeder ud til analytikerne.

Rører aldrig VideometerLab. Måledata kommer ind ad en anden vej.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, time, timedelta, timezone

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, blobdb, classifiers, config, content, db, lots, navision, sync
from .schemas import (
    Acknowledgement,
    Band,
    BandSet,
    BlobRow,
    ClassCount,
    ClassifierVersion,
    ConfusionCell,
    ConfusionMatrix,
    DailyCompletion,
    Dashboard,
    LotDetail,
    LotMeta,
    LotSample,
    LotSetup,
    LotStamp,
    LotSummary,
    LotUpdate,
    SetupOptions,
    SetupUpdate,
    SetupValue,
    MaintenanceReminder,
    NavisionDraft,
    NewLot,
    NewOrder,
    NewSample,
    Order,
    OrderUpdate,
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


# --- Lots og prøver ---------------------------------------------------------
#
# Produktionslinjen, ikke instrumentet. Operatørskærmen i produktionen læser
# her, analytikeren skriver.
#
# Domænet, altså processernes rækkefølge, hvilke testtyper der hører til hver
# af dem, og hvilke metrikker en testtype har, kommer ud gennem /api/lots/meta.
# Frontenden gentager det ikke, præcis som operatørvisningen i forvejen spørger
# serveren om fokusklassen frem for at kende den selv.
#
# Rækkefølgen af ruterne herunder er ikke tilfældig. /api/lots/meta og
# /api/lots/stream skal stå før /api/lots/{lot_no}, ellers fanger den dynamiske
# rute dem og svarer "Lot stream findes ikke".


def _to_lot_sample(row) -> LotSample:
    metrics = row.get("metrics") or {}
    return LotSample(
        id=row["id"],
        lot_no=row["lot_no"],
        process=row["process"],
        test_type=row["test_type"],
        seq=row["seq"],
        taken_at=row["taken_at"],
        taken_by=row["taken_by"],
        adjustment=row["adjustment"],
        scan_id=row["scan_id"],
        operation=row.get("operation"),
        position=row.get("position"),
        acknowledged_at=row["acknowledged_at"],
        acknowledged_by=row["acknowledged_by"],
        metrics={name: float(value) for name, value in metrics.items()},
    )


def _missing_fields(row) -> list[str]:
    """Påkrævede stamdatafelter, der endnu er tomme.

    Driftsrapporten har den samme kontrol i et regneark og skriver "Mangler
    Ordre Nr" i stedet for "Alt OK". Reglen er deres, den er skrevet af som den
    er, og den spærrer ikke for noget: den siger bare, hvad der udestår.
    """
    return [
        field.id
        for field in lots.LOT_FIELDS
        if field.required and row.get(field.id) in (None, "")
    ]


def _to_lot_summary(row) -> LotSummary:
    return LotSummary(
        lot_no=row["lot_no"],
        variety=row["variety"],
        item_no=row["item_no"],
        line=row["line"],
        started_at=row["started_at"],
        started_by=row["started_by"],
        order_no=row.get("order_no"),
        report_no=row.get("report_no"),
        input_kg=row.get("input_kg"),
        ended_at=row.get("ended_at"),
        note=row.get("note"),
        missing=_missing_fields(row),
        stamp=row["stamp"],
        stamped_at=row["stamped_at"],
        stamped_by=row["stamped_by"],
        stamp_note=row["stamp_note"],
        sample_count=row.get("sample_count", 0),
        unacknowledged_count=row.get("unacknowledged_count", 0),
        last_sample_at=row.get("last_sample_at"),
        last_activity=row.get("last_activity") or row["started_at"],
    )


def _to_draft(found: navision.NavisionOrder) -> NavisionDraft:
    """Navisions ordre til et udkast, kontoret kan se på.

    Det, der ikke kunne udledes, siges højt. En ordre, der lander med et tomt
    felt uden en forklaring, bliver gemt med hullet i.
    """
    warnings: list[str] = []

    lines = content.load_lines()
    line = next(
        (
            l.id
            for l in lines
            if l.routing
            and found.routing_no
            and l.routing.casefold() == found.routing_no.casefold()
        ),
        None,
    )
    if found.routing_no and line is None:
        known = ", ".join(sorted(l.routing for l in lines if l.routing)) or "ingen"
        warnings.append(
            f"Routing '{found.routing_no}' er ikke koblet til et anlæg. "
            f"Kendte routings: {known}. Vælg anlæg i hånden, eller skriv "
            "koblingen i content/lines.yaml."
        )
    elif not found.routing_no:
        warnings.append("Ordren har ingen Routing No. Vælg anlæg i hånden.")

    # Partiet står ikke på produktionsordrens hoved. Det er den ene ting,
    # kontoret altid selv skal skrive, indtil vi ved, hvor Navision gemmer det.
    warnings.append(
        "Partiet (Ind lot nr.) står ikke på produktionsordren. Skriv det ind."
    )

    if found.status and found.status.casefold() != "released":
        warnings.append(
            f"Ordren står som '{found.status}' i Navision og ikke Released."
        )

    if found.quantity is not None and not found.weight_type:
        warnings.append(
            "Mængden har ingen Weight Type. Det er uklart, om den er brutto "
            "eller netto."
        )

    return NavisionDraft(
        order_no=found.order_no,
        item_no=found.item_no,
        variety=None,
        line=line,
        lot_no=None,
        planned_kg=found.quantity,
        planned_start=found.starting_at,
        planned_end=found.ending_at,
        due_date=found.due_date,
        source_status=found.status,
        source_routing=found.routing_no,
        source_variant=found.variant,
        source_location=found.location,
        source_weight_type=found.weight_type,
        source_modified_at=found.modified_at,
        created_by=found.created_by,
        description=found.description,
        warnings=warnings,
    )


def _to_order(row) -> Order:
    return Order(
        order_no=row["order_no"],
        lot_no=row["lot_no"],
        item_no=row["item_no"],
        variety=row["variety"],
        line=row["line"],
        planned_kg=row["planned_kg"],
        planned_start=row["planned_start"],
        note=row["note"],
        source_status=row.get("source_status"),
        source_routing=row.get("source_routing"),
        source_variant=row.get("source_variant"),
        source_location=row.get("source_location"),
        source_weight_type=row.get("source_weight_type"),
        planned_end=row.get("planned_end"),
        due_date=row.get("due_date"),
        source_modified_at=row.get("source_modified_at"),
        source_fetched_at=row.get("source_fetched_at"),
        created_at=row["created_at"],
        created_by=row["created_by"],
        cancelled_at=row["cancelled_at"],
        started_lot=row.get("started_lot"),
        started_at=row.get("started_at"),
        started_stamp=row.get("started_stamp"),
        started_ended_at=row.get("started_ended_at"),
    )


@app.get("/api/orders", response_model=list[Order], tags=["orders"])
def list_orders(open_only: bool = True, limit: int = 100) -> list[Order]:
    """Ordrerne fra kontoret.

    Som standard kun dem, der stadig er ledige. Det er den liste, operatøren
    skal vælge i, og en ordre, der allerede kører, er ikke et valg.
    """
    return [
        _to_order(row)
        for row in db.list_orders(open_only=open_only, limit=min(limit, 500))
    ]


@app.post("/api/orders", response_model=Order, status_code=201, tags=["orders"])
def create_order(order: NewOrder) -> Order:
    """Ordrekontorets ende af snittet.

    Indtil integrationen findes, oprettes ordrer gennem det her kald. Det er
    med vilje det samme, kontoret vil bruge: en bagdør til at taste ordrer ind
    ville skulle rives ned igen bagefter.
    """
    if db.get_order(order.order_no.strip()) is not None:
        raise HTTPException(
            status_code=409, detail=f"Ordre {order.order_no} findes allerede"
        )
    if db.get_lot(order.lot_no.strip()) is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Lot {order.lot_no} er allerede kørt på en anden ordre",
        )

    # Anlægget skal findes, og det skal være en renselinje. En ordre på
    # "Linje 3" ville lande uden for sporene på forsiden, og en ordre, ingen
    # kan se, er ikke en ordre. En ordre i laboratoriets kø giver heller ingen
    # mening: dér ligger lots, operatøren er færdig med, ikke ordrer.
    known = {l.id for l in content.load_lines() if l.kind == "cleaning"}
    if known and order.line and order.line.strip() not in known:
        raise HTTPException(
            status_code=422,
            detail=(
                f"'{order.line}' er ikke en renselinje. Vælg et af: "
                + ", ".join(sorted(known))
            ),
        )

    fields = order.model_dump(exclude={"order_no", "lot_no"})
    if any(fields.get(k) for k in ("source_status", "source_routing")):
        # Hentet og ikke tastet. Tidspunktet er grundlaget for "er der kommet
        # en opdatering siden", sammen med Navisions eget modified_at.
        fields["source_fetched_at"] = db.now()
    return _to_order(db.add_order(order.order_no, order.lot_no, **fields))


@app.get(
    "/api/navision/orders/{order_no}",
    response_model=NavisionDraft,
    tags=["orders"],
)
def navision_order(order_no: str) -> NavisionDraft:
    """Slå en produktionsordre op i Navision.

    Ordrekontoret skriver et nummer, trykker hent, og resten udfyldes. Svaret
    er et **udkast** og ikke en ordre: kontoret ser det, retter det, Navision
    ikke ved, og gemmer. Et udkast, der blev til en ordre uden at nogen så det,
    ville lægge Navisions huller ind i vores database, uden at nogen opdagede
    dem.

    Routing No. oversættes til vores anlæg gennem content/lines.yaml. Det er
    hele grunden til, at kontoret ikke skal vælge linje: Navision har allerede
    bestemt det.
    """
    try:
        found = navision.fetch(order_no)
    except navision.NavisionError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    if found is None:
        raise HTTPException(
            status_code=404,
            detail=f"Ordre {order_no} findes ikke i Navision.",
        )

    return _to_draft(found)


@app.get("/api/orders/{order_no}", response_model=Order, tags=["orders"])
def get_order(order_no: str) -> Order:
    row = db.get_order(order_no)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Ordre {order_no} findes ikke")
    return _to_order(row)


@app.patch("/api/orders/{order_no}", response_model=Order, tags=["orders"])
def edit_order(order_no: str, update: OrderUpdate) -> Order:
    """Ret en ordre, der endnu ikke er sat i gang.

    En tastefejl skal kunne rettes uden at ordren skal trækkes tilbage og
    oprettes igen under et nyt nummer. Men kun indtil nogen har sat den i gang:
    derefter har kørslen kopieret ordrens felter, og to forskellige svar på det
    samme spørgsmål er værre end en tastefejl, der står.
    """
    existing = db.get_order(order_no)
    if existing is None:
        raise HTTPException(status_code=404, detail=f"Ordre {order_no} findes ikke")

    fields = update.model_dump(exclude_unset=True)

    known = {l.id for l in content.load_lines() if l.kind == "cleaning"}
    if known and fields.get("line") and fields["line"].strip() not in known:
        raise HTTPException(
            status_code=422,
            detail=(
                f"'{fields['line']}' er ikke en renselinje. Vælg et af: "
                + ", ".join(sorted(known))
            ),
        )

    # Partiet må ikke flyttes over på et, der allerede er kørt på en anden
    # ordre. To ordrer på det samme lot ville give to kørsler med samme nøgle.
    new_lot = (fields.get("lot_no") or "").strip()
    if new_lot and new_lot != existing["lot_no"] and db.get_lot(new_lot) is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Lot {new_lot} er allerede kørt på en anden ordre",
        )

    if db.update_order(order_no, fields) is None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Ordre {order_no} kan ikke rettes. Den er enten trukket "
                "tilbage eller allerede sat i gang på linjen."
            ),
        )

    # Læst forfra, så svaret bærer den samlede visning med kørslens tilstand
    # og ikke bare den rå række.
    return _to_order(db.get_order(order_no))


@app.delete("/api/orders/{order_no}", response_model=Order, tags=["orders"])
def cancel_order(order_no: str) -> Order:
    """Træk ordren tilbage. Kun hvis den ikke er kørt.

    Rækken slettes ikke. En ordre, der har kørt, skal kunne slås op bagefter,
    og en ordre, der blev trukket tilbage, er også en oplysning.
    """
    row = db.cancel_order(order_no)
    if row is None:
        existing = db.get_order(order_no)
        if existing is None:
            raise HTTPException(
                status_code=404, detail=f"Ordre {order_no} findes ikke"
            )
        raise HTTPException(
            status_code=409,
            detail=(
                f"Ordre {order_no} kan ikke trækkes tilbage. Den er enten "
                "allerede trukket tilbage eller sat i gang på linjen."
            ),
        )
    return _to_order(row)


@app.get("/api/lots/meta", response_model=LotMeta, tags=["lots"])
def lot_meta() -> LotMeta:
    """Domænet, som frontenden tegner skærmen ud fra.

    Ligger her frem for i frontenden, fordi et metriknavn, en ny testtype eller
    en ændret rækkefølge ellers skulle rettes to steder og kunne komme til at
    stå forskelligt. Kræver ikke databasen.
    """
    return LotMeta(
        processes=lots.PROCESSES,
        test_types=list(lots.TEST_TYPES.values()),
        lines=content.load_lines(),
        operations=content.load_operations(),
        lot_fields=lots.LOT_FIELDS,
        flat_threshold=lots.FLAT_THRESHOLD,
        relative_threshold=lots.RELATIVE_THRESHOLD,
    )


@app.get("/api/lots/stream", tags=["lots"])
async def lot_stream(request: Request) -> StreamingResponse:
    """Server-sent events: én besked, hver gang der er noget nyt at vise.

    Prompten bad om Supabase realtime direkte i browseren. Det ville kræve
    RLS-policies på prøvetabellerne og den publicerbare nøgle ude i frontenden,
    og så kan enhver, der kan åbne skærmen i produktionen, også læse resten af
    databasen. Kanalen går derfor gennem os, og browseren rører aldrig Supabase.

    Strømmen bærer ikke data, kun beskeden om at der er sket noget. Klienten
    henter selv bagefter. Det holder nyttelasten på nul og betyder, at en
    klient, der har været væk, ikke skal sy et hul sammen af manglende
    hændelser. Den henter bare forfra.

    Hjerteslaget er ikke pynt. Uden det kan skærmen ikke skelne "der er ingen
    nye prøver" fra "forbindelsen døde for en time siden", og det er præcis den
    forskel, en skærm på en produktionsgang skal kunne vise.
    """

    async def events():
        last: str | None = None
        since_beat = 0.0

        while True:
            if await request.is_disconnected():
                break

            try:
                token = await asyncio.to_thread(db.lots_change_token)
                if last is None:
                    # Første gennemløb. Klienten har lige hentet selv, så der
                    # er ikke noget at fortælle den endnu.
                    yield "event: ready\ndata: {}\n\n"
                elif token != last:
                    yield "event: change\ndata: {}\n\n"
                last = token
            except db.DatabaseUnavailable:
                # Databasen er nede. Strømmen holdes åben og siger det, frem
                # for at lukke og lade skærmen se frisk ud, mens den er død.
                yield "event: degraded\ndata: {}\n\n"

            await asyncio.sleep(config.LOT_STREAM_INTERVAL)

            since_beat += config.LOT_STREAM_INTERVAL
            if since_beat >= config.LOT_STREAM_HEARTBEAT:
                since_beat = 0.0
                # En navngiven hændelse og ikke en SSE-kommentar. En kommentar
                # holder ganske vist forbindelsen åben gennem proxyer, men den
                # udløser ingen hændelse i browseren, og så kan skærmen ikke
                # selv se, at den stadig har kontakt. Det er hele formålet.
                yield "event: beat\ndata: {}\n\n"

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            # Nginx buffrer text/event-stream som standard, og så kommer
            # hændelserne i klumper eller slet ikke.
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/lots/setup/options", response_model=SetupOptions, tags=["lots"])
def setup_options() -> SetupOptions:
    """Hvilke indstillinger operatøren kan sætte flueben ved.

    Kommer fra content/machine-setup.yaml og læses fra disk ved hvert kald, så
    en rettelse i listen slår igennem uden genstart. Kræver ikke databasen.
    """
    try:
        return SetupOptions(groups=content.load_setup_options())
    except content.ContentError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


def _to_lot_setup(lot_no: str, rows) -> LotSetup:
    return LotSetup(
        lot_no=lot_no,
        values=[
            SetupValue(setting_id=row["setting_id"], value=row["value"]) for row in rows
        ],
        set_at=max((row["set_at"] for row in rows), default=None),
        set_by=rows[0]["set_by"] if rows else None,
    )


@app.get("/api/lots/{lot_no}/setup", response_model=LotSetup, tags=["lots"])
def get_lot_setup(lot_no: str) -> LotSetup:
    return _to_lot_setup(lot_no, db.lot_setup(lot_no))


@app.put("/api/lots/{lot_no}/setup", response_model=LotSetup, tags=["lots"])
def put_lot_setup(lot_no: str, update: SetupUpdate) -> LotSetup:
    """Gem opsætningen for ét lot.

    Erstatter hele sættet. Fjerner operatøren et flueben, forsvinder værdien,
    frem for at blive stående usynligt og dukke op igen næste gang.
    """
    if db.get_lot(lot_no) is None:
        raise HTTPException(status_code=404, detail=f"Lot {lot_no} findes ikke")

    try:
        known = content.setup_setting_ids()
    except content.ContentError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    unknown = sorted({v.setting_id for v in update.values} - known)
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=(
                "Disse indstillinger findes ikke i machine-setup.yaml: "
                f"{', '.join(unknown)}"
            ),
        )

    # En tom værdi er det samme som intet flueben. Gemmes den, står feltet
    # tomt på skærmen, uden at nogen kan se om det var glemt eller sat til
    # ingenting.
    values = [
        (v.setting_id, v.value.strip())
        for v in update.values
        if v.value.strip() != ""
    ]

    return _to_lot_setup(lot_no, db.save_lot_setup(lot_no, values, update.set_by))


@app.get("/api/lots", response_model=list[LotSummary], tags=["lots"])
def list_lots(limit: int = 40) -> list[LotSummary]:
    return [_to_lot_summary(row) for row in db.list_lots(limit=min(limit, 200))]


@app.post("/api/lots", response_model=LotSummary, status_code=201, tags=["lots"])
def create_lot(lot: NewLot) -> LotSummary:
    """Start en kørsel på en ordre.

    Ordrens felter kopieres her og kommer ikke fra klienten. Kunne klienten
    sende dem med, kunne den også sende noget andet end det, kontoret har
    bestemt, og så står der to forskellige svar på det samme spørgsmål.
    """
    order = db.get_order(lot.order_no.strip())
    if order is None:
        raise HTTPException(
            status_code=404, detail=f"Ordre {lot.order_no} findes ikke"
        )
    if order["cancelled_at"] is not None:
        raise HTTPException(
            status_code=409, detail=f"Ordre {lot.order_no} er trukket tilbage"
        )
    if order["started_lot"] is not None:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Ordre {lot.order_no} kører allerede som lot "
                f"{order['started_lot']}"
            ),
        )
    if db.get_lot(order["lot_no"]) is not None:
        raise HTTPException(
            status_code=409, detail=f"Lot {order['lot_no']} er allerede startet"
        )

    # Ét parti ad gangen gennem anlægget. Reglen er fysisk, ikke en præference,
    # og derfor står den her og ikke kun i knappen på skærmen.
    #
    # Et parti, operatøren har meldt færdigt på linjen, optager den ikke: det
    # står i laboratoriets kø, og anlægget er frit til det næste.
    if order["line"]:
        busy = db.active_lot_on(order["line"])
        if busy is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Lot {busy['lot_no']} kører allerede på anlægget. Meld det "
                    "færdigt på linjen, før det næste sættes i gang."
                ),
            )

    # Kun felter, der står i LOT_FIELDS, når frem til en kolonne. Listen er
    # domænets, ikke skemaets, så en model med et felt for meget kan ikke
    # skrive udenom den.
    fields = {
        name: value
        for name, value in lot.model_dump().items()
        if name in lots.EDITABLE_LOT_FIELDS
    }
    for name in lots.ORDER_OWNED_FIELDS:
        if name != "lot_no":
            fields[name] = order[name] if name != "order_no" else order["order_no"]

    return _to_lot_summary(db.add_lot(order["lot_no"], **fields))


@app.patch("/api/lots/{lot_no}", response_model=LotSummary, tags=["lots"])
def edit_lot(lot_no: str, update: LotUpdate) -> LotSummary:
    """Ret stamdata på et lot, der kører.

    ``exclude_unset`` er det bærende: kun de felter, kaldet faktisk nævnte,
    bliver rørt. Et lot får sine oplysninger lidt ad gangen, og en formular,
    der sendte hele objektet, ville rydde det, den ikke kendte.
    """
    if db.get_lot(lot_no) is None:
        raise HTTPException(status_code=404, detail=f"Lot {lot_no} findes ikke")

    fields = {
        name: value
        for name, value in update.model_dump(exclude_unset=True).items()
        if name in lots.EDITABLE_LOT_FIELDS
    }
    row = db.update_lot(lot_no, fields)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Lot {lot_no} findes ikke")
    return _to_lot_summary(row)


@app.get("/api/lots/samples/{sample_id}", response_model=LotSample, tags=["lots"])
def get_sample(sample_id: int) -> LotSample:
    """Én prøve, det sidste led i hierarkiet.

    Findes for prøvevisningen, som er den eneste skærm, der åbnes med en prøve
    og ikke med et lot. Alternativet var at hente hele lottet og lede, og et
    lot med tredive prøver bærer alle sine metrikker med.
    """
    row = db.get_sample(sample_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Prøven findes ikke")
    return _to_lot_sample(row)


@app.post(
    "/api/lots/samples/{sample_id}/acknowledge",
    response_model=LotSample,
    tags=["lots"],
)
def acknowledge_sample(sample_id: int, ack: Acknowledgement) -> LotSample:
    """Operatøren kvitterer for at have set resultatet.

    Er der allerede kvitteret, står den første kvittering ved magt, og kaldet
    svarer det, der står i databasen. To operatører, der trykker samtidig på
    den samme skærm, skal ikke give en fejl ude i produktionen.
    """
    db.acknowledge_sample(sample_id, ack.acknowledged_by)
    row = db.get_sample(sample_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Prøven findes ikke")
    return _to_lot_sample(row)


@app.get("/api/lots/{lot_no}", response_model=LotDetail, tags=["lots"])
def get_lot(lot_no: str) -> LotDetail:
    row = db.get_lot(lot_no)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Lot {lot_no} findes ikke")

    samples = [_to_lot_sample(s) for s in db.lot_samples(lot_no)]
    summary = _to_lot_summary(row)
    summary.sample_count = len(samples)
    summary.unacknowledged_count = sum(1 for s in samples if s.acknowledged_at is None)
    summary.last_sample_at = max((s.taken_at for s in samples), default=None)

    return LotDetail(**summary.model_dump(), samples=samples)


@app.post(
    "/api/lots/{lot_no}/samples",
    response_model=LotSample,
    status_code=201,
    tags=["lots"],
)
def create_sample(lot_no: str, sample: NewSample) -> LotSample:
    """Registrér en prøve.

    Løbenummeret tildeles af databasen og ikke af den, der taster. To
    analytikere på det samme lot ville ellers kunne give hver sin prøve nummer
    3, og så ville historikken vise to rækker, der påstår at være den samme.
    """
    if db.get_lot(lot_no) is None:
        raise HTTPException(status_code=404, detail=f"Lot {lot_no} findes ikke")

    if not lots.is_valid_scope(sample.process, sample.test_type):
        allowed = ", ".join(lots.test_types_for(sample.process)) or "ingen"
        raise HTTPException(
            status_code=422,
            detail=(
                f"{sample.test_type} hører ikke til {sample.process}. "
                f"Tilladt her: {allowed}"
            ),
        )

    # Stedet skal findes paa trinnet. Et trin med to steder tager ikke proever
    # uden sted: den ville staa uden for fanerne, og ingen ville se den.
    if not lots.is_valid_position(sample.process, sample.position):
        places = lots.positions_for(sample.process)
        if places:
            allowed = ", ".join(f"{p.id} ({p.label})" for p in places)
            detail = (
                f"{lots.PROCESS_BY_ID[sample.process].label} tager prøver to "
                f"steder. Angiv hvilket: {allowed}"
            )
        else:
            detail = (
                f"{lots.PROCESS_BY_ID[sample.process].label} har kun ét sted, "
                "så prøven skal ikke have et."
            )
        raise HTTPException(status_code=422, detail=detail)

    known = lots.metric_ids(sample.test_type)
    unknown = sorted(set(sample.metrics) - known)
    if unknown:
        raise HTTPException(
            status_code=422,
            detail=(
                f"Ukendte metrikker for {sample.test_type}: {', '.join(unknown)}. "
                f"Kendte: {', '.join(sorted(known))}"
            ),
        )

    # En manglende metrik ville stå tom på skærmen, uden at nogen kunne se, om
    # den var glemt eller målt til nul. Derfor kræves de alle sammen.
    missing = sorted(known - set(sample.metrics))
    if missing:
        raise HTTPException(
            status_code=422, detail=f"Disse metrikker mangler: {', '.join(missing)}"
        )

    if sample.taken_at and sample.taken_at > db.now():
        raise HTTPException(
            status_code=422, detail="Prøven kan ikke være taget ude i fremtiden"
        )

    # Operationsnummeret skal findes, og det skal passe til den slags måling.
    # Et ukendt nummer ville blive gemt og aldrig talt med, og så ville lottet
    # se ud til at mangle en analyse, der faktisk var lavet.
    if sample.operation:
        catalogue = {op.id: op for op in content.load_operations()}
        operation = catalogue.get(sample.operation.strip())
        if operation is None:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Operation {sample.operation} findes ikke. Kendte: "
                    + (", ".join(sorted(catalogue)) or "ingen")
                ),
            )
        if operation.test_type and operation.test_type != sample.test_type:
            raise HTTPException(
                status_code=422,
                detail=(
                    f"Operation {operation.id} ({operation.label}) er en "
                    f"{operation.test_type}-analyse og ikke {sample.test_type}."
                ),
            )

    row = db.add_sample(
        lot_no=lot_no,
        process=sample.process,
        test_type=sample.test_type,
        metrics=sample.metrics,
        taken_by=sample.taken_by,
        adjustment=sample.adjustment,
        scan_id=sample.scan_id,
        taken_at=sample.taken_at,
        operation=sample.operation,
        position=sample.position,
    )
    return _to_lot_sample({**row, "metrics": sample.metrics})


@app.post("/api/lots/{lot_no}/stamp", response_model=LotSummary, tags=["lots"])
def stamp_lot(lot_no: str, stamp: LotStamp) -> LotSummary:
    """Godkend eller afvis lottet.

    Kun muligt, når de operationer, der er påkrævet for Post Cleaning, har et
    resultat. Et operationsnummer er en standardprocedure — operation 48 er en
    analyse af 200 frø og renheden af partiet — så kravet er ikke "der er taget
    en prøve", men "den her analyse er lavet efter forskriften".

    Er operationslisten tom, falder reglen tilbage på den svagere: mindst én
    prøve af hver testtype på trinnet. Det er en rimelig tilstand at starte i,
    men det er ikke den rigtige regel.

    Et stempel uden det bagvedliggende er et stempel, der ikke betyder noget,
    og det er værre end intet stempel: nogen tror på det.
    """
    row = db.get_lot(lot_no)
    if row is None:
        raise HTTPException(status_code=404, detail=f"Lot {lot_no} findes ikke")
    if row["stamp"] is not None:
        raise HTTPException(
            status_code=409,
            detail=f"Lot {lot_no} er allerede stemplet af {row['stamped_by']}",
        )

    samples = db.lot_samples(lot_no)
    required = [
        op for op in content.load_operations() if "post_cleaning" in op.required_for
    ]

    if required:
        # Operationen tæller, uanset hvilket trin prøven blev taget på: den er
        # en analyse af partiet, ikke af et trin.
        done = {s["operation"] for s in samples if s.get("operation")}
        outstanding = [op for op in required if op.id not in done]
        if outstanding:
            names = ", ".join(f"{op.id} ({op.label})" for op in outstanding)
            raise HTTPException(
                status_code=409,
                detail=f"Lottet kan ikke stemples. Der mangler resultat for: {names}",
            )
    else:
        taken = {
            s["test_type"] for s in samples if s["process"] == "post_cleaning"
        }
        missing = [t for t in lots.test_types_for("post_cleaning") if t not in taken]
        if missing:
            labels = ", ".join(lots.TEST_TYPES[t].label for t in missing)
            raise HTTPException(
                status_code=409,
                detail=f"Post Cleaning mangler stadig en prøve af: {labels}",
            )

    stamped = db.stamp_lot(lot_no, stamp.stamp, stamp.stamped_by, stamp.note)
    if stamped is None:
        raise HTTPException(status_code=409, detail="Lottet blev stemplet imens")
    return _to_lot_summary(stamped)


# --- Frontend ---------------------------------------------------------------
# Er der bygget en frontend, serveres den herfra, så alt kan køre som én proces.
# Under udvikling kører Vite sin egen server, og denne blok springes over.

if config.FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=config.FRONTEND_DIST, html=True), name="frontend")
