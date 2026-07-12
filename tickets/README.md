# tickets/ — deferred work items

The follow-up tracker: one file = one self-contained task, grouped by area subfolder (`sim/`,
`render/`, `app/`, `pipeline/`, …). This is where work lands when it is real but **out of scope for
the branch that discovered it** — typically review findings deferred at merge time, or ideas noted
mid-step. `docs/plans/` is legacy (user decision 2026-07-12): don't add new work there; existing
plans stay readable until their steps land or move here.

Rules:

- **One ticket, one task.** Small enough for a single `/worktree` session. If it needs phases, it
  needs to be split.
- **Self-contained.** Written for an agent with no memory of the discovering conversation: context
  (why it matters, where it came from), concrete scope, and how to verify. Name the source basis
  when the ticket touches mechanics or extraction.
- **Lifecycle:** a ticket is open while its file exists; the executing branch **deletes the file in
  the same commit** that completes the work (git history is the archive — no status fields, no done/
  folder).
- Run one via `/worktree tickets/<area>/<name>.md`.

Template:

```markdown
# <imperative title>

**Area:** <package(s)> · **Origin:** <review/branch/date>

<Context: why this matters, what was observed, source basis if relevant.>

## Scope

<Concrete changes, files, and the approach if one was already agreed.>

## Verify

<Gates + any scene/browser check.>
```
