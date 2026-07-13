# docs/tickets/ — the work tracker

One file = one self-contained task. This is the only live tracker: work that is real but not being
done right now lives here as a ticket, or it is lost. (`docs/plans/` was retired 2026-07-12; git
history keeps the old plans.)

Folders:

- `features/` — player-visible gameplay slices (a mechanic, a HUD element, a content system).
  Usually cross-package; grouped by what the player gets, not by code area.
- `sim/`, `render/`, `app/`, `pipeline/`, … — scoped technical work (refactors, perf, extraction,
  test gaps) grouped by the package it lives in.

Rules:

- **One ticket, one task.** Small enough for a single `/worktree` session. If it needs phases,
  split it into ordered tickets and name the dependency in each (`Blocked by: <file>`).
- **Self-contained.** Written for an agent with no memory of the discovering conversation: context
  (why it matters, where it came from), concrete scope, and how to verify. Tickets are research
  notes, not ground truth — the executor re-verifies claims against the code and sources.
- **Source basis named.** A ticket that touches mechanics, extraction, or visuals states what pins
  it: extracted `.ini`/`.cif` data, OpenVikings format evidence, or observed original behavior.
  An unknown becomes an explicit investigate-first item, never a guess.
- **Dedupe before filing.** Grep this folder first; extend or sharpen an existing ticket instead of
  filing a near-duplicate. Delete a ticket that code reality has made obsolete (say why in the
  commit).
- **Lifecycle:** a ticket is open while its file exists; the executing branch **deletes the file in
  the same commit** that completes the work (git history is the archive — no status fields, no
  done/ folder). Partially done → rewrite the file to exactly the remaining work.
- **Priority is part of the header.** `P1` = unblocks a playable, correct game (playability chain,
  correctness of core systems); `P2` = real player value or measured performance; `P3` = polish,
  test hardening, refactors. Pick the highest open `P1` whose `Blocked by:` chain is clear; among
  equals, prefer the one that unblocks others. Re-stamp a priority when reality changes — it is a
  judgement snapshot, not a contract.
- **`Needs user:` marks non-autonomous tickets.** A ticket that needs a live decision or the
  user's eyes/ears mid-execution (not just final sign-off) carries a `**Needs user:**` line after
  the header. Agents must not pick these up autonomously — surface them to the user instead.

How tickets get filed (any agent, any session — not just `/worktree`):

- work discovered mid-task but deliberately deferred → file it before the session ends;
- review findings accepted as real but left out of a merge → file them on the same branch;
- `/refactor-cleanup` findings diagnosed but dropped (out of scope, needs a behavior change) →
  filed, not just reported;
- `/ticket-scout` — the proactive sweep that scans a scope for ticket candidates and files them.

Run one via `/worktree docs/tickets/<folder>/<name>.md`.

Template:

```markdown
# <imperative title>

**Area:** <package(s)> · **Origin:** <review/branch/scout/date> · **Priority:** <P1|P2|P3>
**Needs user:** <only if not autonomously runnable — why>
**Blocked by:** <path(s) of prerequisite ticket(s), if any>

<Context: why this matters, what was observed, source basis if relevant.>

## Scope

<Concrete changes, files, and the approach if one was already agreed.>

## Verify

<Gates + any scene/browser check; name the human sign-off seam for anything visual/audio.>
```
