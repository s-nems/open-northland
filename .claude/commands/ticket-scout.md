---
description: Find valuable deferred work in a scope and file concise tickets without changing code.
argument-hint: [sim|render|app|pipeline|path|feature] [focus]
---

# Ticket scout

Scan `$ARGUMENTS` for work worth a dedicated `/worktree` session. Edit only ticket files and return a
ranked report. With no scope, scan the repository at coarse granularity.

## Load context without flooding it

Read root and relevant package `AGENTS.md` files. Build a ticket index from file paths, headings,
metadata, and grep terms. Read full ticket bodies only for likely duplicates or dependencies. Do not
load the entire tracker into context.

## Search independent signals

Run these in parallel when the client supports it:

- structure and ownership problems in the scoped code and callers;
- verified TODO, FIXME, placeholder, deferred, or approximation markers;
- per-tick or per-frame work that breaks the project scale budgets;
- extracted content with no consumer or a clearly stubbed player feature;
- risky behavior lacking a useful test or acceptance scene.

## Triage

Re-read each cited source before accepting a candidate. A ticket must be:

- real in the current code;
- valuable enough for a separate session;
- bounded enough to complete or split into ordered dependencies;
- concrete about scope and verification;
- absent from the existing tracker.

Reject style preferences, speculative abstractions, unverified suspicions, and tiny observations that
are cheaper to fix when their code is next touched. Zero new tickets is a valid result.

## File and report

Use the template in `docs/tickets/README.md`. Put player-visible slices in `features/` and technical
work in the owning area. Update an existing ticket when the candidate is a duplicate with better
evidence.

Do not change production code or commit unless asked. Report filed or updated tickets by value, then
list rejected candidates with a short reason.
