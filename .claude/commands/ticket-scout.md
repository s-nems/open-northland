---
description: Scan a scope for ticket-worthy work and file it as docs/tickets/ entries — discovery only, changes no code.
argument-hint: [scope: sim|render|app|pipeline|path|feature] [focus, e.g. perf, test gaps, features]
---

# Ticket Scout

Sweep the scope in `$ARGUMENTS` for work worth a `/worktree` session and file each find as a
self-contained ticket under `docs/tickets/` (per `docs/tickets/README.md`). This command **edits no
code** — its entire output is new/updated ticket files plus a ranked report. With no scope, sweep
the whole repo at coarse granularity; with a scope, go deep in it.

## 1. Load the baseline

- Read `docs/tickets/` in full first — every existing ticket is a dedupe anchor. Filing a
  near-duplicate is a defect of the pass; sharpen the existing file instead.
- Read `AGENTS.md` plus the package-local `AGENTS.md` of each package in scope: candidates are
  judged against the project's actual rules, not generic taste.

## 2. Hunt on parallel signals

Spawn parallel subagents (one message), each on a different signal, scoped to the scope:

- **Structure** — run `npm run scan:structure`; overgrown modules, flat directories, mixed concerns.
- **Marked debt** — grep for TODO / FIXME / placeholder / stub / "deferred" / "follow-up" /
  "APPROXIMAT" comments; each is a claim that work exists — verify it still does.
- **Scaling** — per-tick sim or per-frame render code whose cost grows with the world instead of
  active work / the screen (golden rules 6–7).
- **Feature gaps** — content the pipeline extracts that no system consumes, `content/` IR lanes
  with no binding, stubbed mechanics, scenes the docs promise but `scenes/index.ts` lacks. These
  become `features/` tickets.
- **Test gaps** — player-visible mechanics without an acceptance scene; risky seams with no test at
  the lowest useful level.

## 3. Triage ruthlessly

The tracker's value is that everything in it is real; guard that before adding to it.

- Re-read the cited code yourself before accepting a candidate — subagents are wrong in both
  directions.
- The bar: **would a `/worktree` session on this ticket leave the project clearly better, and would
  you defend that to the user?** Style-only nits, speculative abstractions, and "could be nicer"
  observations fail the bar. Prefer a handful of load-bearing tickets over a swarm.
- A candidate that is really a defect (wrong behavior, broken gate) is still a ticket — mark it as
  such in the title; do not fix it in this pass.
- Note mid-report anything real but too large for one session: split it into ordered tickets with
  `Blocked by:` links rather than filing one monster.

## 4. File and report

- Write each survivor as a ticket per the `docs/tickets/README.md` template: `features/` for
  player-visible slices, the area folder for scoped technical work. Self-contained context, concrete
  scope, verification, source basis where mechanics/extraction are involved.
- Do not commit unless the user asks; leave the new files for their review.
- Report: filed tickets ranked by value (one line each: path — why it earns a session), then
  candidates dropped in triage with the concrete reason. Zero survivors is a valid result — say so
  rather than filing filler.
