#!/usr/bin/env python3
"""Empaqueta la extensión en site/mosaico.zip (la carpeta se llama «mosaico» al descomprimir)."""

import json
import zipfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
EXT = RAIZ / "extension"
SALIDA = RAIZ / "site" / "mosaico.zip"

version = json.loads((EXT / "manifest.json").read_text(encoding="utf8"))["version"]

with zipfile.ZipFile(SALIDA, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for f in sorted(EXT.rglob("*")):
        if f.is_file():
            z.write(f, Path("mosaico") / f.relative_to(EXT))

print(f"mosaico v{version} -> {SALIDA.relative_to(RAIZ)} ({SALIDA.stat().st_size / 1024:.1f} KB)")
