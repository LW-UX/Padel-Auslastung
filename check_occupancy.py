#!/usr/bin/env python3
"""Erfasst die Platz-Auslastung von Playtomic-Clubs und haengt sie an data/occupancy.csv an.

Geprueft werden heute (nur die restlichen Stunden ab jetzt) und der Tag in DAYS_AHEAD Tagen.
Ein 30-Minuten-Block gilt als frei, wenn ein buchbarer Slot ihn abdeckt, sonst als belegt.
Nur Standardbibliothek, damit es in jeder Umgebung ohne pip install laeuft.
"""
import csv
import json
import re
import sys
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Berlin")
UTC = ZoneInfo("UTC")
DAYS_AHEAD = 4
BLOCK_MIN = 30
CSV_PATH = Path(__file__).parent / "data" / "occupancy.csv"
UA = {"User-Agent": "Mozilla/5.0 (occupancy-tracker)"}

CLUBS = [
    {"slug": "serve-one-padel-langweid", "name": "Serve One Langweid"},
    {"slug": "serve-one-padel", "name": "Serve One Bergheim"},
    # Noch nicht eroeffnet, Zeile einkommentieren sobald online buchbar:
    # {"slug": "bima-athletics", "name": "BIMA Bobingen"},
]

# Tageszeit-Fenster (lokale Zeit, Stunden) fuer die Auswertung
WINDOWS = [("morgens", 0, 12), ("nachmittags", 12, 17), ("abends", 17, 24)]

FIELDS = [
    "run_at", "club", "date", "weekday", "days_ahead", "court",
    "total_blocks", "booked_blocks", "occupancy_pct",
    "morgens_pct", "nachmittags_pct", "abends_pct",
    "from", "pattern", "note",
]
WEEKDAYS_DE = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]


def get(url):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8")


def extract_json(text, key, opener):
    """Liest das JSON-Objekt/Array hinter "key": aus dem eingebetteten Next.js-State."""
    start = text.find(f'"{key}":{opener}')
    if start < 0:
        return None
    i = start + len(key) + 3
    closer = "]" if opener == "[" else "}"
    depth = 0
    for j in range(i, len(text)):
        if text[j] == opener:
            depth += 1
        elif text[j] == closer:
            depth -= 1
            if depth == 0:
                return json.loads(text[i:j + 1])
    return None


def club_info(slug):
    html = get(f"https://playtomic.com/clubs/{slug}").replace('\\"', '"')
    tenant_id = re.search(r'"tenant":\{"tenant_id":"([0-9a-f-]{36})"', html).group(1)
    resources = extract_json(html, "resources", "[") or []
    courts = {r["resourceId"]: r["name"].strip() for r in resources if r.get("sport") == "PADEL"}
    hours = extract_json(html, "opening_hours", "{") or {}
    return tenant_id, courts, hours


def open_range(hours, day):
    """Oeffnungszeit als (start, ende) in Minuten seit Mitternacht; 00:00 als Ende = 24:00."""
    h = hours.get(day.strftime("%A").upper())
    if not h:
        return None
    to_min = lambda s: int(s[:2]) * 60 + int(s[3:5])
    start, end = to_min(h["opening_time"]), to_min(h["closing_time"])
    if end <= start:
        end += 24 * 60
    return start, min(end, 24 * 60)


def free_intervals(tenant_id, day):
    """Freie Intervalle je Court als lokale datetimes, nur Slots die am Zieltag beginnen."""
    data = json.loads(get(
        "https://playtomic.com/api/clubs/availability"
        f"?tenant_id={tenant_id}&date={day.isoformat()}&sport_id=PADEL"
    ))
    free = {}
    for entry in data:
        for s in entry["slots"]:
            start = datetime.fromisoformat(f'{entry["start_date"]}T{s["start_time"]}').replace(tzinfo=UTC).astimezone(TZ)
            if start.date() != day:
                continue
            free.setdefault(entry["resource_id"], []).append((start, start + timedelta(minutes=s["duration"])))
    return free


def pct(booked, total):
    return "" if total == 0 else round(100 * booked / total, 1)


def analyse(club, now):
    tenant_id, courts, hours = club_info(club["slug"])
    rows = []
    for days_ahead in (0, DAYS_AHEAD):
        day = (now + timedelta(days=days_ahead)).date()
        rng = open_range(hours, day)
        if not rng:
            continue
        free = free_intervals(tenant_id, day)
        midnight = datetime.combine(day, datetime.min.time(), tzinfo=TZ)
        blocks = [midnight + timedelta(minutes=m) for m in range(rng[0], rng[1], BLOCK_MIN)]
        if days_ahead == 0:
            blocks = [b for b in blocks if b >= now]  # Vergangenes zeigt Playtomic nicht mehr an
        if not blocks:
            continue
        note = "" if free else "keine freien Online-Slots (ausgebucht oder nicht online buchbar)"

        totals = {"all": [0, 0], **{w[0]: [0, 0] for w in WINDOWS}}
        court_rows = []
        for cid, cname in courts.items():
            ivs = free.get(cid, [])
            status = ["." if any(a <= b < e for a, e in ivs) else "X" for b in blocks]
            per = {"all": [0, 0], **{w[0]: [0, 0] for w in WINDOWS}}
            for b, st in zip(blocks, status):
                keys = ["all"] + [w[0] for w in WINDOWS if w[1] <= b.hour < w[2]]
                for k in keys:
                    per[k][0] += st == "X"
                    per[k][1] += 1
                    totals[k][0] += st == "X"
                    totals[k][1] += 1
            court_rows.append(row(now, club, day, days_ahead, cname, per, blocks[0], "".join(status), note))
        rows += [row(now, club, day, days_ahead, "ALLE", totals, blocks[0], "", note)] + court_rows
    return rows


def row(now, club, day, days_ahead, court, counts, first, pattern, note):
    booked, total = counts["all"]
    return {
        "run_at": now.strftime("%Y-%m-%d %H:%M"),
        "club": club["name"],
        "date": day.isoformat(),
        "weekday": WEEKDAYS_DE[day.weekday()],
        "days_ahead": days_ahead,
        "court": court,
        "total_blocks": total,
        "booked_blocks": booked,
        "occupancy_pct": pct(booked, total),
        **{f"{w[0]}_pct": pct(*counts[w[0]]) for w in WINDOWS},
        "from": first.strftime("%H:%M"),
        "pattern": pattern,
        "note": note,
    }


def main():
    now = datetime.now(TZ)
    rows, errors = [], []
    for club in CLUBS:
        try:
            rows += analyse(club, now)
        except Exception as e:  # ein kaputter Club soll die anderen nicht blockieren
            errors.append(f'{club["name"]}: {e}')

    if rows:  # bei Fehlern keine leere CSV anlegen
        CSV_PATH.parent.mkdir(parents=True, exist_ok=True)
        new = not CSV_PATH.exists()
        with CSV_PATH.open("a", newline="") as f:
            w = csv.DictWriter(f, fieldnames=FIELDS)
            if new:
                w.writeheader()
            w.writerows(rows)

    print(f"Auslastung {now:%a %d.%m.%Y %H:%M} (X = belegt, . = frei, je 30 min)")
    for r in rows:
        if r["court"] == "ALLE":
            label = "heute ab " + r["from"] if r["days_ahead"] == 0 else f'in {r["days_ahead"]} Tagen'
            print(f'\n{r["club"]} | {r["weekday"]} {r["date"]} ({label}): {r["occupancy_pct"]} % belegt '
                  f'(morgens {r["morgens_pct"]} / nachm. {r["nachmittags_pct"]} / abends {r["abends_pct"]})'
                  + (f'  [{r["note"]}]' if r["note"] else ""))
        else:
            print(f'   {r["court"]:<16} {r["occupancy_pct"]:>5} %  {r["pattern"]}')
    for e in errors:
        print("FEHLER", e, file=sys.stderr)
    return 1 if errors and not rows else 0


if __name__ == "__main__":
    sys.exit(main())
