"use strict";

const data = JSON.parse(document.querySelector("#dashboard-data").textContent);
const get = id => document.getElementById(id);
const collator = new Intl.Collator("de", {numeric: true});
const decimal = new Intl.NumberFormat("de-DE", {maximumFractionDigits: 1});
const currency = new Intl.NumberFormat("de-DE", {style: "currency", currency: "EUR"});
const dateFormat = new Intl.DateTimeFormat("de-DE", {dateStyle: "medium", timeZone: "UTC"});
const shortDate = new Intl.DateTimeFormat("de-DE", {day: "2-digit", month: "2-digit", timeZone: "UTC"});
const monthFormat = new Intl.DateTimeFormat("de-DE", {month: "short", year: "numeric", timeZone: "UTC"});
const weekdays = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const dateKey = date => date.toISOString().slice(0, 10);
const asDate = key => new Date(key + "T00:00:00Z");
const shift = (key, days) => {
  const date = asDate(key);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
};
const weekday = day => (asDate(day).getUTCDay() + 6) % 7;
const formatDate = key => dateFormat.format(asDate(key));
const timeLabel = minute => String(Math.floor(minute / 60)).padStart(2, "0") + ":" + String(minute % 60).padStart(2, "0");
const percent = value => value === null ? "–" : decimal.format(value) + " %";
const hours = blocks => decimal.format(blocks / 2);
const safe = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const pair = (club, court) => JSON.stringify([club, court]);
const dateRange = (start, end) => {
  const result = [];
  for (let day = start; day <= end; day = shift(day, 1)) result.push(day);
  return result;
};
const lastDay = data.latest?.slice(0, 10) ?? dateKey(new Date());
const firstDay = data.records[0]?.[0] ?? lastDay;
const types = [...new Set(Object.values(data.clubs))].sort(collator.compare);
const clubs = Object.keys(data.clubs).sort(collator.compare);
const courts = new Map();
const records = data.records.map(([day, club, court, slots]) => {
  const key = pair(club, court);
  courts.set(key, {club, court, key});
  return {day, club, court, key, slots};
});
const courtList = [...courts.values()].sort((a, b) => collator.compare(a.club, b.club) || collator.compare(a.court, b.court));
const states = {
  X: ["Belegt", "booked"], ".": ["Frei", "free"], "?": ["Mehrdeutig", "unclear"],
  x: ["Belegt · Vorschau", "booked"], f: ["Frei · Vorschau", "free"], u: ["Mehrdeutig · Vorschau", "unclear"],
  "-": ["Ohne Messung", "missing"]
};
let activePreset = "30";
let payments = [];
let importVersion = 0;
let selectedDetail = null;
let calendarPage = 0;
const calendarPageSize = 31;
const comparingCourts = () => get("compare-courts").checked;
const selectedCourt = () => comparingCourts() ? "" : get("court").value;
const courtLabel = ({club, court}) => safe(club + " · " + court);

function summary() {
  return {valid: 0, booked: 0, preview: 0, unclear: 0, observed: 0, days: new Set()};
}

function count(target, state, day) {
  target.observed++;
  target.days.add(day);
  if (state === "?" || state === "u") {
    target.unclear++;
    if (!get("include-unknown").checked) return;
  }
  target.valid++;
  if ("Xx?u".includes(state)) target.booked++;
  if ("xfu".includes(state)) target.preview++;
}

function ratio(s) {
  return s?.valid ? s.booked * 100 / s.valid : null;
}

function change(current, previous) {
  const now = ratio(current), before = ratio(previous);
  if (now === null || before === null) return "–";
  const difference = Math.round((now - before) * 10) / 10;
  return (difference > 0 ? "+" : "") + decimal.format(difference) + " Pp.";
}

function clubInScope(club) {
  const selected = selectedCourt();
  return (!get("type").value || data.clubs[club] === get("type").value)
    && (!get("club").value || club === get("club").value)
    && (!selected || club === courts.get(selected)?.club);
}

function inScope({club, key}) {
  const selected = selectedCourt();
  return clubInScope(club) && (!selected || key === selected);
}

function accepted(state) {
  return state !== "-" && (!get("same-day").checked || !"xfu".includes(state));
}

function bucketFor(day) {
  if (get("bucket").value === "week") return shift(day, -weekday(day));
  if (get("bucket").value === "month") return day.slice(0, 7) + "-01";
  return day;
}

function bucketLabel(day) {
  if (get("bucket").value === "month") return monthFormat.format(asDate(day));
  if (get("bucket").value !== "week") return shortDate.format(asDate(day));
  const thursday = asDate(shift(day, 3));
  const year = thursday.getUTCFullYear();
  const week = Math.ceil((thursday - Date.UTC(year, 0, 1) + 86400000) / 604800000);
  return "KW " + week + " · " + year;
}

function rowsFor(start, end, detailed) {
  const totals = summary();
  const groups = new Map();
  const trend = new Map();
  const calendar = new Map();
  const grid = Array.from({length: 7}, () => Array.from({length: 24}, summary));
  const courtTrend = new Map();
  const courtHours = new Map();
  const compare = detailed && comparingCourts();
  const heatmapDay = get("heatmap-day").value;
  function tally(map, key, state, day) {
    if (!map.has(key)) map.set(key, summary());
    count(map.get(key), state, day);
  }
  for (const record of records) {
    const {day, club, key, slots} = record;
    if (day < start || day > end || !inScope(record)) continue;
    const bucket = detailed ? bucketFor(day) : null;
    const dayOfWeek = detailed ? weekday(day) : null;
    const calendarKey = detailed ? JSON.stringify([key, day]) : null;
    const trendKey = compare ? JSON.stringify([key, bucket]) : null;
    const matchesHeatmap = compare && (heatmapDay === "" || Number(heatmapDay) === dayOfWeek);
    for (const [index, state] of [...slots].entries()) {
      if (!accepted(state)) continue;
      count(totals, state, day);
      tally(groups, "type:" + data.clubs[club], state, day);
      tally(groups, "club:" + club, state, day);
      tally(groups, "court:" + key, state, day);
      if (detailed) {
        const hour = Math.floor(index / 2);
        tally(trend, bucket, state, day);
        tally(calendar, calendarKey, state, day);
        count(grid[dayOfWeek][hour], state, day);
        if (compare) tally(courtTrend, trendKey, state, day);
        if (matchesHeatmap) tally(courtHours, JSON.stringify([key, hour]), state, day);
      }
    }
  }
  return {totals, groups, trend, grid, calendar, courtTrend, courtHours};
}

function options(element, items) {
  const old = element.value;
  element.replaceChildren(element.options[0], ...items.map(([key, name]) => new Option(name, key)));
  if (items.some(([key]) => old === key)) element.value = old;
}

function refreshFilters() {
  options(get("club"), clubs.filter(club => !get("type").value || data.clubs[club] === get("type").value)
    .map(club => [club, club]));
  options(get("court"), courtList.filter(({club}) =>
    (!get("type").value || data.clubs[club] === get("type").value)
    && (!get("club").value || club === get("club").value))
    .map(({key, club, court}) => [key, get("club").value ? court : club + " · " + court]));
}

function compareRows() {
  const places = courtList.filter(inScope).map(({club, court, key}) => ["Platz", club + " · " + court, "court:" + key]);
  if (comparingCourts()) return places;
  return [
    ...types.filter(type => clubs.some(club => data.clubs[club] === type && clubInScope(club)))
      .map(type => ["Typ", type, "type:" + type]),
    ...clubs.filter(clubInScope)
      .map(club => ["Standort", club, "club:" + club]),
    ...places
  ];
}

function table(headers, rows, attributes = "") {
  return '<table ' + attributes + '><thead><tr>' + headers.map(header => '<th scope="col">' + header + '</th>').join("")
    + '</tr></thead><tbody>' + rows.join("") + '</tbody></table>';
}

function tr(label, cells) {
  return '<tr><th scope="row">' + label + '</th>' + cells.map(cell => '<td>' + cell + '</td>').join("") + '</tr>';
}

function tile(label, value, note) {
  return '<article><h2>' + label + '</h2><strong>' + value + '</strong><p>' + note + '</p></article>';
}

function color(value) {
  return value === null ? "missing" : "heat-" + Math.min(4, Math.floor(value / 20));
}

function heatCell(group) {
  const value = ratio(group);
  return '<td class="' + color(value) + '" title="' + (group?.valid ?? 0) + ' auswertbare Blöcke">'
    + percent(value) + '</td>';
}

function matrixRow(label, cells) {
  return '<tr><th scope="row">' + label + '</th>' + cells.join("") + '</tr>';
}

function renderCourtMatrix(id, columns, labels, summaries) {
  const places = courtList.filter(inScope);
  get(id).innerHTML = places.length ? table(["Platz", ...labels], places.map(place =>
    matrixRow(courtLabel(place), columns.map(column => heatCell(summaries.get(JSON.stringify([place.key, column])))))),
  'class="matrix court-matrix"') : "<p>Keine Plätze mit erfassten Kalenderdaten für diese Standortauswahl.</p>";
}

function renderTrend(current, days) {
  const buckets = [...new Set(days.map(bucketFor))];
  const label = key => bucketLabel(key) + (get("bucket").value === "day"
    ? '<span class="bar-weekday">' + weekdays[weekday(key)] + '</span>' : "");
  if (comparingCourts()) {
    renderCourtMatrix("trend", buckets, buckets.map(label), current.courtTrend);
    return;
  }
  get("trend").innerHTML = '<div class="trend" aria-label="Auslastung je Zeitraum">'
    + buckets.map(key => {
      const group = current.trend.get(key);
      const value = ratio(group);
      const title = group ? hours(group.booked) + " / " + hours(group.valid) + " h" : "Ohne Messung";
      return '<div class="bar-column" title="' + title + '"><b>' + percent(value) + '</b><div class="bar-track '
        + (value === null ? "missing" : "") + '"><div class="bar" style="height:' + (value ?? 0)
        + '%"></div></div><span>' + label(key) + '</span></div>';
    }).join("") + '</div>';
}

function renderComparison(current, previous) {
  const compare = comparingCourts();
  const headers = ["Auslastung", "Vorzeitraum", "Differenz", "Belegt (h)", "Auswertbar (h)", "Auswertbar zuvor (h)", "Messtage"];
  if (compare) headers.push("Vorschau-Blöcke", "Mehrdeutige Blöcke");
  get("comparison").innerHTML = table([...(compare ? ["Platz"] : ["Ebene", "Typ / Standort / Platz"]), ...headers],
    compareRows().map(([level, name, key]) => {
      const a = current.groups.get(key) ?? summary();
      const b = previous.groups.get(key);
      const cells = ['<b class="badge ' + color(ratio(a)) + '">' + percent(ratio(a)) + '</b>',
        percent(ratio(b)), change(a, b), a.valid ? hours(a.booked) : "–", hours(a.valid), hours(b?.valid ?? 0), a.days.size];
      return compare ? tr(safe(name), [...cells, a.preview, a.unclear]) : tr(level, [safe(name), ...cells]);
    }));
}

function renderHeatmap(current) {
  const columns = Array.from({length: 24}, (_, hour) => hour);
  const labels = columns.map(hour => timeLabel(hour * 60));
  if (comparingCourts()) {
    renderCourtMatrix("heatmap", columns, labels, current.courtHours);
    return;
  }
  get("heatmap").innerHTML = table(["Tag", ...labels],
    current.grid.map((row, day) => matrixRow(weekdays[day], row.map(heatCell))), 'class="matrix"');
}

function renderCalendar(current, days) {
  const start = calendarPage * calendarPageSize;
  const shown = [...days].reverse().slice(start, start + calendarPageSize);
  get("calendar-nav").hidden = days.length <= calendarPageSize;
  get("calendar-newer").disabled = calendarPage === 0;
  get("calendar-older").disabled = start + calendarPageSize >= days.length;
  get("calendar-range").textContent = formatDate(shown.at(-1)) + " bis " + formatDate(shown[0]);
  const included = courtList.filter(inScope);
  const rows = included.map(({key, club, court}, i) => '<tr><th scope="row">' + safe(club + " · " + court) + '</th>'
    + shown.map(day => {
      const group = current.calendar.get(JSON.stringify([key, day]));
      const value = ratio(group);
      return group ? '<td><button type="button" data-row="' + i + '" data-day="' + day + '" class="' + color(value)
        + '" title="' + group.valid + ' auswertbare und ' + group.unclear + ' mehrdeutige Blöcke">'
        + (group.valid ? percent(value) : "?") + '</button></td>' : '<td class="missing">–</td>';
    }).join("") + '</tr>');
  get("calendar").innerHTML = rows.length ? table(["Platz", ...shown.map(day => shortDate.format(asDate(day)))],
    rows, 'class="matrix calendar"') : "<p>Keine Plätze für diese Filter.</p>";
  get("calendar").onclick = event => {
    const button = event.target.closest("button[data-row]");
    if (!button) return;
    selectedDetail = {key: included[Number(button.dataset.row)].key, day: button.dataset.day};
    renderDetail(current);
    get("detail").scrollIntoView({block: "nearest"});
  };
  renderDetail(current);
}

function renderDetail(current) {
  const detail = get("detail");
  if (comparingCourts() && selectedDetail) {
    renderSlotComparison(detail, selectedDetail.day, current);
    return;
  }
  const record = selectedDetail && records.find(({key, day}) => key === selectedDetail.key && day === selectedDetail.day);
  detail.hidden = !record || !current.calendar.has(JSON.stringify([record.key, record.day]));
  if (detail.hidden) {
    detail.replaceChildren();
    return;
  }
  detail.innerHTML = '<h3>' + safe(record.club + " · " + record.court) + ' · ' + formatDate(record.day) + '</h3>'
    + '<div class="slots">' + [...record.slots].map((state, i) => {
      const filtered = state !== "-" && !accepted(state);
      const [label, style] = filtered ? ["Vorschau ausgeblendet", "missing"] : states[state];
      return '<div class="' + style + '"><b>' + timeLabel(i * 30) + '</b><span>' + label + '</span></div>';
    }).join("") + '</div>';
}

function renderSlotComparison(detail, day, current) {
  const byCourt = new Map(records.filter(record => record.day === day && inScope(record))
    .map(record => [record.key, record.slots]));
  const places = courtList.filter(inScope);
  detail.hidden = !places.some(({key}) => current.calendar.has(JSON.stringify([key, day])));
  if (detail.hidden) {
    detail.replaceChildren();
    return;
  }
  const slots = Array.from({length: 48}, (_, i) => i);
  const symbols = {booked: "B", free: "F", unclear: "?", missing: "–"};
  const rows = places.map(place => matrixRow(courtLabel(place), slots.map(index => {
    const state = byCourt.get(place.key)?.[index] ?? "-";
    const [label, style] = state !== "-" && !accepted(state) ? ["Vorschau ausgeblendet", "missing"] : states[state];
    return '<td class="' + style + '" title="' + label + '"><abbr aria-label="' + label + '">' + symbols[style] + '</abbr></td>';
  })));
  detail.innerHTML = '<h3>Halbstunden am ' + formatDate(day) + '</h3>'
    + '<p>B = belegt · F = frei · ? = mehrdeutig · – = kein Wert</p><div class="scroll">'
    + table(["Platz", ...slots.map(index => timeLabel(index * 30))], rows, 'class="matrix court-matrix"') + '</div>';
}

function renderCoverage(current, days) {
  const inView = clubs.filter(clubInScope);
  const start = days[0], end = days.at(-1);
  const byClub = new Map(inView.map(club => [club, new Map()]));
  for (const record of records) {
    if (record.day < start || record.day > end || !inScope(record)) continue;
    const perDay = byClub.get(record.club);
    if (!perDay.has(record.day)) perDay.set(record.day, {sameDay: 0, preview: 0, unclear: 0, valid: 0});
    const counts = perDay.get(record.day);
    for (const state of record.slots) {
      if (state === "-") continue;
      counts["xfu".includes(state) ? "preview" : "sameDay"]++;
      counts["?u".includes(state) ? "unclear" : "valid"]++;
    }
  }
  get("coverage-period").textContent = formatDate(start) + " bis " + formatDate(end)
    + ". Ein erfasster Tag hat mindestens einen Messblock. Die Tabelle zählt auch Vorschauen, die in der Auslastung ausgeblendet sind.";
  const cutoff = get("coverage-cutoff");
  cutoff.hidden = !data.latest || end !== lastDay;
  cutoff.textContent = cutoff.hidden ? "" : "Der letzte Tag ist nur bis zum Datenstand um " + data.latest.slice(11)
    + " Uhr berücksichtigt. Im Platzkalender stehen die erfassten Halbstunden.";
  get("coverage").innerHTML = table(["Standort", "Vom Spieltag", "Nur Vorschau",
    "Ohne Messung", "Letzte Erfassung"], inView.map(club => {
    const dates = byClub.get(club);
    const opening = data.openingDates[club];
    const eligible = days.filter(day => !opening || day >= opening);
    const sameDay = eligible.filter(day => dates.get(day)?.sameDay);
    const previewOnly = eligible.filter(day => dates.has(day) && !dates.get(day).sameDay);
    const missing = eligible.filter(day => !dates.has(day));
    const ambiguousDays = eligible.filter(day => dates.get(day)?.unclear && !dates.get(day).valid);
    const active = current.groups.get("club:" + club);
    const run = data.runs[club];
    const flags = eligible.map(day => dates.get(day)).filter(Boolean);
    const previewBlocks = flags.reduce((sum, counts) => sum + counts.preview, 0);
    const unclearBlocks = flags.reduce((sum, counts) => sum + counts.unclear, 0);
    const details = '<details><summary>Spieltage und Blöcke</summary><dl>'
      + '<dt>Vom Spieltag</dt><dd>' + describeDays(sameDay) + '</dd>'
      + '<dt>Nur Vorschau</dt><dd>' + describeDays(previewOnly) + '</dd>'
      + '<dt>Ohne Messung</dt><dd>' + describeDays(missing) + '</dd>'
      + '<dt>Ausschließlich mehrdeutig</dt><dd>' + describeDays(ambiguousDays) + '</dd>'
      + '<dt>Halbstundenblöcke</dt><dd>' + previewBlocks + ' aus Vorschau, ' + unclearBlocks
      + ' mehrdeutig, ' + (active?.valid ?? 0) + ' in der aktuellen Auslastungsquote</dd></dl></details>';
    const label = safe(club) + ' <span class="coverage-type">' + safe(data.clubs[club]) + '</span>' + details;
    const beforeOpening = opening && opening > start ? '<span class="coverage-type">Eröffnung am ' + formatDate(opening) + '</span>' : "";
    return tr(label, [sameDay.length + " Tage", previewOnly.length + " Tage",
      (eligible.length ? missing.length + " Tage" : "–") + beforeOpening,
      run ? formatDate(run.slice(0, 10)) + " · " + run.slice(11) : "Keine Erfassung"]);
  }));
  const imported = payments.filter(row => row.day >= start && row.day <= end && inScope(row)).length;
  get("payment-coverage").textContent = (imported ? "Zahlungen für " + imported + " Platz-Tage lokal importiert."
    : "Für diese Auswahl liegen keine Zahlungsdaten vor.") + " Bearbeitbare Listenpreise stehen für Serve One bereit.";
}

function describeDays(days) {
  const ranges = [];
  for (const day of days) {
    const last = ranges.at(-1);
    if (last && day === shift(last[1], 1)) last[1] = day;
    else ranges.push([day, day]);
  }
  return ranges.map(([start, end]) => start === end ? formatDate(start) : formatDate(start) + " bis " + formatDate(end)).join(", ") || "Keine";
}

function renderRates() {
  const rates = [
    ["serve-double", "Serve One · Doppel", 38], ["serve-single", "Serve One · Einzel", 24],
    ["langweid", "Serve One Langweid · Ersatzwert", ""], ["bergheim", "Serve One Bergheim · Ersatzwert", ""],
    ["djk", "DJK Lechhausen", ""], ["tsg", "TSG Lechhausen", ""], ["4030", "4030 Padel Club Augsburg", ""]
  ];
  get("rates").innerHTML = rates.map(([id, label, value]) =>
    '<label>' + label + ' (€/h)<input id="rate-' + id + '" type="number" min="0" step="0.01" value="' + value + '"></label>'
  ).join("");
}

function rateFor({club, court}) {
  let id = {"DJK Lechhausen": "djk", "TSG Lechhausen": "tsg", "4030 Padel Club Augsburg": "4030"}[club];
  if (club === "Serve One Langweid" || club === "Serve One Bergheim") {
    if (/einzel|single/i.test(court)) id = "serve-single";
    else if (/doppel|double/i.test(court)) id = "serve-double";
    else id = club.endsWith("Langweid") ? "langweid" : "bergheim";
  }
  const input = id && get("rate-" + id);
  return input && input.validity.valid && Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : null;
}

function renderFinance(current, start, end) {
  const compare = comparingCourts();
  const ledger = payments.filter(row => row.day >= start && row.day <= end && inScope(row));
  const eligibleClubs = clubs.filter(clubInScope);
  const scenarios = courtList.filter(inScope).map(court => {
    const counts = current.groups.get("court:" + court.key);
    return {...court, rate: rateFor(court), blocks: counts?.booked ?? 0, valid: counts?.valid ?? 0};
  });
  const items = compare ? scenarios.map(({club, court, key, rate}) => ({title: club + " · " + court, key, rate}))
    : [{title: "Gesamt"}, ...eligibleClubs.map(club => ({title: club, club}))];
  const headers = [compare ? "Platz" : "Standort", "Importierte Einnahmen", "Bezahlte Stunden", "Effektiver Preis pro Stunde", "Platz-Tage mit Import"];
  if (compare) headers.push("Hinterlegter Tarif pro Stunde");
  headers.push("Szenario bei hinterlegtem Tarif", "Belegte Stunden mit Tarif");
  get("finance").innerHTML = items.length ? table(headers, items.map(({club, title, key, rate}) => {
    const matches = row => (!club || row.club === club) && (!key || row.key === key);
    const paid = ledger.filter(matches);
    const cents = paid.reduce((sum, row) => sum + row.cents, 0);
    const paidHours = paid.reduce((sum, row) => sum + row.hours, 0);
    const scoped = scenarios.filter(matches);
    const priced = scoped.filter(row => row.rate !== null && row.valid);
    const estimate = priced.reduce((sum, row) => sum + row.blocks * row.rate / 2, 0);
    const pricedHours = priced.reduce((sum, row) => sum + row.blocks, 0);
    const total = scoped.reduce((sum, row) => sum + row.blocks, 0);
    const cells = [paid.length ? currency.format(cents / 100) : "–",
      paid.length ? decimal.format(paidHours) : "–", paidHours ? currency.format(cents / 100 / paidHours) : "–",
      paid.length || "–"];
    if (compare) cells.push(rate === null ? "–" : currency.format(rate));
    return tr(safe(title), [...cells, priced.length ? currency.format(estimate) : "–", hours(pricedHours) + " / " + hours(total)]);
  })) : "<p>Keine Plätze mit erfassten Kalenderdaten für diese Standortauswahl.</p>";
}

function parseCsv(text, separator) {
  const rows = [];
  let row = [], field = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += char;
        i++;
      } else {
        quoted = false;
        closed = true;
      }
      continue;
    }
    if (char === separator || char === "\n" || char === "\r") {
      row.push(field.trim());
      field = "";
      closed = false;
      if (char !== separator) {
        if (row.some(Boolean)) rows.push(row);
        row = [];
        if (char === "\r" && text[i + 1] === "\n") i++;
      }
    } else if (char === '"' && !field && !closed) quoted = true;
    else if (closed || char === '"') throw new Error("Ungültige Anführungszeichen in der CSV.");
    else field += char;
  }
  if (quoted) throw new Error("Ein CSV-Feld wurde nicht geschlossen.");
  row.push(field.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parsePayments(text) {
  text = text.replace(/^\uFEFF/, "").trim();
  const separator = text.split(/\r?\n/, 1)[0].includes(";") ? ";" : ",";
  const [header = [], ...rows] = parseCsv(text, separator);
  const columns = ["date", "club", "court", "revenue_eur", "paid_hours"];
  const indices = columns.map(column => header.indexOf(column));
  if (indices.includes(-1) || new Set(header).size !== header.length) {
    throw new Error("Spalten erforderlich: " + columns.join(", ") + ".");
  }
  if (!rows.length) throw new Error("Die Datei enthält keine Zahlungszeilen.");
  const seen = new Set();
  return rows.map((row, i) => {
    const [day, club, court, amount, paidHours] = indices.map(index => row[index] ?? "");
    const key = pair(club, court);
    const unique = JSON.stringify([day, club, court]);
    const parsed = asDate(day);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(+parsed) || dateKey(parsed) !== day
        || !courts.has(key) || row.length !== header.length || !/^-?\d+([.,]\d{1,2})?$/.test(amount)
        || !/^\d+([.,]\d+)?$/.test(paidHours) || seen.has(unique)) {
      throw new Error("Datensatz " + (i + 2) + " ist ungültig oder für Platz und Spieltag doppelt vorhanden.");
    }
    const cents = Math.round(Number(amount.replace(",", ".")) * 100);
    const paid = Number(paidHours.replace(",", "."));
    if (!Number.isSafeInteger(cents) || !Number.isFinite(paid) || paid > 24) {
      throw new Error("Ungültiger Betrag oder mehr als 24 bezahlte Stunden in Datensatz " + (i + 2) + ".");
    }
    seen.add(unique);
    return {day, club, key, cents, hours: paid};
  });
}

let viewerDownloadsPromise = null;

// Im claude.ai-Artefakt laufen Downloads \u00FCber die Viewer-API, sonst \u00FCber einen Blob-Link.
function viewerDownloads() {
  if (!viewerDownloadsPromise && typeof window.claude?.use === "function") {
    viewerDownloadsPromise = window.claude.use("downloads").catch(() => null);
  }
  return viewerDownloadsPromise;
}

async function download(name, rows, status) {
  const encode = cell => {
    const value = String(cell);
    return '"' + value.replaceAll('"', '""') + '"';
  };
  const file = new Blob(["\uFEFF", rows.map(row => row.map(encode).join(";")).join("\r\n") + "\r\n"],
    {type: "text/csv;charset=utf-8"});
  const report = text => {
    status.textContent = text;
    status.hidden = !text;
  };
  report("");
  const pending = viewerDownloads();
  if (pending) {
    const downloads = await pending;
    if (!downloads) {
      report("Downloads sind in dieser Ansicht nicht verf\u00FCgbar.");
      return;
    }
    try {
      await downloads.save({filename: name, data: file});
    } catch (error) {
      if (error?.code === "declined") return;
      report(error?.code === "rate_limited" ? "Ein Download wartet noch auf Best\u00E4tigung."
        : "Der Download ist fehlgeschlagen.");
    }
    return;
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function applyPreset(value) {
  activePreset = value;
  calendarPage = 0;
  selectedDetail = null;
  get("from").value = value === "all" ? firstDay : shift(lastDay, 1 - Number(value));
  get("to").value = lastDay;
  get("bucket").value = value === "90" ? "week" : value === "all" ? "month" : "day";
}

function calendarBounds() {
  const start = get("from").value, end = get("to").value;
  if (!start || !end || start < get("from").min || end < start || end > lastDay) return null;
  const length = Math.round((asDate(end) - asDate(start)) / 86400000) + 1;
  return {start, end, length};
}

function render() {
  const compare = comparingCourts();
  get("court").disabled = compare;
  get("heatmap-day-label").hidden = !compare;
  get("calendar-hint").textContent = compare ? "Ein Tageswert öffnet die Halbstunden aller Plätze für diesen Spieltag."
    : "Ein Tageswert öffnet die zugehörigen Halbstundenblöcke.";
  document.querySelectorAll("[data-days]").forEach(button =>
    button.setAttribute("aria-pressed", button.dataset.days === activePreset));
  const bounds = calendarBounds();
  get("filter-error").hidden = Boolean(bounds);
  get("results").hidden = !bounds;
  get("export").disabled = !bounds;
  if (!bounds) {
    get("filter-error").textContent = "Wähle einen gültigen Zeitraum bis zum Datenstand.";
    get("coverage").replaceChildren();
    return;
  }
  const {start, end, length} = bounds;
  const days = dateRange(start, end);
  const current = rowsFor(start, end, true);
  const previous = rowsFor(shift(start, -length), shift(start, -1), false);
  const totals = current.totals;
  const metric = type => current.groups.get("type:" + type) ?? summary();
  get("kpis").innerHTML = tile("Auslastung gesamt", percent(ratio(totals)), "Vorzeitraum " + percent(ratio(previous.totals))
    + " · " + change(totals, previous.totals) + " · " + previous.totals.days.size + " / " + days.length + " Messtage")
    + tile("Indoor", percent(ratio(metric("Indoor"))), hours(metric("Indoor").valid) + " auswertbare Stunden")
    + tile("Outdoor", percent(ratio(metric("Outdoor"))), hours(metric("Outdoor").valid) + " auswertbare Stunden")
    + tile("Belegte Platzstunden", totals.valid ? hours(totals.booked) + " h" : "–", "Von " + hours(totals.valid) + " auswertbaren Stunden")
    + tile("Messtage", totals.days.size + " / " + days.length, totals.preview + " Blöcke aus Vorschau"
      + " · " + totals.unclear + " mehrdeutig");
  renderTrend(current, days);
  renderComparison(current, previous);
  renderHeatmap(current);
  renderCalendar(current, days);
  renderFinance(current, start, end);
  renderCoverage(current, days);
  get("export").onclick = () => {
    const rows = [["Ebene", "Typ / Standort / Platz", "Von", "Bis", "Auslastung (%)", "Auslastung Vorzeitraum (%)",
      "Belegte Stunden", "Auswertbare Stunden", "Messtage", "Vorschau-Blöcke", "Mehrdeutige Blöcke"]];
    const csvRate = item => ratio(item) === null ? "" : decimal.format(ratio(item));
    for (const [level, name, key] of compareRows()) {
      const s = current.groups.get(key) ?? summary();
      rows.push([level, name, start, end, csvRate(s), csvRate(previous.groups.get(key)),
        s.valid ? hours(s.booked) : "", hours(s.valid), s.days.size, s.preview, s.unclear]);
    }
    download("padel-auslastung-" + end + ".csv", rows, get("export-status"));
  };
}

get("data-stand").textContent = data.latest ? "Datenstand " + formatDate(lastDay) + " · " + data.latest.slice(11) + " Uhr"
  : "Keine Messungen vorhanden";
get("source-notes").textContent = (data.latest ? "Quellen: Playtomic und eBuSy. Ortszeit Europe/Berlin." : "")
  + (data.skippedMarkers ? " Übersprungene Git-Konfliktmarkierungen in der CSV: " + data.skippedMarkers + "." : "");
get("to").max = lastDay;
get("from").max = lastDay;
get("from").min = [firstDay, shift(lastDay, -89)].sort()[0];
get("to").min = get("from").min;
options(get("type"), types.map(type => [type, type]));
options(get("heatmap-day"), weekdays.map((name, day) => [String(day), name]));
refreshFilters();
renderRates();
applyPreset("30");
render();

document.querySelectorAll("[data-days]").forEach(button => button.addEventListener("click", () => {
  applyPreset(button.dataset.days);
  render();
}));
for (const id of ["from", "to", "type", "club", "court", "bucket", "same-day", "include-unknown", "compare-courts", "heatmap-day"]) {
  get(id).addEventListener("change", () => {
    if (id === "type" || id === "club") refreshFilters();
    if (id === "from" || id === "to") {
      activePreset = "";
      calendarPage = 0;
      selectedDetail = null;
    }
    render();
  });
}
for (const [id, step] of [["calendar-newer", -1], ["calendar-older", 1]]) {
  get(id).addEventListener("click", () => {
    calendarPage += step;
    selectedDetail = null;
    render();
  });
}
get("rates").addEventListener("input", () => {
  const bounds = calendarBounds();
  if (bounds) renderFinance(rowsFor(bounds.start, bounds.end, false), bounds.start, bounds.end);
});
get("payments").addEventListener("change", async event => {
  const file = event.target.files[0];
  if (!file) return;
  const version = ++importVersion;
  try {
    const imported = parsePayments(await file.text());
    if (version !== importVersion) return;
    payments = imported;
    get("payment-status").textContent = payments.length + " Platz-Tage geladen aus " + file.name + ".";
    get("reset-payments").hidden = false;
    render();
  } catch (error) {
    if (version !== importVersion) return;
    get("payment-status").textContent = "Import fehlgeschlagen. " + error.message
      + (payments.length ? " Der bisherige Import bleibt aktiv." : "");
  } finally {
    if (version === importVersion) event.target.value = "";
  }
});
get("reset-payments").addEventListener("click", () => {
  importVersion++;
  payments = [];
  get("payments").value = "";
  get("reset-payments").hidden = true;
  get("payment-status").textContent = "Die Auslastungsdaten enthalten keine Zahlungen.";
  render();
});
get("payment-template").addEventListener("click", () =>
  download("padel-zahlungen-vorlage.csv", [["date", "club", "court", "revenue_eur", "paid_hours"]],
    get("template-status")));
viewerDownloads()?.then(downloads => {
  if (!downloads) for (const id of ["export", "payment-template"]) get(id).hidden = true;
});
