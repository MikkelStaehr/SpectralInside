"""Indlæsning af procedurer og vedligeholdelsesopgaver fra Markdown og YAML.

Indholdet er kilden til sandhed og ligger i git. Det læses fra disk ved hver
forespørgsel, så en rettelse i en procedure slår igennem uden genstart.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

import frontmatter
import yaml

from . import config
from .schemas import (
    Line,
    MaintenanceTask,
    Operator,
    Procedure,
    ProcedureSummary,
    SetupGroup,
    SetupSetting,
    Step,
)

# En procedure er opdelt i trin af H2-overskrifter. Alt før den første H2 er
# indledning. Det holder forfatterformatet til ren Markdown.
_STEP_HEADING = re.compile(r"^##[ \t]+(.+?)[ \t]*$", re.MULTILINE)

# Et trin kan kræve, at man venter, før man går videre: "## Vent {wait=60}".
# Bruges til de steder, hvor det at skynde sig ødelægger målingen.
_STEP_WAIT = re.compile(r"\{\s*wait\s*=\s*(\d+)\s*\}\s*$")


class ContentError(RuntimeError):
    """Indholdet på disk kunne ikke læses eller er ugyldigt."""


def _split_steps(body: str) -> tuple[str, list[Step]]:
    headings = list(_STEP_HEADING.finditer(body))
    if not headings:
        return body.strip(), []

    intro = body[: headings[0].start()].strip()
    steps: list[Step] = []
    for i, heading in enumerate(headings):
        start = heading.end()
        end = headings[i + 1].start() if i + 1 < len(headings) else len(body)

        title = heading.group(1).strip()
        wait_match = _STEP_WAIT.search(title)
        wait_seconds = int(wait_match.group(1)) if wait_match else None
        if wait_match:
            title = _STEP_WAIT.sub("", title).strip()

        steps.append(
            Step(
                index=i + 1,
                title=title,
                body=body[start:end].strip(),
                wait_seconds=wait_seconds,
            )
        )
    return intro, steps


def _mtime(path: Path) -> datetime:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)


def _parse_procedure(path: Path) -> Procedure:
    try:
        post = frontmatter.load(path, encoding="utf-8")
    except Exception as exc:  # pragma: no cover - defekt fil på disk
        raise ContentError(f"Kunne ikke læse {path.name}: {exc}") from exc

    meta = post.metadata
    procedure_id = str(meta.get("id") or path.stem)
    title = meta.get("title")
    if not title:
        raise ContentError(f"{path.name} mangler 'title' i frontmatter")

    intro, steps = _split_steps(post.content)

    order = meta.get("order", 999)
    try:
        order = int(order)
    except (TypeError, ValueError):
        order = 999

    return Procedure(
        id=procedure_id,
        title=str(title),
        lead=str(meta.get("lead") or ""),
        order=order,
        trigger=str(meta["trigger"]) if meta.get("trigger") else None,
        duration=str(meta["duration"]) if meta.get("duration") else None,
        icon=str(meta["icon"]) if meta.get("icon") else None,
        category=(
            "vedligehold"
            if str(meta.get("category", "")).strip().lower() == "vedligehold"
            else "wiki"
        ),
        daily=bool(meta.get("daily", False)),
        step_count=len(steps),
        updated_at=_mtime(path),
        intro=intro,
        steps=steps,
    )


def load_procedures() -> list[Procedure]:
    """Alle procedurer, sorteret efter 'order' og derefter titel."""
    if not config.PROCEDURES_DIR.is_dir():
        return []

    procedures: list[Procedure] = []
    for path in sorted(config.PROCEDURES_DIR.glob("*.md")):
        procedures.append(_parse_procedure(path))

    procedures.sort(key=lambda p: (p.order, p.title))
    return procedures


def load_procedure(procedure_id: str) -> Procedure | None:
    for procedure in load_procedures():
        if procedure.id == procedure_id:
            return procedure
    return None


def list_procedure_summaries() -> list[ProcedureSummary]:
    return [
        ProcedureSummary(**procedure.model_dump(exclude={"intro", "steps"}))
        for procedure in load_procedures()
    ]


def load_maintenance_tasks() -> list[MaintenanceTask]:
    if not config.MAINTENANCE_FILE.is_file():
        return []

    try:
        raw = yaml.safe_load(config.MAINTENANCE_FILE.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise ContentError(f"maintenance.yaml er ugyldig: {exc}") from exc

    tasks: list[MaintenanceTask] = []
    for entry in raw.get("tasks", []) or []:
        tasks.append(
            MaintenanceTask(
                id=str(entry["id"]),
                title=str(entry["title"]),
                interval_days=entry.get("interval_days"),
                warn_days=entry.get("warn_days"),
                procedure=entry.get("procedure"),
                why=str(entry.get("why") or "").strip(),
                note=str(entry["note"]).strip() if entry.get("note") else None,
                also_when=[str(item) for item in (entry.get("also_when") or [])],
            )
        )
    return tasks


def load_operators() -> list[Operator]:
    """De analytikere, der kan vælges på login-siden.

    Er filen tom eller fraværende, falder login-siden tilbage til fritekst.
    """
    if not config.OPERATORS_FILE.is_file():
        return []

    try:
        raw = yaml.safe_load(config.OPERATORS_FILE.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise ContentError(f"operators.yaml er ugyldig: {exc}") from exc

    operators: list[Operator] = []
    for entry in raw.get("operators", []) or []:
        initials = str(entry.get("initials") or "").strip()
        if not initials:
            continue
        name = str(entry["name"]).strip() if entry.get("name") else None
        role = str(entry.get("role") or "analytiker").strip().lower()
        if role not in ("analytiker", "udvikler", "ordrekontor"):
            role = "analytiker"
        operators.append(Operator(initials=initials, name=name, role=role))
    return operators


def load_lines() -> list[Line]:
    """Anlæggene på fabrikken.

    Forsiden har ét spor per anlæg, så listen her afgør, hvad der overhovedet
    står på skærmen. Er filen der ikke, er listen tom, og forsiden falder
    tilbage til én samlet liste frem for at vise ingenting.

    Rækkefølgen i filen er rækkefølgen på skærmen.
    """
    if not config.LINES_FILE.is_file():
        return []

    try:
        raw = yaml.safe_load(config.LINES_FILE.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise ContentError(f"lines.yaml er ugyldig: {exc}") from exc

    lines: list[Line] = []
    for entry in raw.get("lines", []) or []:
        line_id = str(entry.get("id") or "").strip()
        if not line_id:
            continue
        lines.append(
            Line(
                id=line_id,
                label=str(entry.get("label") or line_id).strip(),
                lead=str(entry.get("lead") or "").strip() or None,
            )
        )
    return lines


def load_setup_options() -> list[SetupGroup]:
    """Hvilke indstillinger operatøren kan registrere pr. lot.

    Er filen der ikke, er listen tom, og Opsætning-knappen siger det frem for
    at åbne en tom dialog. Det er en rimelig tilstand: applikationen skal virke
    på en maskine, hvor ingen endnu har skrevet linjens indstillinger ned.
    """
    if not config.MACHINE_SETUP_FILE.is_file():
        return []

    try:
        raw = yaml.safe_load(config.MACHINE_SETUP_FILE.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise ContentError(f"machine-setup.yaml er ugyldig: {exc}") from exc

    groups: list[SetupGroup] = []
    for entry in raw.get("groups", []) or []:
        settings: list[SetupSetting] = []
        for item in entry.get("settings", []) or []:
            kind = str(item.get("type") or "number").strip().lower()
            if kind not in ("number", "text", "choice"):
                kind = "number"
            settings.append(
                SetupSetting(
                    id=str(item["id"]),
                    label=str(item["label"]),
                    type=kind,
                    unit=str(item["unit"]) if item.get("unit") else None,
                    options=[str(o) for o in (item.get("options") or [])],
                    hint=str(item["hint"]).strip() if item.get("hint") else None,
                )
            )

        groups.append(
            SetupGroup(
                id=str(entry["id"]),
                title=str(entry["title"]),
                lead=str(entry.get("lead") or "").strip(),
                settings=settings,
            )
        )
    return groups


def setup_setting_ids() -> set[str]:
    """Alle kendte indstillings-id'er, til validering af det, der gemmes."""
    return {s.id for group in load_setup_options() for s in group.settings}


def check() -> list[str]:
    """Fejl i indholdet på disk, til brug i /api/health."""
    problems: list[str] = []

    if not config.CONTENT_DIR.is_dir():
        problems.append(f"Indholdsmappen findes ikke: {config.CONTENT_DIR}")
        return problems

    if not config.PROCEDURES_DIR.is_dir():
        problems.append(f"Proceduremappen findes ikke: {config.PROCEDURES_DIR}")

    try:
        procedures = load_procedures()
    except ContentError as exc:
        problems.append(str(exc))
        return problems

    seen: dict[str, str] = {}
    for procedure in procedures:
        if procedure.id in seen:
            problems.append(f"Dubleret procedure-id '{procedure.id}'")
        seen[procedure.id] = procedure.title
        if not procedure.steps:
            problems.append(f"Proceduren '{procedure.id}' har ingen trin (ingen H2-overskrifter)")

    try:
        tasks = load_maintenance_tasks()
    except ContentError as exc:
        problems.append(str(exc))
        return problems

    for task in tasks:
        if task.procedure and task.procedure not in seen:
            problems.append(
                f"Vedligeholdelsesopgaven '{task.id}' peger på ukendt procedure '{task.procedure}'"
            )

    # Et dubleret indstillings-id ville betyde, at to felter skrev til den
    # samme række i databasen, og at det ene overskrev det andet uden at nogen
    # kunne se det på skærmen.
    try:
        groups = load_setup_options()
    except ContentError as exc:
        problems.append(str(exc))
        return problems

    setting_ids: set[str] = set()
    for group in groups:
        for setting in group.settings:
            if setting.id in setting_ids:
                problems.append(f"Dubleret indstillings-id '{setting.id}' i machine-setup.yaml")
            setting_ids.add(setting.id)
            if setting.type == "choice" and not setting.options:
                problems.append(
                    f"Indstillingen '{setting.id}' er en choice uden options"
                )

    return problems
