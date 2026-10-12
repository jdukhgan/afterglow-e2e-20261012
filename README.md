# Afterglow

A small evening micro-adventure planner with fictional ideas, an original dusk programme, mood/time filters, and saved/planned/tried states. Add, edit and delete evenings in one keyboard-accessible editor. Python 3.13 standard library and SQLite; vanilla web components and self-hosted OFL fonts. No runtime packages or build step.

## Run

```sh
python3 server.py --port 8767 --db .kandev/data/activities.sqlite3
```

Open http://127.0.0.1:8767/. The server binds **127.0.0.1 only**. The database is outside the public assets. The seven examples in `web/fixtures.json` seed a new database once; deleting everything remains empty after restart. Preserve the database when updating the app.

## Retained worker preview

Canonical checkout: `/home/kandev/.kandev/tasks/task-fff30f6d-eb79-493a-a4ab-31a8915aab47` (native delivery workspace inherits the completed Designer checkout).
Service: `jlab-preview-afterglow-e2e-20261012.service`, a non-transient enabled systemd user service with worker user linger enabled. Its unit is in `docs/runtime/`; install only on the authorized project worker:

```sh
install -D -m 644 docs/runtime/jlab-preview-afterglow-e2e-20261012.service ~/.config/systemd/user/jlab-preview-afterglow-e2e-20261012.service
systemctl --user daemon-reload
systemctl --user enable --now jlab-preview-afterglow-e2e-20261012.service
systemctl --user show jlab-preview-afterglow-e2e-20261012.service -p ActiveState -p MainPID -p Transient -p UnitFileState
```

Retained DB: `/home/kandev/.kandev/tasks/task-fff30f6d-eb79-493a-a4ab-31a8915aab47/.kandev/data/activities.sqlite3`.
Health: http://127.0.0.1:8767/api/health. Restart and stop:

```sh
systemctl --user restart jlab-preview-afterglow-e2e-20261012.service
systemctl --user stop jlab-preview-afterglow-e2e-20261012.service
journalctl --user -u jlab-preview-afterglow-e2e-20261012.service
```

The operator's existing temporary Mac loopback bridge is http://127.0.0.1:8335/, forwarding over pinned SSH to worker loopback 8767. The app accepts those two configured loopback Host ports and same-origin JSON writes. This route is temporary preview access, not deployment. Worker health does not establish owner access; the operator observes the owner browser separately. No agent shell keeps the preview alive.

## Verify

```sh
python3 -m unittest discover -s tests -v
node ~/.agents/skills/jlab-dev-v1-implementation/browser-test.cjs --config=playwright.config.cjs
```

The worker harness uses its installed matched Playwright/Chromium; it downloads no dependencies. Browser tests launch their own loopback 8778 service and temporary database, seed realistic examples between tests and close both server/browser resources automatically. They never mutate the retained preview data. API tests use disposable databases and assigned ports.

Focused coverage: real CRUD/reload persistence; filters/reset; server limits, enums, IDs, malformed/duplicate JSON, SQL/asset boundaries and origin checks; empty restart; failed/delayed save, status and delete with retry, draft/list continuity and focus after unlock; stale GET immunity; committed state after failed refresh; overlapping notices; phone keyboard and reduced motion. Independent Reviewer/Verifier own their acceptance gates and additional visual coverage. The UI has one dusk theme, as specified in `DESIGN.md`.

API: `GET/POST /api/activities`, `PATCH/DELETE /api/activities/:id`, `GET /api/health`. Listing supports `mood`, `max_duration` (duration ≤ available time), and `status`. Errors use `{error:{message,fields?}}`. Client validation mirrors server title/place/note limits of 120/160/1000 Unicode code points. Pending editor fields retain their DOM/draft; close is paused with an explanation. Pending status saves pause editing/filter navigation with an accessible explanation. Committed mutation responses immediately become current state; older reads cannot roll them back.
