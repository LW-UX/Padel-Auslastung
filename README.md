# Playtomic-Auslastung

Erfasst dreimal täglich (6, 10, 15 Uhr) die Platz-Auslastung dieser Clubs:

- Serve One Padel Langweid
- Serve One Padel Bergheim
- BIMA Athletics Bobingen (noch nicht eröffnet, in `CLUBS` auskommentiert)
- DJK Lechhausen, 2 Außenplätze (eBuSy)
- TSG Lechhausen, 3 Außenplätze (eBuSy über Padelstars)

Geprüft wird jeweils **heute** (nur die restlichen Stunden, da Playtomic Vergangenes nicht mehr anzeigt) und der Tag **in 4 Tagen**.

```bash
python3 check_occupancy.py
```

Die Ergebnisse werden an [data/occupancy.csv](data/occupancy.csv) angehängt, eine Zeile pro Club, Datum und Platz (`court = ALLE` ist die Summe pro Club).

- `occupancy_pct`: Anteil belegter 30-Minuten-Blöcke innerhalb der Öffnungszeiten
- `morgens_pct` / `nachmittags_pct` / `abends_pct`: vor 12 Uhr, 12–17 Uhr, ab 17 Uhr
- `pattern`: ein Zeichen pro 30 Minuten ab `from`, `X` = belegt, `.` = frei

**Playtomic** (Serve One, BIMA): Ein Block zählt als frei, wenn ein buchbarer Slot ihn abdeckt. Kurze Lücken, die man nicht mehr buchen kann, zählen deshalb als belegt. Datenquelle ist `https://playtomic.com/api/clubs/availability`, also dieselbe Schnittstelle, die auch die Club-Seite nutzt. Plätze und Öffnungszeiten liest das Skript bei jedem Lauf von der Club-Seite.

**eBuSy** (DJK, TSG): Ein Block zählt als belegt, wenn eine Buchung oder Sperre ihn abdeckt. Das Raster (Plätze, Uhrzeiten) stammt aus der öffentlichen Tagesansicht, die Buchungen aus deren JSON-Abfrage (`?selectedDate=MM/DD/YYYY`). Ein Login ist nicht nötig. Bei den Außenplätzen kann das Wetter die Zahlen verzerren.

Soll das in der Cloud laufen, muss die Umgebung diese Domains erreichen dürfen: `playtomic.com`, `padel-djk-lechhausen.ebusy.de` und `ebusy.padelstars.eu`.
