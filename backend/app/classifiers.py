"""Læser de gemte klassifikatorer.

En .vmclf er XML. Vi læser kun toppen af filen, fordi beslutningstræet
længere nede kan fylde adskillige megabyte, og navn og klasser står først.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

from . import config
from .schemas import ClassifierVersion

# "Purity beet v3.7" -> "3.7". Versionen står i filnavnet, ikke i XML'en.
_VERSION = re.compile(r"[vV](\d+(?:\.\d+)*)\s*$")
_CLASS = re.compile(r"<BlobClass>.*?<Name>(.*?)</Name>", re.S)

# Nok til at dække header og klasseliste uden at læse hele træet.
_HEAD_BYTES = 20_000


def _classes(path: Path) -> list[str]:
    try:
        head = path.read_text(encoding="utf-8", errors="replace")[:_HEAD_BYTES]
    except OSError:
        return []

    seen: list[str] = []
    for name in _CLASS.findall(head):
        cleaned = name.strip()
        if cleaned and cleaned not in seen:
            seen.append(cleaned)
    return seen


def list_classifiers() -> list[ClassifierVersion]:
    if not config.CLASSIFIERS_DIR.is_dir():
        return []

    found: list[ClassifierVersion] = []
    for path in config.CLASSIFIERS_DIR.glob("*.vmclf"):
        stat = path.stat()
        stem = path.stem
        match = _VERSION.search(stem)
        found.append(
            ClassifierVersion(
                name=stem,
                version=match.group(1) if match else None,
                filename=path.name,
                classes=_classes(path),
                size_bytes=stat.st_size,
                modified_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
            )
        )

    # Nyeste øverst. Filnavnets version sorterer ikke rigtigt som tekst
    # ("v3.10" før "v3.9"), så der sorteres på tidspunkt.
    found.sort(key=lambda c: c.modified_at, reverse=True)
    return found
