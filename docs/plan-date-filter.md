# Implementation plan: dashboard date-range filter (ticket 005)

> Written for an implementer with zero prior context on this repo and no
> access to any prior conversation — every file, function, and param name
> below is exact and taken from reading the current source.

## Goal

The BrewOps dashboard at `http://localhost:8123` shows all-time brew
totals and charts. Add a date-range filter so the user can pick a
`from`/`to` range and have the stat tiles, per-drink bars, timeline chart,
machine cards, and leader banner all narrow to that range. Default (no
range picked) must stay exactly as it behaves today — all-time.

Repo root: `brewops/`. Stack: FastAPI + raw `sqlite3` (no ORM) +
vanilla-JS frontend (no build step, no framework, no chart library —
charts are hand-rolled SVG/DOM).

## Files you will change

1. `src/brewops/db/queries.py`
2. `src/brewops/api/main.py`
3. `src/brewops/frontend/index.html`
4. `src/brewops/frontend/app.js`
5. `tests/test_db.py`
6. `tests/test_api.py`

Do not touch `src/brewops/db/schema.py` — no migration is needed. The
`brew_events.timestamp` and `maintenance_events.timestamp` columns are
already `TEXT NOT NULL` storing naive local `'YYYY-MM-DD HH:MM:SS'`
strings, and `idx_brew_events_timestamp` already indexes the column used
here. Because the format is lexicographically sortable, plain string
comparison (`WHERE timestamp >= ? AND timestamp < ?`) works with no
`DATE()` casting.

## 1. `src/brewops/db/queries.py`

### `get_stats(conn)` — currently at line 68

Current signature and body:

```python
def get_stats(conn: sqlite3.Connection) -> dict[str, Any]:
    """Dashboard numbers: totals, per-drink, per-day."""
    total = conn.execute("SELECT COUNT(*) AS n FROM brew_events").fetchone()["n"]
    per_drink = [
        dict(r)
        for r in conn.execute(
            """
            SELECT dt.name, dt.label, COUNT(be.id) AS count
            FROM drink_types dt
            LEFT JOIN brew_events be ON be.drink_type = dt.name
            GROUP BY dt.id
            ORDER BY dt.id
            """
        )
    ]
    per_day = [
        dict(r)
        for r in conn.execute(
            """
            SELECT DATE(timestamp) AS day, COUNT(*) AS count
            FROM brew_events
            GROUP BY DATE(timestamp)
            ORDER BY day
            """
        )
    ]
    return {"total_brews": total, "per_drink": per_drink, "per_day": per_day}
```

Change to accept two new optional parameters:

```python
def get_stats(
    conn: sqlite3.Connection,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any]:
```

`date_from` and `date_to` are already-normalized `'YYYY-MM-DD HH:MM:SS'`
strings (or `None`). `date_to` is treated as an **exclusive** upper bound
— the caller (`api/main.py`, see below) is responsible for turning a
user-picked end date into the start of the *next* day before calling
this function, so "to 2026-09-20" includes all of the 20th.

Apply the range:

- `total`: build the WHERE clause conditionally.
  ```python
  where_sql, params = _range_where(date_from, date_to)
  total = conn.execute(
      f"SELECT COUNT(*) AS n FROM brew_events{where_sql}", params
  ).fetchone()["n"]
  ```
- `per_day`: same pattern, append `where_sql` before `GROUP BY`:
  ```python
  per_day = [
      dict(r)
      for r in conn.execute(
          f"""
          SELECT DATE(timestamp) AS day, COUNT(*) AS count
          FROM brew_events
          {where_sql}
          GROUP BY DATE(timestamp)
          ORDER BY day
          """,
          params,
      )
  ]
  ```
- `per_drink`: **do not** put the range in a `WHERE` clause here — that
  would silently drop drink types with zero brews in range because of
  the `LEFT JOIN`. Instead put the range condition inside the `ON`
  clause of the join, so unmatched drink types still produce a row with
  `count: 0`:
  ```python
  join_sql, join_params = _range_where(date_from, date_to, prefix="AND")
  per_drink = [
      dict(r)
      for r in conn.execute(
          f"""
          SELECT dt.name, dt.label, COUNT(be.id) AS count
          FROM drink_types dt
          LEFT JOIN brew_events be
            ON be.drink_type = dt.name {join_sql}
          GROUP BY dt.id
          ORDER BY dt.id
          """,
          join_params,
      )
  ]
  ```

Add a small private helper near the top of the module (or just above
`get_stats`) to avoid repeating the conditional-WHERE logic three times:

```python
def _range_where(
    date_from: str | None, date_to: str | None, prefix: str = "WHERE"
) -> tuple[str, list[str]]:
    """Build a SQL fragment + params for an optional [date_from, date_to)
    range over a `timestamp` column. prefix is "WHERE" for a standalone
    clause or "AND" to append inside a JOIN's ON clause."""
    clauses = []
    params: list[str] = []
    if date_from is not None:
        clauses.append("timestamp >= ?")
        params.append(date_from)
    if date_to is not None:
        clauses.append("timestamp < ?")
        params.append(date_to)
    if not clauses:
        return "", []
    return f" {prefix} " + " AND ".join(clauses), params
```

When both `date_from` and `date_to` are `None` (the default), `_range_where`
returns `("", [])`, so every query above becomes byte-identical to the
current unfiltered SQL. This is important: existing tests that call
`get_stats(conn)` with no range must keep passing unchanged.

### `get_machine_health(conn, machine_id)` — currently at line 97

Add the same two optional params:

```python
def get_machine_health(
    conn: sqlite3.Connection,
    machine_id: int,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict[str, Any] | None:
```

Apply the range **only** to the brew-derived queries (`brews` and
`specialty`), using `_range_where(date_from, date_to, prefix="AND")`
appended after the existing `WHERE machine_id = ?` condition. Do **not**
apply the range to `last_maintenance` or `recent_errors` — those are
maintenance history, not brew stats, and the ticket is specifically about
brew numbers; leave that part of the function unchanged.

```python
range_sql, range_params = _range_where(date_from, date_to, prefix="AND")

brews = conn.execute(
    f"""
    SELECT COUNT(*) AS count, MAX(timestamp) AS last_brew
    FROM brew_events WHERE machine_id = ? {range_sql}
    """,
    (machine_id, *range_params),
).fetchone()

specialty = conn.execute(
    f"""
    SELECT dt.name AS key, dt.label AS label, COUNT(*) AS n
    FROM brew_events b
    JOIN drink_types dt ON dt.name = b.drink_type
    WHERE b.machine_id = ? {range_sql}
    GROUP BY dt.id
    ORDER BY n DESC, dt.name ASC
    LIMIT 1
    """,
    (machine_id, *range_params),
).fetchone()
```

Leave `last_maintenance` and `recent_errors` queries and the final
`return machine | {...}` dict exactly as they are today.

## 2. `src/brewops/api/main.py`

### New query-param parsing helper

The existing `parse_timestamp()` (line 41) rejects unparsable strings and
future dates — both wrong for range boundaries (a `to` date is often
"today", and a user might reasonably pick a future end date that just
returns no extra rows). Add a new helper near it, not a replacement:

```python
def parse_date_range(
    from_: str | None, to: str | None
) -> tuple[str | None, str | None]:
    """Parse optional 'YYYY-MM-DD' query params into storage-format
    range bounds. `to` is inclusive of the whole day, so it's converted
    to an exclusive upper bound (start of the next day)."""
    def parse_bound(value: str) -> datetime:
        try:
            return datetime.strptime(value.strip(), "%Y-%m-%d")
        except ValueError:
            raise HTTPException(400, f"unparsable date {value!r}, expected YYYY-MM-DD")

    date_from = None
    date_to = None
    if from_ is not None:
        date_from = parse_bound(from_).strftime("%Y-%m-%d %H:%M:%S")
    if to is not None:
        # inclusive end date -> exclusive bound at start of next day
        date_to = (parse_bound(to) + timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    if date_from is not None and date_to is not None and date_from >= date_to:
        raise HTTPException(400, "'from' must be before 'to'")
    return date_from, date_to
```

This needs `from datetime import datetime, timedelta` — `timedelta` isn't
currently imported in this file, so update the existing import line:

```python
from datetime import datetime, timedelta
```

Also add `Query` to the existing FastAPI import line:

```python
from fastapi import Depends, FastAPI, HTTPException, Query
```

### Update the two endpoints

Current:

```python
@app.get("/api/stats")
def stats(conn: sqlite3.Connection = Depends(get_db)):
    return queries.get_stats(conn)


@app.get("/api/machines/{machine_id}")
def machine_health(machine_id: int, conn: sqlite3.Connection = Depends(get_db)):
    health = queries.get_machine_health(conn, machine_id)
    if health is None:
        raise HTTPException(404, f"no machine with id {machine_id}")
    return health
```

Change to:

```python
@app.get("/api/stats")
def stats(
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    conn: sqlite3.Connection = Depends(get_db),
):
    date_from, date_to = parse_date_range(from_, to)
    return queries.get_stats(conn, date_from, date_to)


@app.get("/api/machines/{machine_id}")
def machine_health(
    machine_id: int,
    from_: str | None = Query(None, alias="from"),
    to: str | None = Query(None),
    conn: sqlite3.Connection = Depends(get_db),
):
    date_from, date_to = parse_date_range(from_, to)
    health = queries.get_machine_health(conn, machine_id, date_from, date_to)
    if health is None:
        raise HTTPException(404, f"no machine with id {machine_id}")
    return health
```

Query params are `from` and `to`, both optional, format `YYYY-MM-DD`
(plain date, no time — matches what an HTML `<input type="date">`
produces). `from` uses the alias `"from"` because `from` is a Python
reserved word, so the Python parameter is named `from_`.

`GET /api/machines` (the list endpoint, no per-machine health) does not
need changes — it just lists machine metadata, not brew counts.

## 3. `src/brewops/frontend/index.html`

Add a filter control inside the `#dashboard` section, before the
`leader-banner` div (currently starts at line 18). Insert:

```html
<div class="panel filter-panel">
  <label for="filter-from">From</label>
  <input type="date" id="filter-from">
  <label for="filter-to">To</label>
  <input type="date" id="filter-to">
  <button type="button" id="filter-clear">Clear</button>
</div>
```

No new CSS classes are strictly required to function — `panel` already
exists as a class in `style.css` and gives it consistent spacing/borders
with the other dashboard panels. Do not add a submit button; the filter
should apply automatically when either date input changes (see app.js
below), matching the no-friction feel of the rest of the page.

## 4. `src/brewops/frontend/app.js`

### Build the query string and use it in `loadDashboard()`

Current `loadDashboard()` (line 89):

```javascript
async function loadDashboard() {
  const stats = await fetchJSON("/api/stats");
  document.getElementById("total-brews").textContent = stats.total_brews;
  const lastDay = stats.per_day[stats.per_day.length - 1];
  document.getElementById("brews-today").textContent = lastDay ? lastDay.count : 0;
  renderDrinkBars(stats.per_drink);
  renderTimeline(stats.per_day);

  const machines = await fetchJSON("/api/machines");
  document.getElementById("machine-count").textContent = machines.length;
  const healths = await Promise.all(machines.map((m) => fetchJSON(`/api/machines/${m.id}`)));
  renderMachineCards(healths);
  renderLeaderBanner(healths);
}
```

Add a helper just above it to build the query string from the two date
inputs:

```javascript
function dateRangeQuery() {
  const from = document.getElementById("filter-from").value;
  const to = document.getElementById("filter-to").value;
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}
```

Change `loadDashboard()` to use it for every dashboard fetch:

```javascript
async function loadDashboard() {
  const query = dateRangeQuery();
  const stats = await fetchJSON(`/api/stats${query}`);
  document.getElementById("total-brews").textContent = stats.total_brews;
  const lastDay = stats.per_day[stats.per_day.length - 1];
  document.getElementById("brews-today").textContent = lastDay ? lastDay.count : 0;
  renderDrinkBars(stats.per_drink);
  renderTimeline(stats.per_day);

  const machines = await fetchJSON("/api/machines");
  document.getElementById("machine-count").textContent = machines.length;
  const healths = await Promise.all(
    machines.map((m) => fetchJSON(`/api/machines/${m.id}${query}`))
  );
  renderMachineCards(healths);
  renderLeaderBanner(healths);
}
```

`/api/machines` itself (the plain list, no params) stays unfiltered —
only the per-machine `/api/machines/{id}` health fetch gets the range,
which is correct since machine *health* is the brew-derived part.

### Wire up the new controls

In `setupForms()` or right after it near the bottom of the file (after
line 147, before the final `loadDashboard()`/`setupForms()` calls at
lines 169–173), add:

```javascript
function setupFilter() {
  const from = document.getElementById("filter-from");
  const to = document.getElementById("filter-to");
  const clear = document.getElementById("filter-clear");
  from.addEventListener("change", () => loadDashboard());
  to.addEventListener("change", () => loadDashboard());
  clear.addEventListener("click", () => {
    from.value = "";
    to.value = "";
    loadDashboard();
  });
}
```

And call it alongside the existing bottom-of-file calls:

```javascript
loadDashboard().catch((error) => {
  document.getElementById("total-brews").textContent = "!";
  console.error("Dashboard failed to load:", error);
});
setupForms().catch((error) => console.error("Form setup failed:", error));
setupFilter();
```

If the API returns a 400 (e.g. `from` after `to` — though the UI should
rarely produce this since both are plain date pickers, it's still
reachable by picking from > to), `fetchJSON` already throws with the
server's error message. `loadDashboard()` currently has no per-call catch
inside it — the existing top-level `.catch` at line 169 will catch it and
set `#total-brews` to `"!"` and log to console. That is acceptable
existing behavior; no new error UI is required, but note it during
verification (see below) — if it looks too broken/silent for a filter
error, that's fine, it matches how any other dashboard load failure is
already handled, don't over-build this in v1.

## Edge cases and expected behavior

1. **No range picked (both empty)** — `from`/`to` query params absent.
   `parse_date_range(None, None)` returns `(None, None)`.
   `_range_where(None, None)` returns `("", [])`. Every query runs
   exactly as it does today. Verify: dashboard totals unchanged from
   before this change.

2. **Only `from` set, `to` empty** — open-ended range through "now".
   `date_to` stays `None`, so only the `timestamp >= ?` bound applies.
   Verify: picking a `from` date near the end of the seeded data still
   shows only the tail of the data, nothing beyond present.

3. **Only `to` set, `from` empty** — everything up through that day.
   Verify: totals equal all-time totals minus brews after the `to` date.

4. **`from` after `to`** — `parse_date_range` raises `HTTPException(400,
   "'from' must be before 'to'")` before any query runs. Verify: hitting
   `GET /api/stats?from=2026-09-20&to=2026-09-01` returns HTTP 400 with
   that message, not a 500 or empty-but-200 response. The frontend datepickers
   don't prevent this input combination, so this must be a real server-side
   check, not just a UI nicety.

5. **`from` equals `to` (single day)** — should include that whole day.
   Because `to` is converted to an *exclusive* bound at start of the next
   day inside `parse_date_range`, `from=2026-09-10&to=2026-09-10` becomes
   `date_from='2026-09-10 00:00:00'`, `date_to='2026-09-11 00:00:00'`,
   which correctly spans the entire 10th. Verify with a day that has at
   least one seeded brew.

6. **Range with zero brews in it** — e.g. picking a range before any
   seeded data exists, or a gap day. `total_brews` should be `0`,
   `per_day` should be `[]` (empty list, since `GROUP BY DATE(timestamp)`
   produces no rows when nothing matches), and `per_drink` should still
   list **every** drink type with `count: 0` each (this is the reason the
   range condition was put in the `per_drink` JOIN's `ON` clause instead
   of a `WHERE` — a `WHERE` would have made `per_drink` empty too,
   silently hiding drink types instead of showing them at zero). Verify
   both the empty-`per_day` list and the zero-filled-but-present
   `per_drink` list.

7. **`brews-today` tile with a range applied** — this tile reads
   `stats.per_day[stats.per_day.length - 1]`, i.e. "last day with any
   brews." With a filter active this naturally becomes "last active day
   within the selected range" with no code change needed beyond the
   query-string plumbing above, since `per_day` itself is already
   filtered. If `per_day` is empty (case 6), the existing `lastDay ?
   lastDay.count : 0` fallback already handles it, showing `0`. No
   special-casing needed.

8. **Malformed date string** (not `YYYY-MM-DD`, e.g. `from=banana` or a
   full ISO datetime) — `parse_date_range`'s `parse_bound` raises
   `HTTPException(400, "unparsable date 'banana', expected YYYY-MM-DD")`.
   This shouldn't normally happen since the browser's native date picker
   only emits `YYYY-MM-DD`, but a manually-crafted request must still get
   a clean 400, not a 500.

9. **Machine cards / leader banner during a range with a machine that has
   zero brews in range** — `get_machine_health` will return `brew_count:
   0`, `last_brew: None`, `specialty: None` for that machine (same shape
   `get_machine_health` already returns for a machine with literally zero
   brews ever — no new code path, just reuses existing None-handling
   already present in `renderMachineCards`/`renderLeaderBanner`). Verify
   the card renders without JS errors (check browser console) — existing
   template already guards `m.last_brew ? ... : "never"` and `m.specialty
   ? ... : ""`.

## Verification steps

Run these in order after making all the changes above:

1. `uv run pytest` — the full suite must pass. Existing tests in
   `tests/test_db.py::test_stats_math` and
   `tests/test_api.py::test_stats` call `get_stats`/`GET /api/stats` with
   no range and must produce identical results to before this change
   (this is the main regression risk — a bug in `_range_where` that
   changes behavior even when both bounds are `None`).

2. Add new test cases (don't just eyeball manually — put these in the
   test files):
   - `tests/test_db.py`: a case calling `get_stats(conn, date_from,
     date_to)` with a range that includes only some of the seeded brews,
     asserting `total_brews` narrows correctly and at least one
     `per_drink` entry has `count: 0` while still being present in the
     list (edge case 6).
   - `tests/test_db.py`: a case for `get_machine_health` with a range,
     asserting `brew_count`/`last_brew` narrow but `last_maintenance` is
     unaffected by the range.
   - `tests/test_api.py`: `GET /api/stats?from=...&to=...` narrows the
     JSON response; `GET /api/stats?from=2026-09-20&to=2026-09-01`
     returns 400.

3. Manual verification in the browser:
   - `uv run seed` (rebuild `brewops.db` from `data/inbox/`).
   - `uv run start`, open `http://localhost:8123`.
   - Confirm the page loads with all-time totals exactly as before this
     change (compare total_brews to a known baseline, e.g. from
     `uv run pytest -k test_stats_math` output or a quick manual count).
   - Pick a `From` date only: totals should shrink, per-day chart should
     truncate at the start.
   - Add a `To` date narrower than the data range: totals should shrink
     further.
   - Pick a range with no brews in it (e.g. a range entirely before the
     dataset starts): stat tiles show `0`, per-drink bars all show `0`,
     timeline chart is empty (no bars, no JS error in console), machine
     cards show "never" for last brew.
   - Manually edit the URL to something like
     `/api/stats?from=2026-09-20&to=2026-09-01` (from after to) — confirm
     it returns HTTP 400 with a clear message, via curl or the browser's
     network tab, not a crash.
   - Click "Clear" — dashboard returns to the same all-time totals as the
     initial load.
   - Submit the "Log a brew" form while a range filter is active —
     confirm `loadDashboard()` re-runs and respects the still-active
     filter after the reload (existing `submitForm` at line 149 already
     calls `await loadDashboard()` after a successful POST, so this
     should work automatically once `loadDashboard()` reads the filter
     inputs — no separate change needed, just verify it).
   - After any backend Python edit, restart `uv run start` — it does not
     hot-reload (documented in `CLAUDE.md`).
