#!/usr/bin/env python3
"""
Recupere le programme d'animations d'Arc 1950 et le prepare pour
CSMART TV / CSMART Hospitality Mobile.

La page source ne publie pas de flux structure : le programme est une serie
d'images (le programme papier de la semaine). Ce script :
  1. lit la page,
  2. extrait les URLs des visuels du programme,
  3. telecharge ces visuels dans img/ (pas de hotlinking depuis les afficheurs),
  4. ecrit programme.json consomme par index.html,
  5. supprime les visuels des semaines passees.

Usage :
    python3 scripts/scrape.py            # ecrit dans le depot
    python3 scripts/scrape.py --dry-run  # affiche ce qui serait fait
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import pathlib
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

SOURCE_URL = "https://www.arc1950.com/programme-danimations-1458"
USER_AGENT = "CSMART-Hospitality/1.0 (+programme animations Arc 1950)"
TIMEOUT = 30

ROOT = pathlib.Path(__file__).resolve().parent.parent
IMG_DIR = ROOT / "img"
JSON_PATH = ROOT / "programme.json"

# Les visuels du programme vivent dans /uploads/photos/contenus/hd/ et sont
# nommes sem_<semaine>_<index>_<idCMS>_<langue>.jpg  (ex: sem_35_012_1032_fr.jpg)
IMG_RE = re.compile(
    r"""/uploads/photos/contenus/hd/(sem[_-]\d+[^"'\s?>]*?\.(?:jpg|jpeg|png))""",
    re.IGNORECASE,
)
WEEK_RE = re.compile(r"sem[_-](\d+)", re.IGNORECASE)


def fetch(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def extract_images(html: str) -> list[str]:
    """URLs absolues des visuels, dans l'ordre d'apparition, sans doublon."""
    seen: set[str] = set()
    ordered: list[str] = []
    for match in IMG_RE.finditer(html):
        filename = match.group(1)
        if filename in seen:
            continue
        seen.add(filename)
        ordered.append(
            urllib.parse.urljoin(
                SOURCE_URL, f"/uploads/photos/contenus/hd/{filename}"
            )
        )
    return ordered


def week_of(filename: str) -> str | None:
    match = WEEK_RE.search(filename)
    return match.group(1) if match else None


def iso_week_bounds(week: str, year: int) -> tuple[str, str] | tuple[None, None]:
    """Lundi et dimanche de la semaine ISO, pour affichage."""
    try:
        monday = dt.date.fromisocalendar(year, int(week), 1)
    except ValueError:
        return None, None
    return monday.isoformat(), (monday + dt.timedelta(days=6)).isoformat()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--source", default=SOURCE_URL)
    args = parser.parse_args()

    try:
        html = fetch(args.source).decode("utf-8", errors="replace")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
        print(f"ERREUR : page source injoignable ({exc})", file=sys.stderr)
        return 1

    images = extract_images(html)
    if not images:
        # Garde-fou : si la structure de la page change, on ne veut surtout pas
        # ecraser un programme valide par une liste vide.
        print(
            "ERREUR : aucun visuel trouve. La structure de la page a "
            "probablement change. programme.json est laisse intact.",
            file=sys.stderr,
        )
        return 2

    filenames = [url.rsplit("/", 1)[-1] for url in images]
    week = week_of(filenames[0])
    now = dt.datetime.now(dt.timezone.utc)
    start, end = iso_week_bounds(week, now.year) if week else (None, None)

    payload = {
        "semaine": week,
        "debut": start,
        "fin": end,
        "source": args.source,
        "maj": now.replace(microsecond=0).isoformat(),
        "visuels": [{"fichier": f"img/{name}"} for name in filenames],
    }

    print(f"Semaine {week} — {len(images)} visuel(s)")
    for url in images:
        print(f"  {url}")

    if args.dry_run:
        print("\n--dry-run : rien n'a ete ecrit.")
        return 0

    IMG_DIR.mkdir(parents=True, exist_ok=True)

    downloaded: set[str] = set()
    for url, name in zip(images, filenames):
        target = IMG_DIR / name
        if target.exists() and target.stat().st_size > 0:
            downloaded.add(name)
            continue
        try:
            # maxwidth=2100 : la version haute definition servie par le CMS,
            # suffisante pour un affichage 1080p plein ecran.
            data = fetch(f"{url}?maxwidth=2100")
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as exc:
            print(f"ERREUR : telechargement de {name} impossible ({exc})", file=sys.stderr)
            return 3
        target.write_bytes(data)
        downloaded.add(name)
        print(f"  telecharge : {name} ({len(data) // 1024} Ko)")

    # Purge des semaines passees.
    for existing in IMG_DIR.iterdir():
        if existing.is_file() and existing.name not in downloaded:
            existing.unlink()
            print(f"  supprime : {existing.name}")

    JSON_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"\nprogramme.json ecrit ({len(filenames)} visuels).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
