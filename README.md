# Playtomic-Auslastung

Erfasst dreimal täglich (6, 10, 15 Uhr) die Platz-Auslastung dieser Clubs:

- Serve One Padel Langweid
- Serve One Padel Bergheim
- 4030 Padel Club Augsburg, 5 Doppel- und 2 Einzelplätze (Playtomic, für Spieltage ab 25.11.2026)
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

**Playtomic** (Serve One, 4030, BIMA): Ein Block zählt als frei, wenn ein buchbarer Slot ihn abdeckt. Kurze Lücken, die man nicht mehr buchen kann, zählen deshalb als belegt. Datenquelle ist `https://playtomic.com/api/clubs/availability`, also dieselbe Schnittstelle, die auch die Club-Seite nutzt. Plätze und Öffnungszeiten liest das Skript bei jedem Lauf von der Club-Seite.

Sperrt Playtomic eine Anfrage (HTTP 403 oder 429), versucht das Skript es nach 30 Sekunden und nach 2 Minuten erneut. Optional schickt es einen Browser-Cookie mit, wie in Padel-Liga: `PLAYTOMIC_COOKIE` enthält den Wert der Anfragekopfzeile „Cookie“ einer erfolgreichen `availability`-Anfrage im Browser, `PLAYTOMIC_USER_AGENT` den User-Agent desselben Browsers. Erneuerungstoken sowie Analyse- und Zahlungscookies werden nie mitgeschickt. Den Cookie nie ins Repo schreiben, das Repo ist öffentlich.

**eBuSy** (DJK, TSG): Ein Block zählt als belegt, wenn eine Buchung oder Sperre ihn abdeckt. Das Raster (Plätze, Uhrzeiten) stammt aus der öffentlichen Tagesansicht, die Buchungen aus deren JSON-Abfrage (`?selectedDate=MM/DD/YYYY`). Ein Login ist nicht nötig. Bei den Außenplätzen kann das Wetter die Zahlen verzerren.

Soll das in der Cloud laufen, muss die Umgebung diese Domains erreichen dürfen: `playtomic.com`, `padel-djk-lechhausen.ebusy.de` und `ebusy.padelstars.eu`.

## Auslastungsdashboard

`padel-dashboard.html` im Browser öffnen. Die Datei enthält die ausgewerteten Messungen und läuft offline. Nach neuen Erfassungen lässt sich die Datei neu bauen:

```bash
python3 -B build_dashboard.py
```

Die Oberfläche bietet frei wählbare Zeiträume, Tages-, Wochen- und Monatsansichten, den Vergleich mit einem gleich langen Vorzeitraum sowie Filter nach Indoor/Outdoor, Standort und Platz. Die Tagesmatrix öffnet die Halbstundenübersicht pro Platz. Der Vergleich lässt sich als CSV herunterladen.

„Plätze direkt vergleichen“ zeigt Kennzahlen, Zeitverlauf, Auslastung nach Uhrzeit und Einnahmen in einheitlichen Zeilen pro Platz. In diesem Modus öffnet ein Tageswert die Halbstunden aller Plätze für denselben Tag.

Für die Quote zählt jeder auswertbare Halbstundenblock einmal. Pro Block gilt der jüngste erfasste Stand, einschließlich Vorschauen, wenn vom Spieltag keine Messung vorliegt. Mehrdeutige Meldungen sind standardmäßig ausgeklammert. Die Übersicht zur Datenbasis zeigt Erfassungslücken und Vorschauanteile.

### Zahlungen importieren

In der Rubrik „Preise und Einnahmen“ gibt es eine CSV-Vorlage für einen lokalen Import. Erwartet wird eine Summenzeile je Spieltag und Platz mit diesen Spalten:

```csv
date;club;court;revenue_eur;paid_hours
```

- `date` im Format `JJJJ-MM-TT`. `club` und `court` entsprechen den Anzeigenamen aus der Erfassung.
- `revenue_eur` ist die tatsächlich vereinnahmte Platzmiete nach Erstattungen in Euro. `paid_hours` sind die dazugehörigen bezahlten Platzstunden.
- Komma und Semikolon werden als Feldtrenner unterstützt. Bei Semikolon als Feldtrenner sind Werte wie `38,00` und `1,5` möglich.
- Der Import bleibt im aktiven Browser-Tab. Die Tarifrechnung nutzt belegte Stunden und bearbeitbare €/h-Werte. Ihre Abdeckung steht neben dem Szenariobetrag.

### Veröffentlichen

Die erzeugte HTML-Datei lässt sich als Dateiartefakt teilen oder als `index.html` bei einem statischen Hoster bereitstellen. Für einen aktuellen Link kann der Erfassungslauf bei Erfolg einen Neubau und ein Deployment der HTML-Datei auslösen.
