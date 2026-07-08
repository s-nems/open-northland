---
description: Research and author (or reconcile/prune) a docs/plans/ implementation plan in the house format.
argument-hint: <topic to plan, or an existing docs/plans/<file>.md to reconcile>
---

You are writing or maintaining a plan under `docs/plans/` — the live planning surface. Plans are
consumed one step at a time by `/worktree` in FRESH sessions: the executing agent sees only the
plan file and the repo, never this conversation. Write for that reader. The task: **$ARGUMENTS**.
If it is empty, ask what to plan.

## If the task names a new topic

1. **Research first, against the real sources.** Verify every factual claim before writing it
   down: the game data (`../Cultures 8th Wonder`, readable `.ini` preferred), the OpenVikings
   format oracle, and the CURRENT code seams (cite file + symbol; line numbers only as
   "research-time refs — re-verify"). Separate pinned facts from unknowns; an unknown becomes a
   named calibration constant or an explicit investigate-first step, never a guess.
2. **Match the house format** (model on the existing plans): a goal paragraph; a dated
   research-basis list naming the source of each fact; one checkbox per step; one self-contained
   prompt block per step carrying context (with the re-verify warning — plans are research
   output, not ground truth), deliverables, verification (which gates, whether goldens may move,
   the human sign-off seam for anything visual/audio), and guardrails (the `AGENTS.md` rules the
   step can trip).
3. **Size each step for one worktree session**, order by dependency, say which steps are
   severable, and state what is out of scope.
4. Register the plan in `docs/README.md`'s plan list.

## If the task names an existing plan

Reconcile it against reality — plans drift when steps land without the bookkeeping:

- Verify each unticked step against the actual code: a step may have landed unticked. Check the
  real files, then tick with a one-line landed note. The checkbox is the ONLY status marker.
- Fix stale research claims against the current sources — correct them, don't propagate.
- Delete the prompt blocks of merged steps (the checkbox and progress note carry the state; git
  history keeps the prompt). Delete the whole file when everything landed and no decision is
  pending — and remove its entry from `docs/README.md`.

Either way: never create side ledgers (lessons / tech debt / fidelity / roadmap). Durable rules
graduate to `AGENTS.md` or a package-local `AGENTS.md`; everything else lives in the plan or dies
with it.
