# Commit a desktop end-to-end harness

**Area:** desktop/tooling · **Origin:** desktop-packaging review 2026-07-16 · **Priority:** P3

The shell's wizard → pipeline → game-boot flow was verified with ad-hoc Playwright `_electron`
sessions that lived in a scratchpad and are gone. Regressions in that flow (protocol routing, IPC,
staleness routing, the cancel path) currently surface only when a human runs the app.

## Scope

- A local-only e2e suite (like `test:content`: hard-fails without prerequisites, never runs in CI)
  driving the built shell with Playwright's `_electron`:
  - first-run wizard against `OPEN_NORTHLAND_DATA_DIR=<fresh dir>` — pick phase renders, a fake
    game dir probes invalid, Cancel returns to pick;
  - staleness variants via a fabricated data root (no manifest / wrong `irVersion` / current) —
    assert the note wording, button labels, and that `ready` boots the game page;
  - a full real-copy conversion behind an explicit opt-in env var (it takes minutes).
- Wire an npm script (e.g. `test:desktop`) and document it in `packages/desktop/AGENTS.md`
  (replacing the "no committed harness yet" note).

## Gotcha: isolate Electron's profile, not just the data root

`electron.launch` must pass `--user-data-dir=<temp dir>`. `main.ts` gates startup on
`app.requestSingleInstanceLock()` and calls `app.quit()` when it loses — the process then exits 0
with no window and no output, which reads exactly like a crashed harness. The lock keys off
Electron's `userData`, NOT `OPEN_NORTHLAND_DATA_DIR`, so setting the data root alone does not isolate
a run: any other instance on the same profile takes it, including the developer's own installed
OpenNorthland.app. Verified 2026-07-17 during the content-routes/desktop cleanup — a scratchpad
`_electron` harness failed this way until the flag was added, and the same run then passed 16 checks
(pick phase, IPC round-trips, a real game-folder probe, install → run phase → cancel).

## Verify

The suite passes locally against the owned game copy; a deliberately broken protocol route or
staleness classification fails it.
