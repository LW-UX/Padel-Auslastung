#!/usr/bin/env python3
"""Baut aus den erfassten Kalenderdaten ein eigenständiges HTML-Dashboard."""
import argparse
import csv
import json
from datetime import date, datetime, time, timedelta
from pathlib import Path
from tempfile import NamedTemporaryFile

from check_occupancy import BLOCK_MIN, CLUBS, CSV_PATH

ROOT = Path(__file__).resolve().parent
COURT_TYPES = {
    "Serve One Langweid": "Indoor",
    "Serve One Bergheim": "Indoor",
    "4030 Padel Club Augsburg": "Indoor",
    "DJK Lechhausen": "Outdoor",
    "TSG Lechhausen": "Outdoor",
}
SLOTS_PER_DAY = 24 * 60 // BLOCK_MIN
CONFLICT_MARKERS = {"=======", "<<<<<<<", ">>>>>>>", "|||||||"}


def load_data(path):
    """Wählt je Platz, Spieltag und Uhrzeit den jüngsten erfassten Stand."""
    snapshots = {}
    clubs = {club["name"]: COURT_TYPES.get(club["name"], "Unbekannt") for club in CLUBS}
    runs = {}
    latest = None
    skipped_markers = 0

    with path.open(encoding="utf-8-sig", newline="") as source:
        rows = csv.DictReader(source)
        required = {"run_at", "club", "date", "court", "from", "pattern",
                    "total_blocks", "booked_blocks", "note"}
        if not required.issubset(rows.fieldnames or []):
            raise ValueError("Die CSV enthält nicht alle Spalten für das Dashboard.")

        for row in rows:
            if row["run_at"].split(" ", 1)[0] in CONFLICT_MARKERS:
                skipped_markers += 1
                continue
            try:
                run = datetime.fromisoformat(row["run_at"])
                day = date.fromisoformat(row["date"])
                club, court = row["club"], row["court"]
                if not club or not court or run.date() > day:
                    raise ValueError("Ungültiger Standort, Platz oder Erfassungszeitpunkt.")
                if court == "ALLE":
                    continue
                start = time.fromisoformat(row["from"])
                offset = start.hour * 60 + start.minute
                pattern = row["pattern"]
                if (offset % BLOCK_MIN or start.second or offset // BLOCK_MIN + len(pattern) > SLOTS_PER_DAY
                        or len(pattern) != int(row["total_blocks"])
                        or pattern.count("X") != int(row["booked_blocks"])
                        or set(pattern) - {"X", "."}):
                    raise ValueError("Ungültiges Halbstundenraster.")
                ambiguous = bool(row["note"])
            except (TypeError, ValueError) as error:
                raise ValueError(f"CSV-Zeile {rows.line_num}: {error}") from error

            clubs.setdefault(club, "Unbekannt")
            runs[club] = max(run, runs.get(club, run))
            latest = max(run, latest or run)
            slots = snapshots.setdefault((day, club, court), [None] * SLOTS_PER_DAY)
            for i, status in enumerate(pattern, offset // BLOCK_MIN):
                if slots[i] is None or run >= slots[i][0]:
                    slots[i] = (run, "?" if ambiguous and status == "X" else status)

    records = []
    for (day, club, court), slots in sorted(snapshots.items()):
        if day > latest.date():
            continue
        states = []
        for i, measurement in enumerate(slots):
            end = datetime.combine(day, time()) + timedelta(minutes=(i + 1) * BLOCK_MIN)
            if measurement is None or end > latest:
                states.append("-")
                continue
            run, state = measurement
            states.append({"X": "x", ".": "f", "?": "u"}[state] if run.date() < day else state)
        if any(state != "-" for state in states):
            records.append([day.isoformat(), club, court, "".join(states)])

    return {
        "latest": latest.isoformat(timespec="minutes") if latest else None,
        "clubs": clubs,
        "openingDates": {club["name"]: club["opens_on"].isoformat() for club in CLUBS if "opens_on" in club},
        "runs": {club: run.isoformat(timespec="minutes") for club, run in runs.items()},
        "records": records,
        "skippedMarkers": skipped_markers,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=Path, default=CSV_PATH)
    parser.add_argument("--output", type=Path, default=ROOT / "padel-dashboard.html")
    args = parser.parse_args()
    try:
        data = load_data(args.csv)
    except (OSError, ValueError) as error:
        parser.exit(1, f"{error}\n")
    template = (ROOT / "dashboard" / "index.html").read_text(encoding="utf-8")
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")
    document = (
        template.replace("/* DASHBOARD_CSS */", (ROOT / "dashboard" / "style.css").read_text(encoding="utf-8"))
        .replace("/* DASHBOARD_JS */", (ROOT / "dashboard" / "app.js").read_text(encoding="utf-8"))
        .replace("<!-- DASHBOARD_DATA -->", payload)
    )
    temporary = None
    try:
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.output.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(document)
        temporary.replace(args.output)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    print(f"{args.output.resolve()} · {len(data['records'])} Platz-Tage")


if __name__ == "__main__":
    main()
