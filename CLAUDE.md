# BrewOps

Telemetry app for the office coffee machines. Python (FastAPI) + SQLite, vanilla-JS frontend, no build step.

## Architecture

Pipeline: **ingest → db → api → frontend**, all in `src/brewops/`.

- `ingest/loader.py` — parses inbox CSVs, validates rows, inserts via `db/queries.py`. `ingest/cli.py` wires up the `ingest`/`seed` console scripts.
- `db/schema.py` — table definitions (`machines`, `drink_types`, `brew_events`, `maintenance_events`) and reference data (the 4 machines, 6 drink types). `db/connection.py` opens the sqlite3 connection (path from `$BREWOPS_DB`, default `./brewops.db`). `db/queries.py` is the single point of DB access — no ORM, raw `sqlite3` with `Row` factory.
- `api/main.py` — FastAPI app. Endpoints call straight into `queries.py` and return its dicts as JSON; no `response_model` filters the output, so a new key added to a query's return dict flows to the API unchanged. Also serves the static frontend at `/`.
- `frontend/app.js` — fetches `/api/*`, renders dashboard stats and machine health cards. No framework, no build step — edit and reload.

## Ingestion paths

Two ways brew data gets in, both landing in the same `brew_events` table (`source` column distinguishes them):

1. **CSV telemetry** — `data/inbox/brews_*.csv` (columns: `machine_id, drink, timestamp, duration_s, temp_c`), loaded with `source='csv'`. Machines with `has_telemetry=1` report this way.
2. **Manual entry** — either `data/inbox/manual_*.csv` (same columns, `source='manual'` — used for Old Faithful, which predates telemetry and is logged by hand) or the dashboard's log-a-brew form, which POSTs to `/api/brews`.

Maintenance events (`data/inbox/maintenance_*.csv`, columns: `machine_id, type, timestamp, note, error_code`) load the same way, or via the dashboard's maintenance form → `POST /api/maintenance`.

Ingestion is filename-driven (`ingest_file` in `loader.py` branches on the `brews`/`manual`/`maintenance` prefix) and tolerant: invalid rows are skipped and reported, the rest of the file still loads. Timestamps are naive local time, `'YYYY-MM-DD HH:MM:SS'`, and rejected if they're unparsable or in the future.

## Running and testing

- `uv run seed` — wipes and rebuilds `brewops.db` from `data/inbox/`. Run this first.
- `uv run start` — serves the app at http://localhost:8123.
- `uv run ingest [path]` — ingest one CSV or a folder (default `data/inbox`) without resetting the DB.
- `uv run pytest` — unit tests (`tests/test_db.py`, `test_ingest.py`) plus API tests (`test_api.py`) run against a **custom minimal ASGI client** (`tests/asgi_client.py`) — the repo deliberately has no `httpx`, so Starlette's `TestClient` isn't available. API tests point `$BREWOPS_DB` at a temp file via `monkeypatch`.
- After editing backend Python while `uv run start` is already running, **restart the server** — it doesn't hot-reload.

## Conventions

- All timestamps: naive local `'YYYY-MM-DD HH:MM:SS'` strings, never timezone-aware, never in the future.
- SQL tie-breaks (e.g. "most-brewed drink") should sort on `drink_types.name` (the machine-readable key), not `.label`, to stay deterministic and match existing tooling.
- `queries.py` functions return plain dicts/lists (JSON-serializable), not model instances — the API layer passes them through as-is.
- Adding a new drink type end-to-end (DB, API validation, dropdowns, stats) is covered by the `add-drink-type` skill — use it rather than hand-editing each spot.
